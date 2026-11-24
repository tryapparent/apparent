import { AsyncLocalStorage } from "node:async_hooks";
import { app, ipcMain } from "electron";
import { Controller } from "../../main/controller.ts";
import { Delivery } from "../../main/delivery.ts";
import { Store } from "../../main/store.ts";
import { Transport } from "../../main/transport.ts";

type Span = {
  id: number;
  parent: number | null;
  attempt: string;
  name: string;
  startMs: number;
  endMs: number;
};
const scope = new AsyncLocalStorage<Span>();
const spans: Span[] = [];
let sequence = 0;
const now = () => Number(process.hrtime.bigint()) / 1e6;

Object.defineProperty(globalThis, Symbol.for("apparent.handoff.benchmark"), {
  value: spans,
});

let activeCapture = "";

async function measure<T>(
  name: string,
  attempt: string,
  operation: () => T | Promise<T>,
) {
  const span = {
    id: ++sequence,
    parent: scope.getStore()?.id ?? null,
    attempt,
    name,
    startMs: now(),
    endMs: 0,
  };
  return scope.run(span, async () => {
    try {
      return await operation();
    } finally {
      span.endMs = now();
      spans.push(span);
    }
  });
}

function tap<Args extends unknown[]>(
  prototype: object,
  method: string,
  describe: (...args: Args) => string,
  attemptFrom?: (...args: Args) => string,
) {
  const target = prototype as Record<
    string,
    (...args: Args) => Promise<unknown>
  >;
  const original = target[method];
  if (typeof original !== "function")
    throw Error("Missing probe boundary: " + method);
  target[method] = function (...args: Args) {
    const attempt = scope.getStore()?.attempt ?? attemptFrom?.(...args);
    const call = () => original.apply(this, args);
    return attempt ? measure(describe(...args), attempt, call) : call();
  };
}

tap(
  Controller.prototype,
  "update",
  (_capture: string, phase: string) => "catalogue.update." + phase,
  (capture: string) => (activeCapture = capture),
);
tap(
  Controller.prototype,
  "confirm",
  (_capture: string) => "selection.confirm",
  (capture: string) => capture,
);
tap(Controller.prototype, "send", () => "selection.revalidate-and-send");
tap(
  Controller.prototype,
  "ready",
  (_capture: string) => "record.ready",
  (capture: string) => capture,
);
tap(Delivery.prototype, "submit", () => "delivery.submit");
tap(
  Store.prototype,
  "save",
  (job: { phase: string }) => "store.save." + job.phase,
);
tap(Transport.prototype, "get", () => "transport.shell");
tap(Transport.prototype, "rpc", (tag: string) => "transport.rpc." + tag);

const send = WebSocket.prototype.send;
WebSocket.prototype.send = function (data) {
  const parent = scope.getStore();
  if (!parent) return send.call(this, data);
  const startMs = now();
  try {
    return send.call(this, data);
  } finally {
    spans.push({
      id: ++sequence,
      parent: parent.id,
      attempt: parent.attempt,
      name: "transport.websocket.send",
      startMs,
      endMs: now(),
    });
  }
};

const handle = ipcMain.handle;
ipcMain.handle = function (channel, handler) {
  if (
    ![
      "pill:layout",
      "pill:destination-focus",
      "pill:destination-action",
    ].includes(channel)
  )
    return handle.call(this, channel, handler);
  return handle.call(this, channel, (event, ...args) => {
    const attempt =
      channel === "pill:destination-action" ? args[0] : activeCapture;
    const call = () => handler(event, ...args);
    return attempt ? measure("ipc." + channel, attempt, call) : call();
  });
};

app.on("browser-window-created", (_event, window) => {
  window.on("resize", () => {
    if (!activeCapture) return;
    const at = now();
    spans.push({
      id: ++sequence,
      parent: scope.getStore()?.id ?? null,
      attempt: activeCapture,
      name: "window.resize",
      startMs: at,
      endMs: at,
    });
  });
});
