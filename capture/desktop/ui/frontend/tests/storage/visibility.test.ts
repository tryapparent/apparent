import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve unmocked owner modules exactly as the shipped Electron main does.
const require = createRequire(new URL('../../electron/main.cjs', import.meta.url));
const filename = fileURLToPath(new URL('../../electron/main.cjs', import.meta.url));
const source = readFileSync(filename, 'utf8');

// Execute the shipped host with a delayed native first-paint event. This covers
// parent-pipe ordering without pretending to exercise a macOS window server.
function host(mode: string, capture = () => Promise.resolve({ isEmpty: () => false }), platform = 'darwin') {
  const lines = new EventEmitter();
  const exits: number[] = [];
  const written: string[] = [];
  const output = Object.assign(new EventEmitter(), { write: (line: string) => written.push(line) });
  const handlers = new Map<string, (...args: any[]) => void>();
  const timers: { callback: () => void; active: boolean; unref(): void }[] = [];
  let window: Window;
  class Window extends EventEmitter {
    webContents = Object.assign(new EventEmitter(), { setWindowOpenHandler() {}, mainFrame: { url: '' }, capturePage: capture });
    visible: boolean;
    focuses = 0;
    centers = 0;
    destroyed = false;
    options: Record<string, unknown>;
    constructor(options: Record<string, unknown>) {
      super();
      window = this;
      this.options = options;
      this.visible = options.show !== false;
    }
    removeMenu() {}
    loadURL(url: string) { this.webContents.mainFrame.url = url; return Promise.resolve(); }
    isDestroyed() { return this.destroyed; }
    show() { this.visible = true; }
    focus() { this.focuses++; }
    center() { this.centers++; }
  }
  const app = Object.assign(new EventEmitter(), {
    setName() {}, setPath() {}, getPath: () => '/synthetic',
    setActivationPolicy() {}, whenReady: () => ({ then: (fn: () => void) => fn() }),
    quit() {}, exit: (code: number) => exits.push(code),
  });
  const runtime = {};
  const followTheme = Object.assign(() => {}, { backgroundColor: () => '#f5f0e8' });
  const modules: Record<string, unknown> = {
    electron: { app, BrowserWindow: Window, nativeTheme: {},
      ipcMain: { handle: (name: string, fn: (...args: any[]) => void) => handlers.set(name, fn) }, Menu: { setApplicationMenu() {} },
      session: { defaultSession: { setPermissionRequestHandler() {}, setPermissionCheckHandler() {} } } },
    './runtime.cjs': runtime,
    './connect.cjs': { ConnectSettings: class { close() {} }, actions: new Set() },
    './public-share.cjs': { PublicShare: class { close() {} } },
    '@apparent/ui/window-theme': followTheme,
    'node:readline': { createInterface: () => lines },
  };
  vm.runInNewContext(source, {
    require: (name: string) => Object.hasOwn(modules, name) ? modules[name] : require(name),
    __dirname: path.dirname(filename),
    setTimeout: (callback: () => void) => { const timer = { callback, active: true, unref() {} }; timers.push(timer); return timer; },
    clearTimeout: (timer?: typeof timers[number]) => { if (timer) timer.active = false; },
    process: { argv: ['electron', '.', ...mode.split(' '), '--settings-parent'], env: {}, platform, stdin: {}, stdout: output },
  }, { filename });
  const mounted = () => handlers.get('apparent:settings-mounted')!({ sender: window.webContents, senderFrame: window.webContents.mainFrame });
  const expire = () => { for (const timer of timers) if (timer.active) { timer.active = false; timer.callback(); } };
  const frameReady = () => handlers.get('apparent:settings-frame-ready')!({ sender: window.webContents, senderFrame: window.webContents.mainFrame });
  return { window: window!, lines, exits, written, mounted, frameReady, expire, handlers, output };
}

