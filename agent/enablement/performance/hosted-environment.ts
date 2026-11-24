import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export function assertHosted() {
  assert.equal(process.env.GITHUB_ACTIONS, "true");
  assert.equal(process.env.RUNNER_ENVIRONMENT, "github-hosted");
  assert.equal(process.env.GITHUB_REPOSITORY, "tryapparent/apparent");
  assert.equal(
    process.version,
    "v22.23.0",
    "Hosted Agent benchmark requires the gateway Node pin",
  );
  assert.equal(process.platform, "linux");
  assert.equal(process.arch, "x64");
  const os = readFileSync("/etc/os-release", "utf8");
  assert(/^ID=ubuntu$/m.test(os) && /^VERSION_ID="24.04"$/m.test(os));
}

export function cpuList(value: string): number[] {
  assert(/^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/.test(value));
  return value.split(",").flatMap((range) => {
    const [first, last = first] = range.split("-").map(Number);
    assert(last >= first && last - first <= 4096);
    return Array.from(
      { length: last - first + 1 },
      (_, index) => first + index,
    );
  });
}

const read = (path: string) => readFileSync(path, "utf8").trim();
export function siblingsOf(cpu: number) {
  return cpuList(
    read(
      "/sys/devices/system/cpu/cpu" + cpu + "/topology/thread_siblings_list",
    ),
  );
}

export function cpuLimits() {
  const row = read("/proc/self/cgroup")
    .split("\n")
    .find((line) => line.startsWith("0::"));
  assert(row, "Expected cgroup v2 CPU accounting");
  const root = "/sys/fs/cgroup";
  const leaf = join(root, row.slice(3));
  assert(leaf === root || leaf.startsWith(root + "/"));
  const levels = [];
  for (let path = leaf; ; path = dirname(path)) {
    if (existsSync(join(path, "cpu.max"))) {
      levels.push({ path, limit: read(join(path, "cpu.max")) });
    }
    if (path === root) break;
  }
  const affinity = read("/proc/self/status").match(
    /^Cpus_allowed_list:\s+(.+)$/m,
  )?.[1];
  assert(affinity, "Missing process CPU affinity");
  const cpus = cpuList(affinity);
  const quotas = levels.map(({ limit }) => {
    const [quota, period] = limit.split(" ");
    if (quota === "max") return Infinity;
    assert(Number(quota) > 0 && Number(period) > 0);
    return Number(quota) / Number(period);
  });
  return { cpus, levels, effectiveCpus: Math.min(cpus.length, ...quotas) };
}

export function throttlingCounters() {
  const { levels } = cpuLimits();
  return levels.map(({ path }) => {
    const match = read(join(path, "cpu.stat")).match(/^nr_throttled (\d+)$/m);
    assert(match, "Missing CPU throttling counter for " + path);
    return Number(match[1]);
  });
}

export function processorTicks() {
  const rows = read("/proc/stat")
    .split("\n")
    .filter((line) => /^cpu\d+ /.test(line));
  return new Map(
    rows.map((line) => {
      const [id, ...counts] = line.trim().split(/\s+/);
      return [Number(id.slice(3)), counts.slice(0, 8).map(Number)];
    }),
  );
}

export function ticksBetween(before: number[], after: number[]) {
  assert(before.length === 8 && after.length === 8);
  const elapsed = after.map((value, index) => value - before[index]);
  assert(elapsed.every((value) => Number.isSafeInteger(value) && value >= 0));
  const total = elapsed.reduce((sum, value) => sum + value, 0);
  return {
    busy: total ? 1 - elapsed[3] / total : 1,
    steal: total ? elapsed[7] / total : 1,
  };
}

export function systemPressure() {
  return Object.fromEntries(
    ["cpu", "io", "memory"].map((kind) => [
      kind,
      read("/proc/pressure/" + kind),
    ]),
  );
}
