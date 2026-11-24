import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { cpus as processorInfo } from "node:os";
import { setTimeout } from "node:timers/promises";
import { affinity, cpuCounters, maxExternalPercent } from "../watch-sample.ts";

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
  const cpuQuota = await linux("/sys/fs/cgroup/cpu.max");
  return { cpuSpec, cpus, topology, cpuQuota };
}

export async function quietPreflight(cpus: number[]) {
  const before = await cpuCounters(cpus);
  const pressureBefore = await linux("/proc/pressure/io");
  await setTimeout(5000);
  const after = await cpuCounters(cpus);
  const pressureAfter = await linux("/proc/pressure/io");
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
    qualified:
      externalCpuPercent <= maxExternalPercent &&
      peakHostWaitPercent <= maxExternalPercent,
    externalCpuPercent,
    peakHostWaitPercent,
    pressureBefore,
    pressureAfter,
    before,
    after,
  };
}
