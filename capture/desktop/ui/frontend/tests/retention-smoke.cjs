const { test } = require('node:test');
const assert = require('node:assert/strict');
const { _electron: electron, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

test('Retention save/reset/readback, failure, usage loading/error and stale response isolation', { timeout: 45000 }, async t => {
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
  let releaseShorterSave;
  const requests = [];
  const clients = new Set();
  const policy = () => ({ revision, custom, defaults: { mediaDays: 7, bundleDays: 30 }, retention: storedPolicy, secret: 'hidden' });
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
            JSON.stringify(r.policy) === JSON.stringify({ mediaDays: 7, bundleDays: 30 }) ||
            JSON.stringify(r.policy) === JSON.stringify({ mediaDays: null, bundleDays: null }));
          storedPolicy = { mediaDays: { present: true, value: r.policy.mediaDays }, bundleDays: { present: true, value: r.policy.bundleDays } };
          preset = r.policy.mediaDays === 30 ? 'month' : r.policy.mediaDays === null ? 'forever' : 'week';
        } else {
          preset = 'week'; custom = false;
          storedPolicy = { mediaDays: { present: false, value: null }, bundleDays: { present: false, value: null } };
        }
        custom = r.storage === 'saveretention'; revision = (custom ? 'b' : 'c').repeat(16);
        if (unknownOutcome) { unknownOutcome = false; return send({ error: 'outcome_unknown', message: 'private failure' }); }
        if (r.policy?.mediaDays === 7) { releaseShorterSave = () => send(policy()); return; }
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
  const button = name => page.getByRole('button', { name, exact: true });
  const save = button('Save retention');
  const reset = button('Reset retention');
  const refresh = button('Refresh retention');
  const refreshUsage = button('Refresh usage');
  const proof = process.env.APPARENT_SETTINGS_PROOF;
  if (proof) await fs.mkdir(proof, { recursive: true });
  const screenshot = (name, fullPage = false) => proof && page.screenshot({
    path: path.join(proof, name), animations: 'disabled', fullPage,
  });
  t.diagnostic('Retention window opened');
  await expect.poll(() => typeof releaseLocation).toBe('function');
  await expect(page.getByText('Waiting for capture location…')).toBeVisible();
  assert.equal(await page.getByText('Storage is disabled in your configuration.', { exact: false }).count(), 0);
  releaseLocation();
  await expect(page.getByText('Calculating folder usage…')).toBeVisible();
  await expect(refreshUsage).toBeDisabled();
  releaseUsage(); releaseUsage = undefined;
  await expect(page.getByText('12 MB')).toBeVisible();
  const card = page.getByRole('region', { name: 'Capture location', exact: true });
  await expect(card.getByText('/captures', { exact: true })).toHaveCount(1);
  await expect(card.locator(':scope > [role="status"]').getByText('/captures', { exact: true })).toBeVisible();
  const select = page.getByRole('combobox', { name: 'Keep recordings', exact: true });
  const consequence = 'Shorter limits can move existing files to the Trash.';
  const resetDescription = `Reset to default · Media 7 days · capture 30 days ${consequence}`;
  await expect(page.getByText('Storage is unavailable. Refresh when the Rust app is responsive.', { exact: true })).toBeVisible();
  assert.equal(await select.count(), 0);
  initialRetentionBusy = false;
  await refresh.click();
  await expect(select).toHaveValue('week');
  await expect(select.locator('option:checked')).toHaveText('Media 7 days · capture 30 days');
  await screenshot('storage-week.png');
  const help = button('About keeping recordings');
  await help.focus();
  await expect(page.getByRole('tooltip')).toContainText('waits until recording finishes.');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await help.click();
  await expect(page.getByRole('tooltip')).toBeVisible();
  await page.keyboard.press('Escape');
  await select.selectOption('month');
  await save.click();
  await expect(select).toHaveValue('month');
  await expect(select.locator('option:checked')).toHaveText('Media 30 days · capture 90 days');
  assert.equal(preset, 'month');
  t.diagnostic('Retention saved');
  await refresh.click();
  await expect(select).toHaveValue('month');
  await expect(reset).toBeEnabled();
  await expect(reset).toHaveAccessibleDescription(resetDescription);
  await reset.click();
  await expect(select).toHaveValue('week');
  await expect(reset).toBeDisabled();
  failure = 'config_write_failed';
  await select.selectOption('forever');
  await save.click();
  await expect(page.getByRole('alert')).toContainText('Could not save retention.');
  assert.equal(preset, 'week');
  assert.equal(await select.count(), 0);
  failure = undefined;
  await refresh.click();
  await expect(select).toHaveValue('week');
  unknownOutcome = true;
  const previousSaves = requests.filter(request => request.storage === 'saveretention').length;
  await select.selectOption('month');
  await save.press('Enter');
  await expect(page.getByRole('alert')).toContainText('Save is unconfirmed.');
  await expect(page.getByText('Requested save · Media 30 days · capture 90 days')).toBeVisible();
  await expect(refresh).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(select).toHaveValue('month');
  await expect(refresh).toBeFocused();
  await select.selectOption('week');
  await expect(select.locator('option:checked')).toHaveText('Media 7 days · capture 30 days');
  await expect(page.getByText('Unsaved changes', { exact: true })).toBeVisible();
  await expect(save).toHaveAccessibleDescription(consequence);
  await expect(reset).toHaveAccessibleDescription(resetDescription);
  assert.equal(requests.filter(({storage}) => storage === 'saveretention').length, previousSaves + 1);
  await save.press('Enter');
  await expect.poll(() => typeof releaseShorterSave).toBe('function');
  await expect(page.getByText('Saving… Media 7 days · capture 30 days')).toBeVisible();
  await expect(save).toHaveCount(0);
  await expect(refresh).toBeDisabled();
  releaseShorterSave();
  await expect(select).toHaveValue('week');
  await expect(save).toBeDisabled();
  assert.equal(preset, 'week');
  usageError = true;
  await refreshUsage.click();
  await expect(page.getByText('Folder usage is unavailable', { exact: false })).toBeVisible();
  assert.equal(await page.getByText('12 MB').count(), 0);
  usageError = false;
  holdUsage = true;
  await page.evaluate(() => { window.oldUsage = window.apparent.readCaptureUsage(); });
  await expect.poll(() => typeof releaseUsage).toBe('function');
  await select.selectOption('forever');
  await save.click();
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
    'readConnectSettings', 'connectSettings', 'resumeConnectUploads', 'allowConnectUploads',
    'cancelConnectSettings', 'checkConnectConnection', 'disableConnectUploads', 'disconnectConnectSettings',
    'requestDisableConnectUploads', 'requestDisconnectConnectSettings', 'openConnectSharedLinks', 'openConnectBrowser',
  ].sort());
  // Even a direct main-process call from this legitimate frame must not reach
  // unrelated handlers. Check all registered non-Storage capabilities, not only
  // the bounded methods present in the persistent shared preload.
  const denied = await app.evaluate(async ({ ipcMain, BrowserWindow }) => {
    const sender = BrowserWindow.getAllWindows()[0].webContents;
    const event = { sender, senderFrame: sender.mainFrame };
    const allowed = new Set(['read-capture-location', 'change-capture-location', 'reset-capture-location',
      'read-retention', 'save-retention', 'reset-retention', 'read-capture-usage', 'navigate-settings', 'show-capture-folder',
      'settings-mounted', 'settings-frame-ready', 'settings-route']);
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
  const content = page.locator('.settings-content');
  await refreshUsage.scrollIntoViewIfNeeded();
  assert.equal(await content.evaluate(element => element.scrollWidth <= element.clientWidth), true);
  const refreshBounds = await refreshUsage.boundingBox();
  assert.ok(refreshBounds && refreshBounds.y >= 0 && refreshBounds.y + refreshBounds.height <= await page.evaluate(() => innerHeight));
  assert.equal(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight), true);
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
  if (proof) await content.evaluate(element => { element.scrollTop = 0; });
  await screenshot('storage-720-light.png');
  // Non-resizable Linux windows can ignore setSize; test the actual minimum
  // renderer viewport on both platforms rather than silently retaining 720px.
  const viewport = await page.context().newCDPSession(page);
  await viewport.send('Emulation.setDeviceMetricsOverride', { width: 640, height: 530, deviceScaleFactor: 1, mobile: false });
  await expect.poll(() => page.evaluate(() => innerWidth)).toBe(640);
  await page.evaluate(() => document.fonts.ready);
  await expect(select).toHaveCSS('font-size', '18px');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  for (const mode of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: mode });
    assert.equal(await select.evaluate(element => {
      const style = getComputedStyle(element), context = document.createElement('canvas').getContext('2d');
      context.font = style.font;
      return [...element.options].every(option => context.measureText(option.label).width <=
        element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight));
    }), true, `both retention durations remain readable at 640px in ${mode} mode`);
    await select.selectOption('month');
    await select.scrollIntoViewIfNeeded();
    assert.equal(await page.locator('.settings-sidebar').evaluate(element => element.scrollWidth <= element.clientWidth), true);
    await screenshot(`storage-640-${mode}.png`);
  }
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
    await expect(page.locator('.settings-policy + [data-slot="native-select-icon"]')).toHaveCSS('color',await select.evaluate(e=>getComputedStyle(e).color));
    await expect(page.locator('.settings-shell')).toHaveCSS('--apparent-primary', '#7a58c7');
    assert.equal(await page.locator('.settings-shell').evaluate(element => getComputedStyle(element).colorScheme), colorScheme);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await screenshot(`storage-${colorScheme}.png`, true);
  }
  const emitted = [];
  app.process().stdout.on('data', data => emitted.push(data.toString()));
  const compact = button('Settings pages, Storage');
  if (await compact.isVisible()) await compact.click();
  await button('General').click();
  await expect.poll(() => emitted.join('')).toContain('"action":"navigate","pane":"general"');
  t.diagnostic('Retention and installed Settings presentation assertions completed');
});
