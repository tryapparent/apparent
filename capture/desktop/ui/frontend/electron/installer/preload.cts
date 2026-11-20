import {contextBridge, ipcRenderer} from 'electron';
contextBridge.exposeInMainWorld('apparentInstaller', Object.freeze({
  action: async (action: string, replace?: boolean) => {
    const response = await ipcRenderer.invoke('installer:action',
      replace === undefined ? {action} : {action, replace});
    if (response.error) throw Error(response.error);
    return response.result;
  },
}));
