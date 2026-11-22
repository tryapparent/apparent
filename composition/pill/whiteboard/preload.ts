import { contextBridge, ipcRenderer } from "electron";
import type {
  Operation,
  Point,
} from "../../../record/pill/whiteboard/renderer";

contextBridge.exposeInMainWorld("apparentWhiteboard", {
  initial: () => ipcRenderer.invoke("whiteboard:initial"),
  edit: (operation: Operation, point?: Point) =>
    ipcRenderer.invoke("whiteboard:edit", operation, point),
  ready: () => ipcRenderer.send("whiteboard:ready"),
});