test('every Linux Settings pane opens in a fixed-size managed dialog', () => {
  for (const pane of ['general', 'recording', 'storage', 'permissions', 'agents', 'labs', 'about']) {
    const { window } = host(`--settings-storage --settings-${pane}`, undefined, 'linux');
    assert.equal(window.options.type, 'dialog');
    assert.equal(window.options.width, 740);
    assert.equal(window.options.height, 580);
    assert.equal(window.options.useContentSize, true);
    assert.equal(window.options.resizable, false);
    assert.equal(window.options.fullscreenable, false);
    assert.equal(window.options.alwaysOnTop, undefined, 'Settings stays an ordinary managed dialog');
  }
});

test('an earlier paint plus committed DOM cannot reveal an uncomposited Settings surface', async () => {
  let release!: (image: { isEmpty(): boolean }) => void;
  const snapshot = new Promise<{ isEmpty(): boolean }>(resolve => { release = resolve; });
  const { window, mounted, lines } = host('--settings-storage', () => snapshot);
  window.emit('ready-to-show');
  const acknowledgement = mounted();
  lines.emit('line', JSON.stringify({ type: 'show' }));
  assert.equal(window.visible, false, 'The native paint event may precede React content reaching the compositor');
  release({ isEmpty: () => false });
  assert.equal(await acknowledgement, true, 'Successful reveal acknowledges that the fallback is unnecessary');
  assert.equal(window.visible, true);
});

test('a composited frame arriving after parent retirement cannot revive Settings', async () => {
  let release!: (image: { isEmpty(): boolean }) => void;
  const snapshot = new Promise<{ isEmpty(): boolean }>(resolve => { release = resolve; });
  const { window, mounted, lines } = host('--settings-storage', () => snapshot);
  window.emit('ready-to-show');
  const acknowledgement = mounted();
  lines.emit('close');
  release({ isEmpty: () => false });
  await acknowledgement;
  assert.equal(window.visible, false);
  assert.equal(window.focuses, 0);
});

test('the fallback retries if native paint started a snapshot that then fails', async () => {
  let empty!: (image: { isEmpty(): boolean }) => void;
  const first = new Promise<{ isEmpty(): boolean }>(resolve => { empty = resolve; });
  let snapshots = 0;
  const { window, mounted, frameReady } = host('--settings-storage', () =>
    ++snapshots === 1 ? first : Promise.resolve({ isEmpty: () => false }),
  );
  assert.equal(await mounted(), false);
  window.emit('ready-to-show');
  const fallback = frameReady();
  empty({ isEmpty: () => true });
  await fallback;
  assert.equal(snapshots, 2);
  assert.equal(window.visible, true);
});

test('empty and failed snapshots stay hidden until the native failure event or startup deadline', async () => {
  for (const capture of [() => Promise.resolve({ isEmpty: () => true }), () => Promise.reject(new Error('unavailable'))]) {
    const { window, mounted, exits, written, expire } = host('--settings-storage', capture);
    window.emit('ready-to-show');
    await mounted();
    assert.equal(window.visible, false);
    assert.deepEqual(exits, [], 'Snapshot rejection can precede the renderer crash event and its reporting admission');
    expire();
    assert.deepEqual(exits, [1]);
    assert.deepEqual(written, []);
  }
});

test('a snapshot rejection preceding renderer death cannot exit before crash admission', async () => {
  const { window, mounted, exits, written } = host('--settings-storage', () => Promise.reject(new Error('renderer gone')));
  window.emit('ready-to-show');
  await mounted();
  assert.deepEqual(exits, []);
  // The reporter attaches on web-contents-created, before the Settings listener.
  // This observation models the gap before that real native event is delivered.
  window.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
  assert.deepEqual(exits, [1]);
  assert.equal(window.visible, false);
  assert.deepEqual(written, []);
});

test('parent retirement and broken stdout never report user dismissal or reopen Settings', async () => {
  for (const cause of ['close', 'eof', 'broken-pipe']) {
    const {window, lines, output, written, mounted, frameReady} = host('--settings-storage');
    if (cause === 'close') lines.emit('line', JSON.stringify({type:'close'}));
    else if (cause === 'eof') lines.emit('close');
    else output.emit('error', Object.assign(new Error('Synthetic broken pipe'), {code:'EPIPE'}));
    window.emit('close');
    await mounted(); frameReady();
    assert.deepEqual(written, [], cause);
    assert.equal(window.visible, false, cause);
  }
});

