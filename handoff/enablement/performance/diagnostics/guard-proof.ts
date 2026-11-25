import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { hostedInterference, hostedMeter } from "./hosted-guard.ts";
import { pressureDelta, pressureSample } from "../pressure.ts";
import { now } from "../witness.ts";
import policy from "../benchmark.json" with { type: "json" };

const [mode, signal, output] = process.argv.slice(2);
const marker = (name: string) => join(signal, name);
function busy(milliseconds: number) {
  const end = now() + milliseconds;
  while (now() < end) Math.sqrt(end);
}
async function waitFor(name: string) {
  const deadline = now() + 12_000;
  while (!existsSync(marker(name))) {
    assert.ok(now() < deadline, "Guard proof handshake expired: " + name);
    await setTimeout(10);
  }
}
if (mode === "outside") {
  await waitFor("trigger");
  busy(800);
  writeFileSync(marker("done"), "");
} else {
  assert.equal(mode, "inside");
  const meter = hostedMeter();
  async function measure(work: () => void | Promise<void>) {
    const pressureStart = await pressureSample();
    const start = meter.snapshot();
    await work();
    const end = meter.snapshot();
    const pressure = pressureDelta(pressureStart, await pressureSample());
    return {
      pressure,
      ...hostedInterference(
        start,
        end,
        pressure.ioPercent,
        policy.cpuPressurePercent,
        policy.ioPressurePercent,
      ),
    };
  }
  const owned = await measure(() => busy(800));
  const unrelated = await measure(async () => {
    writeFileSync(marker("trigger"), "");
    await waitFor("done");
  });
  writeFileSync(
    output,
    JSON.stringify({ scored: false, owned, unrelated }, null, 2) + "\n",
  );
  assert.ok(
    unrelated.failures.includes("outside-cpu"),
    "Injected unrelated work escaped the guest CPU guard",
  );
}
