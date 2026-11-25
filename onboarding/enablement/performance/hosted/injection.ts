import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import {
  hostedContention,
  hostedLimits,
  startHostedMeter,
} from "../hosted-contention.ts";

const [mode, receipt] = process.argv.slice(2);

function busyFor(ms: number) {
  const end = performance.now() + ms;
  while (performance.now() < end) {}
}

if (mode === "inject") {
  process.stdout.write("ready\n");
  busyFor(15_000);
} else {
  assert.equal(mode, "sample");
  assert(receipt);
  const meter = startHostedMeter();
  const before = meter.sample("start");
  busyFor(1500);
  const after = meter.sample("end");
  const contention = hostedContention(before, after, meter.ticksPerSecond);
  writeFileSync(
    receipt,
    JSON.stringify(
      { scored: false, cpus: meter.selected, before, after, contention },
      null,
      2,
    ) + "\n",
    { flag: "wx", mode: 0o600 },
  );
  assert(contention.workloadUs > 100_000);
  assert(
    contention.outsideCpuPercent > hostedLimits.outsideCpuPercent &&
      !contention.qualified,
    "Same-CPU external load did not fail the outside-CPU guard",
  );
}
