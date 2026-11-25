import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Matched } from "../../../shared/enablement/performance/comparison.ts";
import { readCpuUsage } from "./hosted/quota.ts";
import { runReplayUnit } from "./hosted/replay-unit.ts";
import type { watchAttempt } from "./watch.ts";
import { nativeFixtureSources, type NativeBuild } from "./native/sender.ts";

export type Replay = {
  revision: string;
  chromium: string;
  attempts: Awaited<ReturnType<typeof watchAttempt>>[];
};

export type Resource = {
  cpuSeconds: number;
  peakProcessRssKiB: number;
  storedCaptureBytes: number;
  externalCpuPercent: number;
  peakHostWaitPercent: number;
};

const self = "connect/enablement/benchmark/";
const runnerFiles = [
  "recipient.ts",
  "watch.ts",
  "watch-trace.ts",
  "watch-sample.ts",
  "watch-ledger.ts",
  "watch-score.ts",
];
export const read = async <T>(path: string): Promise<T> =>
  JSON.parse(await readFile(path, "utf8"));
export const hash = async (path: string) =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
export const mean = (values: number[]) =>
  values.reduce((sum, value) => sum + value, 0) / values.length;
export const runMs = (run: Replay) =>
  mean(run.attempts.map((row) => row.rawMs.shareToAdvancingFrameAck));
export const fixture = (run: Replay) =>
  run.attempts.map((row) => row.proof.manifest);

export const maxExternalPercent = 5;
export const quietResources = (
  resource: Pick<Resource, "externalCpuPercent" | "peakHostWaitPercent">,
) =>
  resource.externalCpuPercent <= maxExternalPercent &&
  resource.peakHostWaitPercent <= maxExternalPercent;

export async function cpuCounters(cpus: number[]) {
  const text = await readFile("/proc/stat", "utf8");
  return cpus.map((cpu) => {
    const row = text
      .split("\n")
      .find((line) => line.startsWith("cpu" + cpu + " "));
    assert.ok(row, "Missing Linux CPU " + cpu);
    const [user, nice, system, idle, io, irq, softirq, steal] = row
      .trim()
      .split(/\s+/)
      .slice(1)
      .map(Number);
    const busy = user + nice + system + irq + softirq + steal;
    return { total: busy + idle + io, busy, wait: io + steal };
  });
}

export async function affinity(spec: string) {
  assert.match(spec, /^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/);
  const cpus = spec.split(",").flatMap((range) => {
    const [start, end = start] = range.split("-").map(Number);
    assert.ok(end >= start && end - start < 4096, "Invalid CPU range");
    return Array.from({ length: end - start + 1 }, (_, index) => start + index);
  });
  assert.equal(new Set(cpus).size, cpus.length, "Repeated CPU in affinity");
  for (const cpu of cpus) {
    const siblings = (
      await readFile(
        "/sys/devices/system/cpu/cpu" + cpu + "/topology/thread_siblings_list",
        "utf8",
      )
    ).trim();
    for (const range of siblings.split(",")) {
      const [start, end = start] = range.split("-").map(Number);
      for (let index = start; index <= end; index++) {
        assert.ok(
          cpus.includes(index),
          "Include both SMT siblings in the CPU set",
        );
      }
    }
  }
  return cpus;
}

