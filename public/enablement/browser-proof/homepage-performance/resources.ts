import { readFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import type { CDPSession } from "playwright-core";

export const maxCpuPressurePercent = 2;

export async function pressure() {
  const cpu = await readFile("/proc/pressure/cpu", "utf8");
  const total = Number(cpu.match(/^some .*total=(\d+)/m)?.[1]);
  if (!Number.isSafeInteger(total))
    throw new Error("Linux CPU pressure is required");
  return total;
}

export async function pressureSample() {
  const pressureUs = await pressure();
  return { atMs: performance.now(), pressureUs };
}

export async function idlePreflight() {
  const windows = [];
  let before = await pressureSample();
  let quiet = 0;
  for (let i = 0; i < 6 && quiet < 2; i++) {
    await setTimeout(200);
    const after = await pressureSample();
    const cpuPressurePercent =
      (100 * (after.pressureUs - before.pressureUs)) /
      ((after.atMs - before.atMs) * 1000);
    windows.push({ before, after, cpuPressurePercent });
    quiet = cpuPressurePercent <= maxCpuPressurePercent ? quiet + 1 : 0;
    before = after;
  }
  return { quiet: quiet === 2, windows };
}

export async function processes(cdp: CDPSession) {
  const { processInfo } = await cdp.send("SystemInfo.getProcessInfo");
  let pssKiB = 0;
  for (const { id } of processInfo) {
    const rollup = await readFile(`/proc/${id}/smaps_rollup`, "utf8").catch(
      (error) => {
        if (error.code === "ENOENT" || error.code === "ESRCH") return "";
        throw error;
      },
    );
    pssKiB += Number(rollup.match(/^Pss:\s+(\d+) kB/m)?.[1] ?? 0);
  }
  return {
    pssKiB,
    cpuSeconds: processInfo.reduce((sum, process) => sum + process.cpuTime, 0),
  };
}
