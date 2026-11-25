import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { cpus as processorInfo } from "node:os";
import { setTimeout } from "node:timers/promises";
import { affinity, cpuCounters, quietResources } from "../watch-sample.ts";
import { readCpuQuota } from "./quota.ts";

const linux = (path: string) =>
  readFile(path, "utf8").then((text) => text.trim());

export async function readHostedCpu() {
  const os = await linux("/etc/os-release");
  assert.match(os, /^ID=ubuntu$/m);
  assert.match(os, /^VERSION_ID="24\.04"$/m);
  const status = await linux("/proc/self/status");
  const cpuSpec = /^Cpus_allowed_list:\s*([0-9,-]+)$/m.exec(status)?.[1];
  assert.ok(cpuSpec, "Linux did not disclose the job CPU affinity");
  const cpus = await affinity(cpuSpec);
  const topology = await Promise.all(
    cpus.map(async (cpu) => ({
      cpu,
      siblings: await linux(
        `/sys/devices/system/cpu/cpu${cpu}/topology/thread_siblings_list`,
      ),
      model: processorInfo()[cpu]?.model,
    })),
  );
  assert.ok(
    topology.every(({ model }) => model),
    "Missing visible CPU model",
  );
  const cpuQuota = await readCpuQuota();
  return { cpuSpec, cpus, topology, cpuQuota };
}

export async function quietPreflight(cpus: number[]) {
  const before = await cpuCounters(cpus);
  const pressureBefore = await linux("/proc/pressure/io");
  const guestCpuPsiBefore = await linux("/proc/pressure/cpu");
  const writeback = async () =>
    (await linux("/proc/meminfo"))
      .split("\n")
      .filter((line) => /^(Dirty|Writeback):/.test(line));
  const writebackBefore = await writeback();
  await setTimeout(5000);
  const after = await cpuCounters(cpus);
  const pressureAfter = await linux("/proc/pressure/io");
  const guestCpuPsiAfter = await linux("/proc/pressure/cpu");
  const writebackAfter = await writeback();
  let total = 0;
  let busy = 0;
  const perCpuWaitPercent = after.map((row, index) => {
    const start = before[index];
    const ticks = row.total - start.total;
    assert.ok(ticks > 0, "Missing guest CPU counter progress");
    total += ticks;
    busy += row.busy - start.busy;
    return (100 * (row.wait - start.wait)) / ticks;
  });
  const externalCpuPercent = (100 * busy) / total;
  const peakHostWaitPercent = Math.max(...perCpuWaitPercent);
  return {
    qualified: quietResources({ externalCpuPercent, peakHostWaitPercent }),
    externalCpuPercent,
    peakHostWaitPercent,
    guestCpuPsiBefore,
    guestCpuPsiAfter,
    pressureBefore,
    pressureAfter,
    writebackBefore,
    writebackAfter,
    before,
    after,
  };
}

type QuietWindow = Pick<
  Awaited<ReturnType<typeof quietPreflight>>,
  "qualified" | "externalCpuPercent" | "peakHostWaitPercent"
>;

export async function waitForQuiet<T extends QuietWindow>(
  sample: () => Promise<T>,
  record: (windows: T[]) => Promise<void>,
) {
  const windows: T[] = [];
  for (let index = 0; index < 12; index++) {
    const window = await sample();
    windows.push(window);
    await record(windows);
    if (window.qualified) return true;
  }
  return false;
}
