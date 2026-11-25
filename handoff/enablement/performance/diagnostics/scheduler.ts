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
  return {
    inside: rows.filter((row) => own.has(row.pid) && row.name !== "ps"),
    other: rows.filter((row) => !own.has(row.pid) && row.name !== "ps"),
  };
}

type ProcessRow = ReturnType<typeof processes>["inside"][number];

function cpuFields(stat: string) {
  const fields = stat
    .slice(stat.lastIndexOf(")") + 2)
    .trim()
    .split(/\s+/);
  return {
    startTicks: Number(fields[19]),
    userTicks: Number(fields[11]),
    systemTicks: Number(fields[12]),
  };
}

async function outsideWork(row: ProcessRow, scope?: string) {
  const root = "/proc/" + row.pid;
  const [stat, membership] = await Promise.all([
    optional(join(root, "stat")),
    optional(join(root, "cgroup")),
  ]);
  if (!stat || !membership) return null;
  const path = membership.match(/^0::(\/.*)$/m)?.[1];
  if (!path || (scope && (path === scope || path.startsWith(scope + "/"))))
    return null;
  const cpu = cpuFields(stat);
  return { ...row, ...cpu };
}

async function work(process: ProcessRow) {
  const root = "/proc/" + process.pid;
  const stat = await optional(join(root, "stat"));
  if (!stat) return { ...process, exited: true };
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
    ...cpuFields(stat),
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
    const group = processes(electron);
    for (const process of group.inside) processWork.push(await work(process));
    const outside = (
      await Promise.all(group.other.map((row) => outsideWork(row, cgroupPath)))
    ).filter((row) => row !== null);
    const guestCpuStat = (await optional("/proc/stat"))?.match(
      /^cpu\s+(.+)$/m,
    )?.[1];

    return {
      pressure,
      processWork,
      outside,
      guestCpuStat,
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
    const { outside, ...record } = point;
    const previousOutside = new Map(
      last?.outside.map((row) => [row.pid + ":" + row.startTicks, row]),
    );
    const outsideDeltas = outside
      .flatMap((end) => {
        const before = previousOutside.get(end.pid + ":" + end.startTicks);
        if (!before) return [];
        const userTicks = end.userTicks - before.userTicks;
        const systemTicks = end.systemTicks - before.systemTicks;
        return userTicks > 0 || systemTicks > 0
          ? [{ pid: end.pid, name: end.name, userTicks, systemTicks }]
          : [];
      })
      .sort(
        (a, b) => b.userTicks + b.systemTicks - (a.userTicks + a.systemTicks),
      );
    points.push({
      stage,
      ...record,
      outsideDeltas,
      outsideProcessCounts: {
        observed: outside.length,
        new: outside.filter(
          (row) => !previousOutside.has(row.pid + ":" + row.startTicks),
        ).length,
      },
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
