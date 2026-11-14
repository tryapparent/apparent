import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {PassThrough} from 'node:stream';
import {test, type TestContext} from 'node:test';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';

const entry = fileURLToPath(new URL('../../electron/notes/main.cjs', import.meta.url));
const ownerRequire = createRequire(entry);
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

// Execute the shipped producer. Only native windows/renderers are inert: their
// document-ready promises can finish after an otherwise valid Finish request.
async function boot(t: TestContext) {
  const input = new PassThrough(); t.after(() => input.destroy());
  const messages: Array<{action: string}> = [], notifications: string[] = [];
  const handlers = new Map<string, (...args: any[]) => unknown>();
  const documents: Array<{resolve: () => void; reject: (error: Error) => void}> = [];
  const windows: Window[] = [];
  let quits = 0, popupLoading = false;
  class Contents extends EventEmitter {
    mainFrame = {url: ''};
    setWindowOpenHandler() {}
    isLoadingMainFrame() { return this === windows[0]?.webContents && popupLoading; }
    executeJavaScript() { return new Promise<void>((resolve, reject) => documents.push({resolve, reject})); }
    send(channel: string) {
      notifications.push(channel);
      // The popup's real finish-ready IPC is immediate when no draft is open.
      if (channel === 'notes:finish') queueMicrotask(() => acknowledge(this));
    }
  }
  class Window extends EventEmitter {
    webContents = new Contents();
    constructor(_options: unknown) { super(); windows.push(this); }
    static fromWebContents(contents: Contents) { return windows.find(window => window.webContents === contents); }
    loadURL(url: string) { this.webContents.mainFrame.url = url; }
    removeMenu() {}
    setAlwaysOnTop() {}
    setVisibleOnAllWorkspaces() {}
    setPosition() {}
    hide() {}
    getMediaSourceId() { return `window:${windows.indexOf(this) + 1}:0`; }
  }
  const acknowledge = (contents = windows[0]!.webContents) =>
    handlers.get('notes:finish-ready')!({sender: contents, senderFrame: contents.mainFrame});
  const app = Object.assign(new EventEmitter(), {
    setName() {}, setPath() {}, setActivationPolicy() {}, whenReady: () => Promise.resolve(),
    quit() { quits++; app.emit('quit'); }, exit() { quits++; },
  });
  const electron = {app, BrowserWindow: Window, nativeTheme: {},
    ipcMain: {handle: (name: string, handler: (...args: any[]) => unknown) => handlers.set(name, handler)},
    screen: {screenToDipPoint: (point: unknown) => point,
      getDisplayNearestPoint: () => ({workArea: {x: 0, y: 0, width: 1280, height: 800}})},
    session: {defaultSession: {setPermissionRequestHandler() {}, setPermissionCheckHandler() {}}},
  };
  runInNewContext(readFileSync(entry, 'utf8'), {
    require: (name: string) => name === 'electron' ? electron : ownerRequire(name),
    __dirname: path.dirname(entry), Buffer, queueMicrotask,
    process: {env: {}, platform: process.platform,
      argv: ['electron', entry, '--capture-frame=0,0,1280,800', '--notes-profile=/unused'],
      stdin: input, stdout: {write: (line: string) => messages.push(JSON.parse(line))}},
  }, {filename: entry});
  await tick(); assert.equal(documents.length, 2);
  return {messages, notifications, documents, acknowledge, quits: () => quits,
    loading: () => { popupLoading = true; },
    loaded: async () => { popupLoading = false; windows[0]!.webContents.emit('did-finish-load'); await tick(); },
    finish: async () => { input.write('{"finishing":true}\n'); await tick(); },
    ready: async () => { documents.forEach(document => document.resolve()); await tick(); },
  };
}

test('Finish during startup cannot acknowledge before both documents announce Ready', async t => {
  const f = await boot(t);
  await f.finish();
  assert.deepEqual([...f.messages], [], 'Finish acknowledged while startup was still pending');
  f.documents[0]!.resolve(); await tick();
  assert.deepEqual([...f.messages], [], 'One loaded document cannot establish notes readiness');
  f.documents[1]!.resolve(); await tick();
  assert.deepEqual(f.messages.map(message => message.action), ['windows', 'ready', 'finished']);
  assert.equal(f.notifications.filter(channel => channel === 'notes:finish').length, 1);
});

test('ordinary Ready then Finish keeps one ordered completion acknowledgement', async t => {
  const f = await boot(t); await f.ready();
  await f.finish(); await f.finish();
  assert.deepEqual(f.messages.map(message => message.action), ['windows', 'ready', 'finished']);
  assert.equal(f.notifications.filter(channel => channel === 'notes:finish').length, 1);
});

test('an unsolicited popup acknowledgement cannot precede the actual finish notification', async t => {
  const f = await boot(t); await f.finish();
  f.acknowledge();
  assert.deepEqual([...f.messages], []);
  await f.ready();
  assert.deepEqual(f.messages.map(message => message.action), ['windows', 'ready', 'finished']);
});

test('failed startup never fabricates a successful finish receipt', async t => {
  const f = await boot(t); await f.finish();
  f.documents[1]!.reject(Error('Synthetic renderer startup failure')); await tick();
  assert.ok(f.quits() > 0);
  assert.deepEqual([...f.messages], []);
});

test('a still-loading popup cannot acknowledge before its deferred notification is delivered', async t => {
  const f = await boot(t); await f.ready(); f.loading();
  await f.finish(); f.acknowledge();
  assert.deepEqual(f.messages.map(message => message.action), ['windows', 'ready']);
  assert.equal(f.notifications.filter(channel => channel === 'notes:finish').length, 0);
  await f.loaded();
  assert.deepEqual(f.messages.map(message => message.action), ['windows', 'ready', 'finished']);
  assert.equal(f.notifications.filter(channel => channel === 'notes:finish').length, 1);
});
