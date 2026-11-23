import { createHash } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import {
  type Interval,
  interval,
} from "../../../shared/enablement/performance/measurement.ts";

const origin = { x: 430, y: 515 };
const prefix = Buffer.from("P6\n1280 800\n255\n");
type Frame = { pixels: number; at: number; sha256: string };

async function sample(
  path: string,
  dump: () => Promise<unknown>,
): Promise<Frame> {
  await dump();
  const at = performance.now();
  const image = await readFile(path);
  if (
    !image.subarray(0, prefix.length).equals(prefix) ||
    image.length !== prefix.length + 1280 * 800 * 3
  )
    throw Error("Expected the isolated framebuffer size");
  let pixels = 0;
  let columns = 0;
  for (let x = origin.x + 9; x <= origin.x + 115; x++) {
    let column = 0;
    for (let y = origin.y - 8; y <= origin.y + 8; y++) {
      const i = prefix.length + (1280 * y + x) * 3;
      if (image[i] >= 235 && image[i + 1] <= 82 && image[i + 2] <= 76) column++;
    }
    if (column >= 2) columns++;
    pixels += column;
  }
  return {
    pixels: columns >= 12 ? pixels : 0,
    at,
    sha256: createHash("sha256").update(image).digest("hex"),
  };
}

export type InkEvidence = {
  ms: number;
  gapMs: number;
  before: number;
  after: number;
  frame: string;
  interval?: Interval;
};

export function verifiedInk(value: InkEvidence) {
  return (
    Number.isFinite(value.ms) &&
    value.ms > 0 &&
    Number.isFinite(value.gapMs) &&
    value.gapMs > 0 &&
    value.gapMs <= 200 &&
    Number.isInteger(value.before) &&
    value.before < 10 &&
    Number.isInteger(value.after) &&
    value.after >= value.before + 24 &&
    /^[a-f0-9]{64}$/.test(value.frame)
  );
}

export async function observeInk(
  path: string,
  dump: () => Promise<unknown>,
  place: (position: typeof origin) => void,
  move: (first: () => void) => Promise<unknown>,
  signal: AbortSignal,
) {
  place(origin);
  const before = await sample(path, dump);
  if (before.pixels >= 10)
    throw Error("Synthetic ink area already contains the test pen colour");
  let started = 0;
  const input = move(() => {
    started = performance.now();
  });
  input.catch(() => {});
  const end = performance.now() + 3000;
  let previous = 0;
  let first: InkEvidence | undefined;
  try {
    while (performance.now() < end) {
      const frame = await sample(path, dump);
      if (started && frame.at > started && frame.pixels >= before.pixels + 24) {
        if (first) {
          await input;
          if (!verifiedInk(first)) throw Error("Unqualified ink paint");
          await rm(path);
          return first;
        }
        first = {
          ms: frame.at - started,
          gapMs: frame.at - Math.max(previous, started),
          before: before.pixels,
          after: frame.pixels,
          frame: frame.sha256,
          interval: interval(started, frame.at, "host"),
        };
      } else {
        first = undefined;
      }
      previous = frame.at;
      await delay(12, undefined, { signal });
    }
    throw Error("Did not observe an ink line behind the moving pointer");
  } finally {
    await input;
  }
}
