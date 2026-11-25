import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { basename, dirname, join } from "node:path";
import { cpuSample, receipt, stealSince } from "../hosted/job.ts";
import { pressureTotalUs, waitForQuietStart } from "./host-pressure.ts";
import {
  type CpuSubset,
  cpuNumbers,
  readSelectedCpuTimes,
} from "./smt-subset.ts";

export const hostedAccountingPolicy = "record-host-attribution-v1";
export const hostedSubsetPolicy = "record-start-complete-smt-v1";
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
  if (!hierarchy.length) return null;
  const group = hierarchy[0];
  const pids = readFileSync(join(group, "cgroup.procs"), "utf8")
    .trim()
    .split(/\s+/);
  return {
    membership,
    usageUs: usage(group)("usage_usec"),
    actors: pids
      .filter((pid) => /^\d+$/.test(pid))
      .flatMap((pid) => {
        try {
          const stat = readFileSync("/proc/" + pid + "/stat", "utf8");
          return [{ pid: Number(pid), ...processCpuTicks(stat) }];
        } catch (error) {
          if (
            !["ENOENT", "ESRCH", "EACCES", "EPERM"].includes(
              (error as NodeJS.ErrnoException).code ?? "",
            )
          )
            throw error;
          return [];
        }
      }),
  };
}

export function processCpuTicks(stat: string) {
  const open = stat.indexOf("(");
  const close = stat.lastIndexOf(")");
  const values = stat
    .slice(close + 2)
    .trim()
    .split(/\s+/);
  const startTicks = Number(values[19]);
  const cpuTicks = Number(values[11]) + Number(values[12]);
  assert.ok(
    open >= 0 &&
      close > open &&
      Number.isSafeInteger(startTicks) &&
      Number.isSafeInteger(cpuTicks),
  );
  return { name: stat.slice(open + 1, close), startTicks, cpuTicks };
}

export async function waitForHostedQuiet(path: string, subset?: CpuSubset) {
  const cpus = subset?.cpus.length ?? availableParallelism();
  const observed: { resource: string; percent: number }[][] = [];
  let windows: typeof observed | undefined;
  try {
    windows = await waitForQuietStart(
      AbortSignal.timeout(46_000),
      ["cpu", "io"],
      {
        resource: subset ? "selected-cpu" : "guest-cpu",
        limitPercent: outsideCpuLimitPercent,
        counter: () =>
          (subset
            ? readSelectedCpuTimes(subset).busyUs
            : usage(cgroupRoot)("usage_usec")) / cpus,
        record: (window) => observed.push(window),
      },
    );
  } finally {
    receipt(path, {
      cpus,
      subset,
      windows,
      observed,
      admitted: windows !== undefined,
    });
  }
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
  selectedBefore?: ReturnType<typeof readSelectedCpuTimes>;
  selectedAfter?: ReturnType<typeof readSelectedCpuTimes>;
};

export function qualifyAccounting(
  before: Sample,
  after: Sample,
  cpus: number,
  subset?: CpuSubset,
) {
  const elapsedUs = (after.atMs - before.atMs) * 1000;
  assert.ok(elapsedUs > 0 && Number.isInteger(cpus) && cpus > 0);
  const cpuCapacityUs = elapsedUs * cpus;
  const guestBusyUs = after.guestAfterUs - before.guestBeforeUs;
  let measuredBusyUs = guestBusyUs;
  let selectedStealPercent: number | undefined;
  if (subset) {
    assert.equal(cpus, subset.cpus.length);
    assert.ok(before.selectedBefore && after.selectedAfter);
    measuredBusyUs = after.selectedAfter.busyUs - before.selectedBefore.busyUs;
    selectedStealPercent = stealSince(
      before.selectedBefore,
      after.selectedAfter,
    );
  }
  const workloadCpuUs = after.workloadUs - before.workloadUs;
  const outsideCpuUs = Math.max(0, measuredBusyUs - workloadCpuUs);
  assert.ok(guestBusyUs >= 0 && measuredBusyUs >= 0 && workloadCpuUs >= 0);
  const lagAllowanceUs = (cpus * 2_000_000) / (subset?.clockTicks ?? 100);
  const countersConsistent = measuredBusyUs + lagAllowanceUs >= workloadCpuUs;
  if (!countersConsistent) {
    const counters = subset && {
      subset,
      elapsedUs,
      guestBusyUs,
      measuredBusyUs,
      workloadCpuUs,
      lagAllowanceUs,
      before,
      after,
    };
    assert.fail(
      "Guest and workload CPU counters are inconsistent" +
        (counters ? " " + JSON.stringify(counters) : ""),
    );
  }
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
    steal:
      stealPercent <= stealLimitPercent &&
      (selectedStealPercent ?? 0) <= stealLimitPercent,
    throttling: throttledUs.every((value) => value === 0),
    io: guestIoPsiPercent <= ioLimitPercent,
  };
  return {
    policy: subset ? hostedSubsetPolicy : hostedAccountingPolicy,
    qualified: Object.values(guards).every(Boolean),
    guards,
    limits: { outsideCpuLimitPercent, stealLimitPercent, ioLimitPercent },
    cpus,
    elapsedUs,
    guestBusyUs,
    ...(subset ? { measuredBusyUs, subset, selectedStealPercent } : {}),
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
  assert.match(unit, /^apparent-record-bench-[a-f0-9-]+\.service$/);
  const { membership, hierarchy } = accountingHierarchy();
  assert.ok(basename(membership) === unit, "Missing owned benchmark cgroup");
  const cpuList = allowedCpuList();
  const expected = process.env.APPARENT_RECORD_HOST_CPU_LIST;
  assert.ok(expected);
  assert.deepEqual(
    cpuNumbers(cpuList),
    cpuNumbers(expected),
    "Benchmark scope changed the runner CPU allocation",
  );
  const scope = join(cgroupRoot, membership);
  const cpus = availableParallelism();
  const clockTicks = Number(process.env.APPARENT_RECORD_HOST_SUBSET_TICKS);
  const subset = process.env.APPARENT_RECORD_HOST_SUBSET_TICKS
    ? { cpus: cpuNumbers(expected), clockTicks }
    : undefined;
  if (subset) {
    assert.ok(Number.isSafeInteger(clockTicks) && clockTicks > 0);
    assert.equal(cpus, subset.cpus.length);
    assert.deepEqual(
      cpuNumbers(
        readFileSync(join(scope, "cpuset.cpus.effective"), "utf8").trim(),
      ),
      subset.cpus,
      "Service has an unexpected effective CPU affinity",
    );
  }
  const sample = (): Sample => {
    const atMs = performance.now();
    const guestBeforeUs = usage(cgroupRoot)("usage_usec");
    const selectedBefore = subset && readSelectedCpuTimes(subset);
    const workloadUs = usage(scope)("usage_usec");
    const selectedAfter = subset && readSelectedCpuTimes(subset);
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
      selectedBefore,
      selectedAfter,
    };
  };
  return {
    start() {
      const before = sample();
      return () => ({
        ...qualifyAccounting(before, sample(), cpus, subset),
        cpuList,
        scope: membership,
      });
    },
  };
}
