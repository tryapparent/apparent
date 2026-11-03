import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('apparent', Object.freeze({
  readAgents: () => ipcRenderer.invoke('apparent:agents-read'),
  installCli: () => ipcRenderer.invoke('apparent:agents-install'),
  uninstallCli: () => ipcRenderer.invoke('apparent:agents-uninstall'),
  setAgentDemoVideo: (enabled: boolean) => ipcRenderer.invoke('apparent:agents-demo', enabled),
  navigateSettings: (pane: string) => ipcRenderer.invoke('apparent:navigate-settings', pane),
}));
