import { contextBridge, ipcRenderer } from "electron";
import type {
  Operation,
  Point,
} from "../../../record/pill/whiteboard/renderer";

function edit(operation: Operation, point?: Point) {
  return ipcRenderer.invoke("whiteboard:edit", operation, point);
}

function cancelOpening() {
  void edit("close").catch(() => window.close());
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && document.getElementById("opening"))
    cancelOpening();
});
document.addEventListener("click", (event) => {
  if (document.getElementById("close-opening")?.contains(event.target as Node))
    cancelOpening();
});

contextBridge.exposeInMainWorld("apparentWhiteboard", {
  initial: () => ipcRenderer.invoke("whiteboard:initial"),
  edit,
  ready: () => ipcRenderer.send("whiteboard:ready"),
});
