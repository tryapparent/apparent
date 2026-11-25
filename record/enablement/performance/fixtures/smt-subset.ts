import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

export type CpuSubset = { cpus: number[]; clockTicks: number };
type Topology = readonly { cpu: number; siblings: string }[];
const busyFields = [0, 1, 2, 5, 6];

export function selectedCpuRoundingUs(subset: CpuSubset) {
  return (
    (subset.cpus.length * busyFields.length * 1_000_000) / subset.clockTicks
  );
}

export function cpuNumbers(list: string) {
  assert.match(list, /^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/);
  const cpus = list.split(",").flatMap((range) => {
    const [first, last = first] = range.split("-").map(Number);
    assert.ok(
      Number.isSafeInteger(first) &&
        Number.isSafeInteger(last) &&
        first <= last,
    );
    return Array.from({ length: last - first + 1 }, (_, i) => first + i);
  });
  assert.equal(cpus.length, new Set(cpus).size, "Duplicate CPU in list");
  return cpus.sort((a, b) => a - b);
}

export function completePairs(topology: Topology, allowed: string) {
  const permitted = new Set(cpuNumbers(allowed));
  const byCpu = new Map(
    topology.map(({ cpu, siblings }) => [cpu, cpuNumbers(siblings).join(",")]),
  );
  const groups = [...new Set(byCpu.values())]
    .map(cpuNumbers)
    .filter((group) =>
      group.every(
        (cpu) => permitted.has(cpu) && byCpu.get(cpu) === group.join(","),
      ),
    );
  const singleton = groups.filter((group) => group.length === 1);
  return [
    ...groups.filter((group) => group.length === 2),
    ...singleton.flatMap(([a], index) =>
      singleton.slice(index + 1).map(([b]) => [a, b].sort((x, y) => x - y)),
    ),
  ];
}

export function selectedCpuTimes(text: string, subset: CpuSubset) {
  const totals = { busyTicks: 0, total: 0, steal: 0 };
  const seen = new Set<number>();
  for (const line of text.split("\n")) {
    const row = /^cpu(\d+)\s+(.+)$/.exec(line);
    if (!row || !subset.cpus.includes(Number(row[1]))) continue;
    const cpu = Number(row[1]);
    assert.ok(!seen.has(cpu));
    seen.add(cpu);
    const fields = row[2].trim().split(/\s+/).slice(0, 8).map(Number);
    assert.equal(fields.length, 8);
    assert.ok(
      fields.every((value) => Number.isSafeInteger(value) && value >= 0),
    );
    totals.busyTicks += busyFields.reduce(
      (sum, field) => sum + fields[field],
      0,
    );
    totals.total += fields.reduce((sum, value) => sum + value, 0);
    totals.steal += fields[7];
  }
  assert.equal(seen.size, subset.cpus.length, "Missing per-CPU stat rows");
  return {
    ...totals,
    busyUs: (totals.busyTicks * 1_000_000) / subset.clockTicks,
  };
}

export function readSelectedCpuTimes(subset: CpuSubset) {
  return selectedCpuTimes(readFileSync("/proc/stat", "utf8"), subset);
}
