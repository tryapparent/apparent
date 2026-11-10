import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

test('installed About projects parent state, copies version and bounds actions', { timeout: 30000 }, async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'about-'));
  // A real parent pipe is required: Playwright's Electron launcher closes stdin.
  const executable = createRequire(import.meta.url)('electron') as string;
  const child = spawn(executable, ['--no-sandbox', path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'),
    '--settings-storage', '--settings-about', '--settings-parent', '--remote-debugging-port=0'],
    { env: { ...process.env, ELECTRON_RUN_AS_NODE: '', HOME: home, XDG_CONFIG_HOME: path.join(home, 'config'), XDG_CACHE_HOME: path.join(home, 'cache') }, stdio: 'pipe' });
  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined;
  const exit = new Promise(resolve => child.once('exit', resolve));
  try {
    const debuggerUrl = await new Promise<string>((resolve, reject) => {
      let stderr = '';
      child.stderr.on('data', data => {
        stderr += data.toString();
        const url = stderr.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[^\s]+)/)?.[1];
        if (url) resolve(url);
      });
      child.once('error', reject);
      child.once('exit', () => reject(new Error('About exited before observation: ' + stderr.slice(-2000))));
    });
    browser = await chromium.connectOverCDP(debuggerUrl);
    const page = browser.contexts()[0].pages()[0];
    await expect(page.getByText('Loading update status…')).toBeVisible();
    let output = '';
    child.stdout.on('data', data => { output += data.toString(); });
    const state = { type: 'about-state', version: '1.2.3 · abc1234', updates: true, linux: true,
      mainUpdates: true, updateChannel: 'main', updateCheck: { checking: false, result: 'available' } };
    const publish = (value: unknown) => child.stdin.write(JSON.stringify(value) + '\n');
    publish(state);
    await expect(page.getByText('Version 1.2.3 · abc1234')).toBeVisible();
    await page.getByRole('button', { name: 'Copy version', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Version copied' })).toBeVisible();
    await page.evaluate(() => {
      const field = document.createElement('textarea');
      field.setAttribute('aria-label', 'Clipboard verification');
      document.body.append(field);
      field.focus();
    });
    await page.keyboard.press('ControlOrMeta+V');
    await expect(page.getByRole('textbox', { name: 'Clipboard verification' })).toHaveValue('Apparent 1.2.3 · abc1234');
    await page.getByRole('textbox', { name: 'Clipboard verification' }).evaluate(element => element.remove());
    await expect(page.getByRole('button', { name: 'Update now', exact: true })).toBeVisible();
    if (process.env.APPARENT_ABOUT_PROOF) await page.screenshot({ path: process.env.APPARENT_ABOUT_PROOF });
    await page.getByRole('button', { name: 'Update later', exact: true }).click();
    await expect.poll(() => output.includes('"action":"update-later"')).toBe(true);
    assert.equal(await page.evaluate(async () => {
      try { await window.apparentAbout.act({ action: 'set', key: 'capturesDir', value: '/bad' }); return false; }
      catch { return true; }
    }), true);
    publish({ ...state, updateCheck: { checking: true, result: null } });
    await expect(page.getByRole('button', { name: 'Checking…' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Update now', exact: true })).toHaveCount(0);
    publish({ ...state, updates: false, updateCheck: { checking: false, result: null } });
    await expect(page.getByRole('button', { name: 'Updates unavailable', exact: true })).toBeDisabled();
    await expect(page.getByText('This installation cannot check for updates. Run the AppImage to use automatic updates.')).toBeVisible();
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.select-text')!).userSelect), 'text');
    if (process.env.APPARENT_ABOUT_PROOF) await page.screenshot({ path: process.env.APPARENT_ABOUT_PROOF.replace(/\.png$/, '-unavailable.png') });
    await page.getByRole('button', { name: 'Storage', exact: true }).click();
    await expect.poll(() => output.includes('"pane":"storage"')).toBe(true);
  } finally {
    child.kill('SIGTERM');
    await browser?.close().catch(() => {});
    await exit;
    await fs.rm(home, { recursive: true, force: true });
  }
});
