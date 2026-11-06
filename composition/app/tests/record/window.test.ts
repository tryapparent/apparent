import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import type { BrowserWindow, Screen } from 'electron';
import { bindRecordPillWindow, recordPillWindowOptions } from '../../src/record/window.ts';

function fixture() {
  const events = new EventEmitter();
  const web = new EventEmitter();
  let bounds = { x: 0, y: 0, width: 640, height: 58 };
  let visible = false;
  let measurement: unknown = { width: 480, height: 58, mainWidth: 408, rowHeight: 58, notes: false };
  let deferred: Promise<unknown> | undefined;
  const calls = { show: 0, shapes: [] as unknown[], errors: [] as unknown[], scripts: [] as string[] };
  const window = Object.assign(events, {
    webContents: Object.assign(web, { getURL: () => 'file:///trusted/index.html', async executeJavaScript(script: string) {
      calls.scripts.push(script); return script.includes('getBoundingClientRect') ? await (deferred ?? Promise.resolve(measurement)) : undefined;
    } }),
    getBounds: () => ({ ...bounds }), setBounds(next: typeof bounds) { bounds = next; },
    isDestroyed: () => false, isVisible: () => visible,
    showInactive() { visible = true; calls.show++; }, setShape(value: unknown) { calls.shapes.push(value); },
    setAlwaysOnTop() {}, setVisibleOnAllWorkspaces() {}, setContentProtection() {}, setIgnoreMouseEvents() {},
  });
  const area = { x: -1920, y: 0, width: 1920, height: 1080 };
  const screen = { getDisplayNearestPoint: () => ({ workArea: area }), getDisplayMatching: () => ({ workArea: area, scaleFactor: 1 }),
    getCursorScreenPoint: () => ({ x: -1000, y: 50 }) };
  const binding = bindRecordPillWindow({ window: window as unknown as BrowserWindow, screen: screen as unknown as Screen,
    entryUrl: 'file:///trusted/index.html', platform: 'linux', onError: error => calls.errors.push(error) });
  return { binding, calls, window, bounds: () => bounds, measure(value: unknown) { measurement = value; }, defer(value: Promise<unknown>) { deferred = value; } };
}

test('native presentation retains donor platform options without changing renderer isolation', () => {
  assert.equal(recordPillWindowOptions('linux').focusable, false);
  assert.equal(recordPillWindowOptions('darwin').type, 'panel');
  for (const platform of ['linux', 'darwin'] as const) {
    const options = recordPillWindowOptions(platform);
    assert.equal(options.show, false); assert.equal(options.frame, false); assert.equal(options.transparent, true);
    assert.equal(options.skipTaskbar, true); assert.equal(options.alwaysOnTop, true);
    assert.equal(options.webPreferences, undefined, 'the caller still owns mandatory sandbox preferences');
  }
  assert.throws(() => recordPillWindowOptions('win32'), /Unsupported/);
});

test('main measures its trusted document, bounds native size and shapes only changed footprints', async t => {
  const f = fixture(); t.after(f.binding.dispose);
  assert.equal(await f.binding.measure(), true);
  assert.equal(f.calls.show, 1); assert.equal(f.calls.shapes.length, 1);
  assert.equal(f.bounds().width, 480);
  assert.equal(f.bounds().y, 34);
  assert(f.calls.shapes[0] instanceof Array);
  assert((f.calls.shapes[0] as Array<{ x: number; width: number }>).every(row => row.x + row.width <= 408), 'zero-note transparent reserve cannot catch clicks');
  await f.binding.measure(); assert.equal(f.calls.shapes.length, 1); assert.equal(f.calls.show, 1);
  f.measure({ width: 100_000, height: 100_000, mainWidth: 100_000, rowHeight: 58, notes: true });
  await f.binding.measure(); assert.equal(f.bounds().width, 1200); assert.equal(f.bounds().height, 360);
  assert(f.bounds().x >= -1920 && f.bounds().x + f.bounds().width <= 0);
});

test('invalid dimensions cannot show a window; disposal revokes pending native changes and timers', async t => {
  const f = fixture(); t.after(f.binding.dispose);
  f.measure({ width: Infinity, height: 58, mainWidth: 400, rowHeight: 58, notes: false });
  assert.equal(await f.binding.measure(), false); assert.equal(f.calls.show, 0);
  let release!: (value: unknown) => void;
  f.defer(new Promise(resolve => { release = resolve; }));
  const pending = f.binding.measure();
  f.binding.dispose();
  release({ width: 400, height: 58, mainWidth: 400, rowHeight: 58, notes: false });
  assert.equal(await pending, false); assert.equal(f.calls.show, 0); assert.equal(f.calls.shapes.length, 0);
  assert.equal(await f.binding.measure(), false);
  assert.equal(f.window.webContents.listenerCount('did-finish-load'), 0);
  assert.equal(f.window.listenerCount('closed'), 0);
});

test('closed-window cleanup never reads the destroyed BrowserWindow webContents getter', t => {
  const f = fixture(); t.after(f.binding.dispose);
  const web = f.window.webContents;
  Object.defineProperty(f.window, 'webContents', { get() { throw new Error('Object has been destroyed'); } });
  assert.doesNotThrow(() => f.window.emit('closed'));
  assert.equal(web.listenerCount('did-finish-load'), 0);
});
