import assert from "node:assert/strict";
import { test } from "node:test";
import { benchmarkComparison } from "../../../../shared/enablement/performance/comparison.ts";
import {
  type HostedAccounting,
  processCpuTicks,
  qualifyAccounting,
} from "./host-accounting.ts";

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

test("matches persistent driver processes by name and start time", () => {
  const fields = Array<string>(42).fill("0");
  fields[11] = "30";
  fields[12] = "7";
  fields[19] = "1492";
  assert.deepEqual(processCpuTicks("8 (runner ) helper) " + fields.join(" ")), {
    name: "runner ) helper",
    startTicks: 1492,
    cpuTicks: 37,
  });
});

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

test("selected CPUs retain global work and reject interference on the subset", () => {
  const subset = { cpus: [0, 2], clockTicks: 100 };
  const first = { busyTicks: 40, busyUs: 400_000, total: 200, steal: 2 };
  const next = { busyTicks: 140, busyUs: 1_400_000, total: 400, steal: 2 };
  const last = {
    ...after,
    workloadUs: before.workloadUs + 950_000,
    selectedAfter: next,
  };
  const clean = qualifyAccounting(
    { ...before, selectedBefore: first },
    last,
    2,
    subset,
  );
  assert.equal(clean.qualified, true);
  assert.equal(clean.guestBusyUs, 2_440_000);
  assert.equal(clean.unrelatedCpuPercent, 2.5);
  const injected = qualifyAccounting(
    { ...before, selectedBefore: first },
    { ...last, selectedAfter: { ...next, busyTicks: 170, busyUs: 1_700_000 } },
    2,
    subset,
  );
  assert.equal(injected.unrelatedCpuPercent, 17.5);
  assert.equal(injected.guards.unrelatedCpu, false);
});

test("a hosted subset counter mismatch rejects and exposes both raw samples", () => {
  const subset = { cpus: [2, 3], clockTicks: 100 };
  const start = {
    ...before,
    selectedBefore: { busyTicks: 40, busyUs: 400_000, total: 200, steal: 0 },
  };
  const end = {
    ...after,
    workloadUs: before.workloadUs + 1_050_000,
    selectedAfter: { busyTicks: 140, busyUs: 1_400_000, total: 400, steal: 0 },
  };

  assert.throws(
    () => qualifyAccounting(start, end, 2, subset),
    (error: unknown) => {
      assert.ok(error instanceof assert.AssertionError);
      const prefix = "Guest and workload CPU counters are inconsistent ";
      assert.ok(error.message.startsWith(prefix));
      assert.deepEqual(JSON.parse(error.message.slice(prefix.length)), {
        subset,
        elapsedUs: 1_000_000,
        guestBusyUs: 2_440_000,
        measuredBusyUs: 1_000_000,
        workloadCpuUs: 1_050_000,
        lagAllowanceUs: 40_000,
        before: start,
        after: end,
      });
      return true;
    },
  );
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
