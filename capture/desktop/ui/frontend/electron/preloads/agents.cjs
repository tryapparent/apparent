const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('apparent', Object.freeze({
  readAgents: () => ipcRenderer.invoke('apparent:agents-read'),
  installCli: () => ipcRenderer.invoke('apparent:agents-install'),
  uninstallCli: () => ipcRenderer.invoke('apparent:agents-uninstall'),
  setAgentDemoVideo: (enabled) => ipcRenderer.invoke('apparent:agents-demo', enabled),
  navigateSettings: (pane) => ipcRenderer.invoke('apparent:navigate-settings', pane),
}));
