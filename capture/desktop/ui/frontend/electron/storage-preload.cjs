const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('apparentSettingsRoute', callback => {
  let live = true, received = false;
  const listener = (_event, pane) => { received = true; if (live) callback(pane); };
  ipcRenderer.on('apparent:settings-route', listener);
  // A parent can select a pane before this document's preload is attached.
  void ipcRenderer.invoke('apparent:settings-route').then(pane => {
    if (live && !received && ['agents', 'about'].includes(pane)) callback(pane);
  }).catch(() => {});
  return () => { live = false; ipcRenderer.removeListener('apparent:settings-route', listener); };
});

contextBridge.exposeInMainWorld('apparentSettingsMounted', async () => {
  // React has committed its DOM. Do not hold that fact behind hidden-page
  // animation scheduling: Chromium may already have supplied first paint.
  await ipcRenderer.invoke('apparent:settings-mounted');
  // The hidden page gets a render opportunity between these callbacks. Keep
  // this in the isolated preload, independent of the page's animation helpers.
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  await ipcRenderer.invoke('apparent:settings-frame-ready');
});

// Installed Storage has no Connect, reporting, clipboard or runtime capabilities.
contextBridge.exposeInMainWorld('apparent', Object.freeze({
  readCaptureLocation: () => ipcRenderer.invoke('apparent:read-capture-location'),
  changeCaptureLocation: () => ipcRenderer.invoke('apparent:change-capture-location'),
  resetCaptureLocation: () => ipcRenderer.invoke('apparent:reset-capture-location'),
  readRetention: () => ipcRenderer.invoke('apparent:read-retention'),
  saveRetention: (preset) => ipcRenderer.invoke('apparent:save-retention', preset),
  resetRetention: () => ipcRenderer.invoke('apparent:reset-retention'),
  readCaptureUsage: () => ipcRenderer.invoke('apparent:read-capture-usage'),
  navigateSettings: (pane) => ipcRenderer.invoke('apparent:navigate-settings', pane),
  showCaptureFolder: () => ipcRenderer.invoke('apparent:show-capture-folder'),
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
  previewT3: () => ipcRenderer.invoke('apparent:agents-t3-preview'),
  connectT3: origin => ipcRenderer.invoke('apparent:agents-t3-connect', origin),
  cancelT3: () => ipcRenderer.invoke('apparent:agents-t3-cancel'),
  disconnectT3: () => ipcRenderer.invoke('apparent:agents-t3-disconnect'),
  copySkill: () => ipcRenderer.invoke('apparent:agents-copy-skill'),
  subscribe: callback => {
    const listener = (_event, facts) => callback(facts);
    ipcRenderer.on('apparent:agents-state', listener);
    return () => ipcRenderer.removeListener('apparent:agents-state', listener);
  },
}));

contextBridge.exposeInMainWorld('apparentLabs',Object.freeze({
  read:()=>ipcRenderer.invoke('apparent:labs-preference'),
  save:(enabled,setting='autoPaste')=>ipcRenderer.invoke('apparent:labs-preference',enabled,setting),
  subscribe:callback=>{const listener=(_event,facts)=>callback(facts);ipcRenderer.on('apparent:labs-state',listener);return()=>ipcRenderer.removeListener('apparent:labs-state',listener);},
}));
