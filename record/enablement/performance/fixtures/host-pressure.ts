import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

type PressureResource = "cpu" | "io";
type QuietSample = { resource: string; percent: number };

type ExtraQuietProbe = {
  resource: string;
  limitPercent: number;
  counter: () => number;
  record: (window: QuietSample[]) => void;
};

export const quietPressureLimitPercent = 3;

export function pressureTotalUs(counters: string) {
  const sample = /^some .*\btotal=(\d+)$/m.exec(counters);
  assert.ok(sample, "Linux pressure counters are required");
  return Number(sample[1]);
}

function pressureUs(resource: PressureResource) {
  return pressureTotalUs(readFileSync("/proc/pressure/" + resource, "utf8"));
}

export function schedulerPressureUs() {
  return pressureUs("cpu");
}

export async function waitForQuietStart(
  signal: AbortSignal,
  resources: readonly [PressureResource, ...PressureResource[]] = ["cpu"],
  extra?: ExtraQuietProbe,
) {
  const deadline = performance.now() + 45000;
  const probes: Omit<ExtraQuietProbe, "record">[] = resources.map(
    (resource) => ({
      resource,
      limitPercent: quietPressureLimitPercent,
      counter: () => pressureUs(resource),
    }),
  );
  if (extra) probes.push(extra);
  let quiet: QuietSample[][] = [];
  while (performance.now() < deadline) {
    const start = performance.now();
    const before = probes.map(({ counter }) => counter());
    await delay(1000, undefined, { signal });
    const current = probes.map(({ counter }) => counter());
    const elapsed = (performance.now() - start) * 10;
    const window = probes.map(({ resource }, index) => ({
      resource,
      percent: (current[index] - before[index]) / elapsed,
    }));
    extra?.record(window);
    if (
      window.every(
        ({ percent }, i) => percent >= 0 && percent <= probes[i].limitPercent,
      )
    ) {
      quiet.push(window);
      if (quiet.length === 3) return quiet;
    } else quiet = [];
  }
  throw Error(
    "No quiet host " +
      probes.map(({ resource }) => resource).join(" and ") +
      " window",
  );
}
