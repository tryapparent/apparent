import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

type PressureResource = "cpu" | "io";

function pressureUs(resource: PressureResource) {
  const sample = /^some .*\btotal=(\d+)$/m.exec(
    readFileSync("/proc/pressure/" + resource, "utf8"),
  );
  assert.ok(sample, "Linux " + resource + " pressure counters are required");
  return Number(sample[1]);
}

export function schedulerPressureUs() {
  return pressureUs("cpu");
}

export async function waitForQuietStart(
  signal: AbortSignal,
  resources: readonly [PressureResource, ...PressureResource[]] = ["cpu"],
) {
  const deadline = performance.now() + 45000;
  let quiet: { resource: PressureResource; percent: number }[][] = [];
  while (performance.now() < deadline) {
    const start = performance.now();
    const pressure = resources.map(pressureUs);
    await delay(1000, undefined, { signal });
    const current = resources.map(pressureUs);
    const elapsed = (performance.now() - start) * 10;
    const window = resources.map((resource, index) => ({
      resource,
      percent: (current[index] - pressure[index]) / elapsed,
    }));
    if (window.every(({ percent }) => percent >= 0 && percent <= 3)) {
      quiet.push(window);
      if (quiet.length === 3) return quiet;
    } else quiet = [];
  }
  throw Error("No quiet host " + resources.join(" and ") + " window");
}
