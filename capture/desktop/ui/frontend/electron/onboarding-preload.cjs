const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('apparentBuild',Object.freeze({
  read:()=>ipcRenderer.invoke('apparent:build-identity'),
}));
contextBridge.exposeInMainWorld('nativeOnboarding',Object.freeze({
  readState:()=>ipcRenderer.invoke('onboarding:state'),
  action:action=>ipcRenderer.invoke('onboarding:action',action),
  onState:listener=>{const handler=(_event,state)=>listener(state);ipcRenderer.on('onboarding:state',handler);return()=>ipcRenderer.removeListener('onboarding:state',handler);},
}));

// Two fixed signals only; the renderer cannot submit error text or properties.
contextBridge.exposeInMainWorld('apparentExceptions', Object.freeze({
  exception: () => ipcRenderer.send('apparent:unhandled', 'renderer_exception'),
  rejection: () => ipcRenderer.send('apparent:unhandled', 'renderer_rejection'),
}));
