import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect } from '@playwright/test';

test('final Linux Main AppImage launches with its exact identity and sandboxed updater Settings', { timeout: 90_000 }, async t => {
  const image = process.env.APPARENT_SHELL_APPIMAGE;
  const source = process.env.APPARENT_SHELL_SOURCE_SHA;
  assert(image && source, 'Explicit final AppImage and source SHA are required');
  const profile = await mkdtemp(join(homedir(), '.shell-appimage-proof-'));
  const application = await electron.launch({ executablePath: image, env: { ...process.env, APPARENT_FOUNDATION_PROFILE: profile } });
  t.after(async () => { await application.close(); await rm(profile, { recursive: true, force: true }); });
  const page = await application.firstWindow();
  t.diagnostic(JSON.stringify(await application.evaluate(({ app }) => ({ packaged: app.isPackaged, image: process.env.APPIMAGE, resources: process.resourcesPath }))));
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const section = page.getByRole('region', { name: 'App updates' });
  t.diagnostic(JSON.stringify(await page.evaluate(() => window.apparent.updates.read())));
  await expect(section.getByText(`Running build ${source.slice(0, 12)}`)).toBeVisible();
  await expect(section.getByText('Main', { exact: true })).toBeVisible();
  await expect(section.getByRole('button', { name: /Check/ })).toBeVisible();
  assert.equal(await application.evaluate(({ BrowserWindow }) => {
    const prefs = (BrowserWindow.getAllWindows()[0].webContents as any).getLastWebPreferences();
    return prefs.sandbox && prefs.contextIsolation && !prefs.nodeIntegration;
  }), true);
  assert.equal(await application.evaluate(({ app }) => app.commandLine.hasSwitch('no-sandbox')), false,
    'AppImage startup must not inject a global Chromium sandbox bypass');
  assert.equal(await page.evaluate(async () => {
    try { await (window as any).apparent.updates.restart(); return false; } catch { return true; }
  }), true, 'unready restart is refused through the real preload bridge');
  if (process.env.APPARENT_SHELL_SCREENSHOT) await page.screenshot({ path: process.env.APPARENT_SHELL_SCREENSHOT });
});
