import assert from "node:assert/strict";
import { test } from "node:test";
import { completePairs, cpuNumbers, selectedCpuTimes } from "./smt-subset.ts";

test("only permits whole, mutually reported and allowed core groups", () => {
  const topology = ["0,2", "1,3", "0,2", "1,3"].map((siblings, cpu) => ({
    cpu,
    siblings,
  }));
  assert.deepEqual(completePairs(topology, "0-3"), [
    [0, 2],
    [1, 3],
  ]);
  assert.deepEqual(completePairs(topology, "0-1"), []);
  assert.deepEqual(completePairs(topology, "0-2"), [[0, 2]]);
  assert.deepEqual(
    completePairs(
      [
        { cpu: 2, siblings: "2" },
        { cpu: 3, siblings: "3" },
      ],
      "2-3",
    ),
    [[2, 3]],
  );
  assert.throws(() => cpuNumbers("0-2,2"), /Duplicate CPU/);
});

test("selected counters exclude busy time on other CPUs and retain steal", () => {
  const stat = [
    "cpu 930 0 40 120 0 0 0 8",
    "cpu0 10 1 4 20 6 1 2 3 7 0",
    "cpu1 900 0 0 0 0 0 0 0",
    "cpu2 20 0 5 30 1 0 1 5",
  ].join("\n");
  const subset = { cpus: [0, 2], clockTicks: 100 };
  assert.deepEqual(selectedCpuTimes(stat, subset), {
    busyTicks: 44,
    total: 109,
    steal: 8,
    busyUs: 440_000,
  });
  assert.throws(
    () => selectedCpuTimes(stat, { cpus: [0, 3], clockTicks: 100 }),
    /Missing per-CPU/,
  );
});
