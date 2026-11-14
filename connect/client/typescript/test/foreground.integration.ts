import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {chmod, mkdtemp, readFile, readdir, realpath, rm, stat} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

const binary = process.env.APPARENT_CONNECT_TEST_BINARY;
if (!binary || !path.isAbsolute(binary)) throw Error('Set APPARENT_CONNECT_TEST_BINARY to the rebuilt absolute apparent binary');

function run(command: string, args: string[], env: NodeJS.ProcessEnv, timeout = 30_000) {
  return new Promise<{code: number | null; stdout: string; stderr: string}>((resolve, reject) => {
    const child = spawn(command, args, {env, stdio: ['ignore', 'pipe', 'pipe']});
    let stdout = '', stderr = '', failure: Error | undefined;
    const stop = (reason: string) => { failure ??= Error(reason); child.kill('SIGKILL'); };
    const timer = setTimeout(() => stop('Owned foreground CLI exceeded its deadline'), timeout);
    for (const [stream, name] of [[child.stdout, 'stdout'], [child.stderr, 'stderr']] as const) stream.on('data', chunk => {
      if (name === 'stdout') stdout += chunk; else stderr += chunk;
      if (stdout.length + stderr.length > 1_000_000) stop('Owned CLI exceeded output budget');
    });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => { clearTimeout(timer); failure ? reject(failure) : resolve({code, stdout, stderr}); });
  });
}

