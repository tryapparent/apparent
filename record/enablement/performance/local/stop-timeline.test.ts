import assert from "node:assert/strict";
import { test } from "node:test";
import { stopTimeline } from "./stop-timeline.ts";

const attempt = "d279edcc-a112-4aa2-9bbb-e183e6d2f252";
const spans = [
  { id: 3, parent: 2, name: "recording.transcribe", startMs: 10, endMs: 49 },
  {
    id: 4,
    parent: 2,
    name: "recording.visuals.prepare",
    startMs: 20,
    endMs: 35,
  },
  { id: 5, parent: 4, name: "recording.frames.decode", startMs: 25, endMs: 30 },
  { id: 6, parent: 2, name: "recording.bundle.build", startMs: 50, endMs: 70 },
  {
    id: 7,
    parent: 6,
    name: "recording.artifacts.write",
    startMs: 55,
    endMs: 60,
  },
];
const frame = (overrides: Record<string, unknown> = {}) =>
  "BENCH_FINISH_SPANS " +
  JSON.stringify({
    attempt,
    spans,
    elapsedMs: 79,
    dropped: 0,
    ...overrides,
  });
const timer = "BENCH_FINISH runs_ms=[80.0] median_ms=80.0";

test("counts parallel work once and keeps uninstrumented time visible", () => {
  const receipt = stopTimeline(frame() + "\n" + timer, attempt);
  assert.equal(receipt.parallelMs, 15);
  assert.equal(receipt.coveredMs, 59);
  assert.equal(receipt.unattributedMs, 21);
  assert.deepEqual(receipt.lastMeasuredPrerequisite, {
    name: "recording.transcribe",
    finishedAtMs: 49,
    bundleBuildAtMs: 50,
    gapMs: 1,
  });
});

test("rejects traces that cannot establish an exact completed attempt", () => {
  for (const invalid of [
    frame({ dropped: 1 }),
    frame() + "\n" + frame(),
    frame({ spans: [{ ...spans[4], parent: 3 }] }),
    frame({ elapsedMs: 91 }),
    frame({ attempt: "f000edcc-a112-4aa2-9bbb-e183e6d2f252" }),
  ]) {
    assert.throws(() => stopTimeline(invalid + "\n" + timer, attempt));
  }
});
