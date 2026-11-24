import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { rmSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { hostname } from "node:os";
import { join, relative, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
  benchmarkComparison,
  type Matched,
} from "../../../shared/enablement/performance/comparison.ts";

const [
  runtime,
  assets,
  revision,
  jobArg,
  candidateAssets,
  candidateRevision,
  ...extra
] = process.argv.slice(2);
assert(
  runtime &&
    assets &&
    revision &&
    jobArg &&
    !extra.length &&
    Boolean(candidateAssets) === Boolean(candidateRevision),
  "Usage: benchmark.ts ELECTRON CONTROL_ASSETS CONTROL_SHA PRIVATE_JOB [CANDIDATE_ASSETS CANDIDATE_SHA]",
);
for (const sha of [revision, candidateRevision ?? revision])
  assert.match(sha, /^[0-9a-f]{40}$/);
assert.equal(process.platform, "linux");
const job = await realpath(jobArg);
const info = await stat(job);
assert(
  info.isDirectory() &&
    info.uid === process.getuid?.() &&
    (info.mode & 0o077) === 0,
);
process.umask(0o077);
const hosted =
  process.env.GITHUB_ACTIONS === "true" &&
  process.env.RUNNER_ENVIRONMENT === "github-hosted" &&
  process.env.GITHUB_REPOSITORY === "tryapparent/apparent";
const scratch = hosted
  ? await mkdtemp(join(tmpdir(), "onboarding-trial-"))
  : join(job, "tmp");
if (hosted)
  process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));
else await mkdir(scratch);
process.env.TMPDIR = scratch;
const driver = fileURLToPath(new URL("../click-through.ts", import.meta.url));
const scoreStage = "coach-open-to-interactive";
const required = [
  scoreStage,
  "whiteboard-open-to-usable",
  "whiteboard-open-to-painted-canvas",
  "practice-record-to-first-media",
  "practice-finish-to-verified-clipboard",
  "finish-setup-to-persisted-close",
] as const;
const hostPsiLimitPercent = 10;
const minimumHostIdlePercent = 30;
const minimumHostAvailableMemoryKiB = 1024 * 1024;
const hostWaitLimitMs = 30_000;
const hostedIoPressureLimitPercent = 5;
const hostedStealLimitPercent = 5;
const cohort = process.env.APPARENT_ONBOARDING_HOSTED_COHORT;
if (hosted) assert.match(cohort ?? "", /^[a-f0-9]{64}$/);
const hostIdentity = {
  hostname: hostname(),
  kernel: (await readFile("/proc/sys/kernel/osrelease", "utf8")).trim(),
  node: process.version,
  ...(hosted && {
    provider: "github-hosted-ubuntu-24.04",
    runId: process.env.GITHUB_RUN_ID,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    imageVersion: process.env.ImageVersion,
    cohort,
  }),
};
const pairs = ["control-1", "candidate-1", "candidate-2", "control-2"] as const;
type Variant = "cold" | "resumed";
type Build = { revision: string; assets: string };
type Usage = {
  userSeconds: number;
  systemSeconds: number;
  peakProcessRssKiB: number;
};
type Raw = {
  attempt: string;
  variant: Variant;
  detailed: boolean;
  waits: Record<string, { ms: number; verified: boolean }>;
  verified: Record<string, boolean>;
  identity: {
    runtimeSha256: string;
    entrySha256: string;
    collectorSha256: string;
    fixtureSha256: string;
  };
  resources: { coach: Usage; whiteboard: Usage; outputBytes: number };
  environment: {
    memAvailableKiB: number;
    cpuPressureBefore: string;
    cpuPressureAfter: string;
    ioPressureBefore: string;
    ioPressureAfter: string;
    hostCpuBefore: string;
    hostCpuAfter: string;
  };
};
const psi10 = (sample: string, kind = "some") =>
  Number(
    sample
      .split("\n")
      .find((row) => row.startsWith(kind + " "))
      ?.match(/ avg10=([\d.]+) /)?.[1],
  );
const cpuValues = (row: string) =>
  row.trim().split(/\s+/).slice(1, 9).map(Number);
