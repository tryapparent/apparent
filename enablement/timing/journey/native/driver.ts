import {
  Qmp,
  sendPlan,
  type Action,
} from "../../../../capture/desktop/scripts/linux/gui/input/qmp.ts";
import {
  observeShortcut,
  qualifyPortal,
} from "../../../../record/enablement/performance/start.ts";
import { execFileSync, spawn } from "node:child_process";
import { appendFileSync, lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const [rootArg, keyArg, mode] = process.argv.slice(2);
const root = resolve(rootArg);
const key = resolve(keyArg);
const resultFile = resolve(root, "result.json");
const qmpPath = resolve(root, "qmp.sock");
const result = () => JSON.parse(readFileSync(resultFile, "utf8"));
const deadline = performance.now() + 900_000;
const abort = new AbortController();
process.on("SIGTERM", () => abort.abort());
process.on("SIGINT", () => abort.abort());
while (result().stage !== "scenario") {
  if (result().stage === "finished" || performance.now() > deadline)
    throw Error("VM scenario unavailable");
  await sleep(400, undefined, { signal: abort.signal });
}
const active = result();
const transport = active.transport;
const readiness = active.guest_readiness;
if (
  !active.inputs?.isolated_network ||
  active.inputs.outputs !== 1 ||
  active.inputs.desktop !== "hyprland" ||
  readiness.input_profile !== "mouse" ||
  transport.qmp_socket !== qmpPath ||
  !Number.isInteger(transport.ssh_port) ||
  !/^[a-z][a-z0-9_-]+$/.test(transport.ssh_user) ||
  !/^\/tmp\/ag-[a-z0-9]+$/.test(readiness.tmpdir) ||
  !lstatSync(qmpPath).isSocket() ||
  lstatSync(qmpPath).uid !== process.getuid?.()
) {
  throw Error("Disposable guest identity did not match");
}
const sshArgs = (command: string) => [
  "-o",
  "BatchMode=yes",
  "-o",
  "ConnectTimeout=2",
  "-o",
  "StrictHostKeyChecking=yes",
  "-o",
  "UserKnownHostsFile=" + resolve(root, "known_hosts"),
  "-i",
  key,
  "-p",
  String(transport.ssh_port),
  transport.ssh_user + "@127.0.0.1",
  command,
];
function ssh(command: string) {
  return execFileSync("ssh", sshArgs(command), {
    encoding: "utf8",
    timeout: 4000,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}
function clipboardObserver(path: string) {
  const command =
    'printf "armed\\n"; while ! test -s ' +
    path +
    '; do sleep 0.02; done; printf "clipboard\\n"';
  const child = spawn("ssh", sshArgs(command), {
    signal: abort.signal,
    stdio: ["ignore", "pipe", "ignore"],
  });
  let armed = false;
  let onArmed: () => void;
  const connected = new Promise<void>((resolve) => (onArmed = resolve));
  const finished = new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Native clipboard observer timed out"));
    }, 125000);
    let buffer = "";
    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      if (!armed && buffer.includes("armed\n")) {
        armed = true;
        onArmed();
      }
      if (armed && buffer.includes("clipboard\n")) {
        clearTimeout(timer);
        resolve(performance.now());
      }
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      reject(new Error("Native clipboard observer closed: " + code));
    });
  });
  return { child, connected, finished };
}
if (mode !== "draw" && mode !== "surface")
  throw Error("Expected the draw or surface probe");
