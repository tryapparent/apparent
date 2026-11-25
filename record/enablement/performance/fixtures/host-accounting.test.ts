import assert from "node:assert/strict";
import { test } from "node:test";
import { benchmarkComparison } from "../../../../shared/enablement/performance/comparison.ts";
import { type HostedAccounting, qualifyAccounting } from "./host-accounting.ts";

const before = {
  atMs: 100,
  guestBeforeUs: 400_000,
  guestAfterUs: 400_200,
  workloadUs: 40_000,
  cpuPsiUs: 20_000,
  ioPsiUs: 1_000,
  ticks: { total: 400, steal: 2 },
  throttledUs: [0, 10],
};
const after = {
  atMs: 1_100,
  guestBeforeUs: 2_839_900,
  guestAfterUs: 2_840_000,
  workloadUs: 2_440_000,
  cpuPsiUs: 320_000,
  ioPsiUs: 20_000,
  ticks: { total: 800, steal: 2 },
  throttledUs: [0, 10],
};

test("busy owned workers qualify with high total CPU PSI and quiet outside work", () => {
  const result = qualifyAccounting(before, after, 4);
  assert.equal(result.workloadCpuUs, 2_400_000);
  assert.equal(result.outsideCpuUs, 40_000);
  assert.equal(result.totalGuestCpuPsiPercent, 30);
  assert.equal(result.unrelatedCpuPercent, 1);
  assert.equal(result.qualified, true);
});

test("rejects attributed interference, steal, throttling and I/O separately", () => {
  const changes: [keyof HostedAccounting["guards"], Partial<typeof after>][] = [
    ["unrelatedCpu", { guestAfterUs: 3_200_000 }],
    ["steal", { ticks: { total: 800, steal: 23 } }],
    ["throttling", { throttledUs: [0, 12] }],
    ["io", { ioPsiUs: 60_000 }],
  ];
  for (const [guard, values] of changes) {
    const result = qualifyAccounting(before, { ...after, ...values }, 4);
    assert.equal(result.qualified, false);
    assert.equal(result.guards[guard], false, guard);
  }
});

test("qualified hosted scheduling still rejects a candidate resource regression", async () => {
  const result = qualifyAccounting(before, after, 4);
  const comparison = await benchmarkComparison(
    [[100, 83, 82, 101]],
    [
      [result.qualified ? 0 : 1, 0],
      [121, 100, 20],
    ],
  );
  assert.deepEqual(comparison.permitted, [true, false]);
  assert.ok(comparison.timings[0].score < 100);
});
