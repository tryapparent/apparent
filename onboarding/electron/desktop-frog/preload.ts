import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("desktopFrog", {
  read: () => ipcRenderer.invoke("desktop-frog:read"),
  onShortcut(listener: (shortcut: string) => void) {
    const relay = (_event: unknown, shortcut: string) => listener(shortcut);
    ipcRenderer.on("desktop-frog:shortcut", relay);
    return () => ipcRenderer.removeListener("desktop-frog:shortcut", relay);
  },
  onWardrobe(listener: (items: string[]) => void) {
    const relay = (_event: unknown, items: string[]) => listener(items);
    ipcRenderer.on("desktop-frog:wardrobe", relay);
    return () => ipcRenderer.removeListener("desktop-frog:wardrobe", relay);
  },
  start: () => ipcRenderer.send("desktop-frog:start"),
  menu: () => ipcRenderer.send("desktop-frog:menu"),
  drag: (phase: string) => ipcRenderer.send("desktop-frog:drag", phase),
  arrived: () => ipcRenderer.send("desktop-frog:arrived"),
});
