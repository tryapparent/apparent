const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('nativeOnboarding',Object.freeze({
  readState:()=>ipcRenderer.invoke('onboarding:state'),
  action:action=>ipcRenderer.invoke('onboarding:action',action),
  onState:listener=>{const handler=(_event,state)=>listener(state);ipcRenderer.on('onboarding:state',handler);return()=>ipcRenderer.removeListener('onboarding:state',handler);},
  onDesktopShortcut:listener=>{const handler=(_event,key)=>listener(key);ipcRenderer.on('onboarding:desktop-shortcut',handler);return()=>ipcRenderer.removeListener('onboarding:desktop-shortcut',handler);},
}));
