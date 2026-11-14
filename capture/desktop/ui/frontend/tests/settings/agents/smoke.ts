import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium, expect, _electron as electron} from '@playwright/test';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {createInterface} from 'node:readline';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {skillCommand} from '../../../src/agents/policy.ts';

test('installed Agents uses acknowledged preferences, fixed clipboard text and bounded navigation', {timeout: 60000}, async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'agents-'));
  const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const application = spawn(createRequire(import.meta.url)('electron') as string,
    ['--no-sandbox', frontend, '--settings-storage', '--settings-agents', '--settings-parent', '--remote-debugging-port=0'],
    {env: {...process.env, ELECTRON_RUN_AS_NODE: '', HOME: home, XDG_CONFIG_HOME: path.join(home, 'config'), XDG_CACHE_HOME: path.join(home, 'cache')}, stdio: 'pipe'});
  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined;
  const exited = new Promise<void>(resolve => application.once('exit', () => resolve()));
  const actions: Record<string, unknown>[] = [];
  let saved: boolean | null = null;
  let failWrite = false;
  let holdWrite = false;
  let holdRead = true;
  let held: Record<string, unknown> | undefined;
  const reply = (action: Record<string, unknown>) => {
    if ('enabled' in action && !failWrite) saved = action.enabled as boolean;
    application.stdin.write(JSON.stringify({type: 'agents-result', request: action.request,
      facts: failWrite && 'enabled' in action ? {error: 'config_write_failed'} : {saved}}) + '\n');
  };
  createInterface({input: application.stdout}).on('line', line => {
    try {
      const action = JSON.parse(line); actions.push(action);
      if (action.action === 'agents-preference') {
        if (holdRead || holdWrite && 'enabled' in action) held = action;
        else reply(action);
      }
    } catch {}
  });
  try {
    const debuggerUrl = await new Promise<string>((resolve, reject) => {
      let stderr = '';
      application.stderr.on('data', chunk => {
        stderr += chunk.toString();
        const url = stderr.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[^\s]+)/)?.[1];
        if (url) resolve(url);
      });
      application.once('error', reject);
      application.once('exit', code => reject(Error(`Settings exited (${code}): ${stderr.slice(-1200)}`)));
    });
    browser = await chromium.connectOverCDP(debuggerUrl);
    const page = browser.contexts()[0].pages()[0];
    await expect(page).toHaveTitle('Apparent Settings — Agents');
    const toggle = page.getByRole('switch', {name: 'Ask for an Apparent video on complex changes'});
    await expect(toggle).toBeDisabled();
    await expect(page.getByText('Reading saved preference…', {exact: true})).toBeVisible();
    await expect.poll(() => Boolean(held)).toBe(true);
    if (process.env.APPARENT_AGENTS_PROOF) {
      await fs.mkdir(process.env.APPARENT_AGENTS_PROOF, {recursive: true});
      await page.screenshot({path: path.join(process.env.APPARENT_AGENTS_PROOF, 'agents-loading.png')});
    }
    reply(held!); held = undefined; holdRead = false;
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('button', {name: 'Agents', exact: true})).toHaveAttribute('aria-current', 'page');
    holdWrite = true;
    await toggle.focus(); await page.keyboard.press('Space');
    await expect(toggle).toBeDisabled();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await expect.poll(() => Boolean(held)).toBe(true);
    reply(held!); holdWrite = false;
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect(toggle).toBeEnabled();
    if (process.env.APPARENT_AGENTS_PROOF) await page.screenshot({path: path.join(process.env.APPARENT_AGENTS_PROOF, 'agents-off.png')});
    failWrite = true;
    await toggle.click();
    await expect(page.getByRole('alert')).toContainText('Unable to save');
    await expect(toggle).toBeDisabled();
    failWrite = false;
    await page.getByRole('button', {name: 'Refresh preference'}).click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect(toggle).toBeEnabled();
    // Out-of-band native readback follows external config edits.
    saved = true;
    application.stdin.write(JSON.stringify({type: 'agents-state', facts: {saved}}) + '\n');
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('button', {name: 'Copy command', exact: true}).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Copied', {exact: true})).toBeVisible();
    await page.evaluate(() => {
      const field = document.createElement('textarea'); field.setAttribute('aria-label', 'Clipboard verification');
      document.body.append(field); field.focus();
    });
    await page.keyboard.press('ControlOrMeta+V');
    await expect(page.getByRole('textbox', {name: 'Clipboard verification'})).toHaveValue(skillCommand);
    await page.getByRole('textbox', {name: 'Clipboard verification'}).evaluate(element => element.remove());
    assert.equal(await page.evaluate(async () => {
      for (const call of [() => window.apparentAgents.save('false' as unknown as boolean),
        () => window.apparentAbout.act({action: 'tour'}), () => window.apparent?.resetCaptureLocation()]) {
        try { await call(); return false; } catch {}
      }
      return true;
    }), true, 'Agents cannot send non-boolean preferences or invoke other panes');
    for (const width of [720, 640, 320]) {
      const session = await page.context().newCDPSession(page);
      await session.send('Emulation.setDeviceMetricsOverride', {width, height: 530, deviceScaleFactor: 1, mobile: false});
      for (const colorScheme of ['light', 'dark', 'light'] as const) {
        await page.emulateMedia({colorScheme, reducedMotion: 'reduce'});
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        assert.equal(await page.locator('.settings-content').evaluate(element => element.scrollWidth <= element.clientWidth), true);
        assert.equal(await page.locator('.settings-agent-command').evaluate(element => element.scrollWidth <= element.clientWidth), true);
        const contrasts = await page.evaluate(() => {
          const luminance = (color: Uint8ClampedArray) => {
            const channels = [...color].slice(0, 3).map(value => {
              const channel = value / 255; return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
            });
            return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
          };
          return [...document.querySelectorAll('.settings-agents h2, .settings-agents .settings-metadata, .settings-agent-command, .settings-agents button')].map(element => {
            // Chromium resolves CSS color-mix/oklab and alpha compositing;
            // parsing their numeric components as 8-bit RGB is incorrect.
            const canvas = new OffscreenCanvas(1, 1);
            const context = canvas.getContext('2d')!;
            const ancestors: Element[] = [];
            for (let current: Element | null = element; current; current = current.parentElement) ancestors.unshift(current);
            for (const ancestor of ancestors) { context.fillStyle = getComputedStyle(ancestor).backgroundColor; context.fillRect(0, 0, 1, 1); }
            const b = luminance(context.getImageData(0, 0, 1, 1).data);
            context.fillStyle = getComputedStyle(element).color; context.fillRect(0, 0, 1, 1);
            const a = luminance(context.getImageData(0, 0, 1, 1).data);
            return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
          });
        });
        assert.ok(contrasts.every(value => value >= 4.5), `Text contrast: ${contrasts.join(', ')}`);
        await page.getByRole('button', {name: 'Copy command', exact: true}).scrollIntoViewIfNeeded();
        if (process.env.APPARENT_AGENTS_PROOF) {
          await fs.mkdir(process.env.APPARENT_AGENTS_PROOF, {recursive: true});
          await page.screenshot({path: path.join(process.env.APPARENT_AGENTS_PROOF, `agents-${width}-${colorScheme}.png`)});
          await page.getByRole('heading', {name: 'Agents', exact: true}).scrollIntoViewIfNeeded();
          await page.screenshot({path: path.join(process.env.APPARENT_AGENTS_PROOF, `agents-${width}-${colorScheme}-top.png`)});
        }
      }
      await session.detach();
    }
    application.stdin.write(JSON.stringify({type: 'agents-state', facts: {error: 'config_read_failed'}}) + '\n');
    await expect(toggle).toBeDisabled();
    await expect(page.getByRole('alert')).toContainText('Unable to read');
    if (process.env.APPARENT_AGENTS_PROOF) await page.screenshot({path: path.join(process.env.APPARENT_AGENTS_PROOF, 'agents-read-error.png')});
    await page.getByRole('button', {name: 'About', exact: true}).click();
    await expect.poll(() => actions.some(action => action.action === 'navigate' && action.pane === 'about')).toBe(true);
    assert.equal(actions.some(action => action.action === 'set'), false);
  } finally {
    await browser?.close().catch(() => {});
    if (application.exitCode === null) { application.kill('SIGTERM'); await exited; }
    await fs.rm(home, {recursive: true, force: true});
  }
});

