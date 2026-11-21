import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _electron as electron, chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
test('installed About projects parent state and bounds actions', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'about-'));
  const application = await electron.launch({ env: { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, 'config'), XDG_CACHE_HOME: path.join(home, 'cache') }, args: [path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), '--settings-storage', '--settings-about'] });
  try {
    const page = await application.firstWindow();
    await expect(page.getByText('Loading update status…')).toBeVisible();
    await expect(page).toHaveTitle('Apparent Settings — About');
    let output = '';
    application.process().stdout?.on('data', data => { output += data.toString(); });
    const state = { type: 'about-state', version: '1.2.3 · a1b2c3d +modified', updates: true, linux: true,
      mainUpdates: true, updateChannel: 'main', restartPending: true, updateCheck: { checking: false, result: 'available' } };
    const publish = (value: unknown) => application.evaluate(({ BrowserWindow }, value) => {
      BrowserWindow.getAllWindows()[0].webContents.send('apparent:about-state', value);
    }, value);
    await publish(state);
    await expect(page.getByText('1.2.3 · a1b2c3d +modified')).toBeVisible();
    assert.equal(await application.evaluate(async ({ ipcMain, BrowserWindow }) => {
      const sender = BrowserWindow.getAllWindows()[0].webContents;
      const handler = ipcMain._invokeHandlers.get('apparent:about-copy-version');
      for (const [event, args] of [[{sender, senderFrame: {url: sender.getURL()}}, []],
        [{sender, senderFrame: sender.mainFrame}, ['arbitrary clipboard text']]] as const) {
        try { await handler(event, ...args); return false; } catch {}
      }
      return true;
    }), true, 'Copy refuses foreign frames and renderer-supplied text');
    await expect(page.getByRole('link', { name: 'Star on GitHub' })).toHaveAttribute('href', 'https://github.com/tryapparent/apparent');
    const discord = page.getByRole('link', { name: 'Join our Discord', exact: true });
    await expect(discord).toHaveAttribute('href', 'https://discord.gg/ZRGZwV32M');
    await application.evaluate(({ shell }) => { shell.openExternal = async url => { console.log('external-link:' + url); }; });
    await discord.focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => output.includes('external-link:https://discord.gg/ZRGZwV32M')).toBe(true);
    assert.equal(await page.evaluate(async () => {
      try { await window.apparentAbout.link('https://example.com' as 'discord'); return false; }
      catch { return true; }
    }), true, 'External links remain restricted to named destinations');
    await expect(page.getByText('A GitHub star won’t fix your bugs, but it will make our day.')).toBeVisible();
    await page.getByRole('button', { name: 'Show welcome tour', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => output.includes('"action":"tour"')).toBe(true);
    assert.equal(output.includes('"action":"update-now"'), false, 'Enter on a focused action must not accept an update');
    await expect(page.getByRole('button', { name: 'Restart now', exact: true })).toBeVisible();
    const channel = page.getByRole('combobox', {name: 'Next install source'});
    await channel.focus();
    await expect(channel).toBeFocused();
    // This Linux state is exercised on both hosts. Native select keyboard maps
    // differ on macOS; select the option through the portable control API.
    await channel.selectOption('stable');
    await expect.poll(() => output.includes('"key":"updateChannel","value":"stable"')).toBe(true);
    assert.equal(output.includes('"action":"dismiss-update-check"'), false,
      'the native channel mutation also clears the old offer');
    await page.keyboard.press('Escape');
    await publish({...state, resumeTour: true, updateChannel: 'stable', restartPending: false, updateCheck: {checking: false, result: null}});
    await expect(channel).toHaveValue('stable');
    for (const width of [720, 640]) {
      await application.evaluate(({BrowserWindow}, width) => { const window = BrowserWindow.getAllWindows()[0]; window.setResizable(true); window.setSize(width, 530); }, width);
      await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width);
      for (const colorScheme of ['light', 'dark'] as const) {
        await page.emulateMedia({colorScheme});
        await expect(page.locator('.settings-shell')).toHaveCSS('--apparent-primary', '#7a58c7');
        await expect(channel).toHaveCSS('font-size', '18px');
        await channel.scrollIntoViewIfNeeded();
        await expect(channel).toBeVisible();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        if (process.env.APPARENT_SETTINGS_PROOF) {
          await fs.mkdir(process.env.APPARENT_SETTINGS_PROOF, {recursive: true});
          await page.screenshot({animations: 'disabled', path: path.join(process.env.APPARENT_SETTINGS_PROOF, `channel-${width}-${colorScheme}.png`)});
        }
        const resume = page.getByRole('button', { name: 'Resume setup', exact: true });
        await resume.focus();
        await expect(resume).toBeFocused();
        if (process.env.APPARENT_SETTINGS_PROOF) {
          await page.screenshot({animations: 'disabled', path: path.join(process.env.APPARENT_SETTINGS_PROOF, `resume-${width}-${colorScheme}.png`)});
        }
      }
    }
    await publish(state);
    if (process.env.APPARENT_ABOUT_PROOF) await page.screenshot({ path: process.env.APPARENT_ABOUT_PROOF });
    await expect(page.getByRole('button', { name: 'Restart later', exact: true })).toHaveCount(0);
    assert.equal(await page.evaluate(async () => {
      try { await window.apparentAbout.act({ action: 'set', key: 'capturesDir', value: '/bad' }); return false; }
      catch { return true; }
    }), true);
    await publish({ ...state, updateCheck: { checking: true, result: null } });
    await expect(page.getByRole('heading', { name: 'Checking for updates…' })).toBeVisible();
    await expect(channel).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Restart now', exact: true })).toHaveCount(0);
    if (process.env.APPARENT_SETTINGS_PROOF) {
      await fs.mkdir(process.env.APPARENT_SETTINGS_PROOF, {recursive: true});
      await page.screenshot({path: path.join(process.env.APPARENT_SETTINGS_PROOF, 'about-checking.png')});
    }
    for (const width of [720, 640]) {
      await application.evaluate(({BrowserWindow}, width) => { const window = BrowserWindow.getAllWindows()[0]; window.setSize(width, 600); }, width);
      await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width);
      for (const colorScheme of ['light', 'dark'] as const) {
        await page.emulateMedia({colorScheme, reducedMotion: 'reduce'});
        const snapshot = (phase: string) => process.env.APPARENT_SETTINGS_PROOF && page.screenshot({
          animations: 'disabled',
          path: path.join(process.env.APPARENT_SETTINGS_PROOF, `update-${phase}-${width}-${colorScheme}.png`),
        });
        const showProgress = async (value: Record<string, string | number>) => {
          await publish({...state, updateCheck: {checking: true, result: null, progress: value}});
        };
        await showProgress({phase: 'downloading', downloadedBytes: 0, totalBytes: 0});
        const bar = page.getByRole('progressbar', {name: 'Update download'});
        await expect(bar).not.toHaveAttribute('value');
        await showProgress({phase: 'downloading', downloadedBytes: 42, totalBytes: 100});
        await expect(bar).toHaveAttribute('value', '42');
        await expect(page.getByRole('heading', {name: 'Downloading update…'})).toBeVisible();
        await expect(channel).toBeDisabled();
        await expect(channel.locator('..')).toHaveCSS('opacity', '1');
        await expect(page.getByRole('button', {name: 'Restart now'})).toHaveCount(0);
        assert.equal(await page.evaluate(() => document.querySelector('.settings-content')!.scrollWidth <= document.querySelector('.settings-content')!.clientWidth), true);
        if (process.env.APPARENT_SETTINGS_PROOF) {
          await page.evaluate(() => document.fonts.ready.then(() => {}));
          await page.locator('.settings-content').evaluate(el => { el.scrollTop = 0; });
          await snapshot('downloading');
        }
        await showProgress({phase: 'verifying'});
        await expect(page.getByRole('heading', {name: 'Verifying download…'})).toBeVisible();
        await expect(bar).toHaveCount(0);
        await snapshot('verifying');
        await showProgress({phase: 'installing'});
        await expect(page.getByRole('heading', {name: 'Installing update…'})).toBeVisible();
        await expect(page.locator('.settings-spin')).toHaveCSS('animation-name', 'none');
        await snapshot('installing');
        await publish(state);
        await expect(page.getByRole('button', {name: 'Restart now'})).toBeVisible();
        await expect(channel).toHaveValue('main');
        await expect(channel).toBeEnabled();
        await snapshot('restart');
      }
    }
    for (const [failure, title] of [
      ['busy', 'Update in progress'],
      ['rateLimited', 'GitHub limited update checks'],
      ['download', 'Download failed'],
      ['verification', 'Couldn’t verify the download'],
      ['installation', 'Couldn’t install the update'],
      ['restart', 'Couldn’t restart Apparent'],
    ]) {
      await publish({...state, updateCheck: {checking: false, result: 'failed', failure}});
      const dialog = page.getByRole('alertdialog', {name: title});
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('button', {name: failure === 'restart' ? 'Retry restart' : ['download', 'verification', 'installation'].includes(failure) ? 'Retry update' : 'Try again'})).toBeFocused();
      if (process.env.APPARENT_SETTINGS_PROOF && failure === 'download') {
        await page.screenshot({ animations: 'disabled', path: path.join(process.env.APPARENT_SETTINGS_PROOF, 'update-linux-download-failure.png') });
      }
    }
    const actionStart = output.length;
    await page.keyboard.press('Enter');
    await expect.poll(() => output.slice(actionStart).includes('"action":"update-now"')).toBe(true);
    await page.keyboard.press('Escape');
    await expect.poll(() => output.slice(actionStart).includes('"action":"dismiss-update-check"')).toBe(true);
    for (const result of ['current', 'failed', null] as const) {
      await publish({ ...state, linux: false, mainUpdates: false, restartPending: false, updateCheck: { checking: false, result } });
      if (result) await expect(page.getByRole('heading', { name: result === 'current' ? 'No update available' : 'Update check failed', exact: true })).toBeVisible();
      else {
        await expect(page.getByRole('heading', { name: 'Check for updates', exact: true })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Check for updates', exact: true })).toBeVisible();
      }
      for (const size of [[720, 530], [640, 530]]) {
        await application.evaluate(({ BrowserWindow }, [width, height]) => { const window = BrowserWindow.getAllWindows()[0]; window.setResizable(true); window.setSize(width, height); }, size);
        await expect.poll(() => page.evaluate(() => innerWidth)).toBe(size[0]);
        for (const colorScheme of ['light', 'dark'] as const) {
          await page.emulateMedia({ colorScheme });
          await expect(page.locator('.settings-shell')).toHaveCSS('--apparent-primary', '#7a58c7');
          await expect(page.locator('.settings-links a').first()).toHaveCSS('color',colorScheme==='dark'?'rgb(245, 240, 232)':'rgb(2, 1, 2)');
          if(result==='failed') await page.getByRole('alertdialog').scrollIntoViewIfNeeded();
          else await page.getByRole('button', { name: 'Show welcome tour', exact: true }).scrollIntoViewIfNeeded();
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
          assert.equal(await page.locator('.settings-sidebar').evaluate(element => element.scrollWidth <= element.clientWidth), true, 'sidebar viewport fits');
          if (process.env.APPARENT_SETTINGS_PROOF) {
            await fs.mkdir(process.env.APPARENT_SETTINGS_PROOF, { recursive: true });
            await page.screenshot({ animations: 'disabled', path: path.join(process.env.APPARENT_SETTINGS_PROOF, `about-${result ?? 'idle'}-${size[0]}-${colorScheme}.png`) });
          }
        }
      }
    }
    await publish({ ...state, updates: false, restartPending: false, updateCheck: { checking: false, result: null } });
    await expect(page.getByRole('heading', { name: 'Updates unavailable' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Update$/ })).toBeDisabled();
    await expect(page.getByText('To install updates here, run Apparent from an AppImage.', {exact: true})).toBeVisible();
    if (process.env.APPARENT_SETTINGS_PROOF) await page.screenshot({path: path.join(process.env.APPARENT_SETTINGS_PROOF, 'about-unavailable.png')});
    await page.getByRole('button', { name: 'Copy version', exact: true }).click();
    await expect(page.getByText('Unable to copy. Try again.', { exact: true })).toBeVisible();
    await page.getByRole('button',{name:'Close',exact:true}).click();
    const compact = page.getByRole('button', { name: 'Settings pages, About', exact: true });
    if (await compact.isVisible()) await compact.click();
    await page.getByRole('button', { name: 'Storage', exact: true }).click();
    await expect.poll(() => output.includes('"pane":"storage"')).toBe(true);
  } finally { await application.close(); await fs.rm(home, { recursive: true, force: true }); }
});

