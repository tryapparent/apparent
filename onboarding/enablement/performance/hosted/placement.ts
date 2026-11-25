import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

export const placementProtocol = "complete-visible-smt-v1";

export function cpuList(spec: string) {
  assert.match(spec, /^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/);
  const cpus = spec.split(",").flatMap((range) => {
    const [first, last = first] = range.split("-").map(Number);
    assert(Number.isSafeInteger(last) && last >= first && last - first < 4096);
    return Array.from(
      { length: last - first + 1 },
      (_, offset) => first + offset,
    );
  });
  assert.equal(new Set(cpus).size, cpus.length);
  return cpus.sort((a, b) => a - b);
}

export function allowedCpus(status: string) {
  return cpuList(/^Cpus_allowed_list:\s*([0-9,-]+)$/m.exec(status)?.[1] ?? "");
}

type Topology = { cpu: number; siblings: string }[];

export function completeGroups(topology: Topology) {
  const groups = new Map(
    topology.map(({ cpu, siblings }) => [cpu, cpuList(siblings).join(",")]),
  );
  return [...new Set(groups.values())]
    .map(cpuList)
    .filter((members) =>
      members.every((cpu) => groups.get(cpu) === members.join(",")),
    );
}

export function twoCpuSubsets(topology: Topology) {
  const groups = completeGroups(topology);
  const singles = groups.filter((cpus) => cpus.length === 1);
  return [
    ...groups.filter((cpus) => cpus.length === 2),
    ...singles.flatMap(([first], index) =>
      singles.slice(index + 1).map(([second]) => [first, second]),
    ),
  ].filter((cpus) => cpus.length < topology.length);
}

export function cpuFields(row: string) {
  const fields = row.trim().split(/\s+/).slice(1, 9).map(Number);
  assert.equal(fields.length, 8);
  assert(fields.every((value) => Number.isSafeInteger(value) && value >= 0));
  return fields;
}

export function cpuRows(sample: string, cpus: number[]) {
  const rows = sample.split("\n");
  const selected = cpus.map((cpu) =>
    rows.find((row) => row.startsWith("cpu" + cpu + " ")),
  );
  assert(
    selected.every((row) => row !== undefined),
    "Missing selected CPU counters",
  );
  return selected;
}

export const busyTicks = ([user, nice, system, , , irq, softirq]: number[]) =>
  user + nice + system + irq + softirq;

export async function choosePlacement(affinity: string) {
  const allowed = cpuList(affinity);
  const topology = allowed.map((cpu) => ({
    cpu,
    siblings: readFileSync(
      `/sys/devices/system/cpu/cpu${cpu}/topology/thread_siblings_list`,
      "utf8",
    ).trim(),
  }));
  const groups = twoCpuSubsets(topology);
  assert(
    groups.length,
    "No complete two-vCPU subset smaller than the runner allocation",
  );
  const before = readFileSync("/proc/stat", "utf8");
  await delay(1000);
  const after = readFileSync("/proc/stat", "utf8");
  const busy = (sample: string, cpus: number[]) =>
    cpuRows(sample, cpus).reduce(
      (sum, row) => sum + busyTicks(cpuFields(row)),
      0,
    );
  const choices = groups.map((cpus) => ({
    cpus,
    busyTicksPerCpu: (busy(after, cpus) - busy(before, cpus)) / cpus.length,
  }));
  const [{ cpus }] = choices.sort(
    (a, b) => a.busyTicksPerCpu - b.busyTicksPerCpu,
  );
  return { protocol: placementProtocol, cpus, topology, choices };
}
