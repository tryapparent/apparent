import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import policy from "./video-plan.mjs";

export { policy };

type Entry = Record<string, unknown>;
export type Shot = {
  file: string;
  atMs?: number;
  fromMs?: number;
  toMs?: number;
  label?: string;
  box?: [number, number, number, number];
  boxPixels?: [number, number, number, number];
};

type Cue = { text: string; startMs?: number };
export type Scene = { shots: Shot[]; say: Cue[]; holdMs: number };
export type Plan = { scenes: Scene[] };

export function readPlan(path: string) {
  const file = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const limit = 128 * 1024;
    const stat = fstatSync(file);
    if (!stat.isFile() || stat.size > limit)
      throw Error("Plan must be a regular JSON file up to 128 KiB.");
    const contents = Buffer.alloc(limit + 1);
    let offset = 0;
    while (offset < contents.length) {
      const count = readSync(
        file,
        contents,
        offset,
        contents.length - offset,
        null,
      );
      if (count === 0) break;
      offset += count;
    }
    if (offset > limit) throw Error("Plan exceeds 128 KiB.");
    return JSON.parse(contents.subarray(0, offset).toString("utf8")) as unknown;
  } finally {
    closeSync(file);
  }
}

function object(value: unknown, fields: string[], where: string): Entry {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error(`${where}: expected an object.`);
  const entry = value as Entry;
  for (const key of Object.keys(entry))
    if (!fields.includes(key)) throw Error(`${where}: unknown field "${key}".`);
  return entry;
}

function string(value: unknown, length: number, where: string) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    [...value].length > length ||
    /\p{Cc}/u.test(value)
  )
    throw Error(
      `${where}: expected 1–${length} plain-text characters on one line.`,
    );
  return value.trim();
}

function milliseconds(
  value: unknown,
  max: number,
  where: string,
): number | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > max
  )
    throw Error(`${where}: expected whole milliseconds from 0 to ${max}.`);
  return value;
}

function shot(value: unknown, directory: string, where: string): Shot {
  const entry = object(
    value,
    ["file", "atMs", "fromMs", "toMs", "label", "box", "boxPixels"],
    where,
  );
  const file = string(entry.file, 4096, `${where}.file`);
  const atMs = milliseconds(entry.atMs, 3_600_000, `${where}.atMs`);
  const fromMs = milliseconds(entry.fromMs, 3_600_000, `${where}.fromMs`);
  const toMs = milliseconds(entry.toMs, 3_600_000, `${where}.toMs`);
  if (
    (fromMs === undefined) !== (toMs === undefined) ||
    (atMs !== undefined && fromMs !== undefined)
  )
    throw Error(
      `${where}: use atMs for a freeze frame or fromMs and toMs for a clip.`,
    );
  const label =
    entry.label === undefined
      ? undefined
      : string(entry.label, 36, `${where}.label`);
  if (entry.box !== undefined && entry.boxPixels !== undefined)
    throw Error(`${where}: choose box or boxPixels.`);
  let boxPixels: Shot["boxPixels"];
  if (entry.boxPixels !== undefined) {
    if (
      !Array.isArray(entry.boxPixels) ||
      entry.boxPixels.length !== 4 ||
      !entry.boxPixels.every(
        (v) =>
          typeof v === "number" &&
          Number.isSafeInteger(v) &&
          v >= 0 &&
          v <= 7680,
      )
    )
      throw Error(
        `${where}.boxPixels: use source pixels as [left, top, width, height].`,
      );
    boxPixels = entry.boxPixels as Shot["boxPixels"];
  }
  let box: Shot["box"];
  if (entry.box !== undefined) {
    const [x, y, w, h] = Array.isArray(entry.box) ? entry.box : [];
    if (
      !Array.isArray(entry.box) ||
      entry.box.length !== 4 ||
      !entry.box.every(
        (v) => typeof v === "number" && Number.isFinite(v) && v >= 0,
      ) ||
      w <= 0 ||
      h <= 0 ||
      x + w > 1 ||
      y + h > 1
    )
      throw Error(
        `${where}.box: use [left, top, width, height] as fractions inside the full source frame.`,
      );
    box = [x, y, w, h];
  }
  return {
    file: isAbsolute(file) ? file : resolve(directory, file),
    atMs,
    fromMs,
    toMs,
    label,
    box,
    boxPixels,
  };
}

function spoken(value: unknown, where: string): Cue {
  if (typeof value === "string") return { text: string(value, 108, where) };
  const entry = object(value, ["text", "startMs"], where);
  return {
    text: string(entry.text, 108, `${where}.text`),
    startMs: milliseconds(entry.startMs, 179_999, `${where}.startMs`),
  };
}

export function parsePlan(value: unknown, directory: string): Plan {
  const plan = object(value, ["version", "scenes"], "Plan");
  if (plan.version !== 1) throw Error("Plan.version must be 1.");
  if (
    !Array.isArray(plan.scenes) ||
    plan.scenes.length < 1 ||
    plan.scenes.length > 20
  )
    throw Error("Plan.scenes needs 1–20 scenes.");
  return {
    scenes: plan.scenes.map((value, index) => {
      const where = `Scene ${index + 1}`;
      const scene = object(value, ["shots", "say", "holdMs"], where);
      if (
        !Array.isArray(scene.shots) ||
        scene.shots.length < 1 ||
        scene.shots.length > 2
      )
        throw Error(
          `${where}.shots: use one full-frame source or two for a comparison.`,
        );
      if (
        !Array.isArray(scene.say) ||
        scene.say.length < 1 ||
        scene.say.length > 6
      )
        throw Error(`${where}.say: use an array of 1–6 short spoken captions.`);
      return {
        shots: scene.shots.map((value, i) =>
          shot(value, directory, `${where}, shot ${i + 1}`),
        ),
        say: scene.say.map((value, i) =>
          spoken(value, `${where}, caption ${i + 1}`),
        ),
        holdMs: milliseconds(scene.holdMs, 10_000, `${where}.holdMs`) ?? 450,
      };
    }),
  };
}
