import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

type Span = {
  id: number;
  parent: number;
  name: string;
  startMs: number;
  endMs: number;
};
type Trace = {
  attempt: string;
  elapsedMs: number;
  dropped: number;
  spans: Span[];
};

const root = 2;
const prefix = "BENCH_FINISH_SPANS ";
const finiteTime = (value: number) => Number.isFinite(value) && value >= 0;

export function stopTimeline(log: string, attempt: string) {
  assert.match(attempt, /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i);
  const lines = log.split("\n");
  const traceLines = lines.filter((line) => line.startsWith(prefix));
  assert.equal(
    traceLines.length,
    1,
    "Expected one timestamped finalizer attempt",
  );
  const trace: Trace = JSON.parse(traceLines[0].slice(prefix.length));
  assert.equal(trace.attempt, attempt);
  assert.equal(trace.dropped, 0);
  assert.ok(finiteTime(trace.elapsedMs) && trace.elapsedMs > 0);
  assert.ok(
    Array.isArray(trace.spans) &&
      trace.spans.length > 0 &&
      trace.spans.length <= 128,
  );

  const timers = lines.flatMap((line) => {
    const match = /^BENCH_FINISH runs_ms=\[([\d.]+)\] median_ms=([\d.]+)$/.exec(
      line,
    );
    return match ? [Number(match[1])] : [];
  });
  assert.equal(timers.length, 1);
  const finishMs = timers[0];
  assert.ok(
    finiteTime(finishMs) && finishMs > 0 && finishMs + 0.051 >= trace.elapsedMs,
  );
  const finishBound = Math.max(finishMs, trace.elapsedMs);
  const byId = new Map<number, Span>();
  for (const span of trace.spans) {
    assert.ok(
      Number.isSafeInteger(span.id) && span.id > root && !byId.has(span.id),
    );
    assert.ok(
      Number.isSafeInteger(span.parent) &&
        span.parent >= root &&
        span.parent < span.id,
    );
    assert.match(span.name, /^recording\.[a-z_.]+$/);
    assert.ok(finiteTime(span.startMs) && finiteTime(span.endMs));
    assert.ok(span.endMs >= span.startMs && span.endMs <= trace.elapsedMs);
    byId.set(span.id, span);
  }
  for (const span of trace.spans) {
    if (span.parent === root) continue;
    const parent = byId.get(span.parent);
    assert.ok(
      parent && parent.startMs <= span.startMs && span.endMs <= parent.endMs,
    );
  }
  const edges = [
    ...new Set([
      0,
      trace.elapsedMs,
      finishBound,
      ...trace.spans.flatMap((span) => [span.startMs, span.endMs]),
    ]),
  ].sort((a, b) => a - b);
  let coveredMs = 0;
  let parallelMs = 0;
  const partition = edges.slice(1).map((endMs, i) => {
    const startMs = edges[i];
    const active = trace.spans.filter(
      (span) => span.startMs <= startMs && span.endMs >= endMs,
    );
    const nestedParents = new Set(active.map((span) => span.parent));
    const deepest = active.filter((span) => !nestedParents.has(span.id));
    const durationMs = endMs - startMs;
    if (deepest.length) coveredMs += durationMs;
    if (deepest.length > 1) parallelMs += durationMs;
    return { startMs, endMs, activeIds: deepest.map((span) => span.id) };
  });

  const build = trace.spans.find(
    (span) => span.name === "recording.bundle.build",
  );
  const prerequisiteNames = new Set([
    "recording.transcribe",
    "recording.visuals.prepare",
    "recording.frames.decode",
    "recording.publication.sync",
  ]);
  const prerequisites = build
    ? trace.spans
        .filter(
          (span) =>
            prerequisiteNames.has(span.name) && span.endMs <= build.startMs,
        )
        .sort((left, right) => right.endMs - left.endMs)
    : [];
  const lastMeasured = prerequisites[0];
  return {
    attempt,
    appClock: "Replay cutoff",
    finishMs,
    finalizerReturnMs: trace.elapsedMs,
    coveredMs,
    parallelMs,
    unattributedMs: Math.max(0, finishBound - coveredMs),
    lastMeasuredPrerequisite:
      build && lastMeasured
        ? {
            name: lastMeasured.name,
            finishedAtMs: lastMeasured.endMs,
            bundleBuildAtMs: build.startMs,
            gapMs: build.startMs - lastMeasured.endMs,
          }
        : null,
    partition,
    spans: [...trace.spans].sort(
      (left, right) => left.startMs - right.startMs || left.id - right.id,
    ),
  };
}

if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const [log, attempt] = process.argv.slice(2);
  assert.ok(log && attempt, "Usage: stop-timeline.ts REPROCESS_LOG ATTEMPT_ID");
  console.log(
    JSON.stringify(stopTimeline(readFileSync(log, "utf8"), attempt), null, 2),
  );
}
