const { test } = require('node:test');
const assert = require('node:assert/strict');
const { _electron: electron, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

// Exercise the real Electron main/preload/renderer against an explicitly synthetic
// socket. This is transport/security proof, not a live Rust or native-platform pass.
test('Electron preview, explicit capture controls and isolation', { timeout: 45000 }, async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'ui-'));
  const requests = [];
  let reply = '{"state":{"phase":"idle","capture_id":null}}\n';
  let dynamicState = false;
  let phase = 'idle';
  let activeId = null;
  let server;
  const application = await electron.launch({
    args: [path.join(__dirname, '..')],
    env: { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, 'config') },
  });
  t.after(async () => {
    await application.close();
    if (server) await new Promise((resolve) => server.close(resolve));
    await fs.rm(home, { recursive: true, force: true });
  });
  const page = await application.firstWindow();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByText('Not connected', { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => ({
    keys: Object.keys(window.apparent), require: typeof window.require, process: typeof window.process,
  })), { keys: ['readRuntimeState', 'startCapture', 'finishCapture', 'cancelCapture', 'readCaptureLocation', 'changeCaptureLocation', 'resetCaptureLocation'], require: 'undefined', process: 'undefined' });
  assert.equal(await application.evaluate(({ BrowserWindow }) => {
    const options = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return options.contextIsolation && options.sandbox && !options.nodeIntegration && options.webSecurity;
  }), true);
  assert.equal(await page.evaluate(async () => {
    try { await fetch('https://example.com'); return false; } catch { return true; }
  }), true);

  for (const label of ['Recording', 'Processing', 'Uploading', 'Preparing', 'Permission', 'Error', 'Idle']) {
    await page.getByRole('tab', { name: label, exact: true }).click();
    await page.getByRole('tabpanel').getByText('SYNTHETIC EXAMPLE', { exact: true }).waitFor();
    await expect(page.getByRole('tab', { name: label, exact: true })).toHaveAttribute('aria-selected', 'true');
  }
  await page.getByRole('tab', { name: 'Idle', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Recording', exact: true })).toHaveAttribute('aria-selected', 'true');
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(640, 760));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);

  const directory = path.join(home, '.config/apparent/agent-control');
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.chmod(directory, 0o700);
  server = net.createServer((socket) => socket.once('data', (data) => {
    const request = data.toString();
    requests.push(request);
    if (request === 'state\n') {
      socket.end(dynamicState ? JSON.stringify({ state: { phase, capture_id: activeId } }) + '\n' : reply);
      return;
    }
    let storage;
    try { storage = JSON.parse(request); } catch {}
    if (storage?.storage === 'read') {
      socket.end(JSON.stringify({ storage: { savedPath: null, effectivePath: '/synthetic/captures',
        displayPath: '/synthetic/captures', custom: false, source: 'builtin', revision: 'a'.repeat(16) } }) + '\n');
      return;
    }
    const [action, id, ...extra] = request.trimEnd().split(' ');
    if (request.charCodeAt(request.length - 1) !== 10 || extra.length ||
        !['start', 'stop', 'cancel', 'inspect'].includes(action) || !/^[a-f0-9]{32}$/.test(id)) {
      return socket.end(JSON.stringify({ error: 'invalid_request' }) + String.fromCharCode(10));
    }
    dynamicState = true;
    activeId = id;
    if (action === 'start') phase = 'starting';
    else if (action === 'cancel') { phase = 'idle'; activeId = null; }
    else if (action === 'stop') phase = 'processing';
    const status = action === 'cancel' ? 'cancelled' : action === 'stop' ? 'processing' : phase;
    socket.end(JSON.stringify({ capture_id: id, status, outcome: action === 'stop' ? 'stopping' : status,
      state: { phase, capture_id: activeId } }) + '\n');
  }));
  const address = path.join(directory, 'capture.sock');
  await new Promise((resolve) => server.listen(address, resolve));
  await fs.chmod(address, 0o600);
  await page.getByRole('button', { name: 'Refresh location' }).click();
  await page.getByText('/synthetic/captures', { exact: true }).waitFor();
  const malformedStartRejected = await page.evaluate(() =>
    window.apparent.startCapture('a'.repeat(32)).then(() => false, () => true));
  assert.equal(malformedStartRejected, true);
  assert.equal(requests.some((request) => request.startsWith('start ')), false);
  // Let the production one-second cooldown expire, rather than bypassing it.
  await new Promise((resolve) => setTimeout(resolve, 1100));
  await page.getByRole('button', { name: 'Refresh state' }).click();
  await page.getByText('Connected · idle', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Start capture' }).click();
  await page.getByText('Connected · starting', { exact: true }).waitFor();
  const startRequest = requests.find((request) => request.startsWith('start '));
  const captureId = startRequest.trim().split(' ')[1];
  assert.equal(await page.getByText(captureId, { exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Cancel capture' }).click();
  await page.getByText('Connected · idle', { exact: true }).waitFor();
  assert.ok(requests.some((request) => request.trim() === `cancel ${captureId}`));

  activeId = 'a'.repeat(32);
  phase = 'recording';
  await new Promise((resolve) => setTimeout(resolve, 1100));
  await page.getByRole('button', { name: 'Refresh state' }).click();
  await page.getByText('Connected · recording', { exact: true }).waitFor();
  const controlsImage = path.join(os.tmpdir(), `apparent-capture-controls-${process.pid}.png`);
  await page.screenshot({ path: controlsImage, fullPage: true });
  console.log(`Synthetic capture controls screenshot: ${controlsImage}`);
  await page.getByRole('button', { name: 'Finish capture' }).click();
  await page.getByText('Connected · processing', { exact: true }).waitFor();
  assert.ok(requests.some((request) => request.trim() === `stop ${'a'.repeat(32)}`));

  activeId = 'c'.repeat(32);
  phase = 'recording';
  await new Promise((resolve) => setTimeout(resolve, 1100));
  await page.getByRole('button', { name: 'Refresh state' }).click();
  await page.getByText('Connected · recording', { exact: true }).waitFor();
  activeId = 'b'.repeat(32); // The displayed capture was replaced after the read.
  await page.getByRole('button', { name: 'Finish capture' }).click();
  await page.getByText('The capture changed. Review the state, then refresh before continuing.', { exact: true }).waitFor();
  assert.equal(requests.filter((request) => request.startsWith('stop ')).length, 1);
  const finishButton = page.getByRole('button', { name: 'Finish capture' });
  assert.equal(await finishButton.isDisabled(), true);
  await page.getByRole('button', { name: 'Refresh state' }).click();
  await page.getByText('Connected · recording', { exact: true }).waitFor();
  assert.equal(await finishButton.isDisabled(), false);
  await finishButton.click();
  await page.getByText('Connected · processing', { exact: true }).waitFor();
  assert.ok(requests.some((request) => request.trim() === `stop ${'b'.repeat(32)}`));

  dynamicState = false;
  reply = '{"error":"app_busy"}\n';
  await new Promise((resolve) => setTimeout(resolve, 1100));
  await page.getByRole('button', { name: 'Refresh state' }).click();
  await page.getByText('Unable to read state', { exact: true }).waitFor();
  reply = `{"state":{"phase":"processing","capture_id":"${'c'.repeat(32)}"}}\n`;
  await new Promise((resolve) => setTimeout(resolve, 1100));
  await page.reload();
  await page.getByText('Connected · processing', { exact: true }).waitFor();
  assert.equal(await page.getByText('private', { exact: true }).count(), 0);
  assert.ok(requests.length >= 3);
  assert.ok(requests.some((request) => request.startsWith('start ')));
  assert.ok(requests.some((request) => request.startsWith('cancel ')));
  assert.ok(requests.every((request) => request.trim() === 'state' ||
    (request.charCodeAt(request.length - 1) === 10 &&
      /^(start|stop|cancel|inspect) [a-f0-9]{32}$/.test(request.trimEnd())) ||
    JSON.parse(request).storage === 'read'));
  assert.deepEqual(errors, []);
  const screenshot = path.join(os.tmpdir(), `apparent-foundation-${process.pid}.png`);
  await page.screenshot({ path: screenshot, fullPage: true });
  console.log(`Synthetic Electron screenshot: ${screenshot}`);

  // Do this after interaction checks: Playwright tracks even a cancelled Electron
  // navigation as pending; the actual webContents URL remains authoritative.
  const originalUrl = page.url();
  await page.evaluate(() => {
    const link = document.createElement('a');
    link.href = 'https://example.com'; document.body.append(link); link.click(); link.remove();
    window.open('https://example.com');
  });
  assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getURL()), originalUrl);
  assert.equal(application.windows().length, 1);

  // A second renderer with the same preload still cannot invoke the bridge.
  const startsBeforeForeign = requests.filter((request) => request.startsWith('start ')).length;
  assert.deepEqual(await application.evaluate(async ({ BrowserWindow }, root) => {
    const other = new BrowserWindow({ show: false, webPreferences: {
      preload: root + '/electron/preload.cjs', sandbox: true, contextIsolation: true, nodeIntegration: false,
    } });
    try {
      await other.loadFile(root + '/dist/index.html');
      const malformed = await other.webContents.executeJavaScript('window.apparent.startCapture().then(() => false, () => true)');
      const read = await other.webContents.executeJavaScript('window.apparent.readRuntimeState().then(() => false, () => true)');
      return { malformed, read };
    } finally { other.destroy(); }
  }, path.join(__dirname, '..')), { malformed: true, read: true });
  assert.equal(requests.filter((request) => request.startsWith('start ')).length, startsBeforeForeign);
});
