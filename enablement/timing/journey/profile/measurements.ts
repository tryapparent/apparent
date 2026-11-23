import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { Interval } from "../../../../shared/enablement/performance/measurement.ts";
import type { Part, RunIdentity } from "../assemble.ts";
import { contract, phaseFields, type Receipt } from "../score.ts";

type Scope = "host" | "guest";
type Clock = "host-monotonic" | "guest-monotonic" | "guest-boottime";
type Source = { file: string; sha256: string; clock: Clock };
export type MeasurementEvidence = { schema: 1; traces: Source[] };

type Event = {
  name: string;
  cat?: string;
  ph: "X" | "C";
  ts: number;
  dur?: number;
  pid: number;
  tid: number;
  args?: { value: number };
};

const category = "apparent.benchmark";
const labelPattern = /^[a-z0-9-]+$/;
const hash = (data: Buffer | string) =>
  createHash("sha256").update(data).digest("hex");
const readClock = (span: Interval, scope: Scope): Clock => {
  if (span.clock === "host") return "host-monotonic";
  if (span.clock === "guest-boottime") return span.clock;
  assert.equal(span.clock, "observer", "Unknown checkpoint clock");
  return scope === "host" ? "host-monotonic" : "guest-monotonic";
};
const countSegments = (id: string) =>
  id === "pill" || id === "live" ? [2, 2] : id === "ink" ? [1, 1] : [1];
function spanDuration(span: Interval) {
  assert(
    Number.isSafeInteger(span.startUs) &&
      span.startUs >= 0 &&
      Number.isSafeInteger(span.endUs) &&
      span.endUs > span.startUs,
    "Invalid checkpoint endpoints",
  );
  return span.endUs - span.startUs;
}

function sampleNames(id: string) {
  return countSegments(id).map((count, trial) =>
    Array.from(
      { length: count },
      (_, segment) => `wait/${id}/${trial}/${segment}`,
    ),
  );
}

type RecordingCounter = "bundleBytes" | "peakScratchBytes" | "wordErrorRate";
function resourceKeys(id: string): RecordingCounter[] {
  return [
    "bundleBytes",
    "peakScratchBytes",
    ...(contract.captureFixtures[id]?.audio === "spoken"
      ? ["wordErrorRate"]
      : []),
  ];
}

function identityName(run: RunIdentity, clock: Clock) {
  return (
    "run/" + hash(JSON.stringify([run.runId, run.revision, run.runner, clock]))
  );
}

export async function writeMeasurementTraces(
  directory: string,
  identity: RunIdentity,
  fragments: { label: string; part: Part; scope: Scope }[],
): Promise<MeasurementEvidence> {
  const traces: Source[] = [];
  for (const { label, part, scope } of fragments) {
    assert(labelPattern.test(label), "Invalid trace fragment label");
    const groups = new Map<Clock, Event[]>();
    function add(clock: Clock, event: Omit<Event, "pid" | "tid">) {
      const events = groups.get(clock) ?? [];
      events.push({ ...event, pid: 1, tid: events.length + 1 });
      groups.set(clock, events);
    }
    for (const [id, wait] of Object.entries(part.waits ?? {})) {
      assert(wait.verified === true, "Unverified checkpoint " + id);
      const expected = sampleNames(id);
      const intervals = wait.intervals;
      assert.deepEqual(
        intervals?.map((group) => group.length),
        countSegments(id),
        "Missing measured endpoints for " + id,
      );
      assert(intervals);
      let totalUs = 0;
      for (const [trial, group] of intervals.entries()) {
        for (const [segment, span] of group.entries()) {
          const dur = spanDuration(span);
          totalUs += dur;
          add(readClock(span, scope), {
            name: expected[trial][segment],
            cat: category,
            ph: "X",
            ts: span.startUs,
            dur,
          });
        }
      }
      assert(
        Math.abs(totalUs / intervals.length / 1000 - wait.ms) <= 1.01,
        "Trace endpoints disagree with the verified probe for " + id,
      );
    }
    for (const [id, metrics] of Object.entries(part.resources ?? {})) {
      const bounds = part.resourceIntervals?.[id];
      assert(bounds, "Missing recording phase bounds for " + id);
      assert.equal(bounds.recording.endUs, bounds.finalization.startUs);
      const counter = (key: string, value: unknown, span: Interval) => {
        assert(
          typeof value === "number" && Number.isFinite(value) && value >= 0,
          "Missing recording counter " + id + "/" + key,
        );
        add(readClock(span, scope), {
          name: `resource/${id}/${key}`,
          ph: "C",
          ts: span.endUs,
          args: { value },
        });
      };
      for (const phase of ["recording", "finalization"] as const) {
        const span = bounds[phase];
        const dur = spanDuration(span);
        add(readClock(span, scope), {
          name: `phase/${id}/${phase}`,
          cat: category,
          ph: "X",
          ts: span.startUs,
          dur,
        });
        for (const key of phaseFields)
          counter(phase + "/" + key, metrics[phase][key], span);
      }
      for (const key of resourceKeys(id))
        counter(key, metrics[key], bounds.finalization);
    }
    for (const [clock, traceEvents] of groups) {
      const ts = Math.min(...traceEvents.map((event) => event.ts));
      traceEvents.push({
        name: identityName(identity, clock),
        cat: category,
        ph: "X",
        ts,
        dur: 1,
        pid: 1,
        tid: 0,
      });
      const data = JSON.stringify({ traceEvents });
      const file = join(directory, label + "-" + clock + ".trace.json");
      await writeFile(file, data, { flag: "wx", mode: 0o600 });
      traces.push({ file, sha256: hash(data), clock });
    }
  }
  return { schema: 1, traces };
}

