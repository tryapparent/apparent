import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const cpuList = readFileSync("/proc/self/status", "utf8").match(
  /^Cpus_allowed_list:\s+(.+)$/m,
)?.[1];
assert(
  cpuList && /^\d+$/.test(cpuList),
  "Pin this benchmark to one quiet CPU with taskset",
);
const cpu = Number(cpuList);
const siblings = readFileSync(
  "/sys/devices/system/cpu/cpu" + cpu + "/topology/thread_siblings_list",
  "utf8",
)
  .trim()
  .split(",")
  .flatMap((range) => {
    const [first, last = first] = range.split("-").map(Number);
    return Array.from(
      { length: last - first + 1 },
      (_, index) => first + index,
    );
  });
function counters() {
  const lines = readFileSync("/proc/stat", "utf8").split("\n");
  return siblings.map((id) => {
    const line = lines.find((entry) => entry.startsWith("cpu" + id + " "));
    assert(line, "CPU went offline");
    return line.trim().split(/\s+/).slice(1, 9).map(Number);
  });
}
const tickNs =
  1e9 / Number(execFileSync("getconf", ["CLK_TCK"], { encoding: "utf8" }));
assert(Number.isFinite(tickNs) && tickNs > 0);
function contentionSnapshot() {
  const stats = readFileSync("/proc/schedstat", "utf8");
  assert(
    /^version 1[5-7]$/m.test(stats),
    "Unsupported scheduler accounting format",
  );
  const task = readFileSync("/proc/self/stat", "utf8");
  const fields = task.slice(task.lastIndexOf(")") + 2).split(" ");
  return {
    time: process.hrtime.bigint(),
    taskTicks: fields
      .slice(11, 15)
      .reduce((sum, value) => sum + Number(value), 0),
    runtime: siblings.map((id) => {
      const line = stats
        .split("\n")
        .find((entry) => entry.startsWith("cpu" + id + " "));
      assert(line, "CPU went offline");
      return BigInt(line.trim().split(/\s+/)[7]);
    }),
  };
}
function blockContention(
  start: ReturnType<typeof contentionSnapshot>,
  end: ReturnType<typeof contentionSnapshot>,
) {
  const elapsed = Number(end.time - start.time);
  const ownedMinimum =
    Math.max(0, end.taskTicks - start.taskTicks - 4) * tickNs;
  return siblings.map((id, index) => ({
    cpu: id,
    busy:
      Math.max(
        0,
        Number(end.runtime[index] - start.runtime[index]) -
          (id === cpu ? ownedMinimum : 0),
      ) / elapsed,
  }));
}
async function idle() {
  const before = counters();
  await new Promise((done) => setTimeout(done, 700));
  return counters().map((after, index) => {
    const elapsed = after.map((value, i) => value - before[index][i]);
    const total = elapsed.reduce((sum, value) => sum + value, 0);
    return { cpu: siblings[index], busy: total ? 1 - elapsed[3] / total : 1 };
  });
}

export { cpu, siblings, idle, contentionSnapshot, blockContention };