// Playwright's Electron launcher closes stdin. A real parent pipe is required
// to establish authoritative identity; renderer-only state must never suffice.
test('Copy version uses the real parent identity through the shipped preload', {timeout: 20000}, async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'about-copy-'));
  const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const application = spawn(createRequire(import.meta.url)('electron') as string,
    ['--no-sandbox', frontend, '--settings-storage', '--settings-about', '--settings-parent', '--remote-debugging-port=0'],
    {env: {...process.env, ELECTRON_RUN_AS_NODE: '', HOME: home, XDG_CONFIG_HOME: path.join(home, 'config')}, stdio: 'pipe'});
  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined;
  const exited = new Promise<void>(resolve => application.once('exit', () => resolve()));
  try {
    const debuggerUrl = await new Promise<string>((resolve, reject) => {
      let stderr = '';
      application.stderr.on('data', chunk => {
        stderr += chunk.toString();
        const url = stderr.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[^\s]+)/)?.[1];
        if (url) resolve(url);
      });
      application.once('error', reject);
      application.once('exit', code => reject(new Error(`Settings exited (${code}): ${stderr.slice(-1000)}`)));
    });
    browser = await chromium.connectOverCDP(debuggerUrl);
    const context = browser.contexts()[0];
    const page = context.pages()[0];
    await page.locator('.settings-shell').waitFor();
    application.stdin.write(JSON.stringify({type: 'about-state', version: '1.2.3 · abcdef0 +modified', updates: true,
      linux: true, mainUpdates: false, updateChannel: 'stable', updateCheck: {checking: false, result: 'current'}}) + '\n');
    await expect(page.getByText('1.2.3 · abcdef0 +modified')).toBeVisible();
    await page.getByRole('button', {name: 'Copy version', exact: true}).click();
    await expect(page.getByText('Copied', {exact: true})).toBeVisible();
    await page.evaluate(() => {
      const field = document.createElement('textarea');
      field.setAttribute('aria-label', 'Clipboard verification');
      document.body.append(field); field.focus();
    });
    await page.keyboard.press('ControlOrMeta+V');
    await expect(page.getByRole('textbox', {name: 'Clipboard verification'})).toHaveValue('Apparent 1.2.3 · abcdef0 +modified');
    await page.getByRole('textbox', {name: 'Clipboard verification'}).evaluate(element => element.remove());
    assert.equal(await page.locator('.settings-version > span').first().evaluate(element => getComputedStyle(element).userSelect), 'text');
  } finally {
    await browser?.close().catch(() => {});
    if (application.exitCode === null) { application.kill('SIGTERM'); await exited; }
    await fs.rm(home, {recursive: true, force: true});
  }
});