const query =
  "SELECT 'slice' AS kind, name, printf('%!.17g',dur/1000000.0) AS value " +
  "FROM slice WHERE category='apparent.benchmark' UNION ALL " +
  "SELECT 'counter',counter_track.name,printf('%!.17g',value) FROM counter " +
  "JOIN counter_track ON counter.track_id=counter_track.id";

export async function readMeasurements(
  receipt: Receipt,
  traceProcessor: string,
): Promise<Receipt> {
  const evidence = receipt.measurementEvidence;
  assert(
    evidence?.schema === 1 && evidence.traces.length > 0,
    "Scoring requires verified Perfetto measurement traces",
  );
  const spans = new Map<string, number>();
  const counters = new Map<string, number>();
  const files = new Set<string>();
  for (const source of evidence.traces) {
    assert(
      isAbsolute(source.file) && !files.has(source.file),
      "Invalid measurement trace path",
    );
    files.add(source.file);
    assert.equal(
      hash(await readFile(source.file)),
      source.sha256,
      "Perfetto measurement trace digest mismatch",
    );
    const result = execFileSync(
      traceProcessor,
      ["query", "--format", "csv", source.file, query],
      { encoding: "utf8", timeout: 120000, stdio: ["ignore", "pipe", "pipe"] },
    )
      .trim()
      .split(/\r?\n/);
    assert.equal(result.shift(), '"kind","name","value"');
    let identity = false;
    for (const row of result) {
      const match =
        /^"(slice|counter)","([a-zA-Z0-9/_ -]+)","([0-9eE.+-]+)"$/.exec(row);
      assert(match, "Unexpected Trace Processor result");
      const [, kind, name, text] = match;
      const value = Number(text);
      assert(
        Number.isFinite(value) && value >= 0,
        "Invalid measurement from Perfetto",
      );
      if (name.startsWith("run/")) {
        assert(
          kind === "slice" &&
            !identity &&
            name === identityName(receipt, source.clock),
          "Perfetto trace belongs to a different run",
        );
        identity = true;
        continue;
      }
      const target = kind === "slice" ? spans : counters;
      const key = kind === "slice" ? name : name.replace(/ value$/, "");
      assert(!target.has(key), "Duplicate Perfetto metric " + key);
      target.set(key, value);
    }
    assert(identity, "Perfetto trace is missing its run identity");
  }
  const lookup = (set: Map<string, number>, name: string) => {
    const value = set.get(name);
    assert(value !== undefined, "Missing Perfetto metric " + name);
    set.delete(name);
    return value;
  };
  const waits: Receipt["waits"] = Object.fromEntries(
    Object.entries(receipt.waits).map(([id, wait]) => {
      assert(wait.verified === true, "Unverified checkpoint " + id);
      const samples = sampleNames(id);
      const ms =
        samples.flat().reduce((sum, key) => sum + lookup(spans, key), 0) /
        samples.length;
      assert(ms > 0, "Invalid Perfetto checkpoint duration");
      return [id, { ms, verified: true }];
    }),
  );
  const resources: Receipt["resources"] = {};
  for (const [id, resource] of Object.entries(receipt.resources)) {
    assert(resource.outputVerified === true, "Unverified output " + id);
    const entry = (resources[id] = { ...resource });
    for (const phase of ["recording", "finalization"] as const) {
      assert(
        lookup(spans, `phase/${id}/${phase}`) > 0,
        "Invalid recording phase duration",
      );
      entry[phase] = { ...entry[phase] };
      for (const key of phaseFields)
        entry[phase][key] = lookup(counters, `resource/${id}/${phase}/${key}`);
    }
    for (const key of resourceKeys(id))
      entry[key] = lookup(counters, `resource/${id}/${key}`);
  }
  assert(
    spans.size === 0 && counters.size === 0,
    "Unexpected Perfetto metrics",
  );
  return { ...receipt, waits, resources };
}
