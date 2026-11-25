import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

export function schedulerPressureUs() {
  const sample = /^some .*\btotal=(\d+)$/m.exec(
    readFileSync("/proc/pressure/cpu", "utf8"),
  );
  assert.ok(sample, "Linux CPU pressure counters are required");
  return Number(sample[1]);
}

export async function waitForQuietStart(signal: AbortSignal) {
  const deadline = performance.now() + 45000;
  let consecutive = 0;
  while (performance.now() < deadline) {
    const start = performance.now();
    const pressure = schedulerPressureUs();
    await delay(1000, undefined, { signal });
    const percent =
      (schedulerPressureUs() - pressure) / ((performance.now() - start) * 10);
    consecutive = percent <= 3 ? consecutive + 1 : 0;
    if (consecutive === 3) return;
  }
  throw Error("No quiet host CPU window before the picker-skipped shortcut");
}
