import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { now } from "../witness.ts";

const read = (file: string) => readFileSync(file, "utf8");

export function hostedMeter() {
  const membership = /^0::(\/.*)$/m.exec(read("/proc/self/cgroup"))?.[1];
  assert.match(membership ?? "", /\/apparent-handoff-[a-z0-9-]+\.service$/);
  const status = read("/proc/self/status");
  const allowed = /^Cpus_allowed_list:\s+(\S+)$/m.exec(status)?.[1];
  assert.ok(allowed, "Missing benchmark CPU affinity");
  const cpus = (spec: string) =>
    spec.split(",").flatMap((range) => {
      const [first, last = first] = range.split("-").map(Number);
      assert.ok(Number.isSafeInteger(first) && last >= first);
      return Array.from(
        { length: last - first + 1 },
        (_, index) => first + index,
      );
    });
  assert.deepEqual(
    cpus(allowed),
    cpus(read("/sys/devices/system/cpu/online").trim()),
    "The aggregate guest CPU denominator requires the complete online CPU set",
  );
  const cgroup = join("/sys/fs/cgroup", membership!);
  const ticksPerSecond = Number(
    execFileSync("getconf", ["CLK_TCK"], { encoding: "utf8" }).trim(),
  );
  assert.ok(Number.isSafeInteger(ticksPerSecond) && ticksPerSecond > 0);
  const ancestors: string[] = [];
  for (
    let directory = cgroup;
    directory !== "/sys/fs/cgroup";
    directory = dirname(directory)
  ) {
    const quota = read(join(directory, "cpu.max")).trim().split(/\s+/);
    const [capacity, period] = quota;
    assert.ok(
      Number(period) > 0 &&
        (capacity === "max" ||
          Number(capacity) >= cpus(allowed).length * Number(period)),
      "CPU quota limits the benchmark cgroup or an ancestor below the visible guest capacity",
    );
    ancestors.push(directory);
  }
  return {
    snapshot() {
      const before = cpuStat(read(join(cgroup, "cpu.stat")));
      const line = /^cpu\s+(.+)$/m.exec(read("/proc/stat"))?.[1];
      assert.ok(line);
      const tick = line.trim().split(/\s+/).map(Number);
      assert.ok(tick.length >= 8 && tick.every(Number.isSafeInteger));
      const after = cpuStat(read(join(cgroup, "cpu.stat")));
      const toUs = (count: number) => (count * 1e6) / ticksPerSecond;
      return {
        atMs: now(),
        totalUs: toUs(tick.slice(0, 8).reduce((sum, value) => sum + value, 0)),
        busyUs: toUs(tick[0] + tick[1] + tick[2] + tick[5] + tick[6]),
        stealUs: toUs(tick[7]),
        workBeforeUs: before.usage_usec,
        workAfterUs: after.usage_usec,
        throttledUs:
          after.throttled_usec +
          ancestors
            .slice(1)
            .reduce(
              (sum, directory) =>
                sum + cpuStat(read(join(directory, "cpu.stat"))).throttled_usec,
              0,
            ),
      };
    },
  };
}

function cpuStat(text: string) {
  const fields = Object.fromEntries(
    text
      .trim()
      .split("\n")
      .map((line) => {
        const [name, value] = line.split(/\s+/);
        return [name, Number(value)];
      }),
  );
  for (const key of ["usage_usec", "throttled_usec"])
    assert.ok(
      Number.isSafeInteger(fields[key]) && fields[key] >= 0,
      "Missing cgroup " + key,
    );
  return fields;
}

type Sample = ReturnType<ReturnType<typeof hostedMeter>["snapshot"]>;

export function hostedInterference(
  start: Sample,
  end: Sample,
  ioPercent: number,
  limit: number,
  ioLimit = limit,
) {
  const capacityUs = end.totalUs - start.totalUs;
  const guestBusyUs = end.busyUs - start.busyUs;
  const benchmarkWorkUs = end.workBeforeUs - start.workAfterUs;
  const stealUs = end.stealUs - start.stealUs;
  const throttledUs = end.throttledUs - start.throttledUs;
  assert.ok(capacityUs > 0 && end.atMs > start.atMs);
  assert.ok(
    [guestBusyUs, benchmarkWorkUs, stealUs, throttledUs, ioPercent].every(
      (value) => Number.isFinite(value) && value >= 0,
    ),
    "Invalid interference counters",
  );
  const outsideCpuPercent =
    (100 * Math.max(0, guestBusyUs - benchmarkWorkUs)) / capacityUs;
  const stealPercent = (100 * stealUs) / capacityUs;
  const failures = [
    outsideCpuPercent > limit && "outside-cpu",
    stealPercent > limit && "steal",
    throttledUs > 0 && "throttling",
    ioPercent > ioLimit && "io",
  ].filter(Boolean);
  return {
    qualified: failures.length === 0,
    failures,
    capacityUs,
    guestBusyUs,
    benchmarkWorkUs,
    outsideCpuPercent,
    stealPercent,
    throttledUs,
    ioPercent,
    snapshots: { start, end },
  };
}
