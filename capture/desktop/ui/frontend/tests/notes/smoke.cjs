const { execFileSync } = require('node:child_process');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chromium, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');

for (const scale of process.platform === 'linux' ? [1, 2] : [1]) {
test(`shipped Electron note UI saves, shows saved notes read-only and isolates the bridge at ${scale}x`, { timeout: 45000 }, async t => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'apparent-notes-ui-'));
  const profile = path.join(home, 'owned-profile');
  await fs.mkdir(profile, { mode: 0o700 });
  const child = require('node:child_process').spawn(require('electron'),
    ['--no-sandbox', `--force-device-scale-factor=${scale}`, '--remote-debugging-port=0', path.resolve(__dirname, '../../electron/notes/main.cjs'), '--capture-frame=0,0,1280,800', '--notes-profile=' + profile],
    { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, 'config') } });
  let browser;
  let previousFixture;
  let revision = 0;
  let errors = '';
  child.stderr.on('data', chunk => { errors += chunk.toString(); });
  t.after(async () => { await browser?.close(); child.kill(); await new Promise(resolve => child.exitCode !== null ? resolve() : child.once('exit', resolve)); await fs.rm(home, { recursive: true, force: true }); });
  const endpoint = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Notes runtime did not become ready')), 10000);
    child.stderr.on('data', chunk => { const m = chunk.toString().match(/DevTools listening on (ws:\/\/\S+)/); if (m) { clearTimeout(timer); resolve(m[1]); } });
    child.once('exit', code => { clearTimeout(timer); reject(new Error('Notes runtime exited: '+code)); });
  });
  const messages = [];
  let pending = '';
  child.stdout.on('data', chunk => {
    pending += chunk.toString(); const lines = pending.split('\n'); pending = lines.pop();
    for (const line of lines) { try {
      const value = JSON.parse(line); messages.push(value);
      // Production Rust publishes each accepted draft back to the renderer.
      if (value.action === 'draft' && state?.mode === 'editor' && state.current === value.pin) {
        state = { ...state, drafts: state.drafts.map(n => n.pin === value.pin ? { ...n, text: value.text } : n) }; send();
      }
    } catch {} }
  });
  browser = await chromium.connectOverCDP(await endpoint);
  const context = browser.contexts()[0];
  await expect.poll(() => context.pages().length).toBe(1);
  const pages = context.pages();
  const popup = pages.find(p => p.url().endsWith('#notes-popup')) || pages[0];
  await popup.waitForFunction(() => !!window.captureNotes);
  await expect.poll(() => messages.some(m => m.action === 'ready')).toBe(true);
  let state = { mode: 'editor', current: 1, position: [200, 160], notes: [], drafts: [{ pin: 1, t: 123, x: .5, y: .35, text: '' }], error: null };
  const send = (events) => {
    if (!events) {
      events = [];
      if (state.badgeRect && JSON.stringify(previousFixture?.badgeRect) !== JSON.stringify(state.badgeRect)) events.push({ kind: 'badge', rect: state.badgeRect });
      if (!previousFixture || previousFixture.mode !== state.mode) {
        events.push(state.mode === 'editor' ? { kind: 'open', pin: state.current, position: state.position } :
          { kind: state.mode === 'list' ? 'list' : 'dismiss' });
      }
    }
    previousFixture = structuredClone(state);
    child.stdin.write(JSON.stringify({ revision: ++revision, events, notes: state.notes, drafts: state.drafts, error: state.error }) + '\n');
  };
  send();
  const field = popup.getByRole('textbox', { name: 'Note text' });
  await expect(field).toBeFocused();
  if (process.platform === 'linux') {
    const expected = [200 + 12 * scale, 160 + 12 * scale, 332 * scale, 220 * scale];
    await expect.poll(() => messages.some(m => m.action === 'surface' && m.focus && JSON.stringify(m.rect) === JSON.stringify(expected))).toBe(true);
  }
  const { backgroundColor } = require('@apparent/ui/window-theme');
  for (const mode of ['light', 'dark', 'light']) {
    await popup.emulateMedia({ colorScheme: mode });
    const hex = backgroundColor({ shouldUseDarkColors: mode === 'dark' });
    const rgb = hex.slice(1).match(/../g).map(value => parseInt(value, 16));
    await expect(popup.locator('.note-popup')).toHaveCSS('background-color', `rgb(${rgb.join(', ')})`);
    await expect(popup.locator('body')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  }
  assert.deepEqual(await popup.evaluate(() => ({ require: typeof window.require, process: typeof window.process, keys: Object.keys(window.captureNotes).sort() })),
    { require: 'undefined', process: 'undefined', keys: ['command', 'onSnapshot'] });
  await field.pressSequentially('Smaller button', { delay: 20 }); await expect(field).toBeFocused(); await field.press('Shift+Enter'); await field.press('x');
  await expect(field).toHaveValue('Smaller button\nx');
  await field.press('Enter');
  await expect.poll(() => messages.find(m => m.action === 'save')?.text).toBe('Smaller button\nx');
  // Real Rust owns this ack in production. This fixture tests renderer behavior only.
  state = { ...state, mode: 'badge', notes: [{ ...state.drafts[0], text: 'Smaller button\nx' }], drafts: [] }; send();
  state.mode = 'list'; state.badgeRect = [450, 36, 380, 40]; send();
  if (process.platform === 'linux') {
    const [id, extra] = messages.find(m => m.action === 'windows').ids;
    assert.equal(extra, undefined);
    await expect.poll(() => execFileSync('xwininfo', ['-id', String(id)], { encoding: 'utf8' }).includes('Map State: IsViewable')).toBe(true);
    await expect.poll(() => messages.some(m => m.action === 'surface' && m.rect[3] === 350 * scale)).toBe(true);
    const focusedLists = () => messages.filter(m => m.action === 'surface' && m.focus && m.rect[3] === 350 * scale).length;
    const before = focusedLists();
    send([{ kind: 'list' }]);
    await expect.poll(focusedLists).toBe(before + 1);
  }
  const list = popup.getByRole('list', { name: 'Saved notes' });
  await expect(list.getByRole('listitem')).toHaveText(/Smaller button\s+x/);
  await expect(popup.getByRole('button')).toHaveCount(1);
  await list.getByText(/Smaller button/).click();
  await expect(list).toBeVisible();
  await expect(field).toHaveCount(0);
  for (const action of ['edit', 'delete']) {
    await assert.rejects(popup.evaluate(action => window.captureNotes.command({ action, pin: 1 }), action));
  }
  await popup.getByRole('button', { name: 'Close notes' }).focus();
  await popup.keyboard.press('Tab');
  await expect(list).toBeFocused();
  const savedNotes = state.notes;
  state.notes = [{ ...savedNotes[0], text: Array.from({ length: 40 }, (_, i) => `Line ${i + 1}`).join('\n') }];
  send();
  await popup.setViewportSize({ width: 320, height: 280 });
  await expect(list.getByRole('listitem')).toHaveText(/Line 40/);
  await popup.keyboard.press('End');
  await expect.poll(() => list.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  state.notes = [];
  send();
  await expect(popup.getByText('No notes yet.')).toBeVisible();
  state.notes = savedNotes;
  send();
  await popup.setViewportSize({ width: 332, height: 350 });
  await expect(list).toBeVisible();
  await list.focus();
  await popup.keyboard.press('Escape');
  await expect.poll(() => messages.some(m => m.action === 'dismiss')).toBe(true);
  state.mode = 'badge'; send();
  state.current = 2;
  state.drafts = [{ pin: 2, t: 456, x: .4, y: .3, text: '' }];
  state.mode = 'editor'; send();
  await expect(field).toBeFocused();
  await field.fill('Draft correction');
  const dismissals = messages.filter(m => m.action === 'dismiss').length;
  await popup.locator('main').click({ position: { x: 10, y: 210 } });
  await expect.poll(() => messages.filter(m => m.action === 'dismiss').length).toBe(dismissals + 1);
  await field.press('Enter');
  state.error = 'Could not save this note. Your text is kept; try again.'; send();
  await expect(popup.getByRole('alert')).toBeVisible(); await expect(field).toHaveValue('Draft correction');
  await assert.rejects(popup.evaluate(() => window.captureNotes.command({ action: 'save', pin: 1, text: 'x', path: '/tmp/no' })));
  // Finish must acknowledge every save already sent by this renderer, in pipe order.
  await popup.evaluate(() => { void window.captureNotes.command({ action: 'save', pin: 2, text: 'Final correction' }); });
  child.stdin.write(JSON.stringify({ finishing: true }) + '\n');
  await expect.poll(() => messages.some(m => m.action === 'finished')).toBe(true);
  const finish = messages.findIndex(m => m.action === 'finished');
  assert.ok(messages.findIndex(m => m.action === 'save' && m.text === 'Final correction') < finish);
  await assert.rejects(popup.evaluate(() => window.captureNotes.command({ action: 'save', pin: 2, text: 'Too late' })));
  const exited = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Notes did not exit after EOF')), 5000);
    child.once('exit', code => { clearTimeout(timer); resolve(code); });
  });
  child.stdin.end();
  assert.equal(await exited, 0);
  assert.equal((await fs.stat(profile)).isDirectory(), true, 'the parent owns profile cleanup after reaping');
  assert.doesNotMatch(errors, /Uncaught Exception|ENOTEMPTY/);
});
}