test('an actual window dismissal still notifies the parent once', async () => {
  const {window, written, mounted} = host('--settings-storage');
  window.emit('close');
  window.emit('close');
  await mounted();
  assert.deepEqual(written, ['{"action":"close"}\n']);
  assert.equal(window.visible, false);
});

for (const mode of ['--settings-storage']) {
  test(`${mode} waits for first paint even when the parent requests focus early`, async () => {
    const { window, lines, mounted, expire, exits } = host(mode);
    assert.equal(window.options.width, 740);
    assert.equal(window.options.height, 580);
    assert.equal(window.options.useContentSize, true);
    assert.equal(window.options.titleBarStyle, 'hiddenInset');
    assert.equal(window.options.resizable, false);
    assert.equal(window.options.maximizable, false);
    assert.equal(window.options.fullscreenable, false);
    assert.equal(window.options.acceptFirstMouse, true, 'Inactive pane clicks match the native helper');
    assert.equal(window.options.paintWhenInitiallyHidden, true, 'Hidden Settings must render to receive a first-frame confirmation');
    assert.equal(window.centers, 1, 'Center the final AppKit frame before presenting it');
    assert.equal(window.visible, false, 'Do not expose the empty initial document');
    lines.emit('line', JSON.stringify({ type: 'show' }));
    assert.equal(window.visible, false, 'A parent show command must not bypass first paint');
    assert.equal(window.focuses, 0);
    window.emit('ready-to-show');
    assert.equal(window.visible, false, 'Chromium may paint a document whose React entry module is missing');
    await mounted();
    assert.equal(window.visible, true);
    assert.equal(window.focuses, 1);
    lines.emit('line', JSON.stringify({ type: 'show' }));
    assert.equal(window.focuses, 2, 'Loaded Settings can still be brought forward');
    expire();
    assert.deepEqual(exits, [], 'A mounted surface cancels the startup deadline');
  });

  test(`${mode} waits for paint when React commits first`, async () => {
    const { window, mounted } = host(mode);
    await mounted();
    assert.equal(window.visible, false);
    window.emit('ready-to-show');
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(window.visible, true);
  });

  test(`${mode} recovers when Electron omits ready-to-show only after a renderer frame`, async () => {
    const { window, mounted, frameReady } = host(mode);
    await mounted();
    assert.equal(window.visible, false, 'React mount alone must not present Settings');
    await frameReady();
    assert.equal(window.visible, true, 'The post-commit frame acknowledgement recovers the missing native event');
    assert.equal(window.focuses, 1);
    window.emit('ready-to-show');
    await frameReady();
    assert.equal(window.focuses, 1, 'Late startup signals do not take focus again');
  });

  test(`${mode} frame acknowledgement alone cannot present Settings`, async () => {
    const { window, mounted, frameReady } = host(mode);
    frameReady();
    assert.equal(window.visible, false, 'A first frame without the Settings mount is insufficient');
    await mounted();
    assert.equal(window.visible, true);
  });

  test(`${mode} missing React mount exits for fallback without a user-close signal`, async () => {
    const { window, mounted, expire, exits, written } = host(mode);
    window.emit('ready-to-show');
    expire();
    assert.deepEqual(exits, [1]);
    await mounted();
    window.emit('close');
    assert.equal(window.visible, false);
    assert.deepEqual(written, []);
  });

  test(`${mode} retains load failure and crash fallback signals`, async () => {
    const { window, exits, written, mounted, frameReady } = host(mode);
    window.webContents.emit('did-fail-load');
    window.webContents.emit('render-process-gone');
    assert.deepEqual(exits, [1, 1]);
    await mounted();
    frameReady();
    window.emit('close');
    assert.equal(window.visible, false);
    assert.deepEqual(written, [], 'Fatal failure must not masquerade as user dismissal');
  });

  for (const close of ['parent', 'eof', 'window', 'destroyed']) {
    test(`${mode} never presents a retired window after ${close}`, async () => {
      const { window, lines, mounted, frameReady, expire, exits } = host(mode);
      if (close === 'parent') lines.emit('line', JSON.stringify({ type: 'close' }));
      else if (close === 'eof') lines.emit('close');
      else if (close === 'window') window.emit('close');
      else window.destroyed = true;
      window.emit('ready-to-show');
      if (close === 'destroyed') assert.throws(mounted, /Forbidden bridge/);
      else { await mounted(); frameReady(); }
      lines.emit('line', JSON.stringify({ type: 'show' }));
      assert.equal(window.visible, false);
      assert.equal(window.focuses, 0);
      if (close !== 'destroyed') {
        expire();
        assert.deepEqual(exits, [], 'Retirement cancels the startup deadline');
      }
    });
  }
}

