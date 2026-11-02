const { app, BrowserWindow, dialog, ipcMain, session } = require('electron');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { readRuntimeSnapshot, controlCapture, captureLocation } = require('./runtime.cjs');
const { storagePreference } = require('./runtime.cjs');

// Deliberately separate from the installed application's profile and identity.
app.setName('Apparent UI Foundation');
app.setPath('userData', path.join(app.getPath('appData'), 'apparent-ui-foundation'));

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, reply) => reply(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  const window = new BrowserWindow({
    width: 920, height: 760, minWidth: 640, minHeight: 620,
    title: 'Apparent — UI foundation', backgroundColor: '#faf9f6',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      webSecurity: true, spellcheck: false,
    },
  });
  window.removeMenu();
  const page = pathToFileURL(path.join(__dirname, '../dist/index.html')).href;
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  let pending;
  let lastRead = 0;
  let lastResult = { status: 'disconnected' };
  let observedPhase;
  let observedCaptureId = null;
  let captureMutation = false;
  const validate = (event, args) => {
    if (window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame ||
        event.senderFrame.url !== page || args.length !== 0) throw new Error('Forbidden bridge request');
  };
  let generation = 0;
  let mutation = false;
  let storageVersion = 0;
  let retentionRevision;
  let retentionRead;
  const invalidate = () => { generation += 1; storageVersion += 1; retentionRevision = undefined; };
  window.webContents.on('did-start-navigation', (_event, _url, _inPlace, isMainFrame) => { if (isMainFrame) invalidate(); });
  window.webContents.on('will-navigate', invalidate);
  window.webContents.on('render-process-gone', invalidate);
  window.on('closed', invalidate);
  const project = (result) => {
    if (result.status !== 'connected') return result;
    const { revision: _revision, ...storage } = result.storage;
    return { status: 'connected', storage };
  };
  ipcMain.handle('apparent:read-capture-location', async (event, ...args) => {
    validate(event, args);
    const version = storageVersion;
    const result = await captureLocation(os.homedir());
    return version === storageVersion ? project(result) : { status: 'cancelled' };
  });
  for (const operation of ['change', 'reset']) {
    ipcMain.handle(`apparent:${operation}-capture-location`, async (event, ...args) => {
      validate(event, args);
      if (mutation) return { status: 'error', code: 'app_busy' };
      mutation = true;
      storageVersion += 1;
      const token = generation;
      try {
        const before = await captureLocation(os.homedir());
        if (token !== generation) return { status: 'cancelled' };
        if (before.status !== 'connected') return project(before);
        const fields = { expected: before.storage.revision };
        if (operation === 'change') {
          const selected = await dialog.showOpenDialog(window, {
            title: 'Choose capture location', buttonLabel: 'Choose',
            properties: ['openDirectory', 'createDirectory'],
            ...(path.isAbsolute(before.storage.effectivePath) ? { defaultPath: path.dirname(before.storage.effectivePath) } : {}),
            message: 'New captures use this location. Existing captures stay where they are.',
          });
          if (token !== generation || window.isDestroyed() || selected.canceled) return { status: 'cancelled' };
          if (selected.filePaths.length !== 1) return { status: 'error', code: 'invalid_path' };
          fields.path = selected.filePaths[0];
        }
        if (token !== generation) return { status: 'cancelled' };
        return project(await captureLocation(os.homedir(), operation === 'change' ? 'set' : 'reset', fields));
      } catch {
        return { status: 'error', code: 'bridge_failed' };
      } finally {
        storageVersion += 1;
        mutation = false;
      }
    });
  }
  const projectRetention = (result) => {
    if (result.status !== 'connected') return result;
    retentionRevision = result.revision;
    const { revision: _revision, ...safe } = result;
    return safe;
  };
  ipcMain.handle('apparent:read-retention', async (event, ...args) => {
    validate(event, args);
    const version = storageVersion;
    if (!retentionRead || retentionRead.version !== version) {
      const pending = { version, promise: storagePreference(os.homedir(), 'retention') };
      retentionRead = pending;
      void pending.promise.finally(() => { if (retentionRead === pending) retentionRead = undefined; });
    }
    const result = await retentionRead.promise;
    if (version !== storageVersion) return { status: 'cancelled' };
    retentionRevision = undefined;
    return projectRetention(result);
  });
  ipcMain.handle('apparent:read-capture-usage', async (event, ...args) => {
    validate(event, args);
    const version = storageVersion;
    const result = await storagePreference(os.homedir(), 'usage');
    return version === storageVersion ? result : { status: 'cancelled' };
  });
  for (const operation of ['save', 'reset']) {
    ipcMain.handle(`apparent:${operation}-retention`, async (event, ...args) => {
      const preset = operation === 'save' ? args[0] : undefined;
      validate(event, operation === 'save' && args.length === 1 && ['week', 'month', 'forever'].includes(preset) ? [] : args);
      if (operation === 'save' && args.length !== 1) throw new Error('Invalid preset');
      if (mutation) return { status: 'error', code: 'app_busy' };
      if (!retentionRevision) return { status: 'error', code: 'refresh_required' };
      const expected = retentionRevision;
      retentionRevision = undefined;
      mutation = true;
      storageVersion += 1;
      const token = generation;
      try {
        const result = await storagePreference(os.homedir(), `${operation}retention`, { expected, preset });
        return token === generation ? projectRetention(result) : { status: 'cancelled' };
      } finally { storageVersion += 1; mutation = false; }
    });
  }
  ipcMain.handle('apparent:read-runtime-state', (event, ...args) => {
    validate(event, args);
    // One bounded request, only on load or manual refresh; no recording-time polling.
    if (pending) return pending;
    if (Date.now() - lastRead < 1000) return lastResult;
    pending = readRuntimeSnapshot(os.homedir()).then((snapshot) => {
      observedPhase = snapshot.status === 'connected' ? snapshot.phase : undefined;
      observedCaptureId = snapshot.status === 'connected' ? snapshot.captureId : null;
      lastResult = snapshot.status === 'connected' ? { status: 'connected', phase: snapshot.phase } : snapshot;
      lastRead = Date.now();
      return lastResult;
    }).finally(() => { pending = undefined; });
    return pending;
  });
  for (const action of ['start', 'finish', 'cancel']) {
    ipcMain.handle(`apparent:${action}-capture`, async (event, ...args) => {
      validate(event, args);
      if (captureMutation) return { status: 'error', code: 'app_busy' };
      captureMutation = true;
      const token = generation;
      try {
        const before = await readRuntimeSnapshot(os.homedir());
        if (token !== generation) return { status: 'cancelled' };
        if (before.status !== 'connected') {
          observedPhase = undefined;
          observedCaptureId = null;
          lastRead = 0;
          return { status: 'error', code: before.status === 'disconnected' ? 'disconnected' : 'bridge_failed' };
        }
        if (before.phase !== observedPhase || before.captureId !== observedCaptureId) {
          observedPhase = before.phase;
          observedCaptureId = before.captureId;
          lastRead = 0;
          return { status: 'error', code: 'stale_capture' };
        }
        let id;
        let operation;
        if (action === 'start') {
          if (before.phase !== 'idle' || before.captureId !== null) return { status: 'error', code: 'app_busy' };
          id = crypto.randomBytes(16).toString('hex');
          operation = 'start';
        } else {
          if (!before.captureId || (action === 'finish' && before.phase !== 'recording') ||
              (action === 'cancel' && !['starting', 'recording'].includes(before.phase))) {
            return { status: 'error', code: 'stale_capture' };
          }
          id = before.captureId;
          operation = action === 'finish' ? 'stop' : 'cancel';
        }
        const result = await controlCapture(os.homedir(), operation, id);
        if (action === 'start' || before.captureId === id) observedCaptureId = id;
        if (result.status === 'connected') observedPhase = result.phase;
        lastRead = 0;
        return token === generation ? result : { status: 'cancelled' };
      } catch {
        return { status: 'error', code: 'bridge_failed' };
      } finally {
        captureMutation = false;
      }
    });
  }
  void window.loadURL(page);
});
app.on('window-all-closed', () => app.quit());
