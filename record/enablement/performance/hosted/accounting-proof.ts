import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { hostedAccounting } from "../fixtures/host-accounting.ts";
import { type CpuSubset, cpuNumbers } from "../fixtures/smt-subset.ts";
import { json, receipt, type HostedJob } from "./job.ts";
import { runInMeasurementUnit } from "./measurement-unit.ts";

const entry = fileURLToPath(import.meta.url);

function busyFor(milliseconds: number) {
  const end = performance.now() + milliseconds;
  let witness = 1;
  while (performance.now() < end) witness = Math.imul(witness, 1664525) + 1;
  return witness;
}

export async function verifyAccounting(job: HostedJob, subset: CpuSubset) {
  const isolated = join(job.evidence, "accounting-owned-work.json");
  runInMeasurementUnit(
    entry,
    ["sample", isolated],
    job.env,
    join(job.evidence, "accounting-owned-work.log"),
    subset,
  );
  assert.ok(json(isolated).workloadCpuUs > 100_000);

  const outside = spawn(
    "taskset",
    ["--cpu-list", subset.cpus.join(","), process.execPath, entry, "outside"],
    {
      env: job.env,
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  const exited = once(outside, "exit");
  try {
    await Promise.race([
      once(outside.stdout, "data"),
      exited.then(() => {
        throw Error("CPU interference fixture exited before ready");
      }),
      delay(3000, undefined, { ref: false }).then(() => {
        throw Error("CPU interference fixture did not start");
      }),
    ]);
    const membership = readFileSync(
      "/proc/" + outside.pid + "/cgroup",
      "utf8",
    ).trim();
    const status = readFileSync("/proc/" + outside.pid + "/status", "utf8");
    const injectedCpuList = /^Cpus_allowed_list:\s+([0-9,-]+)$/m.exec(
      status,
    )?.[1];
    assert.ok(injectedCpuList);
    assert.deepEqual(cpuNumbers(injectedCpuList), subset.cpus);
    const path = join(job.evidence, "accounting-outside-work.json");
    runInMeasurementUnit(
      entry,
      ["sample", path],
      job.env,
      join(job.evidence, "accounting-outside-work.log"),
      subset,
    );
    const measured = json(path);
    receipt(path, {
      ...measured,
      injectedMembership: membership,
      injectedCpuList,
    });
    assert.notEqual(membership, "0::" + measured.scope);
    assert.equal(
      measured.guards.unrelatedCpu,
      false,
      "Outside CPU injection must fail qualification",
    );
  } finally {
    if (outside.exitCode === null && outside.signalCode === null)
      outside.kill();
    await exited;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === entry) {
  const [mode, output] = process.argv.slice(2);
  if (mode === "outside") {
    console.log("ready");
    busyFor(4500);
  } else {
    assert.equal(mode, "sample");
    const accounting = hostedAccounting();
    assert.ok(accounting);
    const finish = accounting.start();
    const witness = busyFor(1300);
    receipt(output, { ...finish(), diagnosticOnly: true, witness });
  }
}