test('Agents clipboard failures recover and bridge refuses foreign frames or arbitrary text', {timeout: 20000}, async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'agents-copy-'));
  const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const application = await electron.launch({args: [frontend, '--settings-storage', '--settings-agents'],
    env: {...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, 'config'), XDG_CACHE_HOME: path.join(home, 'cache')}});
  try {
    const page = await application.firstWindow();
    await expect(page.getByRole('button', {name: 'Copy command', exact: true})).toBeVisible();
    assert.equal(await application.evaluate(async ({ipcMain, BrowserWindow, clipboard}) => {
      const sender = BrowserWindow.getAllWindows()[0].webContents;
      const handler = ipcMain._invokeHandlers.get('apparent:agents-copy-skill');
      for (const [event, args] of [[{sender, senderFrame: {url: sender.getURL()}}, []],
        [{sender, senderFrame: sender.mainFrame}, ['arbitrary text']]] as const) {
        try { await handler(event, ...args); return false; } catch {}
      }
      clipboard.writeText = () => { throw Error('Synthetic clipboard unavailable'); };
      return true;
    }), true);
    await page.getByRole('button', {name: 'Copy command', exact: true}).click();
    await expect(page.getByRole('alert').filter({hasText: 'Unable to copy'})).toBeVisible();
    await expect(page.getByText('Copied', {exact: true})).toHaveCount(0);
    await application.evaluate(({clipboard}) => { clipboard.writeText = () => {}; });
    await page.getByRole('button', {name: 'Copy command', exact: true}).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Copied', {exact: true})).toBeVisible();
    await expect(page.getByRole('alert').filter({hasText: 'Unable to copy'})).toHaveCount(0);
  } finally { await application.close(); await fs.rm(home, {recursive: true, force: true}); }
});
