import assert from "node:assert/strict";
import { test } from "node:test";
import {
  evaluateInJob,
  type Block,
  type Experiment,
  type Pair,
} from "./score.ts";

const job = process.env.HERMES_BENCHMARK_JOB;
assert(job, "Set HERMES_BENCHMARK_JOB to a prepared private job");
const hillClimb = {
  windowSeconds: 3600,
  earlyWindows: 2,
  slowWindows: 2,
  slowRatePercent: 20,
  hypothesesSinceGain: 5,
};

let blockId = 0;
function block(wait: number, result = "exact") {
  const resources = {
    cpuMs: wait / 2,
    pluginPeakRssKiB: 100,
    descendantPeakRssKiB: 120,
  };
  return {
    id: String(++blockId),
    waits: { cold: wait, warm: wait },
    resources: { cold: resources, warm: resources },
    result,
  } satisfies Block;
}
const reference: Pair = [block(100), block(101)];
function attempt(
  hypothesis: string,
  seconds: number,
  control: number,
  candidate: number,
  result?: string,
): Experiment {
  return {
    hypothesis,
    seconds,
    build: hypothesis,
    control: [block(control), block(control)],
    candidate: [block(candidate, result), block(candidate, result)],
  };
}

test("uses both repeats and the guard to qualify a gain", () => {
  const half = attempt("one fast repeat", 10, 101, 75);
  half.candidate![1] = block(101);
  const badOutput = attempt("different output", 10, 101, 80, "different");
  const win = attempt("consistent", 10, 101, 80);
  const result = evaluateInJob(job, hillClimb, reference, "main", [
    half,
    badOutput,
    win,
  ]);
  assert.equal(result.baselineScore, 100);
  assert.equal(result.incumbent.build, "consistent");
  assert.deepEqual(
    result.experiments.map((row) => row.accepted),
    [false, false, true],
  );
  assert.equal(result.distinctHypothesesSinceGain, 0);
  assert.equal(result.stop, false);
});

test("requires both late windows and five distinct tested ideas", () => {
  const win = attempt("gain", 60, 101, 80);
  const invalid: Experiment = {
    hypothesis: "invalid",
    seconds: 60,
    build: "invalid",
    outcome: "contention",
  };
  const later = Array.from({ length: 5 }, (_, i) =>
    attempt("idea " + i, 2880, 80, 80),
  );
  const insufficientIdeas = evaluateInJob(job, hillClimb, reference, "main", [
    win,
    invalid,
    ...later.slice(0, 4),
    { ...later[0], seconds: 2880 },
  ]);
  assert.equal(insufficientIdeas.completeWindows, 4);
  assert.equal(insufficientIdeas.distinctHypothesesSinceGain, 4);
  assert.equal(insufficientIdeas.stop, false);
  const result = evaluateInJob(job, hillClimb, reference, "main", [
    win,
    invalid,
    ...later,
  ]);
  assert.equal(result.completeWindows, 4);
  assert.equal(result.distinctHypothesesSinceGain, 5);
  assert.deepEqual(result.windowGainsPerHour.slice(-2), [0, 0]);
  assert(result.cutoffPerHour && result.cutoffPerHour > 0);
  assert.equal(result.stop, true);
});
