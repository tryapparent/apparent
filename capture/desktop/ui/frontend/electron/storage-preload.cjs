const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('apparentSettingsHasInsetTitlebar', process.platform === 'darwin');
contextBridge.exposeInMainWorld('apparentSettingsRoute', callback => {
  let live = true, received = false;
  const listener = (_event, pane) => { received = true; if (live) callback(pane); };
  ipcRenderer.on('apparent:settings-route', listener);
  void ipcRenderer.invoke('apparent:settings-route').then(pane => {
    if (live && !received && ['general', 'agents', 'about', 'labs', 'recording', 'handoff', 'permissions', 'storage'].includes(pane)) callback(pane);
  }).catch(() => {});
  return () => { live = false; ipcRenderer.removeListener('apparent:settings-route', listener); };
});

contextBridge.exposeInMainWorld('apparentOpenRouter', action => ipcRenderer.invoke('apparent:openrouter-preference', action));

contextBridge.exposeInMainWorld('apparentLabs', Object.freeze({
  read: () => ipcRenderer.invoke('apparent:labs-preference'),
  save: (...args) => ipcRenderer.invoke('apparent:labs-preference', ...args),
  subscribe: callback => subscribe('apparent:labs-state', callback),
}));

contextBridge.exposeInMainWorld('apparentHandoff', Object.freeze({
  read: () => ipcRenderer.invoke('apparent:handoff-read'),
  save: enabled => ipcRenderer.invoke('apparent:handoff-save', enabled),
  subscribe: callback => subscribe('apparent:handoff-state', callback),
}));

contextBridge.exposeInMainWorld('apparentSettingsMounted', async () => {
  const committed = ipcRenderer.invoke('apparent:settings-mounted');
  const frame = new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  if (await committed) return;
  await frame;
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
  saveStorageLimit: maximumMb => ipcRenderer.invoke('apparent:limit-retention', maximumMb),
  readRetention: () => ipcRenderer.invoke('apparent:read-retention'),
  saveRetention: (preset) => ipcRenderer.invoke('apparent:save-retention', preset),
  resetRetention: () => ipcRenderer.invoke('apparent:reset-retention'),
  readCaptureUsage: () => ipcRenderer.invoke('apparent:read-capture-usage'),
  showCaptureFolder: () => ipcRenderer.invoke('apparent:show-capture-folder'),
  navigateSettings: (pane) => ipcRenderer.invoke('apparent:navigate-settings', pane),
}));

contextBridge.exposeInMainWorld('apparentFeedback', Object.freeze({
  available: () => ipcRenderer.invoke('apparent:feedback-available'),
  recordingAvailable: () => ipcRenderer.invoke('apparent:feedback-capture-available'),
  startRecording: () => ipcRenderer.invoke('apparent:feedback-capture-start'),
  discardRecording: () => ipcRenderer.invoke('apparent:feedback-capture-discard'),
  sendRecording: () => ipcRenderer.invoke('apparent:feedback-capture-send'),
  sendWritten: (description, id) => ipcRenderer.invoke('apparent:feedback-send-written', description, id),
}));

contextBridge.exposeInMainWorld('apparentAbout', Object.freeze({
  read: () => ipcRenderer.invoke('apparent:about-read'),
  copyVersion: () => ipcRenderer.invoke('apparent:about-copy-version'),
  link: link => ipcRenderer.invoke('apparent:about-link', link),
  act: action => ipcRenderer.invoke('apparent:about-action', action),
  subscribe: callback => subscribe('apparent:about-state', callback),
}));

contextBridge.exposeInMainWorld('apparentAgents', Object.freeze({
  read: () => ipcRenderer.invoke('apparent:agents-preference'),
  saveT3: enabled => ipcRenderer.invoke('apparent:agents-t3-preference', enabled),
  previewT3: server => ipcRenderer.invoke('apparent:agents-t3-preview', server),
  connectT3: origin => ipcRenderer.invoke('apparent:agents-t3-connect', origin),
  cancelT3: () => ipcRenderer.invoke('apparent:agents-t3-cancel'),
  disconnectT3: origin => ipcRenderer.invoke('apparent:agents-t3-disconnect',origin),
  copySkill: () => ipcRenderer.invoke('apparent:agents-copy-skill'),
  copyT3Setup: () => ipcRenderer.invoke('apparent:agents-t3-copy-setup'),
  t3Environments: () => ipcRenderer.invoke('apparent:agents-t3-environments'),
  subscribe: callback => subscribe('apparent:agents-state', callback),
}));

contextBridge.exposeInMainWorld('apparentGeneral', Object.freeze({
  read: () => ipcRenderer.invoke('apparent:general-read'),
  act: action => ipcRenderer.invoke('apparent:general-action', action),
  subscribe: callback => subscribe('apparent:general-state', callback),
}));

function subscribe(channel, callback) {
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}
contextBridge.exposeInMainWorld('apparentRecording', Object.freeze({
  read: () => ipcRenderer.invoke('apparent:recording-read'),
  subscribe: callback => subscribe('apparent:recording-state', callback),
  subscribeLevel: callback => subscribe('apparent:recording-level', callback),
  setMeterVisible: visible => ipcRenderer.invoke('apparent:recording-meter', visible),
  save: change => ipcRenderer.invoke('apparent:recording-save', change),
}));

contextBridge.exposeInMainWorld('apparentPermissions', Object.freeze({
  read: () => ipcRenderer.invoke('apparent:permissions-read'),
  subscribe: callback => subscribe('apparent:permission-state', callback),
  act: intent => ipcRenderer.invoke('apparent:permissions-act', intent),
}));
