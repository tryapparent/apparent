import assert from "node:assert/strict";
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import {
  chmod,
  lstat,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { measuredWait } from "../../../shared/enablement/performance/measurement.ts";

const [appDir, results, ...extra] = process.argv.slice(2);
assert(
  appDir &&
    isAbsolute(appDir) &&
    results &&
    isAbsolute(results) &&
    !extra.length,
  "Usage: performance.ts EXTRACTED_APPIMAGE PRIVATE_RESULTS_DIR",
);
const profile = process.env.XDG_CONFIG_HOME;
const captureDir = process.env.APPARENT_CAPTURES_DIR;
const owner = process.env.APPARENT_GUI_OUTPUT;
const scratch = process.env.TMPDIR;
assert(
  owner &&
    /^\/home\/[a-z0-9_-]+\/apparent-gui-out-[0-9a-f]+$/.test(owner) &&
    profile === join(owner, "config") &&
    captureDir === join(owner, "captures") &&
    results === join(owner, "artifacts") &&
    scratch &&
    /^\/tmp\/ag-[a-z0-9]+$/.test(scratch) &&
    appDir === join(scratch, "app/squashfs-root"),
  "Run in the isolated guest with its isolated settings and captures",
);
const executable = join(appDir, "AppRun");
const runtime = join(appDir, "usr/share/apparent/settings/runtime/electron");
const packaged = runtime + ".benchmark-original";
const settingsPort = join(profile, "apparent-settings/DevToolsActivePort");
assert(
  (await lstat(runtime)).isFile(),
  "Expected the extracted packaged Settings renderer",
);

async function until<T>(probe: () => Promise<T | undefined>, what: string) {
  for (
    const deadline = performance.now() + 25_000;
    performance.now() < deadline;
  ) {
    const result = await probe();
    if (result !== undefined) return result;
    await delay(15);
  }
  throw Error("Timed out waiting for " + what);
}

type Target = { url: string; webSocketDebuggerUrl: string };
async function connectSettings() {
  const target = await until(async () => {
    try {
      const [port] = (await readFile(settingsPort, "utf8")).split("\n");
      if (!/^\d{4,5}$/.test(port)) return;
      const list = (await fetch("http://127.0.0.1:" + port + "/json/list", {
        signal: AbortSignal.timeout(250),
      }).then((response) => response.json())) as Target[];
      return list.find(
        (row) =>
          /^file:.*\/settings\.html/.test(row.url) &&
          row.webSocketDebuggerUrl.startsWith("ws://127.0.0.1:" + port + "/"),
      );
    } catch {
      return;
    }
  }, "the packaged Settings window");
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener(
      "error",
      () => reject(Error("Local Settings observer could not connect")),
      { once: true },
    );
  });
  let next = 0;
  async function send<T = unknown>(method: string, params: object) {
    const id = ++next;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.removeEventListener("message", handler);
        reject(Error("Settings observer timed out on " + method));
      }, 3000);
      function handler(event: MessageEvent) {
        const reply = JSON.parse(String(event.data));
        if (reply.id !== id) return;
        socket.removeEventListener("message", handler);
        clearTimeout(timer);
        if (reply.error) reject(Error(String(reply.error.message)));
        else resolve(reply.result);
      }
      socket.addEventListener("message", handler);
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async function evaluate<T = unknown>(expression: string): Promise<T> {
    const reply = await send<{
      result: { value: T };
      exceptionDetails?: object;
    }>("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (reply.exceptionDetails)
      throw Error("Settings observer expression failed");
    return reply.result.value;
  }
  return { evaluate, send, close: () => socket.close() };
}

type Observer = Awaited<ReturnType<typeof connectSettings>>;
const entry = `document.visibilityState === "visible" && (
  (document.title === "Apparent Settings — General"
    && [...document.querySelectorAll("[role=switch]")].some(control =>
      control.id === "general-errorReporting" && !control.disabled
      && control.getBoundingClientRect().height > 0))
  || (document.title === "Apparent Settings — About"
    && [...document.querySelectorAll("main button")].some(control =>
      control.textContent.trim() === "Show welcome tour" && !control.disabled
      && control.getBoundingClientRect().height > 0))
)`;
const recording = `document.visibilityState === "visible"
  && document.title === "Apparent Settings — Recording"
  && [...document.querySelectorAll("main button, main [role=combobox]")].some(control =>
    (control.getAttribute("role") === "combobox"
      || control.textContent.trim() === "Set up and test volume lowering")
    && !control.disabled && control.getBoundingClientRect().height > 0)`;
