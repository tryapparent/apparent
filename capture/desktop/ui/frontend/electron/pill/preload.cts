// @ts-nocheck -- preserved bounded Electron host; renderer and public view are typed.
'use strict';
const {contextBridge,ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('apparentPill', Object.freeze({
  read: () => ipcRenderer.invoke('pill:read'),
  retryBackgroundHandoff: capture => ipcRenderer.invoke('pill:retry-background-handoff',capture),
  backgroundHandoff: () => ipcRenderer.invoke('pill:background-handoff'),
  subscribeBackgroundHandoff: callback => {
    const listener=(_event,state)=>callback(state);ipcRenderer.on('pill:background-handoff',listener);
    return ()=>ipcRenderer.removeListener('pill:background-handoff',listener);
  },
  destinations: () => ipcRenderer.invoke('pill:destinations'),
  destinationAction: (capture,action,id) => ipcRenderer.invoke('pill:destination-action',capture,action,id),
  destinationFocus: focused => ipcRenderer.invoke('pill:destination-focus',focused),
  subscribeDestinations: callback => {
    const listener=(_event,state)=>callback(state);ipcRenderer.on('pill:destinations',listener);
    return ()=>ipcRenderer.removeListener('pill:destinations',listener);
  },
  layout: revision => ipcRenderer.invoke('pill:layout',revision),
  manualDrag: process.platform==='linux',
  beginDrag: revision => ipcRenderer.invoke('pill:begin-drag',revision),
  beginPaste: revision => ipcRenderer.invoke('pill:begin-paste',revision),
  cancelPaste: () => ipcRenderer.invoke('pill:cancel-paste'),
  act: (revision, action, drop=false) => ipcRenderer.invoke('pill:act',revision,action,drop),
  subscribe: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('pill:state',listener);
    return () => ipcRenderer.removeListener('pill:state',listener);
  },
}));
