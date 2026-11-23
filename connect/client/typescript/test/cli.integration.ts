import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import os from 'node:os';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';

// Explicit integration lane: unlike owner-local tests, this requires a rebuilt
// native composition binary. Missing prerequisites fail rather than skip.
const binary = process.env.APPARENT_CONNECT_TEST_BINARY;
if (!binary || !path.isAbsolute(binary)) throw Error('Set APPARENT_CONNECT_TEST_BINARY to the rebuilt absolute apparent binary');

test('Connect alternatives runs through the real CLI without login or config writes', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'connect-alternatives-'));
  await chmod(root, 0o700);
  t.after(() => rm(root, { recursive: true, force: true }));
  const config = path.join(root, 'config.json');
  for (const name of ['connect', 'cloud']) {
    const output = execFileSync(binary, [name, 'alternatives'], {
      encoding: 'utf8', env: { ...process.env, APPARENT_CONFIG: config }, timeout: 10_000,
    });
    assert.match(output, /waitlisted accounts cannot approve devices/);
    assert.match(output, /scp -r/);
    assert.match(output, /do not enable remote access/);
  }
  await assert.rejects(stat(config), { code: 'ENOENT' });
});

test('real Connect/cloud shares CLI preserves service rows, pagination and safe failures', { timeout: 120_000 }, async () => {
  const installedApp = process.env.APPARENT_CONNECT_TEST_INSTALLED_APP;
  if (installedApp) {
    assert.equal(process.platform, 'darwin', 'Installed Mac proof requires macOS');
    assert.ok(path.isAbsolute(installedApp));
    assert.equal(binary, path.join(installedApp, 'Contents/MacOS/apparent'));
    const settings = path.join(installedApp, 'Contents/Resources/settings');
    for (const executable of [binary, path.join(settings, 'runtime/Electron.app/Contents/MacOS/Electron')]) {
      const metadata = await stat(executable);
      assert.ok(metadata.isFile() && (metadata.mode & 0o111) !== 0, 'Packaged executable required');
    }
    const packaged = path.join(settings, 'app/connect-client');
    assert.deepEqual(JSON.parse(await readFile(path.join(packaged, 'package.json'), 'utf8')), { type: 'module' });
    assert.deepEqual(await readFile(path.join(packaged, 'dist/shares.js')),
      await readFile(new URL('../dist/shares.js', import.meta.url)), 'Installed policy must match this source build');
    assert.deepEqual(await readFile(path.join(packaged, 'dist/handoff.js')),
      await readFile(new URL('../dist/handoff.js', import.meta.url)), 'Installed handoff policy must match this source build');
  }
  const root = await realpath(await mkdtemp('/tmp/apparent-dev-shares-cli-'));
  await chmod(root, 0o700);
  const home = path.join(root, 'home');
  const state = path.join(home, '.config/apparent/hosted');
  await mkdir(state, { recursive: true, mode: 0o700 });
  const config = path.join(home, '.config/apparent/config.json');
  let mode: 'success' | 'denied' | 'wrong-url' = 'success';
  const requests: string[] = [];
  let origin = '';
  const prefix = 'opaque /?&+é';
  const cursor = prefix + '\0'.repeat(4096 - Buffer.byteLength(prefix));
  const cursorRoute = '/v1/shares?before=' + encodeURIComponent(cursor);
  const row = () => ({ id: 'a'.repeat(32), captureId: 'b'.repeat(32), status: 'ready',
    url: `${origin}/s/${'c'.repeat(64)}`, title: 'Synthetic recording',
    createdAt: '2026-11-10T00:00:00.000Z', expiresAt: '2026-11-17T00:00:00.000Z',
    extension: { retained: true } });
  const server = http.createServer((request, response) => {
    requests.push(request.url ?? '');
    if (request.headers.authorization !== 'Bearer synthetic-cli-read-token' || mode === 'denied') {
      response.writeHead(401, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: 'unauthorized', secret: 'synthetic-private-response' }));
      return;
    }
    response.setHeader('Content-Type', 'application/json');
    if (mode === 'wrong-url') {
      response.end(JSON.stringify({ shares: [{ ...row(), url: `https://other.example/s/${'c'.repeat(64)}` }], nextCursor: null }));
    } else if (request.url === '/v1/shares') {
      response.end(JSON.stringify({ shares: [row()], nextCursor: cursor }));
    } else if (request.url === cursorRoute) {
      response.end(JSON.stringify({ shares: [{ ...row(), id: 'd'.repeat(32), status: 'expired', url: null }], nextCursor: null }));
    } else {
      response.writeHead(404); response.end('{}');
    }
  });
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    origin = `http://127.0.0.1:${address.port}`;
    const settings = JSON.stringify({ unrelated: { retained: true }, cloud: { server: origin, enabled: false, uploadConsent: false } });
    const credential = JSON.stringify({ server: origin, site: origin, scope: 'read', token: 'synthetic-cli-read-token', generation: 'e'.repeat(32) });
    await writeFile(config, settings, { mode: 0o600 });
    await writeFile(path.join(state, 'read.credential'), credential, { mode: 0o600 });
    const invoke = (name = 'connect') => new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(binary, [name, 'shares', 'list'], {
        env: { ...process.env, HOME: home, APPARENT_CONFIG: config }, stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '', stderr = '';
      let failure: Error | undefined;
      const stop = (message: string) => { failure ??= Error(message); child.kill('SIGKILL'); };
      const timer = setTimeout(() => stop('Owned CLI exceeded 20-second fixture deadline'), 20_000);
      child.stdout.on('data', chunk => { stdout += chunk; if (stdout.length > 1_000_000) stop('Owned CLI exceeded fixture output budget'); });
      child.stderr.on('data', chunk => { stderr += chunk; if (stderr.length > 1_000_000) stop('Owned CLI exceeded fixture output budget'); });
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.on('close', code => { clearTimeout(timer); if (failure) reject(failure); else resolve({ code, stdout, stderr }); });
    });
    for (const name of ['connect', 'cloud']) {
      requests.length = 0;
      const result = await invoke(name);
      assert.equal(result.code, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), { shares: [row(), { ...row(), id: 'd'.repeat(32), status: 'expired', url: null }], nextCursor: null });
      assert.deepEqual(requests, ['/v1/shares', cursorRoute]);
      assert.ok(!result.stdout.includes('synthetic-cli-read-token'));
    }
    mode = 'wrong-url';
    const malformed = await invoke();
    assert.notEqual(malformed.code, 0);
    assert.equal(malformed.stdout, '');
    assert.match(malformed.stderr, /Invalid share URL/);
    mode = 'denied';
    const denied = await invoke();
    assert.notEqual(denied.code, 0);
    assert.equal(denied.stdout, '');
    assert.match(denied.stderr, /unauthorized|auth_required/);
    assert.ok(!denied.stderr.includes('synthetic-private-response'));
    assert.ok(!denied.stderr.includes('synthetic-cli-read-token'));
    assert.equal(await readFile(config, 'utf8'), settings);
    const afterDenial = JSON.parse(await readFile(path.join(state, 'read.credential'), 'utf8'));
    assert.equal(afterDenial.token, 'synthetic-cli-read-token');
    assert.equal(afterDenial.authRequired, true);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

