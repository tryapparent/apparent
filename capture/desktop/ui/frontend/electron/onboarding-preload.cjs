const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('nativeOnboarding',Object.freeze({
  readState:()=>ipcRenderer.invoke('onboarding:state'),
  readConnect:()=>ipcRenderer.invoke('onboarding:connect',null),
  connect:action=>ipcRenderer.invoke('onboarding:connect',action),
  closeConnect:()=>{void ipcRenderer.invoke('onboarding:close-connect');},
  action:action=>ipcRenderer.invoke('onboarding:action',action),
  onState:listener=>{const handler=(_event,state)=>listener(state);ipcRenderer.on('onboarding:state',handler);return()=>ipcRenderer.removeListener('onboarding:state',handler);},
}));
