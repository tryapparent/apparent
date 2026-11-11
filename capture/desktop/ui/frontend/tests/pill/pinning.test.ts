import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const filename = fileURLToPath(new URL('../../electron/pill/main.cts', import.meta.url));
const source = readFileSync(filename, 'utf8');
const require = createRequire(filename);

// Run the whole host and its real protocol/geometry owners. Only Electron and
// process I/O are inert; no compiler, generated bundle or source-shape search.
function host(platform = 'linux') {
  const input = Object.assign(new EventEmitter(), {setEncoding() {}});
  const messages: Record<string, unknown>[] = [];
  const exits: number[] = [];
  const handlers = new Map<string, (...args: any[]) => any>();
  const area = {x: 0, y: 0, width: 1920, height: 1080};
  let revision = 0;
  let window!: Window;
  class Window extends EventEmitter {
    visible = false;
    bounds = {x: 0, y: 0, width: 640, height: 58};
    webContents = Object.assign(new EventEmitter(), {
      mainFrame: {url: ''},
      setWindowOpenHandler() {},
      send(_channel: string, state: {revision: number}) { revision = state.revision; },
      executeJavaScript: async () => ({width: 640, height: 58, revision}),
    });
    constructor(_options: unknown) { super(); window = this; }
    isVisible() { return this.visible; }
    isDestroyed() { return false; }
    getBounds() { return this.bounds; }
    setBounds(bounds: typeof this.bounds) { this.bounds = bounds; }
    showInactive() { this.visible = true; this.emit('show'); }
    hide() { this.visible = false; }
    setAlwaysOnTop() {}
    setVisibleOnAllWorkspaces() {}
    setContentProtection() {}
    setShape() {}
    setTitle() {}
    getMediaSourceId() { return 'window:123:0'; }
    loadURL(url: string) { this.webContents.mainFrame.url = url; return Promise.resolve(); }
  }
  const app = Object.assign(new EventEmitter(), {
    setName() {}, setPath() {}, getPath: () => '/synthetic', setActivationPolicy() {},
    whenReady: () => ({then: (ready: () => void) => ready()}),
    quit() {}, exit: (code: number) => exits.push(code),
  });
  const electron = {
    app, BrowserWindow: Window, nativeTheme: {}, Menu: {setApplicationMenu() {}},
    ipcMain: {handle: (name: string, handler: (...args: any[]) => any) => handlers.set(name, handler)},
    screen: {
      getCursorScreenPoint: () => ({x: 0, y: 0}),
      getDisplayNearestPoint: () => ({workArea: area}),
      getDisplayMatching: () => ({workArea: area, scaleFactor: 1}),
      screenToDipPoint: (point: unknown) => point, dipToScreenPoint: (point: unknown) => point,
    },
    session: {defaultSession: {
      setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, webRequest: {onBeforeRequest() {}},
    }},
  };
  vm.runInNewContext(source, {
    require: (name: string) => name === 'electron' ? electron
      : name === './protocol.cjs' ? require('./protocol.cts')
      : name === './geometry.cjs' ? require('./geometry.cts') : require(name),
    __dirname: path.dirname(filename), Buffer,
    // Timers are registered but never tick: these tests drive native events.
    setInterval() { return 1; }, clearInterval() {},
    process: {platform, env: {}, stdin: input,
      stdout: {write: (line: string) => messages.push(JSON.parse(line))},
      exit: (code: number) => exits.push(code)},
  }, {filename});
  return {
    window, messages, exits,
    parent: (message: unknown) => input.emit('data', JSON.stringify(message) + '\n'),
    loaded: () => window.webContents.emit('did-finish-load'),
    layout: (value: number) => handlers.get('pill:layout')!({sender: window.webContents,
      senderFrame: window.webContents.mainFrame}, value),
  };
}

async function nativeEvents(activated: boolean, visible: boolean, rendererReady = true, phase = 'recording', platform = 'linux') {
  const h = host(platform);
  h.parent({type: 'state', view: {revision: 1, phase, clock: '00:01', label: 'Private capture context',
    warning: null, reducedMotion: false, draggable: true, actions: []}});
  h.loaded();
  if (activated) h.parent({type: 'activate'});
  if (rendererReady) await h.layout(1);
  // Supply the native visibility observation independently of parent activation.
  h.window.visible = visible;
  h.messages.length = 0;
  for (const event of ['show', 'move', 'resize']) h.window.emit(event);
  assert.deepEqual(h.exits, [], 'The real host must accept the fixture lifecycle');
  return h.messages.filter(message => message.pin === true);
}

test('native pin requests wait for activation and visibility', async () => {
  assert.deepEqual(await nativeEvents(false, false), [], 'Hidden startup placement must not spend native pin attempts');
  assert.deepEqual(await nativeEvents(false, true), [], 'Parent activation must precede native admission');
  assert.deepEqual(await nativeEvents(true, false), [], 'Placement between captures must not pin a hidden surface');
  assert.deepEqual(await nativeEvents(true, true, false), [], 'Uncommitted renderer content must not start native admission');
  assert.deepEqual(await nativeEvents(true, true, true, 'hidden'), [], 'Logical dismissal must suppress native admission');
  assert.equal((await nativeEvents(true, true)).length, 3, 'Shown controls must retain show/move/resize pinning');
});

test('native pin diagnostics contain only bounded presentation facts', async () => {
  assert.deepEqual(await nativeEvents(true, true), Array.from({length: 3}, () => ({
    pin: true, phase: 'recording', activated: true, rendererReady: true, visible: true,
  })));
});

test('macOS never requests the Linux native pin adapter', async () => {
  assert.deepEqual(await nativeEvents(true, true, true, 'recording', 'darwin'), []);
});