async function painted(observer: Observer, predicate: string) {
  try {
    await until(
      async () => ((await observer.evaluate(predicate)) ? true : undefined),
      "responsive Settings controls",
    );
  } catch (error) {
    const state = await observer.evaluate(`({
      title: document.title,
      visibility: document.visibilityState,
      heading: document.querySelector("h1")?.textContent,
      ready: document.readyState,
      controls: [...document.querySelectorAll("main [role=switch], main [role=combobox], main button")]
        .map(control => ({ id: control.id, text: control.textContent.trim(), disabled: control.disabled }))
    })`);
    console.error(JSON.stringify(state));
    throw error;
  }
  await observer.evaluate(
    "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))",
  );
  return performance.now();
}
async function selectRecording(observer: Observer) {
  const position = await observer.evaluate<{
    x: number;
    y: number;
  } | null>(`(() => {
    const button = [...document.querySelectorAll("nav button")].find(control =>
      control.textContent.trim() === "Recording" && !control.disabled);
    if (!button) return null;
    const rect = button.getBoundingClientRect();
    return rect.height && rect.width ? {x: rect.x + rect.width / 2, y: rect.y + rect.height / 2} : null;
  })()`);
  assert(position, "Settings navigator did not expose the Recording option");
  const started = performance.now();
  await observer.send("Input.dispatchMouseEvent", {
    ...position,
    type: "mousePressed",
    button: "left",
    clickCount: 1,
  });
  await observer.send("Input.dispatchMouseEvent", {
    ...position,
    type: "mouseReleased",
    button: "left",
    clickCount: 1,
  });
  return measuredWait(started, await painted(observer, recording));
}

const options = { ...process.env, APPARENT_DESKTOP_REPORTING: "0" };
const version = execFileSync(executable, ["--version"], {
  env: options,
  encoding: "utf8",
}).trim();
assert.match(version, /^apparent\s+\S+\s+·\s+[0-9a-f]{7,40}$/);
const owned: ChildProcess[] = [];
function launch(action: "launch" | "app", background = false) {
  const started = performance.now();
  const child = spawn(
    executable,
    background ? [action, "--background"] : [action],
    {
      env: options,
      stdio: "ignore",
    },
  );
  owned.push(child);
  return { started, child };
}
let observer: Observer | undefined;
await rename(runtime, packaged);
try {
  await writeFile(
    runtime,
    '#!/bin/sh\nexec "$0.benchmark-original" --remote-debugging-address=127.0.0.1 --remote-debugging-port=0 "$@"\n',
    { flag: "wx", mode: 0o700 },
  );
  await chmod(runtime, 0o700);
  await unlink(settingsPort).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
  const cold = launch("launch");
  observer = await connectSettings();
  const launchWait = measuredWait(cold.started, await painted(observer, entry));
  const coldPane = await observer.evaluate(
    "document.querySelector('h1').textContent",
  );
  await writeFile(
    join(results, "launch-waits.json"),
    JSON.stringify(
      {
        version,
        observedPanel: coldPane,
        waits: { launch: launchWait },
      },
      null,
      2,
    ) + "\n",
    { flag: "wx", mode: 0o600 },
  );
  observer.close();
  observer = undefined;
  cold.child.kill("SIGTERM");
  await until(
    async () =>
      cold.child.exitCode !== null || cold.child.signalCode !== null
        ? true
        : undefined,
    "the cold-launch application to exit",
  );
  await unlink(settingsPort).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
  const background = launch("launch", true);
  await until(async () => {
    if (
      background.child.exitCode !== null ||
      background.child.signalCode !== null
    )
      throw Error("Background app exited");
    try {
      const state = JSON.parse(
        execFileSync(executable, ["capture", "state"], {
          env: options,
          encoding: "utf8",
          timeout: 3000,
          stdio: ["ignore", "pipe", "ignore"],
        }),
      );
      return state.state?.phase === "idle" ? true : undefined;
    } catch {
      return;
    }
  }, "the background application to accept capture requests");
  const reopened = launch("app");
  observer = await connectSettings();
  const settings = measuredWait(
    reopened.started,
    await painted(observer, entry),
  );
  const openPane = await observer.evaluate(
    "document.querySelector('h1').textContent",
  );
  const section = await selectRecording(observer);
  await observer.evaluate("window.close()");
  await writeFile(
    join(results, "settings-waits.json"),
    JSON.stringify(
      {
        version,
        observedPanel: openPane,
        waits: {
          settings,
          "settings-section": section,
        },
      },
      null,
      2,
    ) + "\n",
    { flag: "wx", mode: 0o600 },
  );
} finally {
  observer?.close();
  for (const child of owned) child.kill("SIGTERM");
  await rename(packaged, runtime);
}