test('headless account request rotates the grant using the embedded renewal policy', { timeout: 30_000 }, async t => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'connect-renewal-cli-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = path.join(root, 'home');
  const state = path.join(home, '.config/apparent/hosted');
  const config = path.join(home, '.config/apparent/config.json');
  const commands = path.join(root, 'bin');
  await mkdir(state, { recursive: true, mode: 0o700 });
  await mkdir(commands, { mode: 0o700 });
  const curl = execFileSync('/bin/sh', ['-c', 'command -v curl'], { encoding: 'utf8' }).trim();
  await symlink(curl, path.join(commands, 'curl'));
  const requests: { route?: string; authorization?: string; body: string }[] = [];
  const server = http.createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    requests.push({ route: request.url, authorization: request.headers.authorization, body });
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/v1/token/refresh') {
      response.end(JSON.stringify({
        scope: 'read', accessToken: 'synthetic-new-access', refreshToken: 'synthetic-new-refresh',
        grantId: 'synthetic-grant', expiresIn: 3600, refreshExpiresIn: 86400,
      }));
    } else if (request.url === '/v1/account' && request.headers.authorization === 'Bearer synthetic-new-access') {
      response.end(JSON.stringify({ approved: true }));
    } else {
      response.statusCode = 401;
      response.end('{}');
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.closeAllConnections();
    return new Promise<void>(resolve => server.close(() => resolve()));
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const origin = `http://127.0.0.1:${address.port}`;
  const credential = path.join(state, 'read.credential');
  const generation = 'a'.repeat(32);
  const now = Math.floor(Date.now() / 1000);
  await writeFile(config, JSON.stringify({ cloud: { server: origin } }), { mode: 0o600 });
  await writeFile(credential, JSON.stringify({
    server: origin, scope: 'read', token: 'synthetic-old-access', generation, grantId: 'synthetic-grant',
    refreshToken: 'synthetic-old-refresh', expiresAt: now - 1, refreshExpiresAt: now + 3600,
  }), { mode: 0o600 });
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(binary, ['connect', 'status', '--account'], {
      env: { ...process.env, PATH: commands, HOME: home, APPARENT_CONFIG: config },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`Headless Connect exited with ${code}: ${stderr}`));
    });
  });
  assert.deepEqual(JSON.parse(output).account, { approved: true });
  assert.deepEqual(requests.map(({ route, authorization }) => [route, authorization]), [
    ['/v1/token/refresh', undefined],
    ['/v1/account', 'Bearer synthetic-new-access'],
  ]);
  assert.deepEqual(JSON.parse(requests[0].body), { refreshToken: 'synthetic-old-refresh' });
  const saved = JSON.parse(await readFile(credential, 'utf8'));
  assert.equal(saved.generation, generation);
  assert.equal(saved.refreshToken, 'synthetic-new-refresh');
  assert.doesNotMatch(output, /synthetic-(?:old|new)-/);
});
