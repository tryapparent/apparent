import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import { now } from "./witness.ts";

export async function pressureSample() {
  const [cpu, io, stat] = await Promise.all([
    ...["cpu", "io"].map(async (metric) => {
      const pressure = await readFile("/proc/pressure/" + metric, "utf8");
      const total = /^some .* total=(\d+)$/m.exec(pressure);
      assert.ok(total, "Missing Linux PSI " + metric);
      return Number(total[1]);
    }),
    readFile("/proc/stat", "utf8"),
  ] as const);
  const counters = String(stat)
    .match(/^cpu\s+(.+)$/m)?.[1]
    .split(/\s+/)
    .map(Number);
  assert.ok(
    counters && counters.length >= 8 && counters.every(Number.isFinite),
    "Missing Linux guest CPU counters",
  );
  return {
    atMs: now(),
    cpuUs: Number(cpu),
    ioUs: Number(io),
    cpuTotal: counters.slice(0, 8).reduce((sum, value) => sum + value, 0),
    cpuSteal: counters[7],
  };
}

export function pressureDelta(
  a: Awaited<ReturnType<typeof pressureSample>>,
  b: typeof a,
) {
  const durationMs = b.atMs - a.atMs;
  assert.ok(durationMs > 0);
  return {
    durationMs,
    cpuPercent: (b.cpuUs - a.cpuUs) / (10 * durationMs),
    ioPercent: (b.ioUs - a.ioUs) / (10 * durationMs),
    guestStealPercent:
      b.cpuTotal > a.cpuTotal
        ? (100 * (b.cpuSteal - a.cpuSteal)) / (b.cpuTotal - a.cpuTotal)
        : null,
  };
}

export async function preflight() {
  const before = await pressureSample();
  await setTimeout(2000);
  return pressureDelta(before, await pressureSample());
}
