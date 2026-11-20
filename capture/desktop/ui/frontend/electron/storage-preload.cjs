const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('apparentSettingsHasInsetTitlebar', process.platform === 'darwin');
contextBridge.exposeInMainWorld('apparentSettingsRoute', callback => {
  let live = true, received = false;
  const listener = (_event, pane) => { received = true; if (live) callback(pane); };
  ipcRenderer.on('apparent:settings-route', listener);
  // A parent can select a pane before this document's preload is attached.
  void ipcRenderer.invoke('apparent:settings-route').then(pane => {
    if (live && !received && ['general', 'agents', 'about', 'labs', 'recording', 'permissions', 'storage'].includes(pane)) callback(pane);
  }).catch(() => {});
  return () => { live = false; ipcRenderer.removeListener('apparent:settings-route', listener); };
});

contextBridge.exposeInMainWorld('apparentLabs', Object.freeze({
  read: () => ipcRenderer.invoke('apparent:labs-preference'),
  save: (enabled, setting) => ipcRenderer.invoke('apparent:labs-preference', enabled, ...(setting === undefined ? [] : [setting])),
  subscribe: callback => {
    const listener = (_event, facts) => callback(facts);
    ipcRenderer.on('apparent:labs-state', listener);
    return () => ipcRenderer.removeListener('apparent:labs-state', listener);
  },
}));

contextBridge.exposeInMainWorld('apparentLipPrompt', Object.freeze({
  ready: () => ipcRenderer.invoke('apparent:lip-ready'),
  begin: () => ipcRenderer.invoke('apparent:lip-begin'),
  decode: bytes => ipcRenderer.invoke('apparent:lip-decode', bytes),
  cancel: () => ipcRenderer.invoke('apparent:lip-cancel'),
  copy: () => ipcRenderer.invoke('apparent:lip-copy'),
}));

contextBridge.exposeInMainWorld('apparentSettingsMounted', async () => {
  // React has committed its DOM. Do not hold that fact behind hidden-page
  // animation scheduling: Chromium may already have supplied first paint.
  await ipcRenderer.invoke('apparent:settings-mounted');
  // The hidden page gets a render opportunity between these callbacks. Keep
  // this in the isolated preload, independent of the page's animation helpers.
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  await ipcRenderer.invoke('apparent:settings-frame-ready');
});

// Settings handlers admit capabilities only on their owning page.
contextBridge.exposeInMainWorld('apparent', Object.freeze({
  readConnectSettings: () => ipcRenderer.invoke('apparent:read-connect-settings'),
  connectSettings: () => ipcRenderer.invoke('apparent:connect-connect'),
  resumeConnectUploads: () => ipcRenderer.invoke('apparent:connect-resume'),
  allowConnectUploads: () => ipcRenderer.invoke('apparent:connect-allow'),
  cancelConnectSettings: () => ipcRenderer.invoke('apparent:connect-cancel'),
  checkConnectConnection: () => ipcRenderer.invoke('apparent:connect-check'),
  disableConnectUploads: () => ipcRenderer.invoke('apparent:connect-disable'),
  disconnectConnectSettings: () => ipcRenderer.invoke('apparent:connect-disconnect'),
  requestDisableConnectUploads: () => ipcRenderer.invoke('apparent:connect-request-disable'),
  requestDisconnectConnectSettings: () => ipcRenderer.invoke('apparent:connect-request-disconnect'),
  openConnectSharedLinks: () => ipcRenderer.invoke('apparent:connect-open-shared-links'),
  openConnectBrowser: () => ipcRenderer.invoke('apparent:connect-open-browser'),
  readCaptureLocation: () => ipcRenderer.invoke('apparent:read-capture-location'),
  changeCaptureLocation: () => ipcRenderer.invoke('apparent:change-capture-location'),
  resetCaptureLocation: () => ipcRenderer.invoke('apparent:reset-capture-location'),
  readRetention: () => ipcRenderer.invoke('apparent:read-retention'),
  saveRetention: (preset) => ipcRenderer.invoke('apparent:save-retention', preset),
  resetRetention: () => ipcRenderer.invoke('apparent:reset-retention'),
  readCaptureUsage: () => ipcRenderer.invoke('apparent:read-capture-usage'),
  showCaptureFolder: () => ipcRenderer.invoke('apparent:show-capture-folder'),
  navigateSettings: (pane) => ipcRenderer.invoke('apparent:navigate-settings', pane),
}));

contextBridge.exposeInMainWorld('apparentAbout', Object.freeze({
  read: () => ipcRenderer.invoke('apparent:about-read'),
  copyVersion: () => ipcRenderer.invoke('apparent:about-copy-version'),
  link: link => ipcRenderer.invoke('apparent:about-link', link),
  act: action => ipcRenderer.invoke('apparent:about-action', action),
  subscribe: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('apparent:about-state', listener);
    return () => ipcRenderer.removeListener('apparent:about-state', listener);
  },
}));

contextBridge.exposeInMainWorld('apparentAgents', Object.freeze({
  read: () => ipcRenderer.invoke('apparent:agents-preference'),
  save: enabled => ipcRenderer.invoke('apparent:agents-preference', enabled),
  saveT3: enabled => ipcRenderer.invoke('apparent:agents-t3-preference', enabled),
  previewT3: server => ipcRenderer.invoke('apparent:agents-t3-preview', server),
  connectT3: origin => ipcRenderer.invoke('apparent:agents-t3-connect', origin),
  cancelT3: () => ipcRenderer.invoke('apparent:agents-t3-cancel'),
  disconnectT3: origin => ipcRenderer.invoke('apparent:agents-t3-disconnect',origin),
  copySkill: () => ipcRenderer.invoke('apparent:agents-copy-skill'),
  subscribe: callback => {
    const listener = (_event, facts) => callback(facts);
    ipcRenderer.on('apparent:agents-state', listener);
    return () => ipcRenderer.removeListener('apparent:agents-state', listener);
  },
}));

contextBridge.exposeInMainWorld('apparentGeneral', Object.freeze({
  read: () => ipcRenderer.invoke('apparent:general-read'),
  act: action => ipcRenderer.invoke('apparent:general-action', action),
  subscribe: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('apparent:general-state', listener);
    return () => ipcRenderer.removeListener('apparent:general-state', listener);
  },
}));

function recordingSubscription(channel, callback) {
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}
contextBridge.exposeInMainWorld('apparentRecording', Object.freeze({
  read: () => ipcRenderer.invoke('apparent:recording-read'),
  subscribe: callback => recordingSubscription('apparent:recording-state', callback),
  subscribeLevel: callback => recordingSubscription('apparent:recording-level', callback),
  setMeterVisible: visible => ipcRenderer.invoke('apparent:recording-meter', visible),
  save: change => ipcRenderer.invoke('apparent:recording-save', change),
  openVolumeGuide: () => ipcRenderer.invoke('apparent:recording-volume-guide'),
}));

contextBridge.exposeInMainWorld('apparentPermissions', Object.freeze({
  read: () => ipcRenderer.invoke('apparent:permissions-read'),
  subscribe: callback => recordingSubscription('apparent:permission-state', callback),
  act: intent => ipcRenderer.invoke('apparent:permissions-act', intent),
}));
