import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const root = "/sys/fs/cgroup";
export const hostedLimits = {
  outsideCpuPercent: 5,
  stealPercent: 5,
  fullIoPressurePercent: 5,
  throttledPeriods: 0,
} as const;

async function membership() {
  const path = (await readFile("/proc/self/cgroup", "utf8")).match(
    /^0::(\/.*)$/m,
  )?.[1];
  assert(path, "Expected unified cgroup membership");
  const dir = resolve(root, "." + path);
  assert(dir === root || dir.startsWith(root + "/"));
  return dir;
}

function privileged(
  command: "mkdir" | "rmdir" | "tee",
  path: string,
  input?: string,
) {
  execFileSync("sudo", ["-n", command, "--", path], {
    input,
    stdio: ["pipe", "ignore", "inherit"],
    timeout: 5_000,
  });
}

function scopeName(phase: string) {
  assert.match(process.env.GITHUB_RUN_ID ?? "", /^\d+$/);
  assert.match(process.env.GITHUB_RUN_ATTEMPT ?? "", /^\d+$/);
  assert.match(phase, /^(calibration|matched)$/);
  return `apparent-onboarding-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}-${phase}`;
}

export async function withHostedScope<T>(phase: string, run: () => Promise<T>) {
  const dir = join(await membership(), scopeName(phase));
  privileged("mkdir", dir);
  try {
    process.env.APPARENT_ONBOARDING_HOSTED_SCOPE = phase;
    return await run();
  } finally {
    delete process.env.APPARENT_ONBOARDING_HOSTED_SCOPE;
    privileged("rmdir", dir);
  }
}

const read = (file: string) => readFile(file, "utf8");
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
  totalGuestCpuPsi: string;
  ioPsi: string;
  scopeCpu: {
    directory: string;
    usageUs: number;
    throttledPeriods: number | null;
  }[];
};

export async function startHostedMeter() {
  const dir = join(
    await membership(),
    scopeName(process.env.APPARENT_ONBOARDING_HOSTED_SCOPE ?? ""),
  );
  privileged("tee", join(dir, "cgroup.procs"), `${process.pid}\n`);
  assert.equal(
    await membership(),
    dir,
    "Observer must be inside the owned workload scope",
  );
  const hierarchy = [dir];
  while (hierarchy.at(-1) !== root) hierarchy.push(dirname(hierarchy.at(-1)!));
  const ticksPerSecond = counter(
    Number(execFileSync("getconf", ["CLK_TCK"], { encoding: "utf8" }).trim()),
  );
  assert(ticksPerSecond > 0);
  const scopeCpu = async (directory: string) => {
    const stats = keyValues(await read(join(directory, "cpu.stat")));
    return {
      directory,
      usageUs: counter(stats.usage_usec),
      throttledPeriods:
        stats.nr_throttled === undefined ? null : counter(stats.nr_throttled),
    };
  };
  return {
    ticksPerSecond,
    async sample(): Promise<HostedSample> {
      const clockMs = performance.now();
      const [hostCpu, totalGuestCpuPsi, ioPsi, scopes] = await Promise.all([
        read("/proc/stat"),
        read("/proc/pressure/cpu"),
        read("/proc/pressure/io"),
        Promise.all(hierarchy.map(scopeCpu)),
      ]);
      return {
        clockMs,
        hostCpu: hostCpu.split("\n", 1)[0],
        totalGuestCpuPsi,
        ioPsi,
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
  const cpu = (sample: HostedSample) =>
    sample.hostCpu.trim().split(/\s+/).slice(1, 9).map(Number);
  const first = cpu(before);
  const delta = cpu(after).map((value, index) => counter(value - first[index]));
  assert.equal(delta.length, 8);
  const total = delta.reduce((sum, value) => sum + value, 0);
  assert(total > 0 && ticksPerSecond > 0);
  const busy = delta[0] + delta[1] + delta[2] + delta[5] + delta[6];
  const workloadUs = counter(
    after.scopeCpu[0].usageUs - before.scopeCpu[0].usageUs,
  );
  const outsideCpuPercent = Math.max(
    0,
    (100 * (busy - (workloadUs * ticksPerSecond) / 1_000_000)) / total,
  );
  const stealPercent = (100 * delta[7]) / total;
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
