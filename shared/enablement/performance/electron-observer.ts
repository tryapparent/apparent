import assert from "node:assert/strict";
import { lstat, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

type Surface = "pill" | "notes" | "draft" | "onboarding" | "whiteboard";
type Target = { url: string; webSocketDebuggerUrl: string };

export async function waitFor<T>(
  sample: () => Promise<T | undefined>,
  what: string,
  timeout = 10000,
) {
  const deadline = performance.now() + timeout;
  while (performance.now() < deadline) {
    const value = await sample();
    if (value !== undefined) return value;
    await delay(20);
  }
  throw Error("Timed out waiting for " + what);
}

export async function installObservers(app: string, output: string) {
  assert.match(app, /^\/tmp\/ag-[a-z0-9]+\/app\/squashfs-root$/);
  assert.match(
    output,
    /^\/home\/[a-z0-9_-]+\/scrawl-gui-output-[0-9a-f]+\/artifacts$/,
  );
  const runtime = join(app, "usr/share/apparent/settings/runtime/electron");
  assert((await lstat(runtime)).isFile());
  await rename(runtime, runtime + ".benchmark-original");
  await writeFile(
    runtime,
    `#!/bin/bash
name=
for arg in "$@"; do
  case "$arg" in
     */electron/pill/main.cjs) name=pill ;;
     */electron/notes/main.cjs) name=notes ;;
     */composition/onboarding/entry.cjs) name=onboarding ;;
     */dist/whiteboard/main.cjs) name=whiteboard ;;
     */benchmark-draft.cjs) name=draft ;;
  esac
done
if [[ -z "$name" ]]; then
  exec "$0.benchmark-original" "$@"
fi
exec "$0.benchmark-original" --remote-debugging-address=127.0.0.1 --remote-debugging-port=0 "$@" 2> >(tee -a '${output}/observer-'"$name"'.log' >&2)
`,
    { flag: "wx", mode: 0o700 },
  );
  return runtime;
}

export async function connectTo(output: string, surface: Surface, url: RegExp) {
  const target = await waitFor(async () => {
    const portLog = await readFile(
      join(output, "observer-" + surface + ".log"),
      "utf8",
    ).catch(() => "");
    const ports = [
      ...new Set(
        [
          ...portLog.matchAll(
            /^DevTools listening on ws:\/\/127\.0\.0\.1:(\d{4,5})\/devtools\/browser\/[a-z0-9-]+$/gm,
          ),
        ].map((match) => match[1]),
      ),
    ];
    for (const port of ports.reverse()) {
      const endpoint = "127.0.0.1:" + port;
      const targets = await fetch("http://" + endpoint + "/json/list", {
        signal: AbortSignal.timeout(200),
      })
        .then((response) => response.json() as Promise<Target[]>)
        .catch(() => []);
      const target = targets.find(
        (row) =>
          url.test(row.url) &&
          row.webSocketDebuggerUrl?.startsWith(
            "ws://" + endpoint + "/devtools/page/",
          ),
      );
      if (target) return target;
    }
  }, surface + " renderer");
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(Error("Local CDP did not open")),
      2000,
    );
    socket.addEventListener(
      "open",
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
    socket.addEventListener(
      "error",
      () => {
        clearTimeout(timeout);
        reject(Error("Local CDP connection failed"));
      },
      { once: true },
    );
  }).catch((error) => {
    socket.close();
    throw error;
  });
  let serial = 0;
  function send<T>(method: string, params: object = {}) {
    const id = ++serial;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.removeEventListener("message", onMessage);
        reject(Error("Local CDP timed out on " + method));
      }, 1500);
      function onMessage(event: MessageEvent) {
        const reply = JSON.parse(String(event.data));
        if (reply.id !== id) return;
        clearTimeout(timer);
        socket.removeEventListener("message", onMessage);
        if (reply.error) reject(Error(reply.error.message));
        else resolve(reply.result);
      }
      socket.addEventListener("message", onMessage);
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async function evaluate<T>(expression: string) {
    const reply = await send<{
      result: { value: T };
      exceptionDetails?: unknown;
    }>("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (reply.exceptionDetails)
      throw Error(surface + " observer expression failed");
    return reply.result.value;
  }
  async function click(selector: string) {
    const position = await evaluate<{ x: number; y: number } | null>(`(() => {
      const button = document.querySelector(${JSON.stringify(selector)});
      const rect = button?.getBoundingClientRect();
      return button && !button.disabled && rect.width && rect.height &&
        document.visibilityState === "visible"
        ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;
    })()`);
    assert(position, "Expected an enabled visible control " + selector);
    const started = performance.now();
    for (const type of ["mousePressed", "mouseReleased"])
      await send("Input.dispatchMouseEvent", {
        type,
        ...position,
        button: "left",
        clickCount: 1,
      });
    return started;
  }
  async function painted() {
    await evaluate(
      "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
    );
  }
  return {
    evaluate,
    send,
    click,
    painted,
    close: () => socket.close(),
    closed: () => socket.readyState === WebSocket.CLOSED,
  };
}