let out: string | undefined;
const known = new Set<string>();
const finished = new Set<string>();
let warmupHandled = false;
while (performance.now() < deadline) {
  abort.signal.throwIfAborted();
  if (result().stage !== "scenario") break;
  if (!out) {
    out =
      ssh("cat " + readiness.tmpdir + "/output-path 2>/dev/null || true") ||
      undefined;
    if (out && !/^\/home\/[a-z0-9_-]+\/scrawl-gui-output-[0-9a-f]+$/.test(out))
      throw Error("Unexpected guest-owned output path");
  }
  if (out) {
    const phase = ssh(
      "cat " + out + "/artifacts/current-phase 2>/dev/null || true",
    );
    if (phase === "done") break;
    if (!warmupHandled && /^(start|recording) portal-warmup$/.test(phase)) {
      warmupHandled = true;
      const fixture = JSON.parse(ssh("cat " + out + "/artifacts/scene.json"));
      if (fixture.title !== "Apparent capture smoke - SYNTHETIC")
        throw Error("Expected the owned synthetic scene");
      await qualifyPortal(
        root,
        new Qmp(qmpPath),
        () => ssh("cat " + out + "/artifacts/current-phase"),
        abort.signal,
        ssh,
      );
    }
    if (mode === "surface") {
      const label = ssh(
        "cat " + out + "/artifacts/shortcut-request 2>/dev/null || true",
      );
      if (/^shortcut-(first|repeat)$/.test(label) && !known.has(label)) {
        known.add(label);
        await observeShortcut(
          label,
          root,
          new Qmp(qmpPath),
          () => result().stage,
          abort.signal,
          ssh,
        );
      }
      await sleep(250, undefined, { signal: abort.signal });
      continue;
    }
    const ending = /^finish ([a-z0-9-]+) ([a-f0-9]{32})$/.exec(phase);
    if (ending && !finished.has(ending[1])) {
      const [, id, owned] = ending;
      const matches = ssh(
        "cat " + out + "/artifacts/" + id + "-owned-active.json",
      );
      const state = JSON.parse(matches);
      if (
        state.state?.capture_id !== owned ||
        state.state?.phase !== "recording"
      ) {
        throw Error("Finish request no longer matched the owned recording");
      }
      finished.add(id);
      const qmp = new Qmp(qmpPath);
      const actions: Action[] = [
        { kind: "key", code: "alt", down: true },
        { kind: "key", code: "shift", down: true },
        { kind: "key", code: "s", down: true },
        { kind: "key", code: "s", down: false },
        { kind: "key", code: "shift", down: false },
        { kind: "key", code: "alt", down: false },
      ];
      let pressed = 0;
      const observed = clipboardObserver(
        out + "/artifacts/" + id + "-clipboard-at.txt",
      );
      try {
        await Promise.race([observed.connected, observed.finished]);
        const [clipboardAt] = await Promise.all([
          observed.finished,
          sendPlan(
            qmp,
            { profile: "mouse", actions },
            7000,
            abort.signal,
            async (action: Action) => {
              if (action.kind === "key" && action.code === "s" && action.down)
                pressed = performance.now();
            },
          ),
        ]);
        if (!pressed || !(clipboardAt > pressed))
          throw Error("Clipboard observed before physical Finish");
        appendFileSync(
          resolve(root, "physical-finish.jsonl"),
          JSON.stringify({
            id,
            owned,
            waitMs: clipboardAt - pressed,
            pollIntervalMs: 20,
            source: "physical-record-shortcut",
          }) + "\n",
          { mode: 0o600 },
        );
      } finally {
        observed.child.kill();
      }
    }
    const match = /^recording ([a-z0-9-]+)$/.exec(phase);
    if (match && !known.has(match[1])) {
      const name = match[1];
      known.add(name);
      const count = Number(
        ssh("cat " + out + "/artifacts/" + name + "-draw-request"),
      );
      if (!Number.isInteger(count) || count < 0 || count > 12)
        throw Error("Invalid requested stroke count");
      if (count) {
        const actions: Action[] = [];
        for (let stroke = 0; stroke < count; stroke++) {
          actions.push(
            { kind: "key", code: "shift", down: true },
            { kind: "wait", ms: 70 },
          );
          for (const [x, y] of [
            [16, 6],
            [16, 10],
            [13, -4],
            [12, -8],
          ]) {
            actions.push(
              { kind: "relative", x: stroke % 2 === 0 ? x : -x, y },
              { kind: "wait", ms: 65 },
            );
          }
          actions.push(
            { kind: "key", code: "shift", down: false },
            { kind: "wait", ms: 190 },
          );
        }
        const at = performance.now();
        const receipt = await sendPlan(
          new Qmp(qmpPath),
          { profile: "mouse", actions },
          30000,
          abort.signal,
        );
        console.log(
          JSON.stringify({
            name,
            requested: count,
            driverElapsedMs: Math.round(performance.now() - at),
            receipt,
          }),
        );
      }
    }
  }
  await sleep(450, undefined, { signal: abort.signal });
}
