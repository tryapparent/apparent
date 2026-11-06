import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { _electron as electron, expect } from '@playwright/test';
import { buildShell, root } from '../../scripts/build.ts';
import { buildRecordArtifact } from '../../scripts/build-record.ts';
import { assemble, verifyAssembly } from '../../scripts/assemble.ts';
import { packageApplication } from '../../scripts/package.ts';
const { stopElectron } = createRequire(import.meta.url)('../../../../enablement/native/owned-processes.ts') as {
  stopElectron(application: Awaited<ReturnType<typeof electron.launch>> | undefined): Promise<void>;
};

for (const presentation of [undefined, 'pill'] as const) test(`packaged public Record pill uses its injected bridge and assets (${presentation ?? 'foundation'} presentation)`, { timeout: 180_000 }, async t => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'record-pill-electron-')));
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined;
  let sandbox: { path: string; bytes: Buffer; mode: number } | undefined;
  t.after(async () => {
    try { await stopElectron(application); }
    finally {
      if (sandbox) { await rm(sandbox.path); await writeFile(sandbox.path, sandbox.bytes, { mode: sandbox.mode }); await chmod(sandbox.path, sandbox.mode); }
      await rm(directory, { recursive: true, force: true });
    }
  });
  const binding = join(directory, 'binding.ts');
  await writeFile(binding, `
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createRecordFixture } from '@apparent/record/fixtures';
export async function createRecordHostServices({profilePath}) {
  const fixture = createRecordFixture('unsubscribe-during-recording');
  let detachCalls = 0;
  return { record: {
    observe: fixture.client.observe.bind(fixture.client),
    async execute(command) {
      const result = await fixture.client.execute(command);
      if (result.status === 'accepted' && command.type === 'stop-capture') {
        const current = fixture.driver.current();
        fixture.driver.publish({...current, revision: current.revision + 1,
          captures: current.captures.map(capture => ({...capture, phase: 'cancelled'}))});
      }
      await writeFile(join(profilePath, 'commands.json'), JSON.stringify(fixture.driver.commands()));
      return {...result, snapshot: fixture.driver.current()};
    },
    detach() { detachCalls++; fixture.client.detach(); },
  }, async canClose() { return !fixture.driver.captureContinues(); },
  async close() { await writeFile(join(profilePath, 'closed.json'), JSON.stringify({detachCalls})); } };
}
`);
  const shell = join(directory, 'shell');
  await buildShell(shell, undefined, { module: binding, presentation });
  const stream = join(directory, 'record'); await buildRecordArtifact(stream);
  const assembled = await assemble(shell, [stream], join(directory, 'app'));
  const bundle = await packageApplication(assembled, join(directory, 'packages'));
  const helper = process.env.APPARENT_FOUNDATION_SANDBOX_HELPER;
  if (process.platform === 'linux' && helper) {
    const metadata = await stat(helper);
    assert(metadata.isFile() && metadata.uid === 0 && (metadata.mode & 0o4000) && !(metadata.mode & 0o022));
    const path = join(bundle, 'chrome-sandbox');
    sandbox = { path, bytes: await readFile(path), mode: (await stat(path)).mode & 0o777 };
    await rm(path); await symlink(helper, path);
  }
  const payload = process.platform === 'darwin' ? join(bundle, 'Contents/Resources/app') : join(bundle, 'resources/app');
  await verifyAssembly(payload);
  const executablePath = process.platform === 'darwin' ? join(bundle, 'Contents/MacOS/apparent-foundation') : join(bundle, 'apparent-foundation');
  const profile = join(directory, 'profile'); await mkdir(profile, { mode: 0o700 });
  application = await electron.launch({ executablePath, args: [], env: { ...process.env, APPARENT_FOUNDATION_PROFILE: profile } });
  const page = application.windows()[0] ?? await application.waitForEvent('window');
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const controls = page.getByRole('group', { name: 'Recording controls' });
  try { await expect(controls.getByRole('button', { name: 'Finish', exact: true })).toBeVisible(); }
  catch (error) {
    t.diagnostic(await page.content()); t.diagnostic(errors.join('\n'));
    throw error;
  }
  assert.equal(await page.locator('main.pill').getAttribute('data-phase'), 'recording');
  assert.deepEqual(await page.locator('.pill-row').evaluate(async row => {
    const fonts = await document.fonts.load('18px "Host Grotesk"', 'Recording');
    return { minimumHeight: getComputedStyle(row).minHeight, loaded: fonts.length > 0 && fonts.every(font => font.status === 'loaded') };
  }), { minimumHeight: '56px', loaded: true });
  assert.deepEqual(await page.evaluate(() => ({require: typeof (window as any).require, process: typeof (window as any).process})),
    {require: 'undefined', process: 'undefined'});
  if (presentation === 'pill') {
    await expect(page.getByRole('heading', { name: 'Apparent Foundation' })).toHaveCount(0);
    await application.evaluate(({ BrowserWindow }) => new Promise<void>((resolve, reject) => {
      const window = BrowserWindow.getAllWindows()[0];
      if (window.isVisible()) { resolve(); return; }
      const shown = () => { clearTimeout(timer); resolve(); };
      const timer = setTimeout(() => { window.removeListener('show', shown); reject(new Error('Native pill never became visible')); }, 5000);
      window.once('show', shown);
    }));
    const native = await application.evaluate(({ BrowserWindow, screen }) => {
      const window = BrowserWindow.getAllWindows()[0]; const bounds = window.getBounds();
      return { bounds, area: screen.getDisplayMatching(bounds).workArea, visible: window.isVisible(), top: window.isAlwaysOnTop(), focusable: window.isFocusable() };
    });
    t.diagnostic('Native presentation observations: ' + JSON.stringify(native));
    assert.equal(native.visible, true); assert.equal(native.top, true);
    if (process.platform === 'linux') assert.equal(native.focusable, false);
    assert(native.bounds.width <= 1200 && native.bounds.height <= 360);
    assert(native.bounds.x >= native.area.x && native.bounds.y >= native.area.y
      && native.bounds.x + native.bounds.width <= native.area.x + native.area.width
      && native.bounds.y + native.bounds.height <= native.area.y + native.area.height);
  }
  if (process.env.APPARENT_RECORD_PILL_SCREENSHOT) await page.screenshot({ path: process.env.APPARENT_RECORD_PILL_SCREENSHOT + (presentation ? '.native.png' : '') });
  // Changing shell surfaces unmounts and reconnects presentation only, not capture.
  if (!presentation) {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Record', exact: true }).click();
    await expect(controls.getByRole('button', { name: 'Finish', exact: true })).toBeVisible();
  }
  await controls.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(page.locator('main.pill')).toHaveAttribute('data-phase', 'selecting');
  const commands = JSON.parse(await readFile(join(profile, 'commands.json'), 'utf8'));
  assert.equal(commands.length, 1); assert.equal(commands[0].type, 'stop-capture'); assert.equal(commands[0].captureId, 'capture-active');
  assert.match(commands[0].requestId, /^[a-f0-9-]{36}$/);
  assert.deepEqual(errors, []);
  const exited = application.waitForEvent('close', { timeout: 5000 });
  await application.evaluate(({ BrowserWindow }) => {
    const events: string[] = []; (globalThis as any).__pillCloseEvents = events;
    const window = BrowserWindow.getAllWindows()[0];
    window.on('close', event => events.push('close:' + event.defaultPrevented));
    window.on('closed', () => events.push('closed'));
  });
  await application.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].close(); });
  try { await exited; }
  catch (error) {
    t.diagnostic(JSON.stringify(await application.evaluate(({ BrowserWindow }) => ({events: (globalThis as any).__pillCloseEvents,
      windows: BrowserWindow.getAllWindows().map(window => ({visible: window.isVisible(), destroyed: window.isDestroyed()}))}))));
    t.diagnostic(await readFile(join(profile, 'closed.json'), 'utf8').catch(error => String(error)));
    throw error;
  }
  application = undefined;
  assert.deepEqual(JSON.parse(await readFile(join(profile, 'closed.json'), 'utf8')), {detachCalls: 0});
});