function cpuPercentages(before: string, after: string) {
  const first = cpuValues(before);
  const delta = cpuValues(after).map((value, index) => value - first[index]);
  const total = delta.reduce((sum, value) => sum + value, 0);
  return { idle: (100 * delta[3]) / total, steal: (100 * delta[7]) / total };
}
async function waitForQuietHost(dir: string) {
  const deadline = performance.now() + hostWaitLimitMs;
  const cpu = async () =>
    (await readFile("/proc/stat", "utf8")).split("\n", 1)[0];
  let before = await cpu();
  const samples = [];
  for (;;) {
    await delay(1000);
    const after = await cpu();
    const { idle, steal } = cpuPercentages(before, after);
    const cpuPressure = await readFile("/proc/pressure/cpu", "utf8");
    const ioPressure = await readFile("/proc/pressure/io", "utf8");
    const psi = psi10(cpuPressure);
    const io = psi10(ioPressure, "full");
    const admitted =
      psi <= hostPsiLimitPercent &&
      idle >= minimumHostIdlePercent &&
      (!hosted ||
        (io <= hostedIoPressureLimitPercent &&
          steal <= hostedStealLimitPercent));
    samples.push({
      before,
      after,
      idle,
      steal,
      cpuPressure,
      ioPressure,
      admitted,
    });
    const expired = performance.now() >= deadline;
    if (admitted || expired) {
      await writeFile(
        join(dir, "admission.json"),
        JSON.stringify(samples, null, 2) + "\n",
      );
      assert(
        admitted,
        `Host admission timed out at ${psi}% CPU PSI, ${idle.toFixed(1)}% idle, ${io}% full I/O PSI and ${steal.toFixed(1)}% steal`,
      );
      return;
    }
    before = after;
  }
}
const control = { assets: resolve(assets), revision };
const candidate =
  candidateAssets && candidateRevision
    ? { assets: resolve(candidateAssets), revision: candidateRevision }
    : control;

async function observation(
  group: string,
  position: (typeof pairs)[number],
  variant: Variant,
  build: Build,
  detailed: boolean,
) {
  const dir = join(job, `${group}-${variant}-${position}`);
  await mkdir(dir);
  await writeFile(
    join(dir, "inputs.json"),
    JSON.stringify({ build, hostIdentity, variant, detailed }, null, 2) + "\n",
    { flag: "wx" },
  );
  try {
    await waitForQuietHost(dir);
    const env = {
      ...process.env,
      APPARENT_ONBOARDING_OBSERVATION: detailed ? "detailed" : "minimal",
      APPARENT_ONBOARDING_PROFILE_ROOT: scratch,
    };
    delete (env as NodeJS.ProcessEnv).WAYLAND_DISPLAY;
    const child = spawn(
      "xvfb-run",
      [
        "-a",
        process.execPath,
        driver,
        resolve(runtime),
        build.assets,
        dir,
        "1",
        variant,
      ],
      {
        env,
        stdio: ["ignore", "inherit", "inherit"],
      },
    );
    const [code, signal] = await once(child, "exit");
    assert.equal(code, 0, "Click-through exited " + signal);
    const receiptPath = join(dir, "click-through-1.json");
    const raw = JSON.parse(await readFile(receiptPath, "utf8")) as Raw;
    assert.equal(raw.variant, variant);
    assert.equal(raw.detailed, detailed);
    assert.match(raw.attempt, /^[a-f0-9]{32}$/);
    for (const stage of required) {
      assert.equal(raw.waits[stage]?.verified, true, stage);
      assert(
        Number.isFinite(raw.waits[stage].ms) && raw.waits[stage].ms > 0,
        stage,
      );
    }
    for (const check of [
      "coach",
      "renderedWhiteboardStroke",
      "syntheticFirstMediaReadback",
      "syntheticClipboardReadback",
      "syntheticProgressReadback",
      "coachClosed",
    ])
      assert.equal(raw.verified[check], true, check);
    const {
      cpuPressureBefore,
      cpuPressureAfter,
      ioPressureBefore,
      ioPressureAfter,
      hostCpuBefore,
      hostCpuAfter,
    } = raw.environment;
    const pressure = Math.max(
      psi10(cpuPressureBefore),
      psi10(cpuPressureAfter),
    );
    const io = Math.max(
      psi10(ioPressureBefore, "full"),
      psi10(ioPressureAfter, "full"),
    );
    const { idle, steal } = cpuPercentages(hostCpuBefore, hostCpuAfter);
    const valid =
      pressure <= hostPsiLimitPercent &&
      idle >= minimumHostIdlePercent &&
      raw.environment.memAvailableKiB >= minimumHostAvailableMemoryKiB &&
      (!hosted ||
        (io <= hostedIoPressureLimitPercent &&
          steal <= hostedStealLimitPercent));
    return {
      valid,
      pressure,
      idle,
      ioPressure: io,
      steal,
      build,
      receiptPath: relative(job, receiptPath),
      raw,
    };
  } catch (error) {
    await writeFile(
      join(dir, "invalid.json"),
      JSON.stringify({ error: String(error) }) + "\n",
      { flag: "wx" },
    );
    throw error;
  }
}

const groups =
  candidate === control
    ? (["repeat", "overhead"] as const)
    : (["candidate"] as const);
