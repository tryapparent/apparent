import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import { now } from "./witness.ts";

export async function pressureSample() {
  const [cpu, io] = await Promise.all(
    ["cpu", "io"].map(async (metric) => {
      const pressure = await readFile("/proc/pressure/" + metric, "utf8");
      const total = /^some .* total=(\d+)$/m.exec(pressure);
      assert.ok(total, "Missing Linux PSI " + metric);
      return Number(total[1]);
    }),
  );
  return { atMs: now(), cpuUs: cpu, ioUs: io };
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
  };
}

export async function preflight() {
  const before = await pressureSample();
  await setTimeout(2000);
  return pressureDelta(before, await pressureSample());
}
