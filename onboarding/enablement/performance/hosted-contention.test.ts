import assert from "node:assert/strict";
import { test } from "node:test";
import { benchmarkComparison } from "../../../shared/enablement/performance/comparison.ts";
import { hostedContention, type HostedSample } from "./hosted-contention.ts";

import { completeGroups, cpuRows, twoCpuSubsets } from "./hosted/placement.ts";

function sample(
  clockMs: number,
  hostCpu: string,
  workloadUs: number,
  { periods = 0, ioUs = 0, selected = hostCpu.replace("cpu ", "cpu2 ") } = {},
): HostedSample {
  return {
    clockMs,
    hostCpu,
    selectedCpu: [selected],
    totalGuestCpuPsi: "some avg10=85.00 avg60=70.00 avg300=55.00 total=1000000",
    ioPsi: `full avg10=0.00 avg60=0.00 avg300=0.00 total=${ioUs}`,
    scopeCpu: [
      { directory: "/workload", usageUs: workloadUs, throttledPeriods: null },
      { directory: "/", usageUs: workloadUs, throttledPeriods: periods },
    ],
  };
}

const before = sample(1, "cpu 0 0 0 0 0 0 0 0", 0);
const compare = (after: HostedSample) => hostedContention(before, after, 100);

test("benchmark CPU and high total CPU PSI do not reject a quiet matched workload", () => {
  const receipt = compare(sample(1001, "cpu 220 0 80 100 0 0 0 0", 2_950_000));
  assert.equal(receipt.outsideCpuPercent, 1.25);
  assert.equal(receipt.qualified, true);
});

test("independently injected outside CPU rejects the same workload", () => {
  const receipt = compare(sample(1001, "cpu 300 0 80 20 0 0 0 0", 2_950_000));
  assert.equal(receipt.outsideCpuPercent, 21.25);
  assert.equal(receipt.qualified, false);
});

test("other CPUs cannot dilute or contaminate selected-CPU attribution", () => {
  const receipt = compare(
    sample(1001, "cpu 220 0 80 100 0 0 0 0", 500_000, {
      selected: "cpu2 55 0 0 45 0 0 0 0",
    }),
  );
  assert.equal(receipt.outsideCpuPercent, 5);
  assert.equal(receipt.qualified, true);
});

test("selection uses only whole visible sibling groups", () => {
  assert.deepEqual(
    completeGroups([
      { cpu: 0, siblings: "0-1" },
      { cpu: 2, siblings: "2-3" },
      { cpu: 3, siblings: "2-3" },
      { cpu: 4, siblings: "4" },
    ]),
    [[2, 3], [4]],
  );
  assert.deepEqual(
    twoCpuSubsets([
      { cpu: 0, siblings: "0" },
      { cpu: 1, siblings: "1" },
      { cpu: 2, siblings: "2-3" },
      { cpu: 3, siblings: "2-3" },
    ]),
    [
      [2, 3],
      [0, 1],
    ],
  );
  assert.deepEqual(
    cpuRows(
      "cpu  0 0 0 0 0 0 0 0\ncpu2 1 0 0 0 0 0 0 0\ncpu20 2 0 0 0 0 0 0 0",
      [2],
    ),
    ["cpu2 1 0 0 0 0 0 0 0"],
  );
});

test("steal, inherited throttling, and in-window I/O interference reject trials", () => {
  const stolen = compare(sample(1001, "cpu 220 0 80 70 0 0 0 30", 2_950_000));
  assert.equal(stolen.stealPercent, 7.5);
  assert.equal(stolen.qualified, false);
  const stolenElsewhere = compare(
    sample(1001, "cpu 220 0 80 70 0 0 0 30", 2_950_000, {
      selected: "cpu2 220 0 80 100 0 0 0 0",
    }),
  );
  assert.equal(stolenElsewhere.selectedStealPercent, 0);
  assert.equal(stolenElsewhere.qualified, false);
  const throttled = compare(
    sample(1001, "cpu 220 0 80 100 0 0 0 0", 2_950_000, { periods: 1 }),
  );
  assert.equal(throttled.throttledPeriods, 1);
  assert.equal(throttled.qualified, false);
  const io = compare(
    sample(1001, "cpu 220 0 80 100 0 0 0 0", 2_950_000, { ioUs: 60_000 }),
  );
  assert.equal(io.fullIoPressurePercent, 6);
  assert.equal(io.qualified, false);
});

test("the comparison policy rejects product CPU, RSS, and output size regressions", async () => {
  const { permitted } = await benchmarkComparison(
    [],
    [
      [0.61, 0.5, 0.05],
      [120_000, 100_000, 10_000],
      [123, 122, 0],
      [122, 122, 0],
    ],
  );
  assert.deepEqual(permitted, [false, false, false, true]);
});
