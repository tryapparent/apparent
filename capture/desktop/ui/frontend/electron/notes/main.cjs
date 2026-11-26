// Only Rust's private inherited stdin supplies capture state. Technical failures
// may use the same-user reporting socket; it cannot issue capture commands.
const { app, BrowserWindow, ipcMain, screen, session, nativeTheme } = require('electron');
if (process.env.APPARENT_DESKTOP_REPORTING === '1') {
  require('../../dist/assets/reporting.cjs').install(app, kind => require('../runtime.cjs').reportException(require('node:os').homedir(), kind));
}
const path = require('node:path');
const fs = require('node:fs');
const suppliedProfile = process.argv.find(v => v.startsWith('--notes-profile='))?.slice('--notes-profile='.length);
const profile = suppliedProfile || fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'apparent-note-ui-'));
const { pathToFileURL } = require('node:url');
const readline = require('node:readline');
const { validCommand, validSnapshot, popupBounds } = require('./protocol.cjs');
const { initialPresentation, projectSnapshot } = require('./presentation.cjs');
const { createNotesLifecycle } = require('./lifecycle.cjs');
app.setName('Apparent Notes');
nativeTheme.themeSource = 'system';
app.setPath('userData', profile);
// Production Rust deletes its owned profile after reaping this process. Standalone
// renderer tests own their fallback; cleanup errors must never open an error dialog.
app.on('quit', () => {
  if (!suppliedProfile) {
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 }); }
    catch { process.stderr.write('Could not clean standalone notes UI profile\n'); }
  }
});
const frame = process.argv.find(v => v.startsWith('--capture-frame='))?.slice('--capture-frame='.length).split(',').map(Number);
if (!frame || frame.length !== 4 || !frame.every(Number.isFinite)) app.exit(1);
let latest, popup;
let presentation = initialPresentation([frame[0] + frame[2] / 2, frame[1] + 80]);
const lifecycle = createNotesLifecycle();
const send = (value) => process.stdout.write(JSON.stringify(value) + '\n');
app.whenReady().then(() => {
  const { default: dropdown, createNotesPlacement } = require('./dropdown-layout.mjs');
  if (process.platform === 'darwin') app.setActivationPolicy('accessory');
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, reply) => reply(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  const page = pathToFileURL(path.join(__dirname, '../../dist/index.html')).href;
  function createPopup() {
    const win = new BrowserWindow({ title: 'Apparent notes', width: 332, height: 200, show: false, frame: false, transparent: true,
      resizable: false, skipTaskbar: true, alwaysOnTop: true, hasShadow: false,
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true,
        nodeIntegration: false, sandbox: true, spellcheck: false, webSecurity: true, backgroundThrottling: false } });
    win.webContents.on('page-title-updated', event => event.preventDefault());
    win.removeMenu(); win.setAlwaysOnTop(true, 'floating');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', e => e.preventDefault());
    win.webContents.on('will-attach-webview', e => e.preventDefault());
    win.webContents.on('render-process-gone', () => app.quit());
    // XWayland activation can arrive after the first state paint.
    if (process.platform === 'linux') {
      win.on('focus', () => { if (!lifecycle.finishing && latest?.mode !== 'badge' && win.isVisible()) win.webContents.focus(); });
    }
    win.loadURL(page + '#notes-popup');
    return win;
  }
  popup = createPopup();
  const placement = createNotesPlacement(popup, screen, process.platform, send, popupBounds, dropdown.place);
  function validate(event) {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win !== popup || event.senderFrame !== event.sender.mainFrame ||
      event.senderFrame.url !== page + '#notes-popup') throw new Error('Forbidden notes request');
  }
  function publish() {
    if (!latest) return;
    popup.webContents.send('notes:snapshot', latest);
  }
  function finishWhenReady() {
    if (!lifecycle.ready || !lifecycle.finishing || lifecycle.finished) return;
    const notify = () => { if (lifecycle.takeFinishNotification()) popup.webContents.send('notes:finish'); };
    if (popup.webContents.isLoadingMainFrame()) popup.webContents.once('did-finish-load', notify); else notify();
  }
  ipcMain.handle('notes:ready', (event) => { validate(event); publish(); });
  ipcMain.handle('notes:finish-ready', event => { validate(event); if (event.sender === popup.webContents && lifecycle.acknowledgeFinish()) send({ action: 'finished' }); });
  ipcMain.handle('notes:command', (event, value) => {
    validate(event);
    if (lifecycle.finished || !validCommand(value)) throw new Error('Invalid notes command');
    send(value);
  });
  const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  lines.on('line', line => {
    if (Buffer.byteLength(line) > 10_485_760) return app.quit();
    try {
      const state = JSON.parse(line);
      if (state.finishing === true && Object.keys(state).length === 1) {
        lifecycle.requestFinish(); placement.hide();
        finishWhenReady();
        return;
      }
      if (lifecycle.finishing) return;
      if (!Number.isSafeInteger(state.revision) || state.revision <= 0) return app.quit();
      const previous = latest;
      const projected = projectSnapshot(presentation, state);
      if (!validSnapshot(projected)) return app.quit();
      presentation = projected;
      // Only this typed owner chooses presentation. Rust receives an observation
      // for native placement admission/capture telemetry, never another policy.
      send({ action: 'presentation', revision: state.revision, active: projected.mode !== 'badge' });
      Object.assign(state, projected);
      latest = state;
      publish();
      if (state.mode !== 'badge')
        void placement.show(state, previous?.focusRevision !== state.focusRevision).catch(() => app.quit());
      else { placement.hide(); if (previous && previous.mode !== 'badge') send({ action: 'hidden' }); }
    } catch { app.quit(); }
  });
  lines.on('close', () => app.quit());
  popup.webContents.executeJavaScript('document.readyState').then(() => {
    const ids = [popup].map(w => Number(w.getMediaSourceId().split(':')[1])).filter(n => Number.isInteger(n) && n > 0);
    send({ action: 'windows', ids }); send({ action: 'ready' });
    lifecycle.markReady(); finishWhenReady();
  }).catch(() => app.quit());
}).catch(() => app.quit());
app.on('window-all-closed', () => app.quit());
