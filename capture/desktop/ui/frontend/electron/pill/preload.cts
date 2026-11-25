// @ts-nocheck -- preserved bounded Electron host; renderer and public view are typed.
'use strict';
const {contextBridge,ipcRenderer} = require('electron');
let snapshot,receive;
ipcRenderer.on('pill:update',(_event,update)=>{
  if(receive)receive(update);
  else snapshot={...snapshot,...update};
});
const ready=ipcRenderer.invoke('pill:bootstrap').then(()=>true,()=>false);
contextBridge.exposeInMainWorld('apparentPill', Object.freeze({
  read: () => ipcRenderer.invoke('pill:read'),
  retryBackgroundHandoff: capture => ipcRenderer.invoke('pill:retry-background-handoff',capture),
  destinations: () => ipcRenderer.invoke('pill:destinations'),
  destinationAction: (capture,action,id) => ipcRenderer.invoke('pill:destination-action',capture,action,id),
  destinationFocus: focused => ipcRenderer.invoke('pill:destination-focus',focused),
  layout: revision => ipcRenderer.invoke('pill:layout',revision),
  manualDrag: process.platform==='linux',
  beginDrag: revision => ipcRenderer.invoke('pill:begin-drag',revision),
  beginPaste: revision => ipcRenderer.invoke('pill:begin-paste',revision),
  cancelPaste: () => ipcRenderer.invoke('pill:cancel-paste'),
  act: (revision, action, drop=false) => ipcRenderer.invoke('pill:act',revision,action,drop),
  subscribe: (onUpdate,onError) => {
    receive=onUpdate;
    if(snapshot){onUpdate(snapshot);snapshot=undefined;}
    void ready.then(accepted=>{if(!accepted&&receive===onUpdate)onError();});
    return ()=>{if(receive===onUpdate)receive=undefined;};
  },
}));
