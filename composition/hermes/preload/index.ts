import { contextBridge, ipcRenderer } from "electron";
import type { View } from "../main/protocol";

const subscribers = new Set<() => void>();
let snapshot = JSON.stringify({ phase: "confirm", availability: "pending" });
const publish = (view: View) => {
  snapshot = JSON.stringify(view);
  for (const subscriber of subscribers) subscriber();
};
const disconnected = () =>
  publish({
    phase: "error",
    message:
      "Unable to connect to Apparent. Reopen Record for Hermes and try again.",
  });
const read = (): Promise<View> => ipcRenderer.invoke("apparent:hermes-read");
let receivedUpdate = false;
ipcRenderer.on("apparent:hermes-view", (_event, view: View) => {
  receivedUpdate = true;
  publish(view);
});
void read().then(
  (view) => {
    if (!receivedUpdate) publish(view);
  },
  () => {
    if (!receivedUpdate) disconnected();
  },
);
window.addEventListener(
  "DOMContentLoaded",
  () => {
    document.title = "Record for Hermes";
  },
  { once: true },
);

declare global {
  type HermesRecordingView = View;
  interface Window {
    hermesRecording?: {
      read(): Promise<View>;
      start(): Promise<View | void>;
      snapshot(): string;
      subscribe(notify: () => void): () => void;
    };
  }
}
contextBridge.exposeInMainWorld("hermesRecording", {
  read,
  start: () => ipcRenderer.invoke("apparent:hermes-start").catch(disconnected),
  snapshot: () => snapshot,
  subscribe(notify: () => void) {
    subscribers.add(notify);
    return () => {
      subscribers.delete(notify);
    };
  },
} satisfies NonNullable<Window["hermesRecording"]>);