test('development foundation keeps its existing window presentation', async () => {
  const { window, mounted, frameReady } = host('--foundation');
  assert.equal(window.visible, true);
  assert.equal(window.centers, 0);
  assert.throws(mounted, /Unavailable outside Settings/);
  assert.throws(frameReady, /Unavailable outside Settings/);
});

test('readiness refuses another frame and unexpected arguments', async () => {
  const { window, handlers } = host('--settings-storage');
  const ready = handlers.get('apparent:settings-mounted');
  assert.throws(() => ready!({ sender: window.webContents, senderFrame: { url: window.webContents.mainFrame.url } }), /Forbidden bridge/);
  assert.throws(() => ready!({ sender: window.webContents, senderFrame: window.webContents.mainFrame }, true), /Forbidden bridge/);
  assert.throws(() => ready!({ sender: {}, senderFrame: window.webContents.mainFrame }), /Forbidden bridge/);
  window.webContents.mainFrame.url = 'file:///foreign.html';
  assert.throws(() => ready!({ sender: window.webContents, senderFrame: window.webContents.mainFrame }), /Forbidden bridge/);
});

test('first-frame acknowledgement refuses another frame and unexpected arguments', async () => {
  const { window, handlers } = host('--settings-storage');
  const ready = handlers.get('apparent:settings-frame-ready');
  assert.throws(() => ready!({ sender: window.webContents, senderFrame: { url: window.webContents.mainFrame.url } }), /Forbidden bridge/);
  assert.throws(() => ready!({ sender: window.webContents, senderFrame: window.webContents.mainFrame }, true), /Forbidden bridge/);
  assert.throws(() => ready!({ sender: {}, senderFrame: window.webContents.mainFrame }), /Forbidden bridge/);
  window.webContents.mainFrame.url = 'file:///foreign.html';
  assert.throws(() => ready!({ sender: window.webContents, senderFrame: window.webContents.mainFrame }), /Forbidden bridge/);
});

test('Settings preload overlaps the fallback frames with mount acknowledgement', async () => {
  const preload = path.join(path.dirname(filename), 'storage-preload.cjs');
  const callbacks: (() => void)[] = [];
  const invoked: string[] = [];
  let mounted!: () => Promise<void>;
  let acknowledge!: (presented: boolean) => void;
  const mount = new Promise<boolean>(resolve => { acknowledge = resolve; });
  vm.runInNewContext(readFileSync(preload, 'utf8'), {
    process: { platform: 'linux' },
    require: () => ({
      contextBridge: { exposeInMainWorld(name: string, value: () => Promise<void>) {
        if (name === 'apparentSettingsMounted') mounted = value;
      } },
      ipcRenderer: { invoke(channel: string) { invoked.push(channel); return mount; } },
    }),
    requestAnimationFrame: (callback: () => void) => { callbacks.push(callback); },
  }, { filename: preload });
  const opening = mounted();
  assert.equal(callbacks.length, 1, 'The first callback is queued before mount IPC replies');
  callbacks.shift()!();
  callbacks.shift()!();
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.deepEqual(invoked, ['apparent:settings-mounted'], 'The fallback cannot race the mount reply');
  acknowledge(false);
  await opening;
  assert.deepEqual(invoked, ['apparent:settings-mounted', 'apparent:settings-frame-ready']);
});
