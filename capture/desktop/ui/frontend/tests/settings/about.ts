import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _electron as electron, chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
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

test('recorded bug reports require Connect and can be confirmed without an inline preview', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'report-settings-'));
  const application = await electron.launch({
    env: { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, 'config'), XDG_CACHE_HOME: path.join(home, 'cache') },
    args: [path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), '--settings-storage', '--settings-about'],
  });
  try {
    const page = await application.firstWindow();
    await application.evaluate(({ ipcMain }) => {
      const handlers = {
        'apparent:feedback-available': () => true,
        'apparent:feedback-capture-available': () => false,
        'apparent:feedback-capture-start': () => ({ status: 'saved' }),
        'apparent:feedback-capture-discard': () => {},
        'apparent:feedback-capture-send': () => 'sent',
      };
      for (const [channel, handler] of Object.entries(handlers)) {
        ipcMain.removeHandler(channel);
        ipcMain.handle(channel, handler);
      }
    });
    await application.evaluate(({ BrowserWindow, nativeTheme }) => {
      nativeTheme.themeSource = 'light';
      const window = BrowserWindow.getAllWindows()[0];
      return window.loadURL(window.webContents.getURL());
    });
    const report = page.getByRole('button', { name: 'Report a bug' });
    await report.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Sign in to Apparent Connect to send a recording.')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Show it with Apparent' })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Write a description' }).click();
    await expect(dialog.getByRole('textbox')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(report).toBeFocused();

    await application.evaluate(({ BrowserWindow, ipcMain }) => {
      ipcMain.removeHandler('apparent:feedback-capture-available');
      ipcMain.handle('apparent:feedback-capture-available', () => true);
      BrowserWindow.getAllWindows()[0].setContentSize(640, 530);
    });
    await page.emulateMedia({ colorScheme: 'dark' });
    await report.click();
    await dialog.getByRole('button', { name: 'Show it with Apparent' }).click();
    await expect(dialog.getByText('Preview unavailable. The recording is saved on this device.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Send report' }).click();
    await expect(dialog.getByRole('heading', { name: 'Report submitted' })).toBeVisible();
  } finally {
    await application.close();
    await fs.rm(home, { recursive: true, force: true });
  }
});
