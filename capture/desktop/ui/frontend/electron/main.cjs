// Presentation only: the owning Rust process admits every command.
function startControls() {
  const {app, BrowserWindow, ipcMain, Menu, session, nativeTheme} = require('electron');
  const path = require('node:path');
  const {pathToFileURL} = require('node:url');
  const readline = require('node:readline');
  const followWindowTheme = require('@apparent/ui/window-theme');
  app.setName('Apparent');
  app.setPath('userData', path.join(app.getPath('appData'), 'apparent-controls'));
  nativeTheme.themeSource = 'system';
  let window;
  let busy = false;
  let status = null;
  let painted = false;
  let mounted = false;
  let retired = false;
  const show = () => {
    if (!retired && painted && mounted) { window.show(); process.stdout.write('{"ready":true}\n'); }
  };
  process.stdin.on('end', () => { retired = true; app.quit(); });
  process.stdout.on('error', () => { retired = true; app.quit(); });
  readline.createInterface({input: process.stdin}).on('line', line => {
    if (line === 'show' && window && !window.isDestroyed()) {
      if (!retired && painted && mounted) { window.restore(); window.show(); window.focus(); }
    } else if (line === 'busy' || line === 'idle') {
      busy = line === 'busy';
      if (window && !window.isDestroyed()) window.webContents.send('apparent:controls-busy', busy);
    } else if (line.startsWith('status ')) {
      try {
        const value = JSON.parse(line.slice(7));
        if (value === null || typeof value === 'string') {
          status = value;
          if (window && !window.isDestroyed()) window.webContents.send('apparent:controls-status', status);
        }
      } catch {}
    }
  });
  app.whenReady().then(() => {
    if (retired) return;
    Menu.setApplicationMenu(null);
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, reply) => reply(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    window = new BrowserWindow({width: 420, height: 500, show: false,
      title: 'Apparent', backgroundColor: followWindowTheme.backgroundColor(nativeTheme),
      webPreferences: {preload: path.join(__dirname, 'preload.cjs'), additionalArguments: ['--controls'],
        contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true}});
    followWindowTheme(nativeTheme, window);
    const page = pathToFileURL(path.join(__dirname, '../dist/src/controls/index.html')).href;
    window.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.on('will-attach-webview', event => event.preventDefault());
    ipcMain.handle('apparent:controls-mounted', (event, ...args) => {
      if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame ||
          event.senderFrame.url !== page || args.length !== 0) throw new Error('Forbidden controls request');
      mounted = true; show(); return {busy, status};
    });
    ipcMain.handle('apparent:controls-command', (event, ...args) => {
      if (window.isDestroyed() || event.sender !== window.webContents ||
          event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== page ||
          args.length !== 1 || !['record', 'latest', 'settings'].includes(args[0])) {
        throw new Error('Forbidden controls request');
      }
      if (!retired && !busy) process.stdout.write(JSON.stringify({action: args[0]}) + '\n');
    });
    window.webContents.on('render-process-gone', () => app.exit(1));
    window.webContents.on('did-fail-load', () => app.exit(1));
    window.once('ready-to-show', () => {
      painted = true; show();
    });
    window.loadURL(page);
  });
  app.on('window-all-closed', () => app.quit());
}