export async function sample(
  tree: string,
  result: string,
  chrome: string,
  cpuSpec: string,
  traced: boolean,
  hostedCgroup?: string,
  enforceSubset = false,
  native?: NativeBuild,
) {
  const cpus = await affinity(cpuSpec);
  const command = join(tree, self, "recipient.ts");
  const worker = join(tree, "connect/service/dist/worker.js");
  const workerHash = await hash(worker);
  const harness = await Promise.all(
    [
      ...runnerFiles.map((name) => self + name),
      ...(native ? [self + "native/sender.ts", ...nativeFixtureSources] : []),
    ].map((name) => hash(join(tree, name))),
  );
  if (native) assert.equal(await hash(native.binary), native.hash);
  const revision = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: tree,
    encoding: "utf8",
  }).trim();
  execFileSync(
    "git",
    [
      "diff",
      "--exit-code",
      "HEAD",
      "--",
      "connect/service",
      "connect/client",
      "shared/ui",
      "shared/assets",
    ],
    { cwd: tree, stdio: "pipe" },
  );
  const log = join(await mkdtemp(join(result, "sample-")), "resources.txt");
  const clockTicks = Number(
    execFileSync("getconf", ["CLK_TCK"], { encoding: "utf8" }),
  );
  const scopeBefore = hostedCgroup && (await readCpuUsage(hostedCgroup));
  const before = await cpuCounters(cpus);
  const args = [
    "-c",
    cpuSpec,
    "/usr/bin/time",
    "-o",
    log,
    "-f",
    "%U %S %M",
    process.execPath,
    command,
    result,
    chrome,
    traced ? "watch-traced" : "watch-untraced",
    ...(native ? [JSON.stringify(native)] : []),
  ];
  const cwd = join(tree, "connect/service");
  const unit = hostedCgroup
    ? runReplayUnit(
        args,
        cwd,
        result,
        dirname(log),
        enforceSubset ? cpuSpec : undefined,
      )
    : undefined;
  const replayPath =
    unit?.replayPath ??
    execFileSync("taskset", args, {
      cwd,
      encoding: "utf8",
      timeout: 90000,
      env: { ...process.env, TMPDIR: result },
    }).trim();
  const after = await cpuCounters(cpus);
  const scopeAfter = hostedCgroup && (await readCpuUsage(hostedCgroup));
  const replay = await read<Replay>(replayPath);
  assert.equal(replay.revision, revision);
  assert.deepEqual(
    replay.attempts.map((row) => row.variant),
    ["cold", "warm"],
  );
  assert.ok(
    replay.attempts.every(
      (row) =>
        row.proof.originalBytesVerified &&
        row.trace === traced &&
        runMs(replay) > 0,
    ),
  );
  assert.deepEqual(fixture(replay)[0], fixture(replay)[1]);
  for (const { proof } of replay.attempts) {
    assert.equal(proof.nativeSender?.sha, native?.sha);
    assert.equal(proof.nativeSender?.hash, native?.hash);
  }
  const [user, system, peakProcessRssKiB] = (await readFile(log, "utf8"))
    .trim()
    .split(" ")
    .map(Number);
  const gnuTimeSeconds = user + system;
  const cpuSeconds = unit
    ? (unit.replayCgroup.afterUsec - unit.replayCgroup.beforeUsec) / 1000000
    : gnuTimeSeconds;
  const deltas = after.map((row, index) => [
    row.total - before[index].total,
    row.busy - before[index].busy,
    row.wait - before[index].wait,
  ]);
  const total = deltas.reduce((sum, [ticks]) => sum + ticks, 0);
  const busy = deltas.reduce((sum, [, ticks]) => sum + ticks, 0);
  const resource: Resource = {
    cpuSeconds,
    peakProcessRssKiB,
    storedCaptureBytes: fixture(replay)[0].reduce(
      (sum, file) => sum + file.size,
      0,
    ),
    externalCpuPercent:
      (100 * Math.max(0, busy - cpuSeconds * clockTicks)) / total,
    peakHostWaitPercent: Math.max(
      ...deltas.map(([ticks, , wait]) => (100 * wait) / ticks),
    ),
  };
  assert.ok(Object.values(resource).every(Number.isFinite));
  return {
    replay,
    replayPath,
    workerHash,
    harness,
    resource,
    log,
    cpuAccounting: {
      clockTicks,
      gnuTimeSeconds,
      replayCgroup: unit?.replayCgroup,
      affinity: unit?.affinity,
      cpus,
      before,
      after,
      ...(typeof scopeBefore === "number" && typeof scopeAfter === "number"
        ? {
            runnerCgroup: {
              path: hostedCgroup,
              beforeUsec: scopeBefore,
              afterUsec: scopeAfter,
            },
          }
        : {}),
    },
  };
}

export type Sample = Awaited<ReturnType<typeof sample>>;
export type Benchmark = {
  contractHash: string;
  mode: "baseline" | "compare";
  valid: boolean;
  qualified: boolean;
  noiseSpeedIndex: number;
  runtime: {
    host: string;
    cpuSpec: string;
    node: string;
    chrome: string;
    ffmpeg: string;
  };
  samples: Matched<Sample>;
};

export function validate(sample: Sample, first: Sample) {
  assert.deepEqual(
    fixture(sample.replay),
    fixture(first.replay),
    "Synthetic asset bytes changed",
  );
  assert.deepEqual(sample.harness, first.harness, "Harness changed");
  assert.equal(
    sample.replay.chromium,
    first.replay.chromium,
    "Chromium version changed",
  );
}
