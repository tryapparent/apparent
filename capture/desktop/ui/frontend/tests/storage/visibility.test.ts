import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const filename = fileURLToPath(new URL('../../electron/main.cjs', import.meta.url));
const source = readFileSync(filename, 'utf8');

// Execute the shipped host with a delayed native first-paint event. This covers
// parent-pipe ordering without pretending to exercise a macOS window server.
function host(mode: string) {
  const lines = new EventEmitter();
  const exits: number[] = [];
  let window: Window;
  class Window extends EventEmitter {
    webContents = Object.assign(new EventEmitter(), { setWindowOpenHandler() {} });
    visible: boolean;
    focuses = 0;
    destroyed = false;
    options: Record<string, unknown>;
    constructor(options: Record<string, unknown>) {
      super();
      window = this;
      this.options = options;
      this.visible = options.show !== false;
    }
    removeMenu() {}
    loadURL() { return Promise.resolve(); }
    isDestroyed() { return this.destroyed; }
    show() { this.visible = true; }
    focus() { this.focuses++; }
  }
  const app = Object.assign(new EventEmitter(), {
    setName() {}, setPath() {}, getPath: () => '/synthetic',
    setActivationPolicy() {}, whenReady: () => ({ then: (fn: () => void) => fn() }),
    quit() {}, exit: (code: number) => exits.push(code),
  });
  const runtime = { installExceptionReporting() {} };
  const followTheme = Object.assign(() => {}, { backgroundColor: () => '#f5f0e8' });
  const modules: Record<string, unknown> = {
    electron: { app, BrowserWindow: Window, nativeTheme: {},
      ipcMain: { handle() {} }, Menu: { setApplicationMenu() {} },
      session: { defaultSession: { setPermissionRequestHandler() {}, setPermissionCheckHandler() {} } } },
    './runtime.cjs': runtime,
    './storage-policy.cjs': {},
    './connect.cjs': { ConnectSettings: class { close() {} }, actions: new Set() },
    './public-share.cjs': { PublicShare: class { close() {} } },
    '@apparent/ui/window-theme': followTheme,
    'node:readline': { createInterface: () => lines },
  };
  vm.runInNewContext(source, {
    require: (name: string) => Object.hasOwn(modules, name) ? modules[name] : require(name),
    __dirname: path.dirname(filename),
    process: { argv: ['electron', '.', mode, '--settings-parent'], platform: 'darwin', stdin: {}, stdout: { write() {} } },
  }, { filename });
  return { window: window!, lines, exits };
}

for (const mode of ['--settings-storage', '--settings-connect']) {
  test(`${mode} waits for first paint even when the parent requests focus early`, () => {
    const { window, lines } = host(mode);
    assert.equal(window.options.width, 720);
    assert.equal(window.options.height, 530);
    assert.equal(window.options.titleBarStyle, 'hiddenInset');
    assert.equal(window.visible, false, 'Do not expose the empty initial document');
    lines.emit('line', JSON.stringify({ type: 'show' }));
    assert.equal(window.visible, false, 'A parent show command must not bypass first paint');
    assert.equal(window.focuses, 0);
    window.emit('ready-to-show');
    assert.equal(window.visible, true);
    assert.equal(window.focuses, 1);
    lines.emit('line', JSON.stringify({ type: 'show' }));
    assert.equal(window.focuses, 2, 'Loaded Settings can still be brought forward');
  });

  test(`${mode} retains load failure and crash fallback signals`, () => {
    const { window, exits } = host(mode);
    window.webContents.emit('did-fail-load');
    window.webContents.emit('render-process-gone');
    assert.deepEqual(exits, [1, 1]);
  });

  for (const close of ['parent', 'eof', 'window', 'destroyed']) {
    test(`${mode} never presents a retired window after ${close}`, () => {
      const { window, lines } = host(mode);
      if (close === 'parent') lines.emit('line', JSON.stringify({ type: 'close' }));
      else if (close === 'eof') lines.emit('close');
      else if (close === 'window') window.emit('close');
      else window.destroyed = true;
      window.emit('ready-to-show');
      lines.emit('line', JSON.stringify({ type: 'show' }));
      assert.equal(window.visible, false);
      assert.equal(window.focuses, 0);
    });
  }
}

test('development foundation keeps its existing window presentation', () => {
  assert.equal(host('--foundation').window.visible, true);
});
