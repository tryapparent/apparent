import assert from "node:assert/strict";
import test from "node:test";
import { stopDecision, type Experiment } from "./stop.ts";
import { analyzeTrace } from "./trace.ts";

test("probe spans cover the observer wait without double-counting overlap", () => {
  const endpoint = {
    id: "attempt",
    pid: 4,
    startNs: "0",
    endNs: "20000000",
    stdoutBytes: 12,
  };
  const mark = (
    name: string,
    edge: "begin" | "end" | "at",
    ms: number,
    bytes = 0,
    tid = 4,
  ) => ({ name, edge, pid: 4, tid, ns: BigInt(ms * 1e6), bytes });
  const marks = [
    mark("exec", "at", 2),
    mark("elf-entry", "at", 4),
    mark("main", "begin", 5),
    mark("inspect", "begin", 6),
    mark("bundle-load-and-parse", "begin", 7),
    mark("index-read", "begin", 8),
    mark("index-read", "end", 9),
    mark("bundle-load-and-parse", "end", 10),
    mark("interpretation-formatting", "begin", 10),
    mark("worker", "begin", 11, 0, 5),
    mark("interpretation-formatting", "end", 13),
    mark("worker", "end", 14, 0, 5),
    mark("stdout", "begin", 14),
    mark("stdout", "end", 15, 12),
    mark("inspect", "end", 16),
    mark("main", "end", 17),
    mark("exit", "at", 18, 9_000_000),
  ];
  const trace = analyzeTrace(endpoint, marks);
  assert.equal(trace.attemptId, endpoint.id);
  assert.equal(trace.cpuMs, 9);
  assert.equal(trace.completeStdoutMs, 15);
  assert.equal(trace.concurrentMs, 3);
  assert.equal(trace.unattributedMs, 4);
  assert.equal(
    trace.criticalPath.reduce((sum, row) => sum + row.ms, 0),
    20,
  );
  const load = trace.spans.find(
    ({ name }) => name === "bundle-load-and-parse",
  )!;
  assert.equal(
    trace.spans.find(({ name }) => name === "index-read")?.parent,
    load.id,
  );
  assert.throws(
    () => analyzeTrace({ ...endpoint, stdoutBytes: 13 }, marks),
    /verified stdout/,
  );
});

test("focused stop uses four complete active windows and five tested ideas", async () => {
  const failed = (
    hypothesis: string,
    activeSeconds = 2160,
    tested = true,
  ): Experiment => ({ hypothesis, activeSeconds, tested, qualified: false });
  const ledger = [
    {
      hypothesis: "faster",
      activeSeconds: 3600,
      tested: true,
      qualified: true,
      score: 95,
      repeatScores: [94, 96],
    } as const,
    failed("one"),
    failed("two"),
    failed("three"),
    failed("four"),
    failed("invalid run", 1, false),
    failed("five"),
  ] as Experiment[];
  const result = await stopDecision([99.9, 100.1], true, ledger);
  assert.equal(result.incumbent.score, 95);
  assert.equal(result.completeWindows, 4);
  assert.equal(result.distinctHypothesesSinceGain, 5);
  assert.equal(result.activeSeconds, 14401);
  assert.equal(result.windowGainsPerHour[0], 0.05263);
  assert.deepEqual(result.windowGainsPerHour.slice(1), [0, 0, 0]);
  assert.equal(result.earlySpeedGainPerHour, 0.026315);
  assert.equal(result.cutoffPerHour, 0.005263);
  assert.equal(result.stop, true);
  const tooSoon = await stopDecision([99.9, 100.1], true, ledger.slice(0, -1));
  assert.equal(tooSoon.distinctHypothesesSinceGain, 4);
  assert.equal(tooSoon.stop, false);
});
