import assert from "node:assert/strict";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { interval } from "../../../../shared/enablement/performance/measurement.ts";

export const width = 640;
const height = 96;
const top = 25;
export const bytesPerFrame = width * height * 3;
const controls = [
  {
    id: "finish",
    label: "Finish",
    enabled: true,
    selected: false,
    primary: true,
  },
  {
    id: "whiteboard",
    label: "Whiteboard",
    enabled: true,
    selected: false,
    primary: false,
  },
  {
    id: "cancel",
    label: "Cancel",
    enabled: true,
    selected: false,
    primary: false,
  },
];

type Frame = {
  at: number;
  bytes: Buffer;
  marker: { x: number; y: number } | null;
};

type Reply = {
  ready?: boolean;
  activated?: boolean;
  windowId?: number;
  revision?: number;
  frame?: number[];
  action?: string;
};

type TimedReply = { value: Reply; at: number };

export function locate(input: string) {
  const settings = join(input, "usr/share/apparent/settings");
  const packaged = existsSync(join(settings, "runtime/electron"));
  const app = packaged ? join(settings, "app") : input;
  const runtime = packaged
    ? join(settings, "runtime/electron")
    : join(input, "node_modules/electron/dist/electron");
  const host = join(app, "electron/pill/main.cjs");
  const renderer = join(app, "dist/pill/index.html");
  for (const file of [runtime, host, renderer])
    assert.ok(existsSync(file), "Missing benchmark build file " + file);
  return {
    app,
    runtime,
    host,
    renderer,
    lib: packaged ? join(input, "usr/lib") : undefined,
  };
}

export type Setup = ReturnType<typeof locate>;

async function until<T>(
  read: () => T | undefined,
  label: string,
  limitMs = 6000,
) {
  const deadline = performance.now() + limitMs;
  while (performance.now() < deadline) {
    const result = read();
    if (result !== undefined) return result;
    await delay(4);
  }
  throw Error("Startup benchmark timed out at " + label);
}

