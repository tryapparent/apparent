import { createHash } from "node:crypto";
import { appendFileSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { interval } from "../../../shared/enablement/performance/measurement.ts";
import { waitForQuietStart } from "./fixtures/host-pressure.ts";
import type { InkEvidence } from "./ink.ts";

type Qmp = {
  ready(deadline: number): Promise<void>;
  command(command: string, args: object, deadline: number): Promise<unknown>;
  close(): void;
};

const width = 1280;
const height = 800;
const markers = [
  [144, 200],
  [144, 400],
  [500, 154],
  [1000, 645],
  [1135, 350],
  [600, 224],
  [330, 410],
  [600, 610],
];
const maxSampleGapMs = 200;

function scan(path: string) {
  const pixels = readFileSync(path);
  const header = /^P6\n1280 800\n255\n/.exec(
    pixels.subarray(0, 64).toString("ascii"),
  );
  if (!header || pixels.length !== header[0].length + width * height * 3)
    throw Error("Expected a complete 1280 by 800 VM framebuffer");
  const offset = header[0].length;
  const pixel = (x: number, y: number) => offset + (width * y + x) * 3;
  let pickerMarkers = 0;
  for (const [x, y] of markers) {
    const i = pixel(x, y);
    if (pixels[i] === 122 && pixels[i + 1] === 162 && pixels[i + 2] === 247)
      pickerMarkers++;
  }
  let purple = 0;
  let dark = 0;
  let recordingRed = 0;
  for (let y = 38; y < 76; y += 2) {
    for (let x = 555; x < 840; x += 2) {
      const i = pixel(x, y);
      const [r, g, b] = [pixels[i], pixels[i + 1], pixels[i + 2]];
      if (r > 130 && g > 100 && b > r + 10 && r > g + 8) purple++;
      if (r < 65 && g < 65 && b < 78) dark++;
    }
  }
  for (let y = 44; y < 88; y++) {
    for (let x = 160; x < 810; x++) {
      const i = pixel(x, y);
      const [r, g, b] = [pixels[i], pixels[i + 1], pixels[i + 2]];
      if (r > 160 && r > g + 36 && r > b + 21) recordingRed++;
    }
  }
  return {
    observation: { pickerMarkers, purple, dark, recordingRed },
    digest: () => createHash("sha256").update(pixels).digest("hex"),
  };
}

type Frame = ReturnType<typeof scan>["observation"];
const pickerVisible = (frame: Frame) => frame.pickerMarkers === markers.length;
const pillVisible = (before: Frame, after: Frame) =>
  !pickerVisible(after) &&
  (after.recordingRed >= before.recordingRed + 12 ||
    (after.purple > before.purple + 80 && after.dark > before.dark + 300));
const keyEvent = (code: string, down: boolean) => ({
  type: "key",
  data: { down, key: { type: "qcode", data: code } },
});
const button = (down: boolean) => ({
  type: "btn",
  data: { down, button: "left" },
});
type GuestCommand = (command: string) => string;

async function captureFrame(qmp: Qmp, path: string) {
  await qmp.command("screendump", { filename: path }, performance.now() + 1000);
  return { ...scan(path), at: performance.now() };
}

function input(qmp: Qmp, events: object[]) {
  return qmp.command("input-send-event", { events }, performance.now() + 1000);
}

function verifyOutput(ssh: GuestCommand) {
  const instances = JSON.parse(ssh("hyprctl -j instances"));
  if (
    !Array.isArray(instances) ||
    instances.length !== 1 ||
    !/^[a-z0-9_]+$/i.test(instances[0].instance)
  )
    throw Error("Expected one dedicated guest compositor");
  const command = "hyprctl -i " + instances[0].instance + " -j ";
  const outputs = JSON.parse(ssh(command + "monitors"));
  const display = outputs[0];
  if (
    outputs.length !== 1 ||
    display.name !== "Virtual-1" ||
    display.width !== width ||
    display.height !== height ||
    display.scale !== 1 ||
    display.transform !== 0 ||
    display.x !== 0 ||
    display.y !== 0 ||
    display.disabled
  ) {
    throw Error("Expected the qualified disposable VM output");
  }
  const cursor = JSON.parse(ssh(command + "cursorpos"));
  if (!(cursor.x > 350 && cursor.x < 930 && cursor.y > 245 && cursor.y < 590))
    throw Error("Pointer is outside the synthetic output preview");
  return { name: display.name, x: cursor.x, y: cursor.y };
}

async function confirm(
  qmp: Qmp,
  signal: AbortSignal,
  at: (value: number) => void,
  pressed?: (value: number) => void,
) {
  type Mouse = {
    name: string;
    absolute: boolean;
    index: number;
    current: boolean;
  };
  const mice = (await qmp.command(
    "query-mice",
    {},
    performance.now() + 1000,
  )) as Mouse[];
  const relative = mice.filter(
    (mouse) => /^QEMU (USB|HID) Mouse$/.test(mouse.name) && !mouse.absolute,
  );
  const prior = mice.find((mouse) => mouse.current);
  if (relative.length !== 1 || !prior)
    throw Error("Expected the qualified relative input device");
  const select = (index: number) =>
    qmp.command(
      "human-monitor-command",
      { "command-line": "mouse_set " + index },
      performance.now() + 1000,
    );
  const changed = prior.index !== relative[0].index;
  if (changed) await select(relative[0].index);
  try {
    signal.throwIfAborted();
    pressed?.(performance.now());
    await input(qmp, [button(true)]);
    await sleep(35, undefined, { signal });
  } finally {
    at(performance.now());
    try {
      await input(qmp, [button(false)]);
    } finally {
      if (changed) await select(prior.index);
    }
  }
}

export async function qualifyPortal(
  root: string,
  qmp: Qmp,
  phase: () => string,
  signal: AbortSignal,
  ssh: GuestCommand,
) {
  const path = resolve(root, "warmup-frame.ppm");
  try {
    await qmp.ready(performance.now() + 3000);
    const deadline = performance.now() + 30_000;
    while (performance.now() < deadline) {
      const pending = phase();
      if (!/^(start|recording) portal-warmup$/.test(pending)) return;
      signal.throwIfAborted();
      const current = await captureFrame(qmp, path);
      if (pickerVisible(current.observation)) {
        const output = verifyOutput(ssh);
        const latest = await captureFrame(qmp, path);
        if (
          !/^(start|recording) portal-warmup$/.test(phase()) ||
          !pickerVisible(latest.observation)
        )
          throw Error("Synthetic warmup chooser changed before confirmation");
        await confirm(qmp, signal, () => {});
        console.log(
          JSON.stringify({
            action: "confirm-synthetic-warmup",
            output,
            sha256: latest.digest(),
          }),
        );
        rmSync(path);
        return;
      }
      await sleep(100, undefined, { signal });
    }
    throw Error("Synthetic warmup chooser never qualified");
  } finally {
    qmp.close();
  }
}

function measured(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function verifiedStart(row: {
  source?: string;
  selection?: "skipped";
  ms?: number;
  output?: { name?: string; x?: number; y?: number };
  before: Frame;
  confirmation?: Frame;
  picker?: { ms: number; sampleGapMs: number; frame: Frame; sha256: string };
  pill: { ms: number; sampleGapMs: number; frame: Frame; sha256: string };
}) {
  const { source, ms, output, before, confirmation, picker, pill } = row;
  const step = (item: typeof pill) =>
    measured(item.ms) &&
    measured(item.sampleGapMs) &&
    item.sampleGapMs <= maxSampleGapMs &&
    /^[a-f0-9]{64}$/.test(item.sha256);
  const ready =
    source === "qmp-framebuffer-v1" &&
    output?.name === "Virtual-1" &&
    measured(output.x) &&
    output.x > 350 &&
    output.x < 930 &&
    measured(output.y) &&
    output.y > 245 &&
    output.y < 590 &&
    !pickerVisible(before) &&
    step(pill);
  if (row.selection === "skipped") {
    return (
      ready &&
      !picker &&
      !confirmation &&
      ms === pill.ms &&
      pillVisible(before, pill.frame)
    );
  }
  return (
    ready &&
    picker &&
    confirmation &&
    pickerVisible(confirmation) &&
    pickerVisible(picker.frame) &&
    pillVisible(confirmation, pill.frame) &&
    step(picker) &&
    ms === picker.ms + pill.ms
  );
}

export async function observeShortcut(
  name: string,
  root: string,
  qmp: Qmp,
  stage: () => string,
  signal: AbortSignal,
  ssh: GuestCommand,
  armMedia?: () => {
    connected: Promise<void>;
    finished: Promise<{ screenAt: number; microphoneAt: number }>;
    close(): void;
  },
  inkProbe?: (qmp: Qmp) => Promise<InkEvidence>,
  selection?: "skipped",
) {
  const path = resolve(root, name + "-scan.ppm");
  const dump = () => captureFrame(qmp, path);
  const observe = async (
    started: () => number,
    predicate: (frame: Frame) => boolean,
    observed: string,
    after?: (frame: Frame) => boolean,
  ) => {
    const end = performance.now() + 5000;
    while (!started() && performance.now() < end) await sleep(4);
    if (!started()) throw Error("Native action was not sent");
    let prior = started();
    type Sample = {
      at: number;
      ms: number;
      sampleGapMs: number;
      frame: Frame;
      sha256: string;
    };
    let first: Sample | undefined;
    let confirmed: Sample | undefined;
    let subsequent: Sample | undefined;
    while (performance.now() < end && stage() === "scenario") {
      signal.throwIfAborted();
      const frame = await dump();
      const sample = () => ({
        at: frame.at,
        ms: frame.at - started(),
        sampleGapMs: Math.max(1, Math.round(frame.at - prior)),
        frame: frame.observation,
        sha256: frame.digest(),
      });
      if (!confirmed && predicate(frame.observation)) {
        if (first) {
          confirmed = first;
          if (!after) return confirmed;
        } else {
          first = sample();
        }
      } else if (!confirmed) {
        first = undefined;
      }
      if (after?.(frame.observation)) {
        if (subsequent && confirmed)
          return { ...confirmed, redFinish: subsequent };
        subsequent ??= sample();
      } else {
        subsequent = undefined;
      }
      prior = frame.at;
      await sleep(12, undefined, { signal });
    }
    throw Error("Native framebuffer milestone was not observed: " + observed);
  };
  try {
    await qmp.ready(performance.now() + 3000);
    if (selection === "skipped") await waitForQuietStart(signal);
    const before = (await dump()).observation;
    if (pickerVisible(before))
      throw Error("Source picker was already open before the shortcut");
    let keyDown = 0;
    const shortcut = async () => {
      await input(qmp, [keyEvent("alt", true), keyEvent("shift", true)]);
      try {
        await sleep(25, undefined, { signal });
        keyDown = performance.now();
        await input(qmp, [keyEvent("s", true)]);
        await sleep(35, undefined, { signal });
      } finally {
        await input(qmp, [
          keyEvent("s", false),
          keyEvent("shift", false),
          keyEvent("alt", false),
        ]);
      }
    };
    const retain = (receipt: Parameters<typeof verifiedStart>[0]) => {
      if (!verifiedStart(receipt))
        throw Error("Invalid native Start observation");
      appendFileSync(
        resolve(root, "weighted-start-observations.jsonl"),
        JSON.stringify(receipt) + "\n",
        { mode: 0o600 },
      );
      rmSync(path);
      console.log(JSON.stringify(receipt));
    };
    if (selection === "skipped") {
      const output = verifyOutput(ssh);
      const media = armMedia?.();
      try {
        await media?.connected;
        const [pill, arrival] = await Promise.all([
          observe(
            () => keyDown,
            (frame) => pillVisible(before, frame),
            "recording pill and red Finish",
            (frame) =>
              frame.recordingRed >= before.recordingRed + 12 &&
              !pickerVisible(frame),
          ),
          media?.finished,
          shortcut(),
        ]);
        const live = arrival && {
          screenMs: arrival.screenAt - keyDown,
          microphoneMs: arrival.microphoneAt - keyDown,
          pillMs: pill.at - keyDown,
        };
        if (live && !Object.values(live).every(measured))
          throw Error("First media evidence preceded the recording shortcut");
        const receipt = {
          name,
          source: "qmp-framebuffer-v1",
          selection,
          output,
          before,
          pill,
          live,
          ms: pill.ms,
          intervals: {
            pill: [interval(keyDown, pill.at, "host")],
            live: arrival && [
              interval(
                keyDown,
                Math.max(pill.at, arrival.screenAt, arrival.microphoneAt),
                "host",
              ),
            ],
          },
        };
        retain(receipt);
      } finally {
        media?.close();
      }
      return;
    }
    const [picker] = await Promise.all([
      observe(() => keyDown, pickerVisible, "output picker"),
      shortcut(),
    ]);
    const output = verifyOutput(ssh);
    const confirmation = (await dump()).observation;
    if (stage() !== "scenario" || !pickerVisible(confirmation))
      throw Error("Synthetic chooser disappeared before confirmation");
    let release = 0;
    let press = 0;
    const media = armMedia?.();
    const [pill, arrival] = await (async () => {
      try {
        await media?.connected;
        return await Promise.all([
          observe(
            () => release,
            (frame) => pillVisible(confirmation, frame),
            "recording pill",
          ),
          media?.finished,
          confirm(
            qmp,
            signal,
            (at) => {
              release = at;
            },
            (at) => {
              press = at;
            },
          ),
        ]);
      } finally {
        media?.close();
      }
    })();
    const live = arrival && {
      screenMs: arrival.screenAt - press,
      microphoneMs: arrival.microphoneAt - press,
      pillMs: pill.ms + release - press,
    };
    if (live && !Object.values(live).every(measured))
      throw Error("First media evidence preceded the selected source");
    const ink = await inkProbe?.(qmp).catch((error) => {
      console.error("Ink readiness for " + name + ": " + String(error));
      return undefined;
    });
    const receipt = {
      name,
      source: "qmp-framebuffer-v1",
      output,
      before,
      confirmation,
      picker,
      pill,
      live,
      ink,
      intervals: {
        pill: [
          interval(keyDown, picker.at, "host"),
          interval(release, pill.at, "host"),
        ],
        live: arrival && [
          interval(keyDown, picker.at, "host"),
          interval(
            press,
            Math.max(arrival.screenAt, arrival.microphoneAt, pill.at),
            "host",
          ),
        ],
      },
      ms: picker.ms + pill.ms,
    };
    retain(receipt);
  } finally {
    qmp.close();
  }
}
