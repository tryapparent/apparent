import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { basename, dirname, join } from "node:path";
import { cpuSample, stealSince } from "../hosted/job.ts";
import { pressureTotalUs } from "./host-pressure.ts";

export const hostedAccountingPolicy = "record-host-attribution-v1";
const cgroupRoot = "/sys/fs/cgroup";
const outsideCpuLimitPercent = 5;
const stealLimitPercent = 5;
const ioLimitPercent = 5;

export function accountingHierarchy() {
  const membership = /^0::(\/[^\n]*)$/m.exec(
    readFileSync("/proc/self/cgroup", "utf8"),
  )?.[1];
  assert.ok(membership, "Expected cgroup v2 process membership");
  const hierarchy = [];
  for (
    let path = join(cgroupRoot, membership);
    path !== cgroupRoot;
    path = dirname(path)
  ) {
    hierarchy.push(path);
  }
  return { membership, hierarchy };
}

export function allowedCpuList() {
  const list = /^Cpus_allowed_list:\s+([0-9,-]+)$/m.exec(
    readFileSync("/proc/self/status", "utf8"),
  )?.[1];
  assert.ok(list, "Missing allowed CPU list");
  return list;
}

function usage(path: string) {
  const counters = readFileSync(join(path, "cpu.stat"), "utf8");
  return (name: string) => {
    const value = counters
      .split("\n")
      .find((row) => row.startsWith(name + " "));
    const count = Number(value?.split(" ")[1]);
    assert.ok(
      Number.isSafeInteger(count) && count >= 0,
      "Missing CPU counter " + name,
    );
    return count;
  };
}

export function driverCpuSnapshot() {
  const { membership, hierarchy } = accountingHierarchy();
  return hierarchy.length
    ? { membership, usageUs: usage(hierarchy[0])("usage_usec") }
    : null;
}

type Sample = {
  atMs: number;
  guestBeforeUs: number;
  guestAfterUs: number;
  workloadUs: number;
  cpuPsiUs: number;
  ioPsiUs: number;
  ticks: ReturnType<typeof cpuSample>;
  throttledUs: number[];
};

export function qualifyAccounting(before: Sample, after: Sample, cpus: number) {
  const elapsedUs = (after.atMs - before.atMs) * 1000;
  assert.ok(elapsedUs > 0 && Number.isInteger(cpus) && cpus > 0);
  const cpuCapacityUs = elapsedUs * cpus;
  const guestBusyUs = after.guestAfterUs - before.guestBeforeUs;
  const workloadCpuUs = after.workloadUs - before.workloadUs;
  const outsideCpuUs = Math.max(0, guestBusyUs - workloadCpuUs);
  assert.ok(guestBusyUs >= 0 && workloadCpuUs >= 0);
  assert.ok(
    guestBusyUs + cpus * 20_000 >= workloadCpuUs,
    "Guest and workload CPU counters are inconsistent",
  );
  const unrelatedCpuPercent = (100 * outsideCpuUs) / cpuCapacityUs;
  const totalGuestCpuPsiPercent =
    (100 * (after.cpuPsiUs - before.cpuPsiUs)) / elapsedUs;
  const guestIoPsiPercent =
    (100 * (after.ioPsiUs - before.ioPsiUs)) / elapsedUs;
  const stealPercent = stealSince(before.ticks, after.ticks);
  assert.equal(before.throttledUs.length, after.throttledUs.length);
  const throttledUs = after.throttledUs.map(
    (value, i) => value - before.throttledUs[i],
  );
  assert.ok(throttledUs.every((value) => value >= 0));
  assert.ok(totalGuestCpuPsiPercent >= 0 && guestIoPsiPercent >= 0);
  const guards = {
    unrelatedCpu: unrelatedCpuPercent <= outsideCpuLimitPercent,
    steal: stealPercent <= stealLimitPercent,
    throttling: throttledUs.every((value) => value === 0),
    io: guestIoPsiPercent <= ioLimitPercent,
  };
  return {
    policy: hostedAccountingPolicy,
    qualified: Object.values(guards).every(Boolean),
    guards,
    limits: { outsideCpuLimitPercent, stealLimitPercent, ioLimitPercent },
    cpus,
    elapsedUs,
    guestBusyUs,
    workloadCpuUs,
    outsideCpuUs,
    unrelatedCpuPercent,
    totalGuestCpuPsiPercent,
    guestIoPsiPercent,
    stealPercent,
    throttledUs,
    before,
    after,
  };
}

export type HostedAccounting = ReturnType<typeof qualifyAccounting>;

export function hostedAccounting() {
  const unit = process.env.APPARENT_RECORD_HOSTED_SCOPE;
  if (!unit) return undefined;
  assert.match(unit, /^apparent-record-bench-[a-f0-9-]+\.scope$/);
  const { membership, hierarchy } = accountingHierarchy();
  assert.ok(basename(membership) === unit, "Missing owned benchmark cgroup");
  const cpuList = allowedCpuList();
  assert.equal(
    cpuList,
    process.env.APPARENT_RECORD_HOST_CPU_LIST,
    "Benchmark scope changed the runner CPU allocation",
  );
  const scope = join(cgroupRoot, membership);
  const cpus = availableParallelism();
  const sample = (): Sample => {
    const atMs = performance.now();
    const guestBeforeUs = usage(cgroupRoot)("usage_usec");
    const workloadUs = usage(scope)("usage_usec");
    const guestAfterUs = usage(cgroupRoot)("usage_usec");
    return {
      atMs,
      guestBeforeUs,
      guestAfterUs,
      workloadUs,
      cpuPsiUs: pressureTotalUs(readFileSync("/proc/pressure/cpu", "utf8")),
      ioPsiUs: pressureTotalUs(readFileSync("/proc/pressure/io", "utf8")),
      ticks: cpuSample(),
      throttledUs: hierarchy.map((path) => usage(path)("throttled_usec")),
    };
  };
  return {
    start() {
      const before = sample();
      return () => ({
        ...qualifyAccounting(before, sample(), cpus),
        cpuList,
        scope: membership,
      });
    },
  };
}