test('installed Connect foreground adapter uploads encrypted bundle and fetches exact plaintext', {timeout: 180_000}, async t => {
  const installedApp = process.env.APPARENT_CONNECT_TEST_INSTALLED_APP;
  if (installedApp) {
    assert.equal(process.platform, 'darwin');
    assert.equal(binary, path.join(installedApp, 'Contents/MacOS/apparent'));
    const settings = path.join(installedApp, 'Contents/Resources/settings');
    for (const executable of [binary, path.join(settings, 'runtime/Electron.app/Contents/MacOS/Electron')]) {
      const info = await stat(executable); assert.ok(info.isFile() && (info.mode & 0o111) !== 0);
    }
    const packaged = path.join(settings, 'app/connect-client');
    assert.deepEqual(JSON.parse(await readFile(path.join(packaged, 'package.json'), 'utf8')), {type: 'module'});
    assert.deepEqual(await readFile(path.join(packaged, 'dist/foreground.js')), await readFile(new URL('../dist/foreground.js', import.meta.url)));
  }

  const root = await realpath(await mkdtemp('/tmp/apparent-dev-connect-foreground-'));
  await chmod(root, 0o700); t.after(() => rm(root, {recursive: true, force: true}));
  const baseEnv = {...process.env, HOME: path.join(root, 'home'), XDG_CONFIG_HOME: path.join(root, 'home/.config'),
    APPARENT_CONFIG: path.join(root, 'home/.config/apparent/config.json'), APPARENT_CAPTURES_DIR: path.join(root, 'captures'), TMPDIR: path.join(root, 'tmp')};
  const {mkdir, writeFile} = await import('node:fs/promises');
  await mkdir(path.dirname(baseEnv.APPARENT_CONFIG!), {recursive: true, mode: 0o700});
  await mkdir(baseEnv.TMPDIR!, {recursive: true, mode: 0o700});
  await writeFile(baseEnv.APPARENT_CONFIG!, JSON.stringify({experiments: {connectForegroundUpload: true}, unrelatedFixtureMarker: 'preserved'}), {mode: 0o600});

  const fixture = fileURLToPath(new URL('./foreground-fixture.ts', import.meta.url));
  const service = spawn(process.execPath, ['--experimental-strip-types', fixture, 'serve', '--port', '0'], {env: baseEnv, stdio: ['ignore', 'pipe', 'pipe']});
  let serviceOutput = '', serviceError = '';
  service.stdout.on('data', chunk => { serviceOutput += chunk; }); service.stderr.on('data', chunk => { serviceError += chunk; });
  try {
    const origin = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(Error(`fixture startup timed out: ${serviceError}`)), 10_000);
      service.stdout.on('data', () => {
        const line = serviceOutput.split('\n').find(value => value.includes('"ready":true'));
        if (!line) return;
        clearTimeout(timer);
        try { resolve(JSON.parse(line).origin as string); } catch (error) { reject(error); }
      });
      service.once('exit', code => { clearTimeout(timer); reject(Error(`fixture exited ${code}: ${serviceError}`)); });
    });
    const recipientEnv = {...baseEnv, HOME: path.join(root, 'recipient-home'), XDG_CONFIG_HOME: path.join(root, 'recipient-home/.config'), APPARENT_CONFIG: path.join(root, 'recipient-home/.config/apparent/config.json')};
    await mkdir(path.dirname(recipientEnv.APPARENT_CONFIG!), {recursive: true, mode: 0o700});
    const readerLogin = await run(binary, ['connect', 'login', '--server', origin, '--scope', 'read', '--no-browser'], recipientEnv);
    assert.equal(readerLogin.code, 0, readerLogin.stderr);
    const login = await run(binary, ['connect', 'login', '--server', origin, '--scope', 'upload', '--consent-upload', '--no-browser'], baseEnv);
    assert.equal(login.code, 0, login.stderr);
    const savedConfig = JSON.parse(await readFile(baseEnv.APPARENT_CONFIG!, 'utf8'));
    assert.equal(savedConfig.experiments.connectForegroundUpload, true);
    assert.equal(savedConfig.unrelatedFixtureMarker, 'preserved');
    assert.equal(savedConfig.cloud.enabled, true);
    assert.equal(savedConfig.cloud.uploadConsent, true);
    const bundle = await run(process.execPath, ['--experimental-strip-types', fixture, 'bundle', '--root', root], baseEnv);
    assert.equal(bundle.code, 0, bundle.stderr);
    const bundlePath = JSON.parse(bundle.stdout.trim()).bundle as string;
    const upload = await run(binary, ['connect', 'upload', bundlePath], baseEnv, 90_000);
    assert.equal(upload.code, 0, upload.stderr);
    const id = /\b([a-f0-9]{32})\b/.exec(upload.stdout)?.[1];
    assert.ok(id, `foreground upload did not return a capture id: ${upload.stdout}`);
    const statusResponse = await fetch(`${origin}/__fixture/status`);
    assert.equal(statusResponse.status, 200);
    const status = await statusResponse.json() as {syntheticOnly: boolean; approvedLogins: number; captures: Array<{format: string; ready: boolean; files: number; received: boolean}>; calls: Record<string, number>};
    assert.equal(status.syntheticOnly, true);
    assert.equal(status.approvedLogins, 2);
    assert.deepEqual(status.captures, [{format: 'apparent-encrypted-v1', ready: true, files: 2, received: true}]);
    assert.ok(status.calls['PUT /v1/captures/:id/files/:path'] >= 2);
    assert.equal(status.calls['POST /v1/captures/:id/complete'], 1);
    assert.ok(status.calls['GET /v1/captures/:id'] >= 1, `manifest readback must occur after upload: ${JSON.stringify(status.calls)}`);
    const hostedState = path.join(baseEnv.HOME!, '.config/apparent/hosted');
    assert.equal((await readdir(hostedState)).filter(name => name.endsWith('.job')).length, 0, 'foreground path must not create legacy queue jobs');
    const fetched = path.join(root, 'recipient.apparent');
    const readback = await run(binary, ['fetch', id, '--out', fetched, '--wait', '0'], recipientEnv, 60_000);
    assert.equal(readback.code, 0, readback.stderr);
    const finalStatus = await (await fetch(`${origin}/__fixture/status`)).json() as typeof status;
    assert.ok(finalStatus.calls['GET /v1/captures/:id/files/:path'] >= 2, 'recipient must fetch encrypted files');
    const source = bundlePath, received = fetched;
    const files = ['apparent.json', 'summary.md', 'contact-sheet.png', 'frames/frame-0001.png'];
    for (const file of files) assert.deepEqual(await readFile(path.join(received, file)), await readFile(path.join(source, file)), file);
    assert.equal(service.exitCode, null);
  } finally {
    service.kill('SIGTERM');
    await new Promise<void>(resolve => { if (service.exitCode !== null) resolve(); else { const timer = setTimeout(() => { service.kill('SIGKILL'); resolve(); }, 2_000); service.once('exit', () => { clearTimeout(timer); resolve(); }); } });
  }
});
