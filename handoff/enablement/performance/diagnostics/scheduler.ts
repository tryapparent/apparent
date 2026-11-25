import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { pressureDelta, pressureSample } from "../pressure.ts";

async function optional(path: string) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (
      ["ENOENT", "ESRCH", "EACCES"].includes(
        (error as NodeJS.ErrnoException).code ?? "",
      )
    )
      return null;
    throw error;
  }
}

function processes(electron?: number) {
  const rows = execFileSync("ps", ["-e", "-o", "pid=,ppid=,comm="], {
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .flatMap((line) => {
      const row = /^\s*(\d+)\s+(\d+)\s+(\S+)/.exec(line);
      return row
        ? [{ pid: Number(row[1]), parent: Number(row[2]), name: row[3] }]
        : [];
    });
  let ancestor = rows.find((row) => row.pid === process.pid);
  while (ancestor && ancestor.name !== "xvfb-run" && ancestor.parent > 1)
    ancestor = rows.find((row) => row.pid === ancestor?.parent);
  const own = new Set([
    process.pid,
    electron,
    ...(ancestor?.name === "xvfb-run" ? [ancestor.pid] : []),
  ]);
  let size: number;
  do {
    size = own.size;
    for (const row of rows) if (own.has(row.parent)) own.add(row.pid);
  } while (own.size !== size);
  return rows.filter((row) => own.has(row.pid) && row.name !== "ps");
}

async function work(process: ReturnType<typeof processes>[number]) {
  const root = "/proc/" + process.pid;
  const stat = await optional(join(root, "stat"));
  if (!stat) return { ...process, exited: true };
  const fields = stat
    .slice(stat.lastIndexOf(")") + 2)
    .trim()
    .split(/\s+/);
  const tasks = await readdir(join(root, "task")).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT" || error.code === "ESRCH") return [];
      throw error;
    },
  );
  const scheduling = [0, 0, 0];
  let readable = 0;
  for (const task of tasks) {
    const raw = await optional(join(root, "task", task, "schedstat"));
    if (!raw) continue;
    const counters = raw.trim().split(/\s+/).map(Number);
    if (counters.length !== 3 || !counters.every(Number.isFinite)) continue;
    readable++;
    counters.forEach((count, i) => {
      scheduling[i] += count;
    });
  }
  const status = await optional(join(root, "status"));
  const switches = (name: string) => {
    const value = status?.match(
      new RegExp("^" + name + ":\\s+(\\d+)$", "m"),
    )?.[1];
    return value === undefined ? null : Number(value);
  };
  return {
    ...process,
    startTicks: Number(fields[19]),
    userTicks: Number(fields[11]),
    systemTicks: Number(fields[12]),
    threads: tasks.length,
    readableSchedstats: readable,
    threadRuntimeNs: scheduling[0],
    threadWaitNs: scheduling[1],
    threadSlices: scheduling[2],
    mainThreadContextSwitches: {
      voluntary: switches("voluntary_ctxt_switches"),
      involuntary: switches("nonvoluntary_ctxt_switches"),
    },
  };
}

export async function schedulerDiagnostic() {
  const cgroupPath = (await optional("/proc/self/cgroup"))?.match(
    /^0::(\/.*)$/m,
  )?.[1];
  const cgroup = cgroupPath ? join("/sys/fs/cgroup", cgroupPath) : null;
  async function snapshot(electron?: number) {
    const pressure = await pressureSample();
    const processWork = [];
    for (const process of processes(electron))
      processWork.push(await work(process));
    return {
      pressure,
      processWork,
      observerCpu: process.cpuUsage(),
      observerContextSwitches: {
        voluntary: process.resourceUsage().voluntaryContextSwitches,
        involuntary: process.resourceUsage().involuntaryContextSwitches,
      },
      cgroupCpuStat: cgroup ? await optional(join(cgroup, "cpu.stat")) : null,
      cgroupCpuPressure: cgroup
        ? await optional(join(cgroup, "cpu.pressure"))
        : null,
      cgroupIoPressure: cgroup
        ? await optional(join(cgroup, "io.pressure"))
        : null,
    };
  }
  const points: object[] = [];
  let last: Awaited<ReturnType<typeof snapshot>> | undefined;
  async function mark(stage: string, electron?: number) {
    const point = await snapshot(electron);
    points.push({
      stage,
      ...point,
      sincePrevious: last && pressureDelta(last.pressure, point.pressure),
    });
    last = point;
  }
  await mark("idle-start");
  await setTimeout(2000);
  await mark("idle-end");
  return {
    mark,
    evidence: {
      schema: 1,
      scored: false,
      clockTicksPerSecond: Number(
        execFileSync("getconf", ["CLK_TCK"], { encoding: "utf8" }).trim(),
      ),
      schedulerStatsEnabled: await optional(
        "/proc/sys/kernel/sched_schedstats",
      ),
      points,
    },
  };
}
