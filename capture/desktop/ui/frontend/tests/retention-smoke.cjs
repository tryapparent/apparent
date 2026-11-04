const { test } = require('node:test');
const assert = require('node:assert/strict');
const { _electron: electron, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

test('Retention save/reset/readback, failure, usage loading/error and stale response isolation', { timeout: 45000 }, async t => {
  // Shipped Electron main/preload/production renderer; synthetic backend, not native proof.
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'ui-r-'));
  const directory = path.join(home, '.config/apparent/agent-control');
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  let initialRetentionBusy = true;
  let preset = 'week';
  let custom = false;
  let storedPolicy = { mediaDays: { present: false, value: null }, bundleDays: { present: false, value: null } };
  let revision = 'a'.repeat(16);
  let failure;
  let unknownOutcome = false;
  let usageError = false;
  let releaseUsage;
  let holdUsage = true;
  let releaseLocation;
  const requests = [];
  const clients = new Set();
  const policy = () => ({ revision, custom, retention: storedPolicy, secret: 'hidden' });
  const server = net.createServer(socket => {
    clients.add(socket); socket.on('close', () => clients.delete(socket)); socket.on('error', () => {});
    socket.once('data', data => {
      if (data.toString() === 'state\n') return socket.end('{"state":{"phase":"idle"}}\n');
      const r = JSON.parse(data); requests.push(r);
      const send = value => socket.end(JSON.stringify(value) + '\n');
      if (r.reference || r.connect) return send({ error: 'feature_disabled' });
      if (r.storage === 'retention' && initialRetentionBusy) return send({ error: 'app_busy' });
      if (r.storage === 'locationfacts') {
        const reply = () => send({ location: { saved: { kind: 'string', value: '/captures' },
          environment: { present: false, value: null }, homePath: home, builtinPath: '/builtin', revision } });
        if (!releaseLocation) { releaseLocation = reply; return; }
        return reply();
      }
      if (r.storage === 'probelocation') return send({ probe: { available: true } });
      if (r.storage === 'usage') {
        if (usageError) return send({ error: 'usage_unavailable', message: 'private failure' });
        const reply = { usage: { effectivePath: '/captures', displayPath: '/captures', formatted: '12 MB', secret: 'hidden' } };
        if (holdUsage) { holdUsage = false; releaseUsage = () => send(reply); return; }
        return send(reply);
      }
      if (r.storage === 'saveretention' || r.storage === 'resetretention') {
        if (failure) return send({ error: failure, message: 'private failure' });
        assert.equal(r.expected, revision);
        if (r.storage === 'saveretention') {
          assert.ok(JSON.stringify(r.policy) === JSON.stringify({ mediaDays: 30, bundleDays: 90 }) ||
            JSON.stringify(r.policy) === JSON.stringify({ mediaDays: null, bundleDays: null }));
          storedPolicy = { mediaDays: { present: true, value: r.policy.mediaDays }, bundleDays: { present: true, value: r.policy.bundleDays } };
          preset = r.policy.mediaDays === 30 ? 'month' : r.policy.mediaDays === null ? 'forever' : 'week';
        } else {
          preset = 'week'; custom = false;
          storedPolicy = { mediaDays: { present: false, value: null }, bundleDays: { present: false, value: null } };
        }
        custom = r.storage === 'saveretention'; revision = (custom ? 'b' : 'c').repeat(16);
        if (unknownOutcome) { unknownOutcome = false; return send({ error: 'outcome_unknown', message: 'private failure' }); }
      }
      send(policy());
    });
  });
  const address = path.join(directory, 'capture.sock');
  await new Promise(resolve => server.listen(address, resolve)); await fs.chmod(address, 0o600);
  const app = await electron.launch({ args: [path.join(__dirname, '..'), '--settings-storage'], env: { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, 'config') } });
  t.after(async () => {
    for (const c of clients) c.destroy();
    let timer;
    try {
      await Promise.race([app.close(), new Promise((_, reject) => {
        timer = setTimeout(() => {
          app.process().kill('SIGKILL');
          reject(new Error('Retention smoke Electron cleanup exceeded 5 seconds'));
        }, 5000);
      })]);
    } finally {
      clearTimeout(timer);
      await new Promise(resolve => server.close(resolve));
      await fs.rm(home, { recursive: true, force: true });
    }
  });
  const page = await app.firstWindow();
  t.diagnostic('Retention window opened');
  await expect.poll(() => typeof releaseLocation).toBe('function');
  await expect(page.getByText('Waiting for capture location…')).toBeVisible();
  assert.equal(await page.getByText('Storage is disabled in your configuration.', { exact: false }).count(), 0);
  releaseLocation();
  await expect(page.getByText('Calculating folder usage…')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh usage', exact: true })).toBeDisabled();
  releaseUsage(); releaseUsage = undefined;
  await expect(page.getByText('12 MB in captures')).toBeVisible();
  const card = page.getByRole('region', { name: 'Capture location', exact: true });
  // Regression for native Mac's old ambiguous locator: usage legitimately
  // repeats the folder, so the location readback must be independently scoped.
  await expect(card.getByText('/captures', { exact: true })).toHaveCount(2);
  await expect(card.locator(':scope > [role="status"]').getByText('/captures', { exact: true })).toBeVisible();
  const select = page.getByLabel('Keep recordings');
  // A genuine single-worker busy response hides an unverified policy. The
  // native helper must use the visible Refresh recovery before asserting it.
  await expect(page.getByText('Storage is unavailable. Refresh when the Rust app is responsive.', { exact: true })).toBeVisible();
  assert.equal(await select.count(), 0);
  initialRetentionBusy = false;
  await page.getByRole('button', { name: 'Refresh retention', exact: true }).click();
  await expect(select).toHaveValue('week');
  await select.selectOption('month');
  await page.getByRole('button', { name: 'Save retention', exact: true }).click();
  await expect(select).toHaveValue('month');
  assert.equal(preset, 'month');
  t.diagnostic('Retention saved');
  await page.getByRole('button', { name: 'Refresh retention', exact: true }).click();
  await expect(select).toHaveValue('month');
  await expect(page.getByRole('button', { name: 'Reset retention', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Reset retention', exact: true }).click();
  await expect(select).toHaveValue('week');
  await expect(page.getByRole('button', { name: 'Reset retention', exact: true })).toBeDisabled();
  failure = 'config_write_failed';
  await select.selectOption('forever');
  await page.getByRole('button', { name: 'Save retention', exact: true }).click();
  await expect(page.getByText('Retention could not be saved.', { exact: false })).toBeVisible();
  assert.equal(preset, 'week');
  assert.equal(await select.count(), 0); // Failed save never looks authoritative.
  failure = undefined;
  await page.getByRole('button', { name: 'Refresh retention', exact: true }).click();
  await expect(select).toHaveValue('week');
  unknownOutcome = true;
  const previousSaves = requests.filter(request => request.storage === 'saveretention').length;
  await select.selectOption('month');
  await page.getByRole('button', { name: 'Save retention', exact: true }).click();
  await expect(page.getByText('The save outcome is unknown.', { exact: false })).toBeVisible();
  assert.equal(requests.filter(request => request.storage === 'saveretention').length, previousSaves + 1);
  await page.getByRole('button', { name: 'Refresh retention', exact: true }).click();
  await expect(select).toHaveValue('month');
  usageError = true;
  await page.getByRole('button', { name: 'Refresh usage', exact: true }).click();
  await expect(page.getByText('Folder usage is unavailable', { exact: false })).toBeVisible();
  assert.equal(await page.getByText('12 MB in captures').count(), 0);
  usageError = false;
  holdUsage = true;
  await page.evaluate(() => { window.oldUsage = window.apparent.readCaptureUsage(); });
  await expect.poll(() => typeof releaseUsage).toBe('function');
  await select.selectOption('forever');
  await page.getByRole('button', { name: 'Save retention', exact: true }).click();
  await expect(select).toHaveValue('forever');
  releaseUsage(); releaseUsage = undefined;
  assert.deepEqual(await page.evaluate(() => window.oldUsage), { status: 'cancelled' });
  t.diagnostic('Stale usage cancelled');
  const safe = await page.evaluate(() => window.apparent.readRetention());
  assert.equal(safe.revision, undefined); assert.equal(safe.secret, undefined);
  assert.equal(await page.evaluate(() => window.apparent.saveRetention('arbitrary').then(() => false, () => true)), true);
  assert.deepEqual(await page.evaluate(() => Object.keys(window.apparent).sort()), [
    'readCaptureLocation', 'changeCaptureLocation', 'resetCaptureLocation', 'readRetention',
    'saveRetention', 'resetRetention', 'readCaptureUsage', 'navigateSettings', 'showCaptureFolder',
  ].sort());
  // Even a direct main-process call from this legitimate frame must not reach
  // unrelated handlers. The passive build identity is shared by all windows;
  // other non-Storage capabilities must remain refused, including direct calls.
  const denied = await app.evaluate(async ({ ipcMain, BrowserWindow }) => {
    const sender = BrowserWindow.getAllWindows()[0].webContents;
    const event = { sender, senderFrame: sender.mainFrame };
    const allowed = new Set(['build-identity', 'read-capture-location', 'change-capture-location', 'reset-capture-location',
      'read-retention', 'save-retention', 'reset-retention', 'read-capture-usage', 'navigate-settings', 'show-capture-folder']);
    const rejected = [];
    for (const [channel, handler] of ipcMain._invokeHandlers) {
      if (!channel.startsWith('apparent:') || allowed.has(channel.slice('apparent:'.length))) continue;
      let refused = false;
      try { await handler(event, ...(channel === 'apparent:set-error-reporting' ? [false] : [])); }
      catch { refused = true; }
      if (!refused) throw new Error(`Unrelated Storage capability admitted: ${channel}`);
      rejected.push(channel);
    }
    return rejected;
  });
  assert.ok(denied.includes('apparent:connect-allow'));
  assert.ok(denied.includes('apparent:set-error-reporting'));
  assert.ok(denied.includes('apparent:copy-capture-reference'));
  assert.ok(denied.includes('apparent:read-runtime-state'));
  // Real handler origin/arity gates, including the mutation channel.
  assert.equal(await app.evaluate(async ({ ipcMain, BrowserWindow }) => {
    const sender = BrowserWindow.getAllWindows()[0].webContents;
    for (const channel of ['read-retention', 'read-capture-usage', 'save-retention', 'reset-retention']) {
      const handler = ipcMain._invokeHandlers.get(`apparent:${channel}`);
      for (const event of [{ sender, senderFrame: { url: sender.getURL() } }, { sender, senderFrame: sender.mainFrame }]) {
        try { await handler(event, 'arbitrary', 'extra'); return false; } catch {}
      }
    }
    return true;
  }), true);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(640, 760));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await select.focus(); await expect(select).toBeFocused();
  // Isolate the suspected macOS CDP select-menu shutdown hang: Escape alone
  // did not fix it. Keep this keyboard check Linux-only; selectOption above
  // still exercises the shipped Mac change/save path, not native keyboard use.
  if (process.platform !== 'darwin') {
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Escape');
  }
  assert.ok(requests.some(r => r.storage === 'resetretention'));
  assert.equal((await page.locator('body').innerText()).includes('private failure'), false);
  await expect(page.getByRole('heading', { name: 'Storage', exact: true })).toBeVisible();
  assert.equal(await page.getByText('UI foundation', { exact: false }).count(), 0);
  assert.equal(await page.getByText('State previews', { exact: true }).count(), 0);
  assert.equal(await page.evaluate(() => window.apparent.navigateSettings('storage').then(() => false, () => true)), true);
  assert.equal(await page.evaluate(() => window.apparent.navigateSettings('arbitrary').then(() => false, () => true)), true);
  assert.equal(await page.evaluate(() => window.apparent.showCaptureFolder('arbitrary').then(() => false, () => true)), false, 'zero-argument preload cannot forward a path');
  for (const colorScheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme });
    assert.equal(await page.locator('.settings-shell').evaluate(element => getComputedStyle(element).colorScheme), colorScheme);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if (process.env.APPARENT_SETTINGS_PROOF) {
      await fs.mkdir(process.env.APPARENT_SETTINGS_PROOF, { recursive: true });
      await page.screenshot({ path: path.join(process.env.APPARENT_SETTINGS_PROOF, `storage-${colorScheme}.png`), fullPage: true });
    }
  }
  const emitted = [];
  app.process().stdout.on('data', data => emitted.push(data.toString()));
  await page.getByRole('button', { name: 'General', exact: true }).click();
  await expect.poll(() => emitted.join('')).toContain('"action":"navigate","pane":"general"');
  t.diagnostic('Retention and installed Settings presentation assertions completed');
});

