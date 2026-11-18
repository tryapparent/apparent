import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("apparentQuit", {
  state: () => ipcRenderer.invoke("quit-state"),
  decide: (quit: boolean, checked: boolean | null) =>
    ipcRenderer.invoke("quit-decide", quit, checked),
  close: () => ipcRenderer.send("quit-close"),
});
