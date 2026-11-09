import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _electron as electron } from '@playwright/test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { availablePort } from './testing/port.ts';
import { mailboxId, sign, authenticatedState } from '../../../../../../hermes/desktop/controller.ts';
const root = fileURLToPath(new URL('../..', import.meta.url));
const token = '0123456789abcdef0123456789abcdef';
test('real Electron confirmation/preload and bounded native CLI flow, then acknowledgement closes the bridge', { timeout: 45000 }, async () => {
  const job = await mkdtemp(path.join(tmpdir(), 'hermes-native-'));
  const home = path.join(job, 'home'); await mkdir(home, { mode: 0o700 });
  const bridgePort = await availablePort();
  const id = await mailboxId(token);
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined;
  let passed = false;
  const diagnostics: unknown[] = [];
  try {
    application = await electron.launch({ args: [path.join(root, 'dist/hermes-main.cjs'), '--hermes-request', `${token}/${bridgePort}`, '--apparent-executable', path.join(root, 'src/hermes/testing/cli.ts')],
      env: { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(job, 'config'), APPARENT_SYNTHETIC_RECEIPT: path.join(job, 'receipt.json'), APPARENT_SYNTHETIC_TRACE: path.join(job, 'trace.jsonl') } });
    const page = await application.firstWindow();
    page.on('console', entry => diagnostics.push({ console: entry.text() }));
    page.on('requestfailed', request => diagnostics.push({ request: request.url(), failure: request.failure() }));
    page.on('response', response => { if (response.url().startsWith('http://127.0.0.1:')) diagnostics.push({ response: response.url(), status: response.status(), headers: response.headers() }); });
    await page.getByRole('button', { name: 'Record and send when finished' }).waitFor();
    const preflight = (await readFile(path.join(job, 'trace.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.ok(preflight.every(call => call[0] === 'capture' && call[1] === 'state'));
    assert.equal(await page.evaluate(() => typeof (window as any).require), 'undefined');
    const stateURL = `http://127.0.0.1:${bridgePort}/${id}/state`;
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
    assert.deepEqual(await authenticatedState(token, JSON.parse(rendererReply.body)), { phase: 'confirm' });
    await receiver.close();
    assert.deepEqual(await authenticatedState(token, await (await fetch(stateURL, { headers: { Origin: 'null' } })).json()), { phase: 'confirm' });
    await page.getByRole('button', { name: 'Record and send when finished' }).click();
    await page.getByText('Recording saved.', { exact: false }).waitFor();
    assert.deepEqual(await authenticatedState(token, await (await fetch(stateURL, { headers: { Origin: 'null' } })).json()), { phase: 'saved', source: '/synthetic/owned.apparent' });
    const calls = (await readFile(path.join(job, 'trace.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.equal(calls.filter(c => c[1] === 'start').length, 1);
    assert.ok(calls.filter(c => ['inspect', 'handoff'].includes(c[1])).every(c => c[2] === token));
    assert.ok(!calls.some(c => ['stop', 'cancel'].includes(c[1])));
    // Cross-origin callers cannot acknowledge or read this recording.
    assert.equal((await fetch(stateURL, { headers: { Origin: 'https://example.invalid' } })).status, 403);
    await fetch(`http://127.0.0.1:${bridgePort}/${id}/ack/${await sign(token, `ack:${id}`)}`, { method: 'POST', headers: { Origin: 'null' } });
    await new Promise<void>(resolve => { if (application!.process().exitCode !== null) resolve(); else application!.process().once('exit', () => resolve()); });
    passed = true;
  } finally {
    await writeFile(path.join(job, 'diagnostics.json'), JSON.stringify(diagnostics, null, 2));
    await application?.close().catch(() => {});
    if (passed) await rm(job, { recursive: true, force: true }); else console.log(`Failed synthetic bridge evidence: ${job}`);
  }
});
