import assert from "node:assert/strict";
import test from "node:test";
import { evaluateInterference } from "./interference.ts";

const before: Parameters<typeof evaluateInterference>[0] = {
  atMs: 1,
  sampleUs: 100,
  logicalCpus: 4,
  guestCpuUs: 100_000,
  stealTicks: 80,
  benchmarkCpuUs: 90_000,
  scopeThrottledUs: 0,
  rootThrottledUs: 0,
  scopeThrottledEvents: 0,
  rootThrottledEvents: 0,
  hasScopeThrottleCounters: true,
  hasRootThrottleCounters: true,
  guestIoUs: 100,
  ownIoUs: 100,
};
const ownWork = {
  ...before,
  atMs: 201,
  benchmarkCpuUs: 540_000,
  guestCpuUs: 560_000,
  guestIoUs: 8_100,
  ownIoUs: 8_100,
};

test("admits parallel benchmark CPU and benchmark-attributed I/O", () => {
  const result = evaluateInterference(before, ownWork);
  assert(result.passed);
  assert.equal(result.unrelatedCpuUs, 10_000);
  assert.equal(result.unrelatedIoLowerBoundUs, 0);
});

test("rejects independently observed interference", () => {
  const overrides = {
    unrelatedCpu: { guestCpuUs: 800_000 },
    observedSteal: { stealTicks: 81 },
    throttling: { scopeThrottledEvents: 1 },
    unrelatedIo: { guestIoUs: 18_100 },
    sampling: { sampleUs: 14_000 },
  };
  for (const [guard, counters] of Object.entries(overrides)) {
    const result = evaluateInterference(before, { ...ownWork, ...counters });
    assert.equal(result.checks[guard as keyof typeof result.checks], false);
    assert.equal(result.passed, false);
  }
});