test('Installed Agents owns only Agents and navigation capabilities', { timeout: 45000 }, async t => {
  // Darwin sun_path is 104 bytes, including termination; keep the real socket
  // address below that bound even under the hosted runner's long TMPDIR.
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'a-'));
  let app, server;
  const clients = new Set();
  t.after(async () => {
    try { if (app) await app.close(); }
    finally {
      for (const socket of clients) socket.destroy();
      if (server?.listening) await new Promise(resolve => server.close(resolve));
      await fs.rm(home, { recursive: true, force: true });
    }
  });
  let agentInstalled = false;
  let agentDemo = true;
  let agentBusy = true;
  let agentRejectInstall = true;
  const directory = path.join(home, '.config/apparent/agent-control');
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const requests = [];
  server = net.createServer(socket => {
    clients.add(socket); socket.once('close', () => clients.delete(socket)); socket.on('error', () => {});
    socket.once('data', data => {
    requests.push(data.toString());
    const request = JSON.parse(data);
    if (request?.agents) {
      if (agentBusy || (request.agents === 'install' && agentRejectInstall)) {
        agentBusy = false;
        agentRejectInstall = request.agents !== 'install';
        return socket.end('{"error":"app_busy"}\n');
      }
      if (request.agents === 'install') agentInstalled = true;
      if (request.agents === 'uninstall') agentInstalled = false;
      if (request.agents === 'demo') agentDemo = request.enabled;
      socket.end(JSON.stringify({agents: {cli: agentInstalled ? 'installed' : 'missing', canInstall: !agentInstalled,
        canUninstall: agentInstalled, agentDemoVideo: agentDemo, skillCommand: 'canonical fixture command'}}) + '\n');
    }
    });
  });
  const address = path.join(directory, 'capture.sock');
  assert.ok(Buffer.byteLength(address) < 104, 'Synthetic socket path exceeds macOS sun_path');
  await new Promise((resolve, reject) => server.once('error', reject).listen(address, resolve));
  await fs.chmod(address, 0o600);
  const appRoot = process.env.APPARENT_AGENTS_TEST_APP_ROOT ?? path.join(__dirname, '..');
  const executablePath = process.env.APPARENT_AGENTS_TEST_ELECTRON;
  assert.ok(path.isAbsolute(appRoot));
  if (executablePath) assert.ok(path.isAbsolute(executablePath));
  app = await electron.launch({ executablePath, args: [appRoot, '--settings-agents'], env: { ...process.env, HOME: home } });
  const page = await app.firstWindow();
  await expect(page.getByRole('heading', { name: 'Agents', exact: true, level: 1 })).toBeVisible();
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle()))
    .toBe('Apparent Settings — Agents');
  assert.equal(await page.getByRole('button', { name: 'Agents', exact: true }).getAttribute('aria-current'), 'page');
  assert.deepEqual(await page.evaluate(() => Object.keys(window.apparent).sort()), ['readAgents', 'installCli', 'uninstallCli', 'setAgentDemoVideo', 'navigateSettings'].sort());
  assert.deepEqual(await page.evaluate(() => Object.keys(window.apparentExceptions).sort()), ['exception', 'rejection']);
  const agents = page.getByRole('region', { name: 'Agents', exact: true });
  await expect(agents.getByText('Could not confirm the saved state. Refresh before trying again.', { exact: true })).toBeVisible();
  await agents.getByRole('button', { name: 'Refresh Agents settings' }).click();
  await agents.getByRole('button', { name: 'Install command-line tool', exact: true }).click();
  await expect(agents.getByText('Could not confirm the saved state. Refresh before trying again.', { exact: true })).toBeVisible();
  assert.equal(requests.filter(r => r.startsWith('{') && JSON.parse(r).agents === 'install').length, 1);
  await agents.getByRole('button', { name: 'Refresh Agents settings' }).click();
  await agents.getByRole('button', { name: 'Install command-line tool', exact: true }).click();
  await expect(agents.getByText('The command-line tool is installed.', { exact: true })).toBeVisible();
  await agents.getByRole('button', { name: 'Uninstall command-line tool', exact: true }).click();
  await expect(agents.getByText('The command-line tool is not installed.', { exact: true })).toBeVisible();
  await agents.getByRole('checkbox').click();
  await expect(agents.getByRole('checkbox')).not.toBeChecked();
  await expect(agents.getByText('canonical fixture command', {exact:true})).toBeVisible();
  await page.evaluate(() => window.apparent.navigateSettings('general'));
  assert.equal(await app.evaluate(async ({ ipcMain, BrowserWindow }) => {
    const sender = BrowserWindow.getAllWindows()[0].webContents;
    const event = { sender, senderFrame: sender.mainFrame };
    const allowed = new Set(['build-identity', 'agents-read', 'agents-install', 'agents-uninstall', 'agents-demo', 'navigate-settings']);
    for (const [channel, handler] of ipcMain._invokeHandlers) {
      if (!channel.startsWith('apparent:') || allowed.has(channel.slice(9))) continue;
      try { await handler(event); return channel; } catch {}
    }
    for (const [channel, args] of [['agents-read', [true]], ['agents-demo', ['yes']], ['navigate-settings', ['agents']], ['navigate-settings', ['storage', 'extra']]]) {
      try { await ipcMain._invokeHandlers.get(`apparent:${channel}`)(event, ...args); return channel; } catch {}
    }
    for (const channel of allowed) {
      try { await ipcMain._invokeHandlers.get(`apparent:${channel}`)({ sender, senderFrame: { url: sender.getURL() } }); return channel; } catch {}
    }
    return true;
  }), true);
});
