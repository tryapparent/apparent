import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _electron as electron } from '@playwright/test';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { randomBytes } from 'node:crypto';
import { availablePort } from './testing/port.ts';
import { keyDirectory } from './key.ts';
import { tokenValid } from './protocol.ts';
import { mailboxId, sign, authenticatedState } from '../../../../../../hermes/desktop/controller.ts';
const root = fileURLToPath(new URL('../..', import.meta.url));
async function until(predicate: () => unknown, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) { if (Date.now() > deadline) throw new Error('Synthetic Hermes smoke timed out'); await new Promise(resolve => setTimeout(resolve, 20)); }
}
async function waitForKey(read: () => Promise<string>) {
  let key = '';
  await until(async () => {
    // publishKey creates the final path before writing its complete 32-hex key.
    try { key = await read(); return tokenValid(key); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return false;
    }
  });
  return key;
}
test('windowless key readiness waits for complete material and propagates read errors', async () => {
  const key = randomBytes(16).toString('hex');
  let reads = 0;
  const ready = await waitForKey(async () => {
    reads++;
    if (reads === 1) throw Object.assign(new Error('Not published'), { code: 'ENOENT' });
    if (reads === 2) return '';
    if (reads === 3) return key.slice(0, 16);
    return key;
  });
  assert.ok(ready === key, 'readiness must return the complete key');
  assert.equal(reads, 4);
  assert.ok((await sign(ready, 'state:synthetic')).length > 0);
  await assert.rejects(waitForKey(async () => {
    throw Object.assign(new Error('Denied'), { code: 'EACCES' });
  }), { code: 'EACCES' });
});
for (const needsLaunch of [false, true]) test(`real Electron confirmation/preload and bounded native CLI flow (${needsLaunch ? 'closed' : 'running'} recorder), then acknowledgement closes the bridge`, { timeout: 45000 }, async () => {
  const token = randomBytes(16).toString('hex');
  const job = await mkdtemp(path.join(tmpdir(), 'apparent-dev-hermes-native-'));
  const home = path.join(job, 'home'); await mkdir(home, { mode: 0o700 });
  const runtime = path.join(job, 'runtime'); await mkdir(runtime, { mode: 0o700 });
  const appData = path.join(job, 'app-data'); await mkdir(appData, { mode: 0o700 });
  const bootstrap = path.join(job, 'bootstrap.cjs');
  await build({ entryPoints: [path.join(root, 'src/hermes/testing/bootstrap.cts')], outfile: bootstrap, bundle: true, platform: 'node', format: 'cjs', external: ['electron'] });
  const appAssets = path.join(job, 'dist');
  await cp(path.join(root, 'dist'), appAssets, { recursive: true });
  await build({ entryPoints: { 'hermes-main': path.join(root, 'src/hermes/main.ts'), 'hermes-preload': path.join(root, 'src/hermes/preload.ts') },
    outdir: appAssets, bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outExtension: { '.js': '.cjs' } });
  const mainBundle = path.join(appAssets, 'hermes-main.cjs');
  const keyFile = path.join(process.platform === 'linux' ? runtime : keyDirectory(), 'apparent-hermes', `${token}.key`);
  const bridgePort = await availablePort();
  const id = await mailboxId(token);
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined;
  let passed = false;
  const diagnostics: unknown[] = [];
  const launch = async (port: number) => electron.launch({ args: [bootstrap, mainBundle, '--hermes-request', `${token}/${port}`, '--apparent-executable', path.join(root, 'src/hermes/testing/cli.ts')],
    env: { ...process.env, HOME: home, APPARENT_SYNTHETIC_APP_DATA: appData, XDG_RUNTIME_DIR: runtime, XDG_CONFIG_HOME: path.join(job, 'config'), APPARENT_SYNTHETIC_NEEDS_LAUNCH: needsLaunch ? '1' : '0', APPARENT_SYNTHETIC_RECEIPT: path.join(job, 'receipt.json'), APPARENT_SYNTHETIC_TRACE: path.join(job, 'trace.jsonl') } });
  try {
    application = await launch(bridgePort);
    assert.equal(await application.evaluate(({ app }) => app.getPath('userData')), path.join(appData, 'apparent-hermes'));
    const page = await application.firstWindow();
    const key = await readFile(keyFile, 'utf8');
    assert.notEqual(key, token);
    page.on('console', entry => diagnostics.push({ console: entry.text() }));
    page.on('requestfailed', request => diagnostics.push({ request: request.url(), failure: request.failure() }));
    page.on('response', response => { if (response.url().startsWith('http://127.0.0.1:')) diagnostics.push({ response: response.url(), status: response.status(), headers: response.headers() }); });
    await page.getByRole('button', { name: 'Record and send when finished' }).waitFor();
    const preflight = (await readFile(path.join(job, 'trace.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.ok(preflight.every(call => call[0] === 'capture' && call[1] === 'state'));
    assert.equal(await page.evaluate(() => typeof (window as any).require), 'undefined');
    const stateURL = `http://127.0.0.1:${bridgePort}/${id}/state/${await sign(key, `state:${id}`)}`;
    // Apparent deliberately has connect-src 'none': its UI uses only IPC.
    // Stock Hermes v0.23.0's index has no CSP. A separate file renderer models
    // that receiving boundary without weakening Apparent's production policy.
    const receiverHTML = path.join(job, 'hermes-receiver.html');
    await writeFile(receiverHTML, '<!doctype html><meta charset="UTF-8"><title>Synthetic Hermes receiver</title><main>Transport probe only</main>');
    const receiverReady = application.waitForEvent('window');
    await application.evaluate(async ({ BrowserWindow }, file) => {
      const receiver = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
      await receiver.loadFile(file);
    }, receiverHTML);
    const receiver = await receiverReady;
    receiver.on('console', entry => diagnostics.push({ receiverConsole: entry.text() }));
    receiver.on('request', request => { void request.allHeaders().then(headers => diagnostics.push({ receiverRequest: request.url(), headers })); });
    const rendererReply = await receiver.evaluate(async url => {
      const response = await fetch(url, { credentials: 'omit', cache: 'no-store', redirect: 'error' });
      return { status: response.status, type: response.type, body: await response.text(), headers: Object.fromEntries(response.headers) };
    }, stateURL);
    diagnostics.push({ rendererReply });
    assert.equal(rendererReply.status, 200);
    assert.deepEqual(await authenticatedState(key, JSON.parse(rendererReply.body)), { phase: 'confirm' });
    await receiver.close();
    assert.deepEqual(await authenticatedState(key, await (await fetch(stateURL, { headers: { Origin: 'null' } })).json()), { phase: 'confirm' });
    await page.getByRole('button', { name: 'Record and send when finished' }).click();
    await page.getByRole('status').filter({ hasText: 'Talk, point and draw.' }).waitFor({ state: 'attached' });
    assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(window => window.isVisible())), false,
      'confirmation must stay hidden while native recording is active');
    if (process.platform === 'darwin') {
      assert.equal(await application.evaluate(({ app }) => app.isHidden()), true, 'the entire confirmation app must hide on macOS');
      assert.equal(await application.evaluate(({ app }) => app.isActive()), false, 'the confirmation app must relinquish native focus');
    }
    await writeFile(path.join(job, 'receipt.json.finished'), '1');
    await page.getByText('Recording saved.', { exact: false }).waitFor();
    assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), true,
      'completion must be visible after the recording app was hidden');
    if (process.platform === 'darwin') assert.equal(await application.evaluate(({ app }) => app.isHidden()), false);
    assert.deepEqual(await authenticatedState(key, await (await fetch(stateURL, { headers: { Origin: 'null' } })).json()),
      { phase: 'saved', bundlePath: '/synthetic/owned.apparent', remoteSource: null, source: '/synthetic/owned.apparent' });
    const calls = (await readFile(path.join(job, 'trace.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.equal(calls.filter(c => c[0] === 'launch').length, needsLaunch ? 1 : 0, 'only an unavailable recorder should be launched');
    assert.equal(await page.title(), 'Record for Hermes');
    assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle()), 'Record for Hermes');
    assert.equal(calls.filter(c => c[1] === 'start').length, 1);
    assert.ok(calls.filter(c => ['inspect', 'handoff'].includes(c[1])).every(c => c[2] === token));
    assert.ok(!calls.some(c => ['stop', 'cancel'].includes(c[1])));
    // Cross-origin callers cannot acknowledge or read this recording.
    assert.equal((await fetch(stateURL, { headers: { Origin: 'https://example.invalid' } })).status, 403);
    assert.equal((await fetch(`http://127.0.0.1:${bridgePort}/${id}/ack/${await sign(token, `ack:${id}`)}`, { method: 'POST', headers: { Origin: 'null' } })).status, 404);
    await fetch(`http://127.0.0.1:${bridgePort}/${id}/ack/${await sign(key, `ack:${id}`)}`, { method: 'POST', headers: { Origin: 'null' } });
    await new Promise<void>(resolve => { if (application!.process().exitCode !== null) resolve(); else application!.process().once('exit', () => resolve()); });
    await assert.rejects(readFile(keyFile), { code: 'ENOENT' });
    if (!needsLaunch) {
      // A genuine second launch in the same private app state must still refuse
      // the consumed ID. Test isolation must not weaken persistent replay safety.
      application = await launch(await availablePort());
      const replay = await application.firstWindow();
      await replay.getByRole('button', { name: 'Record and send when finished' }).click();
      await replay.getByText('Any recording already started remains in Apparent. Nothing is retried automatically.').waitFor();
      const after = (await readFile(path.join(job, 'trace.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
      assert.equal(after.filter(call => call[1] === 'start').length, 1, 'replayed ID must never start another take');
      assert.equal(after.filter(call => call[0] === 'launch').length, 0);
    }
    passed = true;
  } catch (error) {
    const view = await application?.windows()[0]?.evaluate(() => (window as any).hermesRecording.read()).catch(() => undefined);
    const trace = await readFile(path.join(job, 'trace.jsonl'), 'utf8').catch(() => 'unavailable');
    console.error('Synthetic Hermes smoke failure', { view, trace });
    throw error;
  } finally {
    await writeFile(path.join(job, 'diagnostics.json'), JSON.stringify(diagnostics, null, 2));
    await application?.close().catch(() => {});
    if (passed) await rm(job, { recursive: true, force: true }); else console.log(`Failed synthetic bridge evidence: ${job}`);
  }
});

test('trusted local autostart records through the signed mailbox without creating a Hermes-facing window', { timeout: 45000 }, async () => {
  const token = randomBytes(16).toString('hex');
  const job = await mkdtemp(path.join(tmpdir(), 'apparent-dev-hermes-autostart-'));
  const home = path.join(job, 'home'); await mkdir(home, { mode: 0o700 });
  const runtime = path.join(job, 'runtime'); await mkdir(runtime, { mode: 0o700 });
  const appData = path.join(job, 'app-data'); await mkdir(appData, { mode: 0o700 });
  const bootstrap = path.join(job, 'bootstrap.cjs');
  await build({ entryPoints: [path.join(root, 'src/hermes/testing/bootstrap.cts')], outfile: bootstrap, bundle: true, platform: 'node', format: 'cjs', external: ['electron'] });
  const mainBundle = path.join(job, 'hermes-main.cjs');
  await build({ entryPoints: [path.join(root, 'src/hermes/main.ts')], outfile: mainBundle, bundle: true, platform: 'node', format: 'cjs', external: ['electron'] });
  const keyFile = path.join(process.platform === 'linux' ? runtime : keyDirectory(), 'apparent-hermes', `${token}.key`);
  const port = await availablePort(); const id = await mailboxId(token);
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined; let passed = false;
  try {
    application = await electron.launch({ args: [bootstrap, mainBundle, '--hermes-request', `${token}/${port}`, '--hermes-autostart', '--apparent-executable', path.join(root, 'src/hermes/testing/cli.ts')],
      env: { ...process.env, HOME: home, APPARENT_SYNTHETIC_APP_DATA: appData, XDG_RUNTIME_DIR: runtime, XDG_CONFIG_HOME: path.join(job, 'config'), APPARENT_SYNTHETIC_NEEDS_LAUNCH: '1', APPARENT_SYNTHETIC_STARTUP_DELAY_MS: '8000', APPARENT_SYNTHETIC_RECEIPT: path.join(job, 'receipt.json'), APPARENT_SYNTHETIC_TRACE: path.join(job, 'trace.jsonl') } });
    // A windowless launch has no firstWindow() readiness barrier. The complete key is
    // published only after the bridge binds; launch() can resolve before that.
    const key = await waitForKey(() => readFile(keyFile, 'utf8'));
    const stateURL = `http://127.0.0.1:${port}/${id}/state/${await sign(key, `state:${id}`)}`;
    const readState = async () => authenticatedState(key, await (await fetch(stateURL, { headers: { Origin: 'null' } })).json());
    await until(async () => (await readState() as any)?.phase === 'recording', 20000);
    assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 0);
    const calls = (await readFile(path.join(job, 'trace.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.ok(calls.some(call => call[0] === 'launch' && call[1] === '--background'));
    assert.equal(calls.filter(call => call[1] === 'start').length, 1);
    await writeFile(path.join(job, 'receipt.json.finished'), '1');
    await until(async () => (await readState() as any)?.phase === 'saved');
    assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 0);
    const ackURL = `http://127.0.0.1:${port}/${id}/ack/${await sign(key, `ack:${id}`)}`;
    assert.equal((await fetch(ackURL, { method: 'POST', headers: { Origin: 'null' } })).status, 200);
    await new Promise<void>(resolve => { if (application!.process().exitCode !== null) resolve(); else application!.process().once('exit', () => resolve()); });
    await assert.rejects(readFile(keyFile), { code: 'ENOENT' });
    passed = true;
  } finally {
    await application?.close().catch(() => {});
    if (passed) await rm(job, { recursive: true, force: true }); else console.log(`Failed synthetic autostart evidence: ${job}`);
  }
});

test('composer recording action never submits an unsent draft by mouse or keyboard', { timeout: 45000 }, async () => {
  const job = await mkdtemp(path.join(tmpdir(), 'apparent-dev-hermes-button-'));
  const main = path.join(job, 'main.cjs');
  const renderer = path.join(job, 'renderer.js');
  const html = path.join(job, 'composer.html');
  const sdk = path.resolve(root, '../../../../hermes/desktop/testing/sdk.ts');
  const plugin = path.resolve(root, '../../../../hermes/desktop/plugin.ts');
  await build({ stdin: { contents: `import { app, BrowserWindow } from 'electron';
    app.setPath('appData', process.env.HOME!); app.setPath('userData', process.env.HOME!);
    app.whenReady().then(() => { const view = new BrowserWindow({ show: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
      void view.loadFile(process.argv[2]); });`, loader: 'ts', resolveDir: root },
    outfile: main, bundle: true, platform: 'node', format: 'cjs', external: ['electron'] });
  await build({ stdin: { contents: `import React from 'react';
    import { createRoot } from 'react-dom/client';
    import plugin from ${JSON.stringify(plugin)};
    window.recordingChecks = { submissions: 0, notices: [] };
    let control;
    plugin.register({ onDispose() {}, setInterval() { return () => {}; },
      storage: { get() { return null; }, async set() {} },
      register(item) { if (item.id === 'record') control = item.render; } });
    createRoot(document.getElementById('root')).render(React.createElement('form', {
      onSubmit(event) { event.preventDefault(); window.recordingChecks.submissions++;
        document.querySelector('textarea').value = ''; }
    }, React.createElement('textarea', { 'aria-label': 'Draft' }),
      React.createElement(control), React.createElement('button', { type: 'submit' }, 'Send')));`,
    loader: 'tsx', resolveDir: root }, outfile: renderer, bundle: true, platform: 'browser', format: 'iife', nodePaths: [path.join(root, 'node_modules')],
    plugins: [{ name: 'synthetic-composer-sdk', setup(builder) {
      builder.onResolve({ filter: /^@hermes\/plugin-sdk$/ }, () => ({ path: 'sdk', namespace: 'composer-fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'composer-fixture' }, () => ({ loader: 'tsx', resolveDir: root,
        contents: `import React from 'react'; import { host as mockedHost } from ${JSON.stringify(sdk)};
          export * from ${JSON.stringify(sdk)};
          // Stock v0.23.1 forwards Button props to a native button without a default type.
          export const Button = ({ variant, size, ...props }) => React.createElement('button', props);
          export const host = { ...mockedHost, state: { ...mockedHost.state,
            focusedSessionOwner: { get() { return null; } } },
            notify(notice) { window.recordingChecks.notices.push(notice.message); } };` }));
    } }] });
  await writeFile(html, '<!doctype html><meta charset="UTF-8"><title>Synthetic Hermes composer</title><div id="root"></div><script src="renderer.js"></script>');
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined;
  let passed = false;
  try {
    application = await electron.launch({ args: [main, html], env: { ...process.env, HOME: job, XDG_CONFIG_HOME: path.join(job, 'config') } });
    const page = await application.firstWindow();
    for (const activation of ['mouse', 'Enter', 'Space']) {
      await page.reload();
      await page.getByRole('textbox', { name: 'Draft' }).fill('This draft must stay unsent.');
      const button = page.getByRole('button', { name: 'Record with Apparent' });
      if (activation === 'mouse') await button.click();
      else { await button.focus(); await button.press(activation); }
      await until(() => page.evaluate(() => (window as any).recordingChecks.notices.length === 1));
      assert.equal(await page.getByRole('textbox', { name: 'Draft' }).inputValue(), 'This draft must stay unsent.', activation);
      assert.equal(await page.evaluate(() => (window as any).recordingChecks.submissions), 0, activation);
      // Confirm this really is a working form, rather than an inert click fixture.
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      assert.equal(await page.evaluate(() => (window as any).recordingChecks.submissions), 1);
    }
    passed = true;
  } finally {
    await application?.close().catch(() => {});
    if (passed) await rm(job, { recursive: true, force: true }); else console.log(`Failed composer action evidence: ${job}`);
  }
});
