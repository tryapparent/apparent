export interface QuietParameters {
  freezeNoiseDb: number;
  freezeDurationMs: number;
  silenceNoiseDb: number;
  silenceDurationMs: number;
}
export type Span = readonly [bigint, bigint];
export interface TimelineItem {
  kind: "event" | "stroke" | "mark" | "transcript" | "cursor";
  startMs: bigint;
  endMs: bigint;
}
export interface QuietFacts {
  durationMs: bigint;
  videoOffsetMs: bigint;
  frozen: readonly Span[];
  silent: readonly Span[];
  timeline: readonly TimelineItem[];
  limits: { maximumIntervals: number; supportedRate: number };
}
export interface QuietInterval {
  startMs: bigint;
  endMs: bigint;
  rate: number;
}
const MAXIMUM = 0xffff_ffff_ffff_ffffn;
const RATE = 4;
const kinds = new Set(["event", "stroke", "mark", "transcript", "cursor"]);
const subtract = (a: bigint, b: bigint) => (a > b ? a - b : 0n);
const add = (a: bigint, b: bigint) => (a > MAXIMUM - b ? MAXIMUM : a + b);
const minimum = (a: bigint, b: bigint) => (a < b ? a : b);
const maximum = (a: bigint, b: bigint) => (a > b ? a : b);
function clock(value: bigint) {
  if (typeof value !== "bigint" || value < 0n || value > MAXIMUM)
    throw Error("Invalid quiet-export clock");
}

export function quietParameters(): QuietParameters {
  return {
    freezeNoiseDb: -60,
    freezeDurationMs: 12_000,
    silenceNoiseDb: -55,
    silenceDurationMs: 1000,
  };
}

export function planQuietExport(facts: QuietFacts): QuietInterval[] {
  clock(facts.durationMs);
  clock(facts.videoOffsetMs);
  if (
    !Number.isInteger(facts.limits.maximumIntervals) ||
    facts.limits.maximumIntervals < 1 ||
    facts.limits.maximumIntervals > 64 ||
    facts.limits.supportedRate !== RATE
  )
    throw Error("Unsupported native retiming limits");
  for (const spans of [facts.frozen, facts.silent]) {
    if (!Array.isArray(spans)) throw Error("Invalid quiet-export observations");
    for (const span of spans) {
      if (!Array.isArray(span) || span.length !== 2)
        throw Error("Invalid quiet-export observations");
      clock(span[0]);
      clock(span[1]);
      if (span[1] > facts.durationMs)
        throw Error("Invalid quiet-export observation extent");
    }
  }
  const protectedSpans: Span[] = facts.timeline.map((item) => {
    if (!kinds.has(item.kind)) throw Error("Invalid quiet-export timeline");
    clock(item.startMs);
    clock(item.endMs);
    return [
      subtract(subtract(item.startMs, facts.videoOffsetMs), 2000n),
      add(subtract(item.endMs, facts.videoOffsetMs), 5000n),
    ];
  });
  const intervals: QuietInterval[] = [];
  for (const [a, b] of facts.frozen)
    for (const [c, d] of facts.silent) {
      const start = add(maximum(a, c), 5000n),
        end = subtract(minimum(b, d), 5000n);
      let pieces: Span[] = [[start, end]];
      for (const [p, q] of protectedSpans)
        pieces = pieces.flatMap(([x, y]): Span[] =>
          p >= y || q <= x
            ? [[x, y]]
            : [
                [x, maximum(p, x)],
                [minimum(q, y), y],
              ],
        );
      for (const [startMs, endMs] of pieces)
        if (subtract(endMs, startMs) >= 10_000n)
          intervals.push({ startMs, endMs, rate: RATE });
    }
  intervals.sort((a, b) =>
    a.startMs < b.startMs ? -1 : a.startMs > b.startMs ? 1 : 0,
  );
  return intervals.slice(0, facts.limits.maximumIntervals);
}
