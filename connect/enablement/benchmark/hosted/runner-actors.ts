import assert from "node:assert/strict";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { join, posix } from "node:path";
import {
  isMainThread,
  parentPort,
  Worker,
  workerData,
} from "node:worker_threads";

export function processTicks(stat: string) {
  const open = stat.indexOf("(");
  const close = stat.lastIndexOf(")");
  const name = stat.slice(open + 1, close);
  const fields = stat
    .slice(close + 2)
    .trim()
    .split(/\s+/);
  const startTicks = Number(fields[19]);
  const ticks = Number(fields[11]) + Number(fields[12]);
  assert.ok(
    open >= 0 &&
      close > open &&
      Number.isSafeInteger(startTicks) &&
      Number.isSafeInteger(ticks),
  );
  return { name, startTicks, ticks };
}

function observe(group: string) {
  assert.ok(group.startsWith("/") && posix.normalize(group) === group);
  const ticksByProcess = new Map<
    string,
    { name: string; before: number; after: number }
  >();
  let snapshots = 0;
  const snapshot = () => {
    for (const pid of readFileSync(
      join("/sys/fs/cgroup", group, "cgroup.procs"),
      "utf8",
    )
      .trim()
      .split(/\s+/)) {
      if (!/^\d+$/.test(pid)) continue;
      try {
        const { name, startTicks, ticks } = processTicks(
          readFileSync("/proc/" + pid + "/stat", "utf8"),
        );
        const key = pid + ":" + startTicks;
        const previous = ticksByProcess.get(key);
        ticksByProcess.set(key, {
          name,
          before: previous?.before ?? (snapshots === 0 ? ticks : 0),
          after: ticks,
        });
      } catch (error) {
        if (
          !["ENOENT", "ESRCH"].includes(
            (error as NodeJS.ErrnoException).code ?? "",
          )
        )
          throw error;
      }
    }
    snapshots++;
  };
  snapshot();
  const timer = setInterval(snapshot, 125);
  parentPort?.postMessage("ready");
  parentPort?.once("message", () => {
    clearInterval(timer);
    snapshot();
    parentPort?.postMessage({
      scored: false,
      snapshots,
      samplerSharesParentProcess: true,
      actors: [...ticksByProcess.values()]
        .map(({ name, before, after }) => ({ name, cpuTicks: after - before }))
        .filter(({ cpuTicks }) => cpuTicks > 0)
        .sort((a, b) => b.cpuTicks - a.cpuTicks),
    });
  });
}

if (!isMainThread) observe(workerData as string);

export async function withRunnerActors<T>(
  group: string,
  replay: () => Promise<T>,
  save: (report: unknown) => Promise<void>,
) {
  const worker = new Worker(new URL(import.meta.url), { workerData: group });
  let failure: Error | undefined;
  worker.on("error", (error) => {
    failure = error;
  });
  const next = () =>
    once(worker, "message", { signal: AbortSignal.timeout(10000) });
  try {
    assert.equal((await next())[0], "ready");
    try {
      return await replay();
    } finally {
      if (failure) throw failure;
      const completion = next();
      worker.postMessage("stop");
      await save((await completion)[0]);
    }
  } finally {
    await worker.terminate();
  }
}
