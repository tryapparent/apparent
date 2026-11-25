import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const hostedInterference = "guest-cgroup-v2";
const cgroupRoot = "/sys/fs/cgroup";
const pressureTotal = (path: string) => {
  const total = Number(
    readFileSync(path, "utf8").match(/^some .*total=(\d+)/m)?.[1],
  );
  assert(Number.isSafeInteger(total));
  return total;
};
function cpuStat(path: string) {
  return Object.fromEntries(
    readFileSync(join(path, "cpu.stat"), "utf8")
      .trim()
      .split("\n")
      .map((line) => {
        const [name, value] = line.split(/\s+/);
        return [name, Number(value)];
      }),
  );
}

export function scopeCommand(scope: string, command: string, args: string[]) {
  assert.match(scope, /^\/sys\/fs\/cgroup\/apparent-public-[0-9]+-[0-9]+$/);
  return [
    "-c",
    `scope=$1; shift; sudo -n sh -c 'printf "%s\\n" "$1" > "$2/cgroup.procs"' sh "$$" "$scope" && exec "$@"`,
    "public-benchmark-scope",
    scope,
    command,
    ...args,
  ];
}

export function hostedSampler(scope: string) {
  const clockTicks = Number(process.env.APPARENT_PUBLIC_GUEST_CLOCK_TICKS);
  assert(Number.isSafeInteger(clockTicks) && clockTicks > 0);
  assert.equal(dirname(scope), cgroupRoot);
  assert(
    readFileSync("/proc/self/cgroup", "utf8")
      .split("\n")
      .includes("0::/" + scope.slice(cgroupRoot.length + 1)),
    "Hosted sampler is outside its benchmark cgroup",
  );
  return () => {
    const start = performance.now();
    const stat = readFileSync("/proc/stat", "utf8");
    const cpu = stat
      .match(/^cpu +([0-9 ]+)$/m)?.[1]
      .trim()
      .split(/ +/)
      .map(Number);
    assert(
      cpu && cpu.length >= 8 && cpu.slice(0, 8).every(Number.isSafeInteger),
    );
    const own = cpuStat(scope);
    const root = cpuStat(cgroupRoot);
    const guestIoUs = pressureTotal("/proc/pressure/io");
    const ownIoUs = pressureTotal(join(scope, "io.pressure"));
    const end = performance.now();
    const logicalCpus = [...stat.matchAll(/^cpu\d+ /gm)].length;
    assert(
      logicalCpus &&
        [own.usage_usec, root.usage_usec].every(Number.isSafeInteger),
    );
    return {
      atMs: (start + end) / 2,
      sampleUs: (end - start) * 1000,
      logicalCpus,
      clockTicks,
      guestCpuUs: root.usage_usec,
      stealTicks: cpu[7],
      benchmarkCpuUs: own.usage_usec,
      scopeThrottledUs: own.throttled_usec ?? 0,
      rootThrottledUs: root.throttled_usec ?? 0,
      scopeThrottledEvents: own.nr_throttled ?? 0,
      rootThrottledEvents: root.nr_throttled ?? 0,
      hasScopeThrottleCounters: Object.hasOwn(own, "throttled_usec"),
      hasRootThrottleCounters: Object.hasOwn(root, "throttled_usec"),
      guestIoUs,
      ownIoUs,
    };
  };
}

type Sample = ReturnType<ReturnType<typeof hostedSampler>>;

export function evaluateInterference(before: Sample, after: Sample) {
  const durationUs = (after.atMs - before.atMs) * 1000;
  assert(
    durationUs > 0 &&
      after.logicalCpus === before.logicalCpus &&
      after.clockTicks === before.clockTicks,
  );
  const readSkewUs = before.sampleUs + after.sampleUs;
  const delta = (
    key: keyof Pick<
      Sample,
      | "guestCpuUs"
      | "stealTicks"
      | "benchmarkCpuUs"
      | "scopeThrottledUs"
      | "rootThrottledUs"
      | "scopeThrottledEvents"
      | "rootThrottledEvents"
      | "guestIoUs"
      | "ownIoUs"
    >,
  ) => {
    const value = after[key] - before[key];
    assert(value >= 0, "Hosted Linux counter went backwards: " + key);
    return value;
  };
  const benchmarkCpuUs = delta("benchmarkCpuUs");
  const guestCpuUs = delta("guestCpuUs");
  const cpuReadSkewUs = readSkewUs * before.logicalCpus;
  const guestCounterLagUs = Math.max(0, benchmarkCpuUs - guestCpuUs);
  const counterLagAllowanceUs =
    cpuReadSkewUs + (1_000_000 * before.logicalCpus) / before.clockTicks;
  const unrelatedCpuUs = Math.max(0, guestCpuUs - benchmarkCpuUs);
  const cpuAllowanceUs = cpuReadSkewUs + durationUs / 4;
  const guestIoUs = delta("guestIoUs");
  const benchmarkIoUs = delta("ownIoUs");
  const unrelatedIoLowerBoundUs = Math.max(0, guestIoUs - benchmarkIoUs);
  const ioAllowanceUs = durationUs * 0.02 + readSkewUs;
  const observedStealTicks = delta("stealTicks");
  const throttleUs = delta("scopeThrottledUs") + delta("rootThrottledUs");
  const throttleEvents =
    delta("scopeThrottledEvents") + delta("rootThrottledEvents");
  const checks = {
    sampling:
      readSkewUs <= Math.min(10_000, durationUs / 10) &&
      guestCounterLagUs <= counterLagAllowanceUs,
    unrelatedCpu: unrelatedCpuUs <= cpuAllowanceUs,
    observedSteal: observedStealTicks === 0,
    throttling: throttleUs === 0 && throttleEvents === 0,
    unrelatedIo: unrelatedIoLowerBoundUs <= ioAllowanceUs,
  };
  return {
    before,
    after,
    checks,
    passed: Object.values(checks).every(Boolean),
    benchmarkCpuUs,
    guestCpuUs,
    guestCounterLagUs,
    counterLagAllowanceUs,
    unrelatedCpuUs,
    cpuAllowanceUs,
    guestIoUs,
    benchmarkIoUs,
    unrelatedIoLowerBoundUs,
    ioAllowanceUs,
    observedStealTicks,
    throttleUs,
    throttleEvents,
  };
}