export function watchDisplay() {
  const child = spawn(
    "ffmpeg",
    [
      "-v",
      "error",
      "-threads",
      "1",
      "-filter_threads",
      "1",
      "-probesize",
      "32",
      "-analyzeduration",
      "0",
      "-f",
      "x11grab",
      "-draw_mouse",
      "0",
      "-framerate",
      "60",
      "-video_size",
      `${width}x${height}`,
      "-i",
      `${process.env.DISPLAY}+0,${top}`,
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "-threads",
      "1",
      "pipe:1",
    ],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  const frames: Frame[] = [];
  let pending = Buffer.alloc(0);
  child.stdout.on("data", (chunk: Buffer) => {
    pending = Buffer.concat([pending, chunk]);
    while (pending.length >= bytesPerFrame) {
      const bytes = pending.subarray(0, bytesPerFrame);
      pending = pending.subarray(bytesPerFrame);
      let red = 0,
        x = 0,
        y = 0;
      for (let row = 17; row < height - 15; row++) {
        for (let column = 120; column < width - 120; column++) {
          const i = (row * width + column) * 3;
          const [r, g, b] = [bytes[i], bytes[i + 1], bytes[i + 2]];
          if (r > 115 && r > g + 30 && r > b + 20) {
            red++;
            x += column;
            y += row;
          }
        }
      }
      const marker =
        red >= 12
          ? { x: Math.round(x / red), y: top + Math.round(y / red) }
          : null;
      frames.push({ at: performance.now(), bytes, marker });
      if (frames.length > 24) frames.shift();
    }
  });
  return { child, frames };
}

async function visibleFrame(
  display: ReturnType<typeof watchDisplay>,
  after: number,
  requireTransition: boolean,
  limitMs?: number,
) {
  return until(
    () => {
      const frames = display.frames;
      const index = frames.findIndex(
        ({ at, marker }, i) =>
          i > 0 &&
          at >= after &&
          marker &&
          frames[i + 1]?.marker &&
          (!requireTransition || frames[i - 1].marker === null),
      );
      if (index < 0) return undefined;
      return {
        frame: frames[index],
        gap: frames[index].at - frames[index - 1].at,
      };
    },
    "painted recording marker",
    limitMs,
  );
}

function launch(setup: Setup, directory: string, diagnostic: boolean) {
  const affinity = process.env.APPARENT_START_BENCH_CPUS;
  if (affinity) assert.match(affinity, /^\d+,\d+$/);
  const child = spawn(
    affinity ? "taskset" : setup.runtime,
    [
      ...(affinity ? ["--cpu-list", affinity, setup.runtime] : []),
      "--no-sandbox",
      "--ozone-platform=x11",
      ...(diagnostic ? ["--enable-logging=stderr"] : []),
      setup.host,
    ],
    {
      cwd: setup.app,
      env: {
        PATH: process.env.PATH,
        DISPLAY: process.env.DISPLAY,
        XAUTHORITY: process.env.XAUTHORITY,
        HOME: directory,
        XDG_RUNTIME_DIR: directory,
        XDG_CONFIG_HOME: join(directory, "config"),
        APPARENT_CONFIG: join(directory, "config.json"),
        APPARENT_DESKTOP_REPORTING: "0",
        LD_LIBRARY_PATH: setup.lib,
      },
      stdio: ["pipe", "pipe", "inherit"],
    },
  );
  const replies: TimedReply[] = [];
  const send = (message: unknown) =>
    child.stdin.write(JSON.stringify(message) + "\n");
  createInterface({ input: child.stdout }).on("line", (line) => {
    const value: Reply = JSON.parse(line);
    replies.push({ value, at: performance.now() });
    if (value.ready) send({ type: "activate", windowId: value.windowId });
  });
  return { child, replies, send };
}

function sendState(
  runtime: ReturnType<typeof launch>,
  revision: number,
  phase: "hidden" | "recording",
) {
  runtime.send({
    type: "state",
    capture: "record-startup-fixture",
    t3Eligible: false,
    view: {
      revision,
      phase,
      clock: "00:00",
      label: "Recording",
      warning: null,
      reducedMotion: true,
      draggable: false,
      actions: phase === "recording" ? controls : [],
    },
  });
}

export async function shutDown(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const ended = new Promise<void>((done) => child.once("close", () => done()));
  if (child.stdin) child.stdin.end();
  else child.kill();
  await Promise.race([ended, delay(1000, undefined, { ref: false })]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await ended;
  }
}

function span(name: string, start: number, end: number) {
  return { name, ...interval(start, end) };
}

function runtimeResources(pid: number) {
  const pending = [pid];
  const seen = new Set<number>();
  let cpuTicks = 0;
  let pssKiB = 0;
  for (const next of pending) {
    if (seen.has(next)) continue;
    seen.add(next);
    const path = `/proc/${next}`;
    try {
      const stat = readFileSync(join(path, "stat"), "utf8");
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      const memory = /^Pss:\s+(\d+) kB$/m.exec(
        readFileSync(join(path, "smaps_rollup"), "utf8"),
      );
      assert.ok(memory, "PSS missing from recording controls process");
      pssKiB += Number(memory[1]);
      cpuTicks += Number(fields[11]) + Number(fields[12]);
      for (const thread of readdirSync(join(path, "task"))) {
        try {
          const children = readFileSync(
            join(path, "task", thread, "children"),
            "utf8",
          );
          pending.push(
            ...children.trim().split(/\s+/).filter(Boolean).map(Number),
          );
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
    } catch (error) {
      if (
        next === pid ||
        !["ENOENT", "ESRCH"].includes(
          (error as NodeJS.ErrnoException).code ?? "",
        )
      )
        throw error;
    }
  }
  return { cpuTicks, pssKiB };
}

export async function attempt(
  setup: Setup,
  mode: "cold" | "warm",
  directory: string,
  display?: ReturnType<typeof watchDisplay>,
  probe: "score" | "diagnostic" | "prepare" = "score",
) {
  mkdirSync(directory, { mode: 0o700 });
  if (display)
    await until(
      () => (display.frames.at(-1)?.marker === null ? true : undefined),
      "hidden fixture",
    );
  const id = randomUUID();
  const profile = mkdtempSync(join(tmpdir(), "apparent-dev-pill-profile-"));
  let launched: ReturnType<typeof launch> | undefined;
  let spawned = 0;
  try {
    writeFileSync(join(profile, "config.json"), "{}", { mode: 0o600 });
    spawned = performance.now();
    const runtime = launch(setup, profile, probe === "diagnostic");
    launched = runtime;
    if (mode === "warm") {
      sendState(runtime, 1, "hidden");
      await until(
        () => runtime.replies.find(({ value }) => value.activated),
        "hidden activation",
      );
    }
    const revision = 2;
    const start = mode === "cold" ? spawned : performance.now();
    const sent = performance.now();
    sendState(runtime, revision, "recording");
    const observationLimitMs = probe === "prepare" ? 10_000 : 6000;
    const acknowledgement = () =>
      until(
        () =>
          runtime.replies.find(
            ({ value }) => value.revision === revision && value.frame,
          ),
        "revision-specific frame acknowledgement",
        observationLimitMs,
      );
    const [observed, ack] = await (async () => {
      if (display)
        return Promise.all([
          visibleFrame(display, sent, true, observationLimitMs),
          acknowledgement(),
        ]);
      const acknowledged = await acknowledgement();
      const delayed = watchDisplay();
      try {
        return [
          await visibleFrame(delayed, acknowledged.at, false),
          acknowledged,
        ] as const;
      } finally {
        await shutDown(delayed.child);
      }
    })();
    const admitted = runtime.replies.find(({ value }) => value.ready);
    const activated = runtime.replies.find(({ value }) => value.activated);
    assert.ok(admitted?.value.windowId && activated && observed.frame.marker);
    const { x, y } = observed.frame.marker;
    execFileSync("xdotool", ["mousemove", String(x), String(y), "click", "1"], {
      timeout: 1000,
    });
    const finish = await until(
      () =>
        runtime.replies.find(
          ({ value }) =>
            value.revision === revision && value.action === "finish",
        ),
      "Finish command",
    );
    assert.ok(runtime.child.pid);
    const resources = runtimeResources(runtime.child.pid);
    const raw = join(directory, "visible.rgb");
    writeFileSync(raw, observed.frame.bytes, { mode: 0o600 });
    const end = observed.frame.at;
    return {
      id,
      mode,
      rawMs: display ? end - start : null,
      inputToAckMs: ack.at - start,
      resources,
      visible: {
        rgb: raw,
        width,
        height,
        top,
        x,
        y,
        sha256: createHash("sha256").update(observed.frame.bytes).digest("hex"),
        sampleGapMs: observed.gap,
        finishRevision: finish.value.revision,
        evidenceBytes: observed.frame.bytes.length,
      },
      spans: [
        ...(display ? [span("verified-visible-controls", start, end)] : []),
        span("spawn-to-window-ready", spawned, admitted.at),
        span("fixture-window-activation-roundtrip", admitted.at, activated.at),
        span("recording-state-to-host-frame-ack", sent, ack.at),
        span("verified-finish-command", end, finish.at),
      ],
      criticalPath: display
        ? {
            inputToFramebufferMs: end - start,
            hostFrameAckRelativeToFramebufferMs: ack.at - end,
            unattributedAfterAckMs: Math.max(0, end - ack.at),
            windowReadinessStateOverlapMs: Math.max(
              0,
              Math.min(admitted.at, ack.at, end) - sent,
            ),
          }
        : null,
    };
  } catch (error) {
    writeFileSync(
      join(directory, "failure.json"),
      JSON.stringify({
        id,
        mode,
        diagnostic: probe !== "score",
        probe,
        reason: error instanceof Error ? error.message : String(error),
        replyTimeline: (launched?.replies ?? []).map(({ value, at }) => ({
          elapsedMs: at - spawned,
          ready: value.ready,
          activated: value.activated,
          revision: value.revision,
          frame: Boolean(value.frame),
        })),
        sampleCount: display?.frames.length ?? 0,
        visibleMarkerObserved:
          display?.frames.some(({ marker }) => marker) ?? false,
        childExitCode: launched?.child.exitCode ?? null,
        childSignal: launched?.child.signalCode ?? null,
      }),
      { mode: 0o600 },
    );
    throw error;
  } finally {
    try {
      if (launched) await shutDown(launched.child);
    } finally {
      rmSync(profile, { recursive: true, force: true });
    }
  }
}