if(process.argv.includes('--controls')) { startControls(); }
else if(process.argv.includes('--onboarding')) { require('./onboarding.cjs'); } else {
const { app, BrowserWindow, dialog, ipcMain, Menu, session, shell, nativeTheme, clipboard } = require('electron');
const os = require('node:os');
let exitWithReports = code => app.exit(code);
if (process.env.APPARENT_DESKTOP_REPORTING === '1') {
  exitWithReports = require('../dist/assets/reporting.cjs').install(app, kind => require('./runtime.cjs').reportException(os.homedir(), kind));
}
const {PublicShare} = require('./public-share.cjs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { readRuntimeState, storageLocation, errorReporting, captureReference, storagePreference, microphoneEnabled, supportCapture } = require('./runtime.cjs');
const { LocationWorkflow } = require('./storage-owner/location-workflow.js');
const { RetentionWorkflow } = require('./storage-owner/retention-workflow.js');
const { storageLimitValid } = require('./storage-owner/retention/size-limit.js');
const { isRetentionPolicy } = require('./storage-owner/policy.js');
const { ConnectSettings, actions, admitConnect } = require('./connect.cjs');
const followWindowTheme = require('@apparent/ui/window-theme');
nativeTheme.themeSource = 'system';
const frame = require('./settings/frame.cjs');
let pane = frame.initialSettingsPane(process.argv);
const settings = !!pane;
const hasSettingsParent = process.argv.includes('--settings-parent');
const settingsHosts = new frame.SettingsHosts(action => process.stdout.write(JSON.stringify(action) + '\n'));
let generalState;
const settingsHash = settings && pane !== 'storage' ? '#' + pane : '';
const {LabsPreferences, facts: labsFacts, admitLabsRequest} = require('./settings/labs.cjs');
const labsPreferences = new LabsPreferences(message => {
  if (pane !== 'labs' || !hasSettingsParent) throw new Error('Labs parent unavailable');
  process.stdout.write(JSON.stringify(message) + '\n');
});
const { AgentsPreferences, PreferenceQueue, skillCommand, preferenceFacts } = require('./settings/agents.cjs');
const {PairingLinks, bindT3Setup} = require('./settings/t3.cjs');
const pairingLinks = new PairingLinks();
let t3Approval;
let pairingPreviewVersion=0;
const agentsPreferences = new AgentsPreferences(message => {
  if (pane !== 'agents' || !hasSettingsParent) throw new Error('Settings parent unavailable');
  process.stdout.write(JSON.stringify(message) + '\n');
});
const preferenceQueue=new PreferenceQueue();
const resetPreferences = () => {
  agentsPreferences.close();
  labsPreferences.close();
  settingsHosts.reset();
};
let aboutState;

// Deliberately separate from the installed application's profile and identity.
app.setName(settings ? 'Apparent Settings' : 'Apparent UI Foundation');
const profile = process.env.APPARENT_PROFILE === 'apparent-nightly' ? 'apparent-nightly' : 'apparent';
app.setPath('userData', path.join(app.getPath('appData'), `${profile}-${settings ? 'settings' : 'ui-foundation'}`));

app.whenReady().then(() => {
  if (settings) {
    Menu.setApplicationMenu(null);
    if (process.platform === 'darwin') app.setActivationPolicy('accessory');
  }
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, reply) => reply(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  const window = new BrowserWindow({
    show: !settings,
    // The preload needs a render opportunity before the first presentation.
    ...(settings ? { paintWhenInitiallyHidden: true } : {}),
    ...(settings ? frame.settingsWindowOptions(process.platform) : {
      width: 920, height: 760, minWidth: 640, minHeight: 620,
    }),
    title: settings ? 'Apparent Settings' : 'Apparent — UI foundation',
    backgroundColor: followWindowTheme.backgroundColor(nativeTheme),
    webPreferences: {
      preload: path.join(__dirname, settings ? 'storage-preload.cjs' : 'preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      webSecurity: true, spellcheck: false,
    },
  });
  // A parent show must not expose Chromium's empty initial document.
  let settingsPainted = false;
  let settingsMounted = false;
  let settingsCommitted = false;
  let settingsFrame;
  let settingsClosing = false;
  let preferenceEpoch=0;
  function preferenceTask(task,signal){const epoch=preferenceEpoch;return preferenceQueue.run(task,()=>!settingsClosing&&epoch===preferenceEpoch,signal);}
  function preferenceRequest(...args){return preferenceTask(()=>agentsPreferences.request(...args));}

  let settingsFailed = false;
  let startupTimer;
  const failSettings = () => {
    settingsFailed = settingsClosing = true;
    clearTimeout(startupTimer);
    exitWithReports(1);
  };
  const showSettings = () => {
    if (!settingsPainted || !settingsCommitted || settingsClosing || window.isDestroyed()) return;
    if (!settingsMounted) {
      settingsFrame ??= frame.committedFrame(window.webContents).then(() => {
        if (settingsClosing || window.isDestroyed()) return;
        settingsMounted = true;
        showSettings();
      }).catch(() => {
        settingsFrame = undefined;
      });
      return settingsFrame;
    }
    clearTimeout(startupTimer);
    window.show();
    window.focus();
  };
  if (settings) {
    // First paint alone can be an empty document with a missing entry module.
    startupTimer = setTimeout(failSettings, 15000);
    startupTimer.unref();
    window.once('ready-to-show', () => {
      settingsPainted = true;
      showSettings();
    });
  }
  // AppKit applies the inset titlebar metrics after constructor-time centering.
  if (settings && process.platform === 'darwin') window.center();
  followWindowTheme(nativeTheme, window);
  window.removeMenu();
  const page = pathToFileURL(path.join(__dirname, settings ? '../dist/settings.html' : '../dist/index.html')).href;
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  let pending;
  let lastRead = 0;
  let lastResult = { status: 'disconnected' };
  const validate = (event, args) => {
    if (window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame ||
        event.senderFrame.url !== page + settingsHash || args.length !== 0) throw new Error('Forbidden bridge request');
  };
  const validateFoundation = (event, args) => {
    if (settings) throw new Error('Unavailable in Storage Settings');
    validate(event, args);
  };
  ipcMain.handle('apparent:settings-mounted', (event, ...args) => {
    validate(event, args);
    if (!settings) throw new Error('Unavailable outside Settings');
    if (settingsClosing || window.isDestroyed()) return;
    settingsCommitted = true;
    return showSettings();
  });
  ipcMain.handle('apparent:settings-route', (event, ...args) => {
    validate(event, args);
    if (!settings) throw new Error('Unavailable outside the shared Settings shell');
    return pane;
  });
  ipcMain.handle('apparent:settings-frame-ready', (event, ...args) => {
    validate(event, args);
    if (!settings) throw new Error('Unavailable outside Settings');
    settingsPainted = true;
    return showSettings();
  });
  ipcMain.handle('apparent:general-read', (event, ...args) => {
    validate(event, args);
    if (pane !== 'general') throw new Error('Unavailable outside General');
    return generalState;
  });
  ipcMain.handle('apparent:general-action', (event, action, ...args) => {
    validate(event, args);
    if (pane !== 'general' || !require('./settings/general.cjs').validAction(action)) throw new Error('Forbidden General action');
    process.stdout.write(JSON.stringify(action) + '\n');
  });
  settingsHosts.bind(window, {
    bind: (owner, name, handle) => ipcMain.handle(`apparent:${owner}-${name}`, (event, ...args) => {
      validate(event, []);
      if (pane !== owner || !hasSettingsParent || settingsClosing) throw Error('Unavailable');
      return handle(...args);
    }),
    platform: process.platform,
    openExternal: url => shell.openExternal(url),
  });
  const feedback = frame.settingsFeedbackHost({
    token: process.env.APPARENT_MANUAL_REPORT_TOKEN,
    build: process.env.APPARENT_MANUAL_REPORT_BUILD,
    environment: process.env.APPARENT_MANUAL_REPORT_ENVIRONMENT,
  });
  ipcMain.handle('apparent:feedback-available', (event, ...args) => {
    validate(event, args);
    return hasSettingsParent && !settingsClosing && feedback.available;
  });
  ipcMain.handle('apparent:feedback-send-written', (event, description, id, ...args) => {
    validate(event, args);
    if (!hasSettingsParent || settingsClosing) throw Error('Bug reporting unavailable');
    return feedback.submit(description, id);
  });
  const reportCapture = frame.settingsReportCapture(
    process.env.APPARENT_REPORT_EXECUTABLE,
    (operation, id) => supportCapture(os.homedir(), operation, id),
    show => { if (!settingsClosing && !window.isDestroyed()) show ? showSettings() : window.hide(); },
    feedback.submitRecording,
  );
  for (const [name, operation] of [
    ['available', reportCapture.available],
    ['start', reportCapture.start],
    ['discard', reportCapture.discard],
    ['send', reportCapture.submit],
  ]) {
    ipcMain.handle(`apparent:feedback-capture-${name}`, (event, ...args) => {
      validate(event, args);
      if (!hasSettingsParent || settingsClosing || !feedback.available) throw Error('Support capture unavailable');
      return operation();
    });
  }
  frame.bindAbout({
    handle: (name, listener) => ipcMain.handle(name, listener),
    validate, current: () => pane === 'about', read: () => aboutState,
    send: action => process.stdout.write(JSON.stringify(action) + '\n'),
    open: url => shell.openExternal(url), copy: text => clipboard.writeText(text),
  });
  ipcMain.handle('apparent:agents-preference', (event, ...args) => {
    validate(event, args);
    if (pane !== 'agents') throw new Error('Forbidden Agents preference');
    return preferenceRequest();
  });
  ipcMain.handle('apparent:labs-preference', (event, ...args) => {
    validate(event, []);
    if (!admitLabsRequest(pane, args, process.platform)) throw new Error('Forbidden Labs preference');
    return labsPreferences.request(...args);
  });
  ipcMain.handle('apparent:agents-t3-preference', (event, ...args) => {
    validate(event, []);
    if (pane !== 'agents' || args.length !== 1 || typeof args[0] !== 'boolean') throw new Error('Forbidden Agents preference');
    return preferenceRequest(args[0]);
  });
  ipcMain.handle('apparent:agents-copy-skill', (event, ...args) => {
    validate(event, args);
    if (pane !== 'agents') throw new Error('Unavailable outside Agents');
    return clipboard.writeText(skillCommand);
  });
  bindT3Setup({
    bind: (name, handle) => ipcMain.handle(name, (event, ...args) => {
      validate(event, args);
      if (pane !== 'agents' || !hasSettingsParent || settingsClosing) throw Error('T3 setup unavailable');
      return handle();
    }),
    copy: text => clipboard.writeText(text), configPath: process.env.APPARENT_CONFIG,
  });
  ipcMain.handle('apparent:agents-t3-preview', async (event, ...args) => {
    validate(event,[]);
    if (pane !== 'agents' || !hasSettingsParent || t3Approval || args.length>1 || args.length===1&&(typeof args[0]!=='string'||args[0].length>2048)) throw Error('T3 connection unavailable');
    const version=++pairingPreviewVersion;pairingLinks.clear();
    try { const link=await clipboard.readText();if(settingsClosing||version!==pairingPreviewVersion)throw Error('Preview cancelled');return {preview:pairingLinks.preview(link,args[0])}; }
    catch { return {error:'Copy a T3 code or full link. For a code, check the server address and use HTTPS or localhost.'}; }
  });
  ipcMain.handle('apparent:agents-t3-connect', async (event, ...args) => {
    validate(event, []);
    if (pane !== 'agents' || !hasSettingsParent || args.length!==1 || typeof args[0]!=='string' || t3Approval) throw new Error('T3 connection unavailable');
    const approval=new AbortController();t3Approval=approval;
    let persisting=false;
    try {
      const connection=await pairingLinks.connect(args[0], approval.signal);
      if(settingsClosing||approval.signal.aborted)throw Error('T3 connection cancelled');
      return {facts:await preferenceTask(()=>{persisting=true;return agentsPreferences.storeConnection(connection);},approval.signal)};
    } catch(error) {
      return {reason:persisting?'unconfirmed':approval.signal.aborted?'cancelled':'unavailable'};
    } finally {if(t3Approval===approval)t3Approval=undefined;}
  });
  ipcMain.handle('apparent:agents-t3-cancel', (event, ...args) => {
    validate(event,args);if(pane !== 'agents')throw Error('T3 connection unavailable');++pairingPreviewVersion;pairingLinks.clear();t3Approval?.abort();
  });
  ipcMain.handle('apparent:agents-t3-disconnect', (event, ...args) => {
    validate(event,[]);if(pane !== 'agents'||args.length!==1||typeof args[0]!=='string'||args[0].length>2048||!hasSettingsParent||t3Approval)throw Error('T3 connection unavailable');
    return preferenceTask(()=>agentsPreferences.storeConnection(null,args[0]));
  });
  ipcMain.handle('apparent:navigate-settings', (event, ...args) => {
    validate(event, []);
    if (!settings || args.length !== 1 || args[0] === pane || !frame.isSettingsDestination(args[0])) throw new Error('Forbidden Settings page');
    process.stdout.write(`${JSON.stringify({ action: 'navigate', pane: args[0] })}\n`);
  });
  ipcMain.handle('apparent:show-capture-folder', (event, ...args) => {
    validate(event, args);
    if (!settings || pane !== 'storage') throw new Error('Unavailable outside Storage Settings');
    process.stdout.write(`${JSON.stringify({ action: 'show-captures' })}\n`);
  });
  if (settings) {
    const closeSettings = () => { settingsClosing = true; ++pairingPreviewVersion; pairingLinks.clear(); t3Approval?.abort(); resetPreferences(); clearTimeout(startupTimer); app.quit(); };
    // A parent can exit before Chromium closes its child. Retire quietly when
    // its output pipe breaks instead of opening Electron's error dialog.
    process.stdout.on('error', error => { if (error.code === 'EPIPE') closeSettings(); else failSettings(); });
    // Only the Rust Settings owner supplies this private pipe. EOF closes its child.
    if (hasSettingsParent) {
    const lines = require('node:readline').createInterface({ input: process.stdin });
    lines.on('line', line => {
      try {
        const command = JSON.parse(line);
        if (command.type === 'general-state' && pane === 'general') {
          generalState = command;
          window.webContents.send('apparent:general-state', command);
        }
        settingsHosts.receive(pane, command);
        if (command.type === 'about-state' && pane === 'about') {
          aboutState = command;
          window.webContents.send('apparent:about-state', command);
        }
        if (pane === 'agents' && command.type === 'agents-result') agentsPreferences.receive(command);
        if (pane === 'labs' && command.type === 'labs-result') labsPreferences.receive(command);
        if (pane === 'labs' && command.type === 'labs-state') window.webContents.send('apparent:labs-state', labsFacts(command.facts));
        if (pane === 'agents' && command.type === 'agents-state') {
          window.webContents.send('apparent:agents-state', preferenceFacts(command.facts));
        }
        if (command.type === 'close') closeSettings();
        if (command.type === 'show') {
          if (frame.isSharedSettingsPane(command.pane)) {
            if (command.pane !== pane) {
              invalidate();++preferenceEpoch;
              generalState = undefined; aboutState = undefined;
              ++pairingPreviewVersion; pairingLinks.clear(); t3Approval?.abort(); resetPreferences();
            }
            pane = command.pane;
            window.webContents.send('apparent:settings-route', pane);
          }
          showSettings();
        }
      } catch { /* malformed parent message has no effect */ }
    });
    lines.on('close', closeSettings);
    }
    window.on('close', () => {
      const userDismissed = !settingsClosing && !settingsFailed;
      settingsClosing = true;
      resetPreferences();
      clearTimeout(startupTimer);
      if (userDismissed) process.stdout.write(`${JSON.stringify({ action: 'close' })}\n`);
    });
    window.webContents.on('did-fail-load', failSettings);
    window.webContents.on('render-process-gone', failSettings);
  }
  let generation = 0;
  let mutation = false;
  let storageVersion = 0;
  const connect = new ConnectSettings(os.homedir());
  let pendingConnect;
  const publicShare = new PublicShare(os.homedir());
  let reference;
  let referencePending;
  const retention = new RetentionWorkflow({
    read: () => storagePreference(os.homedir(), 'retention'),
    write: (operation, fields) => storagePreference(os.homedir(), operation === 'limit' ? 'savelimit' : `${operation}retention`, fields),
    usage: () => storagePreference(os.homedir(), 'usage'),
  });
  const invalidate = () => { generation += 1; storageVersion += 1; reference = undefined; retention.invalidate(); connect.close(); publicShare.close(); };
  window.webContents.on('did-start-navigation', (_event, _url, _inPlace, isMainFrame) => { if (isMainFrame) invalidate(); });
  window.webContents.on('will-navigate', invalidate);
  window.webContents.on('render-process-gone', invalidate);
  window.on('closed', invalidate);
  const requestConnect = (action) => {
    if (pendingConnect) return action === undefined ? pendingConnect : Promise.resolve({ status: 'error' });
    const token = generation;
    const request = connect.request(action).then(async result => {
      if (token !== generation || window.isDestroyed()) return { status: 'cancelled' };
      // Only this explicit zero-argument action may open the URI just authorized
      // by the current Rust controller. Never accept a renderer-supplied URL.
      if (result.openUri) await shell.openExternal(result.openUri);
      delete result.openUri;
      return result;
    }).catch(() => ({ status: 'error' })).finally(() => {
      if (pendingConnect === request) pendingConnect = null;
    });
    pendingConnect = request;
    return request;
  };
  const validateConnectCall = (event, args) => {
    admitConnect(settings, pane); validate(event, args);
  };
  ipcMain.handle('apparent:read-connect-settings', (event, ...args) => {
    validateConnectCall(event, args);
    return requestConnect();
  });
  for (const action of actions) {
    ipcMain.handle(`apparent:connect-${action}`, (event, ...args) => {
      validateConnectCall(event, args);
      return requestConnect(action);
    });
  }
  const location = new LocationWorkflow({
    facts: () => storageLocation(os.homedir(), 'facts'),
    probe: (path, expected) => storageLocation(os.homedir(), 'probe', {path, expected}),
    write: (operation, fields) => storageLocation(os.homedir(), operation, fields),
    choose: effectivePath => dialog.showOpenDialog(window, {
      title: 'Choose capture location', buttonLabel: 'Choose',
      properties: ['openDirectory', 'createDirectory'],
      ...(path.isAbsolute(effectivePath) ? {defaultPath: path.dirname(effectivePath)} : {}),
      message: 'New captures use this location. Existing captures stay where they are.',
    }),
  });
  let reportingMutation = false;
  let microphoneMutation = false;
  ipcMain.handle('apparent:read-microphone-enabled', (event, ...args) => { validateFoundation(event, args); return microphoneEnabled(os.homedir()); });
  ipcMain.handle('apparent:set-microphone-enabled', async (event, enabled, ...args) => {
    validateFoundation(event, args);
    if (typeof enabled !== 'boolean') throw new Error('Forbidden microphone preference');
    if (microphoneMutation) return { status: 'error', code: 'app_busy' };
    microphoneMutation = true;
    try { return await microphoneEnabled(os.homedir(), enabled); }
    finally { microphoneMutation = false; }
  });
  ipcMain.handle('apparent:read-error-reporting', async (event, ...args) => {
    validateFoundation(event, args);
    return errorReporting(os.homedir());
  });
  ipcMain.handle('apparent:set-error-reporting', async (event, enabled, ...args) => {
    validateFoundation(event, args);
    if (args.length || typeof enabled !== 'boolean') throw new Error('Forbidden bridge request');
    if (reportingMutation) return { status: 'error', code: 'app_busy' };
    reportingMutation = true;
    try { return await errorReporting(os.homedir(), enabled); }
    finally { reportingMutation = false; }
  });
  ipcMain.handle('apparent:read-capture-location', async (event, ...args) => {
    validate(event, args);
    if (settings && pane !== 'storage') throw new Error('Unavailable outside Storage Settings');
    const version = storageVersion;
    const result = await location.read();
    return version === storageVersion ? result : { status: 'cancelled' };
  });
  for (const operation of ['change', 'reset']) {
    ipcMain.handle(`apparent:${operation}-capture-location`, async (event, ...args) => {
      validate(event, args);
      if (settings && pane !== 'storage') throw new Error('Unavailable outside Storage Settings');
      if (mutation) return { status: 'error', code: 'app_busy' };
      mutation = true;
      storageVersion += 1;
      const token = generation;
      try {
        return await location.mutate(operation, () => token === generation && !window.isDestroyed());
      } finally {
        storageVersion += 1;
        mutation = false;
      }
    });
  }
  for (const operation of ['read', 'copy']) {
    ipcMain.handle(`apparent:${operation}-capture-reference`, async (event, ...args) => {
      validateFoundation(event, args);
      // Coalesce StrictMode/read refreshes, but never repeat or overlap a copy.
      if (referencePending) return operation === 'read' && referencePending.operation === 'read'
        ? referencePending.promise : { status: 'error', code: 'app_busy' };
      const expected = reference?.status === 'connected' ? reference.id : null;
      if (operation === 'copy' && expected === null) return { status: 'error', code: 'refresh_required' };
      const token = generation;
      reference = undefined;
      const promise = captureReference(os.homedir(), operation, expected).then((result) => {
        if (token !== generation) return { status: 'cancelled' };
        if (result.status === 'connected') reference = result;
        return result;
      }).catch(() => ({ status: 'error', code: 'bridge_failed' })).finally(() => { referencePending = undefined; });
      referencePending = { operation, promise };
      return promise;
    });
  }
  for (const action of ['start','read','cancel']) {
    ipcMain.handle(`apparent:${action}-public-share`, async (event,...args) => {
      validateFoundation(event,args);
      return publicShare.request(action, reference?.status==='connected'?reference.id:null);
    });
  }
  ipcMain.handle('apparent:read-retention', async (event, ...args) => {
    validate(event, args);
    if (settings && pane !== 'storage') throw new Error('Unavailable outside Storage Settings');
    const version = storageVersion;
    return retention.read(version, () => version === storageVersion);
  });
  ipcMain.handle('apparent:read-capture-usage', async (event, ...args) => {
    validate(event, args);
    if (settings && pane !== 'storage') throw new Error('Unavailable outside Storage Settings');
    const version = storageVersion;
    return retention.measure(() => version === storageVersion);
  });
  for (const operation of ['save', 'reset', 'limit']) {
    ipcMain.handle(`apparent:${operation}-retention`, async (event, ...args) => {
      const policy = args[0];
      if (operation !== 'reset' && args.length !== 1) throw new Error('Invalid retention request');
      validate(event, operation === 'reset' ? args : []);
      if (operation === 'limit' && (!settings || !storageLimitValid(policy))) throw new Error('Invalid storage limit');
      if (settings && pane !== 'storage') throw new Error('Unavailable outside Storage Settings');
      if (operation === 'save' && !isRetentionPolicy(policy)) {
        throw new Error('Invalid retention policy');
      }
      if (mutation) return { status: 'error', code: 'app_busy' };
      if (!retention.ready) return { status: 'error', code: 'refresh_required' };
      mutation = true;
      storageVersion += 1;
      const token = generation;
      try {
        return await retention.mutate(operation, policy, () => token === generation);
      } finally { storageVersion += 1; mutation = false; }
    });
  }
  ipcMain.handle('apparent:read-runtime-state', (event, ...args) => {
    validateFoundation(event, args);
    // One bounded request, only on load or manual refresh; no recording-time polling.
    if (pending) return pending;
    if (Date.now() - lastRead < 1000) return lastResult;
    pending = readRuntimeState(os.homedir()).then((result) => {
      lastResult = result;
      lastRead = Date.now();
      return result;
    }).finally(() => { pending = undefined; });
    return pending;
  });
  void window.loadURL(page + settingsHash);
});
app.on('window-all-closed', () => app.quit());

}
