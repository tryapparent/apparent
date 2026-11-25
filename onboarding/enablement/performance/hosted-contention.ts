import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  allowedCpus,
  busyTicks,
  cpuFields,
  cpuList,
  cpuRows,
} from "./hosted/placement.ts";

const root = "/sys/fs/cgroup";
export const hostedLimits = {
  outsideCpuPercent: 5,
  stealPercent: 5,
  fullIoPressurePercent: 5,
  throttledPeriods: 0,
} as const;

const keyValues = (contents: string) =>
  Object.fromEntries(
    contents
      .trim()
      .split("\n")
      .map((row) => {
        const [key, raw] = row.trim().split(/\s+/);
        return [key, Number(raw)];
      }),
  );
const counter = (value: number | undefined) => {
  assert(
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0,
  );
  return value;
};

export type HostedSample = {
  clockMs: number;
  hostCpu: string;
  selectedCpu: string[];
  totalGuestCpuPsi: string;
  ioPsi: string;
  scopeCpu: {
    directory: string;
    usageUs: number;
    throttledPeriods: number | null;
  }[];
};

export function startHostedMeter() {
  const read = (path: string) => readFileSync(path, "utf8");
  const scope = process.env.APPARENT_ONBOARDING_HOSTED_SCOPE ?? "";
  assert.match(
    scope,
    /^apparent-onboarding-[0-9]+-[0-9]+-(calibration|matched|proof)\.service$/,
  );
  const membership = /^0::(\/.*)$/m.exec(read("/proc/self/cgroup"))?.[1];
  assert.equal(membership, "/system.slice/" + scope);
  const dir = join(root, membership);
  const selected = cpuList(process.env.APPARENT_ONBOARDING_HOSTED_CPUS ?? "");
  assert.deepEqual(
    cpuList(read(join(dir, "cpuset.cpus.effective")).trim()),
    selected,
  );
  assert.deepEqual(allowedCpus(read("/proc/self/status")), selected);
  const hierarchy = [dir];
  while (hierarchy.at(-1) !== root) hierarchy.push(dirname(hierarchy.at(-1)!));
  const ticksPerSecond = counter(
    Number(execFileSync("getconf", ["CLK_TCK"], { encoding: "utf8" }).trim()),
  );
  assert(ticksPerSecond > 0);
  const scopeCpu = (directory: string) => {
    const stats = keyValues(read(join(directory, "cpu.stat")));
    return {
      directory,
      usageUs: counter(stats.usage_usec),
      throttledPeriods:
        stats.nr_throttled === undefined ? null : counter(stats.nr_throttled),
    };
  };
  return {
    ticksPerSecond,
    selected,
    sample(boundary: "start" | "end"): HostedSample {
      const clockMs = performance.now();
      const startCpu = boundary === "start" ? read("/proc/stat") : undefined;
      const scopes = hierarchy.map(scopeCpu);
      const hostCpu = startCpu ?? read("/proc/stat");
      return {
        clockMs,
        hostCpu: hostCpu.split("\n", 1)[0],
        selectedCpu: cpuRows(hostCpu, selected),
        totalGuestCpuPsi: read("/proc/pressure/cpu"),
        ioPsi: read("/proc/pressure/io"),
        scopeCpu: scopes,
      };
    },
  };
}

function fullIo(sample: string) {
  const row = /^full avg10=([\d.]+).* total=(\d+)$/m.exec(sample);
  assert(row, "Expected Linux full I/O pressure counters");
  return { average: Number(row[1]), totalUs: counter(Number(row[2])) };
}

export function hostedContention(
  before: HostedSample,
  after: HostedSample,
  ticksPerSecond: number,
) {
  const cpuDelta = (before: string, after: string) => {
    const first = cpuFields(before);
    return cpuFields(after).map((value, index) =>
      counter(value - first[index]),
    );
  };
  const sum = (fields: number[]) =>
    fields.reduce((total, value) => total + value, 0);
  assert(before.selectedCpu.length > 0);
  assert.deepEqual(
    before.selectedCpu.map((row) => row.split(/\s+/, 1)[0]),
    after.selectedCpu.map((row) => row.split(/\s+/, 1)[0]),
  );
  const deltas = before.selectedCpu.map((row, index) =>
    cpuDelta(row, after.selectedCpu[index]),
  );
  const total = sum(deltas.map(sum));
  assert(total > 0 && ticksPerSecond > 0);
  const busy = sum(deltas.map(busyTicks));
  const workloadUs = counter(
    after.scopeCpu[0].usageUs - before.scopeCpu[0].usageUs,
  );
  const outsideCpuPercent = Math.max(
    0,
    (100 * (busy - (workloadUs * ticksPerSecond) / 1_000_000)) / total,
  );
  const guestDelta = cpuDelta(before.hostCpu, after.hostCpu);
  const selectedStealPercent =
    (100 * sum(deltas.map((delta) => delta[7]))) / total;
  const guestStealPercent = (100 * guestDelta[7]) / sum(guestDelta);
  const stealPercent = Math.max(selectedStealPercent, guestStealPercent);
  assert.deepEqual(
    after.scopeCpu.map(({ directory }) => directory),
    before.scopeCpu.map(({ directory }) => directory),
  );
  const throttledPeriods = Math.max(
    ...after.scopeCpu.map(({ throttledPeriods }, index) => {
      const previous = before.scopeCpu[index].throttledPeriods;
      assert.equal(throttledPeriods === null, previous === null);
      return counter((throttledPeriods ?? 0) - (previous ?? 0));
    }),
  );
  const ioBefore = fullIo(before.ioPsi);
  const ioAfter = fullIo(after.ioPsi);
  const elapsedMs = after.clockMs - before.clockMs;
  assert(elapsedMs > 0);
  const fullIoPressurePercent = Math.max(
    ioBefore.average,
    ioAfter.average,
    counter(ioAfter.totalUs - ioBefore.totalUs) / (10 * elapsedMs),
  );
  return {
    outsideCpuPercent,
    workloadUs,
    selectedStealPercent,
    guestStealPercent,
    stealPercent,
    throttledPeriods,
    fullIoPressurePercent,
    qualified:
      outsideCpuPercent <= hostedLimits.outsideCpuPercent &&
      stealPercent <= hostedLimits.stealPercent &&
      fullIoPressurePercent <= hostedLimits.fullIoPressurePercent &&
      throttledPeriods <= hostedLimits.throttledPeriods,
  };
}