const observations = [];
for (const variant of ["cold", "resumed"] as const) {
  for (const group of groups) {
    const collect = (p: (typeof pairs)[number], b: boolean) =>
      observation(
        group,
        p,
        variant,
        b ? candidate : control,
        group !== "overhead" || b,
      );
    const runs = [
      await collect(pairs[0], false),
      await collect(pairs[1], true),
      await collect(pairs[2], true),
      await collect(pairs[3], false),
    ] as const;
    const first = runs[0].raw.identity;
    assert.equal(new Set(runs.map(({ raw }) => raw.attempt)).size, 4);
    for (const { raw } of runs) {
      assert.equal(raw.identity.runtimeSha256, first.runtimeSha256);
      assert.equal(raw.identity.collectorSha256, first.collectorSha256);
      assert.equal(raw.identity.fixtureSha256, first.fixtureSha256);
    }
    const values = (get: (raw: Raw) => number): Matched<number> => [
      get(runs[0].raw),
      get(runs[1].raw),
      get(runs[2].raw),
      get(runs[3].raw),
    ];
    const sameBuild = (left: 0 | 1, right: 2 | 3) =>
      assert.deepEqual(runs[left].raw.identity, runs[right].raw.identity);
    sameBuild(0, 3);
    sameBuild(1, 2);
    if (candidate === control) sameBuild(0, 2);
    const cpu = ({ resources: { coach, whiteboard } }: Raw) =>
      coach.userSeconds +
      coach.systemSeconds +
      whiteboard.userSeconds +
      whiteboard.systemSeconds;
    const rss = ({ resources: { coach, whiteboard } }: Raw) =>
      Math.max(coach.peakProcessRssKiB, whiteboard.peakProcessRssKiB);
    const guardValues = [
      values(cpu),
      values(rss),
      values((raw) => raw.resources.outputBytes),
    ];
    const guard = (repeats: Matched<number>, minimumAllowance: number) => {
      const ceiling = Math.max(repeats[0], repeats[3]);
      const allowance = Math.max(
        ceiling * (minimumAllowance > 0 ? 0.1 : 0),
        minimumAllowance,
      );
      return [
        [repeats[1], ceiling, allowance],
        [repeats[2], ceiling, allowance],
      ] as [number, number, number][];
    };
    const limits = guard(guardValues[0], 0.05).concat(
      guard(guardValues[1], 4096),
      guard(guardValues[2], 0),
    );
    const stageWaits = required.map((stage) =>
      values((raw) => raw.waits[stage].ms),
    );
    const guardedStages = required.filter(
      (stage) =>
        group === "candidate" &&
        (variant === "resumed" || stage !== scoreStage),
    );
    const stageLimits = guardedStages.flatMap((stage) =>
      guard(stageWaits[required.indexOf(stage)], 20),
    );
    const comparison = await benchmarkComparison(stageWaits, [
      ...limits,
      ...stageLimits,
    ]);
    const outputSizesMatch = new Set(guardValues[2]).size === 1;
    const stages = required.map((stage, index) => ({
      stage,
      ...comparison.timings[index],
    }));
    const result = {
      group,
      variant,
      identity: {
        runtimeSha256: first.runtimeSha256,
        collectorSha256: first.collectorSha256,
        fixtureSha256: first.fixtureSha256,
      },
      stages,
      resourceGuards: {
        cpuSeconds: guardValues[0],
        peakProcessRssKiB: guardValues[1],
        outputBytes: guardValues[2],
        permitted: comparison.permitted.slice(0, limits.length),
      },
      stageGuards: guardedStages.map((stage, index) => ({
        stage,
        permitted: comparison.permitted.slice(
          limits.length + 2 * index,
          limits.length + 2 * index + 2,
        ),
      })),
      runs: runs.map(({ raw, ...item }) => ({ ...item, attempt: raw.attempt })),
      qualified:
        outputSizesMatch &&
        comparison.permitted.every(Boolean) &&
        runs.every(({ valid }) => valid),
    };
    await writeFile(
      join(job, `${group}-${variant}.json`),
      JSON.stringify(result, null, 2) + "\n",
      { flag: "wx" },
    );
    observations.push(result);
  }
}
const baseline =
  candidate === control
    ? observations
        .filter(({ group }) => group === "repeat")
        .map(({ variant, stages, qualified }) => {
          const {
            controlMs: [a, b],
            controlMeanMs,
            candidateMs: [c, d],
          } = stages[0];
          const toSpeed = (ms: number) => controlMeanMs / ms;
          const speeds = [a, b, c, d].map(toSpeed);
          const speedNoise = Math.max(...speeds) - Math.min(...speeds);
          return {
            variant,
            stage: scoreStage,
            qualified,
            controlScore: 100,
            controlMeanMs,
            speedNoise,
          };
        })
    : undefined;
const summary = {
  schema: 1,
  eligibility: hosted ? "hosted-scoring" : "local-diagnostic",
  hostIdentity,
  control,
  candidate,
  contention: {
    hostPsiLimitPercent,
    minimumHostIdlePercent,
    minimumHostAvailableMemoryKiB,
    ...(hosted && { hostedIoPressureLimitPercent, hostedStealLimitPercent }),
  },
  baseline,
  observations,
};
const report = join(job, "benchmark.json");
await writeFile(report, JSON.stringify(summary, null, 2) + "\n", {
  flag: "wx",
});
console.log(
  JSON.stringify({
    report,
    eligibility: summary.eligibility,
    baseline,
    scores: observations.map(({ group, variant, stages, qualified }) => ({
      group,
      variant,
      qualified,
      score: stages[0].score,
    })),
  }),
);
if (observations.some(({ qualified }) => !qualified)) process.exitCode = 2;
