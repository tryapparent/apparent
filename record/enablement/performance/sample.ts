import assert from "node:assert/strict";
import { readFileSync, readdirSync, readlinkSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

const bootMs = () =>
  Math.round(Number(readFileSync("/proc/uptime", "utf8").split(" ")[0]) * 1000);
const root = Number(process.argv[2]);
const exe = process.argv[3];
const pageSize = Number(process.argv[4]);
assert(
  Number.isSafeInteger(root) &&
    root > 0 &&
    exe?.startsWith("/") &&
    pageSize > 0,
);
function cpu() {
  const [u, n, s, idle, wait, irq, soft, steal] = readFileSync(
    "/proc/stat",
    "utf8",
  )
    .split("\n", 1)[0]
    .trim()
    .split(/\s+/)
    .slice(1, 9)
    .map(Number);
  return {
    total: u + n + s + idle + wait + irq + soft + steal,
    busy: u + n + s + irq + soft,
    steal,
  };
}
function value(file: string, key: string) {
  const line = readFileSync(file, "utf8")
    .split("\n")
    .find((line) => line.startsWith(key));
  return line === undefined ? undefined : Number(line.trim().split(/\s+/)[1]);
}
function processes() {
  const children = new Map<
    number,
    { pid: number; parent: number; birth: number; ticks: number; rss: number }[]
  >();
  for (const name of readdirSync("/proc")) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const stat = readFileSync("/proc/" + name + "/stat", "utf8");
      const fields = stat
        .slice(stat.lastIndexOf(")") + 2)
        .trim()
        .split(/\s+/);
      const info = {
        pid: Number(name),
        parent: Number(fields[1]),
        birth: Number(fields[19]),
        ticks: Number(fields[11]) + Number(fields[12]),
        rss: Math.max(0, Number(fields[21])),
      };
      const family = children.get(info.parent) ?? [];
      family.push(info);
      children.set(info.parent, family);
      if (info.pid === root) children.set(-1, [info]);
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code !== "ENOENT" &&
        (error as NodeJS.ErrnoException).code !== "ESRCH"
      )
        throw error;
    }
  }
  const owned = children.get(-1) ?? [];
  for (const row of owned) owned.push(...(children.get(row.pid) ?? []));
  let pid = 0;
  if (
    owned.length &&
    readlinkSync("/proc/" + root + "/exe") === exe &&
    readFileSync("/proc/" + root + "/cmdline", "utf8")
      .split("\0")
      .includes("app")
  ) {
    pid = root;
  }
  return { owned, pid };
}
let previous = { at: 0, cpu: cpu(), ticks: new Map<string, number>() };
let index = 0;
let retryPss = false;
console.log(
  "ms\tinterval_ms\tapp_cpu_ticks\tvm_cpu_ticks\tvm_busy_ticks\tvm_steal_ticks\tapp_rss_kib\tapp_pss_kib\tpss_count\towned_count\tmem_available_kib\tmain_pid",
);
for (;;) {
  const at = bootMs();
  const current = cpu();
  const { owned, pid } = processes();
  const pssSample: boolean = index % 4 === 0 || retryPss;
  const ticks = new Map<string, number>();
  let appCpu = 0;
  let rss = 0;
  let pss = 0;
  let count = 0;
  for (const process of owned) {
    const key = process.pid + ":" + process.birth;
    ticks.set(key, process.ticks);
    appCpu += Math.max(
      0,
      process.ticks - (previous.ticks.get(key) ?? process.ticks),
    );
    rss += (process.rss * pageSize) / 1024;
    if (pssSample) {
      try {
        const sample = value("/proc/" + process.pid + "/smaps_rollup", "Pss:");
        if (sample !== undefined) {
          pss += sample;
          count++;
        }
      } catch (error) {
        if (
          !["ENOENT", "ESRCH", "EACCES", "EPERM"].includes(
            (error as NodeJS.ErrnoException).code ?? "",
          )
        )
          throw error;
      }
    }
  }
  retryPss = pssSample && (!owned.length || count !== owned.length);
  const free = value("/proc/meminfo", "MemAvailable:");
  assert(free !== undefined);
  if (previous.at && previous.at < at) {
    console.log(
      [
        at,
        at - previous.at,
        appCpu,
        current.total - previous.cpu.total,
        current.busy - previous.cpu.busy,
        current.steal - previous.cpu.steal,
        rss,
        pss,
        count,
        owned.length,
        free,
        pid,
      ].join("\t"),
    );
  }
  previous = { at, cpu: current, ticks };
  index++;
  await delay(Math.max(1, at + 125 - bootMs()));
}
