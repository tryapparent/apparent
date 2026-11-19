import quiet, {
  type BendSpan,
  type Clock,
  type Spans,
} from "./quiet-export.mjs";

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
const WORD = 0xffff_ffffn;
const UNIT = { $: "Unit" } as const;
const kinds = new Set(["event", "stroke", "mark", "transcript", "cursor"]);

function clock(value: bigint): Clock {
  if (typeof value !== "bigint" || value < 0n || value > MAXIMUM)
    throw Error("Invalid quiet-export clock");
  return { $: "Clock", hi: Number(value >> 32n), lo: Number(value & WORD) };
}

function milliseconds(value: Clock): bigint {
  return (BigInt(value.hi) << 32n) | BigInt(value.lo);
}

function span(start: bigint, end: bigint): BendSpan {
  return { $: "Span", start: clock(start), end: clock(end) };
}

function list(values: readonly BendSpan[]): Spans {
  let tail: Spans = { $: "Nil" };
  for (let index = values.length - 1; index >= 0; index--)
    tail = { $: "Con", head: values[index], tail };
  return tail;
}

function observations(values: readonly Span[], duration: Clock): Spans {
  if (!Array.isArray(values)) throw Error("Invalid quiet-export observations");
  const spans = list(
    values.map((value) => {
      if (!Array.isArray(value) || value.length !== 2)
        throw Error("Invalid quiet-export observations");
      return span(value[0], value[1]);
    }),
  );
  if (!quiet.observations_valid(spans, duration, true))
    throw Error("Invalid quiet-export observation extent");
  return spans;
}

export function quietParameters(): QuietParameters {
  const settings = quiet.quiet_parameters(UNIT);
  return {
    freezeNoiseDb: -settings.freeze_db_magnitude,
    freezeDurationMs: settings.freeze_ms,
    silenceNoiseDb: -settings.silence_db_magnitude,
    silenceDurationMs: settings.silence_ms,
  };
}

export function planQuietExport(facts: QuietFacts): QuietInterval[] {
  const duration = clock(facts.durationMs);
  const offset = clock(facts.videoOffsetMs);
  const { maximumIntervals, supportedRate } = facts.limits;
  for (const value of [maximumIntervals, supportedRate])
    if (!Number.isInteger(value) || value < 0 || value > Number(WORD))
      throw Error("Unsupported native retiming limits");
  if (!quiet.limits_valid(maximumIntervals, supportedRate))
    throw Error("Unsupported native retiming limits");

  const frozen = observations(facts.frozen, duration);
  const silent = observations(facts.silent, duration);
  const timeline = list(
    facts.timeline.map((item) => {
      if (!kinds.has(item.kind)) throw Error("Invalid quiet-export timeline");
      return span(item.startMs, item.endMs);
    }),
  );
  const rate = quiet.quiet_rate(UNIT);
  let plan = quiet.plan_quiet_export(
    frozen,
    silent,
    timeline,
    offset,
    maximumIntervals,
  );
  const intervals: QuietInterval[] = [];
  while (plan.$ === "Con") {
    intervals.push({
      startMs: milliseconds(plan.head.start),
      endMs: milliseconds(plan.head.end),
      rate,
    });
    plan = plan.tail;
  }
  return intervals;
}
