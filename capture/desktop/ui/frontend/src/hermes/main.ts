import { app, BrowserWindow, ipcMain, session } from 'electron';
import { execFile, spawn } from 'node:child_process';
import { mkdir, open } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createCaptureRequest } from '../../../../../../record/capture-request/src/lifecycle.ts';
import { Recording, destination, type Receipt, type View } from './protocol';
import { mailbox } from './mailbox';
import { keyDirectory, publishKey } from './key';
import { captureCanStart } from '../../../../../../hermes/desktop/controller';

const option = (key: string) => process.argv[process.argv.indexOf(key) + 1];
const request = destination(option('--hermes-request'));
const executable = option('--apparent-executable');
const autoStart = process.argv.includes('--hermes-autostart');
if (!path.isAbsolute(executable)) throw new Error('Invalid launch request');
app.setName('Apparent for Hermes');
app.setPath('userData', path.join(app.getPath('appData'), 'apparent-hermes'));
let view: View = { phase: 'confirm' };
let window: BrowserWindow | undefined;
const showWindow = () => {
  if (!window || window.isDestroyed()) return;
  if (process.platform === 'darwin') app.show();
  window.show();
};
const owned = new Recording(request.token, args => new Promise<Receipt>((resolve, reject) => {
  execFile(executable, args, { timeout: 35000, maxBuffer: 65536, encoding: 'utf8' }, (_error, stdout) => {
    try { resolve(JSON.parse(stdout)); } catch { reject(new Error('Apparent is unavailable. Open the installed app and finish onboarding.')); }
  });
}));
const captureState = () => new Promise<{ available: boolean; phase?: string }>(resolve => {
  execFile(executable, ['capture', 'state'], { timeout: 4500, maxBuffer: 65536, encoding: 'utf8' }, (error, stdout) => {
    try { resolve({ available: !error, phase: JSON.parse(stdout)?.state?.phase }); }
    catch { resolve({ available: false }); }
  });
});
const ready = async () => {
  const state = await captureState();
  if (!state.available) throw new Error('Apparent capture runtime is unavailable');
};
app.whenReady().then(async () => {
  const key = randomBytes(16).toString('hex');
  const server = await mailbox(request.token, request.port, key, () => view, () => window ? window.close() : app.quit());
  app.once('before-quit', () => server.close());
  const removeKey = publishKey(keyDirectory(), request.token, key);
  app.once('before-quit', removeKey);
  const deadline = setTimeout(() => { server.close(); if (window && !window.isDestroyed()) window.close(); else app.quit(); }, 60 * 60 * 1000);
  app.once('before-quit', () => clearTimeout(deadline));
  session.defaultSession.setPermissionRequestHandler((_w, _p, reply) => reply(false));
  session.defaultSession.setPermissionCheckHandler(() => false);

  const lifecycle = createCaptureRequest(request.token, {
    async prepare() {
      await mkdir(app.getPath('userData'), { recursive: true, mode: 0o700 });
      const journal = await open(path.join(app.getPath('userData'), `${request.token}.json`), 'wx', 0o600);
      try { await journal.writeFile(JSON.stringify({ created: Date.now() })); } finally { await journal.close(); }
      try { await ready(); }
      catch {
        const child = spawn(executable, ['launch', '--background'], { detached: true, stdio: 'ignore' });
        await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
        child.unref();
        for (let attempt = 0; ; attempt++) {
          try { await ready(); break; }
          catch { if (attempt === 9) throw new Error('Open Apparent and complete onboarding, then try again.'); await new Promise(resolve => setTimeout(resolve, 500)); }
        }
      }
      const state = await captureState();
      if (state.available && !captureCanStart(state.phase)) throw Object.assign(new Error('Finish the current Apparent capture before recording from Hermes.'), { code: 'occupied' });
    },
    beforeStart() {
      window?.hide();
      if (process.platform === 'darwin') app.hide();
    },
    start: () => owned.start(),
    inspect: () => owned.inspect(),
    handoff: () => owned.source().then(source => ({ capture_id: request.token, source })),
    wait: () => new Promise(resolve => setTimeout(resolve, 1000)),
    publish(next) {
      view = { ...next, ...(next.message?.includes('Finish the current Apparent capture') ? { code: 'occupied' as const } : {}) };
      if (!autoStart && ['saved', 'cancelled', 'error'].includes(next.phase)) showWindow();
    },
  });

  const sender = (event: Electron.IpcMainInvokeEvent) => {
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Invalid sender');
  };
  if (!autoStart) {
    window = new BrowserWindow({ width: 500, height: 340, resizable: false, show: false, autoHideMenuBar: true,
      title: 'Record for Hermes', webPreferences: { preload: path.join(__dirname, 'hermes-preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false } });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.on('page-title-updated', event => event.preventDefault());
    window.once('ready-to-show', () => { if (view.code !== 'occupied') showWindow(); });
    ipcMain.handle('apparent:hermes-read', event => { sender(event); return view; });
    ipcMain.handle('apparent:hermes-start', async event => { sender(event); return lifecycle.run(); });
    const state = await captureState();
    if (state.available && !captureCanStart(state.phase)) {
      view = { phase: 'error', code: 'occupied', message: 'Finish the current Apparent capture before recording from Hermes.' };
    }
    await window.loadFile(path.join(__dirname, 'index.html'), { query: { surface: 'hermes' } });
  } else {
    const state = await captureState();
    if (state.available && !captureCanStart(state.phase)) {
      view = { phase: 'error', code: 'occupied', message: 'Finish the current Apparent capture before recording from Hermes.' };
    } else {
      void lifecycle.run();
    }
  }
}).catch(() => app.quit());
app.on('window-all-closed', () => app.quit());
