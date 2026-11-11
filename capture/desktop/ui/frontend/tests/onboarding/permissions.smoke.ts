import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {mkdtemp, mkdir, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium, expect} from '@playwright/test';

// Real Electron main/preload/renderer, synthetic native permission receipts.
// This does not grant permissions or prove evdev/capture/Hermes integration.
test('Linux input permission recovery never claims readiness from a copy request', {timeout: 45000}, async t => {
  const require = createRequire(import.meta.url);
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const profile = await mkdtemp(path.join(os.tmpdir(), 'permission-'));
  const child = spawn(require('electron'), [root, '--onboarding', '--remote-debugging-port=0',
    ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], {
    env: {...process.env, APPARENT_UI_PROFILE: profile}, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined;
  t.after(async () => {
    if (child.exitCode === null) {
      const done = new Promise(resolve => child.once('exit', resolve));
      child.stdin.end('{"type":"close"}\n');
      const timer = setTimeout(() => child.kill(), 3000);
      await done; clearTimeout(timer);
    }
    await browser?.close();
    await rm(profile, {recursive: true, force: true});
  });
  const endpoint = await new Promise<string>((resolve, reject) => {
    let log = '';
    const timer = setTimeout(() => reject(Error('No Electron debugger endpoint')), 10000);
    child.once('error', reject);
    child.once('exit', () => {clearTimeout(timer); reject(Error('Electron exited'));});
    child.stderr.on('data', bytes => {
      log += bytes;
      const match = log.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {clearTimeout(timer); resolve(match[1]);}
    });
  });
  browser = await chromium.connectOverCDP(endpoint);
  const context = browser.contexts()[0];
  const page = context.pages()[0] || await context.waitForEvent('page');
  let output = '';
  child.stdout.on('data', bytes => output += bytes);
  const send = (platform: string, granted = false) => child.stdin.write(JSON.stringify({
    type: 'state', step: 'permissions', platform, ready: granted, fix: false,
    index: 1, count: 5, shortcut: 'Super+Shift+R', rows: [
      {permission: 'screen-recording', status: 'granted', required: true},
      {permission: 'microphone', status: 'granted', required: true},
      {permission: 'accessibility', status: granted ? 'granted' : 'denied', required: true},
    ],
  }) + '\n');
  const evidence = process.env.ANNOTATION_EVIDENCE;
  if (evidence) await mkdir(evidence, {recursive: true});
  send('linux');
  await expect(page.locator('.native-permissions')).toBeVisible();
  if (evidence) await page.screenshot({path: path.join(evidence, 'permissions.png')});
  await expect(page.getByText('Input devices', {exact: true})).toBeVisible();
  await expect(page.getByText(/log out and back in/i)).toBeVisible();
  assert.equal(await page.locator('.native-setup').evaluate(el => el.scrollWidth <= el.clientWidth), true);
  assert.equal(await page.locator('.native-permission-description code').evaluate(el => el.scrollWidth <= el.clientWidth), true);
  const copy = page.getByRole('button', {name: 'Copy command', exact: true});
  await copy.focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => output).toContain('"action":"grant","permission":"accessibility"');
  await expect(page.getByRole('button', {name: 'Choose recording shortcut'})).toBeDisabled();
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({colorScheme: theme, reducedMotion: 'reduce'});
    if (evidence) await page.screenshot({path: path.join(evidence, `permissions-${theme}.png`)});
  }
  send('linux', true);
  await expect(copy).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Choose recording shortcut'})).toBeEnabled();
  send('macos');
  await expect(page.getByText('Accessibility', {exact: true})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Open Settings', exact: true})).toBeVisible();
  assert.equal(await page.getByText('Input devices', {exact: true}).count(), 0);
});
