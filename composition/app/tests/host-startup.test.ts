import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild';

const compiled = await build({ entryPoints: [fileURLToPath(new URL('../src/main.cts', import.meta.url))],
  bundle: true, platform: 'node', format: 'cjs', write: false, external: ['electron'],
  define: { APPARENT_OMARCHY: 'true', APPARENT_TRAY_ICON: '""' } });
const require = createRequire(import.meta.url);

async function startup(t: { after(cleanup: () => Promise<void>): void }, kind: 'missing-binding' | 'partial-binding' | 'window-failure' | 'second-instance') {
  const root = await mkdtemp(join(tmpdir(), 'app-startup-owner-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  if (kind === 'partial-binding') {
    const binding = await build({ stdin: { contents:
      'export async function createRecordHostServices() { throw new Error("synthetic partial ownership"); }', loader: 'ts' },
      format: 'esm', platform: 'node', write: false });
    await writeFile(join(root, 'owner-binding.mjs'), binding.outputFiles[0].text);
  }
  let complete!: (value: 'exit' | 'failure-window') => void;
  const terminal = new Promise<'exit' | 'failure-window'>(resolve => { complete = resolve; });
  const app = Object.assign(new EventEmitter(), { setName() {}, setPath() {}, getPath: () => join(root, 'profile'),
    requestSingleInstanceLock: () => kind !== 'second-instance',
    whenReady: () => Promise.resolve(), quit() { complete('exit'); },
    exit(code: number) { exitCode = code; complete('exit'); } });
  let exitCode: number | undefined;
  let window: Window | undefined;
  let url = '', title = '', dialogs = 0;
  class Window extends EventEmitter {
    webContents = Object.assign(new EventEmitter(), { setWindowOpenHandler() {} });
    constructor() { super(); if (kind === 'window-failure') throw new Error('synthetic window failure'); window = this; }
    setTitle(value: string) { title = value; }
    show() {}
    isDestroyed() { return false; }
    async loadURL(value: string) { url = value; complete('failure-window'); }
  }
  const electron = { app, BrowserWindow: Window, ipcMain: new EventEmitter(),
    session: { defaultSession: { setPermissionRequestHandler() {}, webRequest: { onBeforeRequest() {} } } },
    dialog: { showErrorBox() { dialogs++; } } };
  new Function('require', '__dirname', 'module', 'exports', 'console', compiled.outputFiles[0].text)(
    (name: string) => name === 'electron' ? electron : require(name), root, { exports: {} }, {}, { error() {} });
  const result = await terminal;
  const quit = { blocked: false, preventDefault() { this.blocked = true; } };
  app.emit('before-quit', quit);
  const close = { blocked: false, preventDefault() { this.blocked = true; } };
  window?.emit('close', close);
  return { result, exitCode, url, title, dialogs, quit, close };
}

test('pre-binding import or window failure exits without inventing native ownership', async t => {
  for (const kind of ['missing-binding', 'window-failure'] as const) {
    const result = await startup(t, kind);
    assert.equal(result.result, 'exit'); assert.equal(result.exitCode, 1);
    assert.equal(result.dialogs, 1); assert.equal(result.quit.blocked, false);
    assert.equal(result.close.blocked, false);
  }
});

test('entered binding failure retains ownership with a read-only failure page and refuses quit', async t => {
  const result = await startup(t, 'partial-binding');
  assert.equal(result.result, 'failure-window'); assert.equal(result.exitCode, undefined);
  assert.match(result.url, /#startup-incomplete$/); assert.match(result.title, /ownership retained/);
  assert.equal(result.quit.blocked, true); assert.equal(result.close.blocked, true);
});

test('a second launch cannot construct another native or SDK owner assembly', async t => {
  const result = await startup(t, 'second-instance');
  assert.equal(result.result, 'exit'); assert.equal(result.exitCode, 0);
  assert.equal(result.url, ''); assert.equal(result.dialogs, 0);
  assert.equal(result.quit.blocked, false);
});
