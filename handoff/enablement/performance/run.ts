import { hostedInterference, hostedMeter } from "./diagnostics/hosted-guard.ts";
import { schedulerDiagnostic } from "./diagnostics/scheduler.ts";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import { cpus, release } from "node:os";
import { isAbsolute, join } from "node:path";
import { setTimeout } from "node:timers/promises";
import {
  benchmarkComparison,
  type Matched,
} from "../../../shared/enablement/performance/comparison.ts";
import { fixture, scenario, type ScenarioDriver } from "./scenario.ts";
import { preflight, pressureDelta, pressureSample } from "./pressure.ts";
import policy from "./benchmark.json" with { type: "json" };

type Driver = {
  forBuild(frontend: string): ScenarioDriver;
  buildProbes(build: string, output: string): Promise<void>;
};
type Trial = Awaited<ReturnType<typeof scenario>>;
const millis = (trial: Trial) => trial.waits.pickerMs + trial.waits.sendMs;
const mean = (values: number[]) =>
  values.reduce((sum, value) => sum + value, 0) / values.length;
const median = (values: number[]) => {
  const ordered = values.toSorted((a, b) => a - b);
  return (
    (ordered[Math.floor((ordered.length - 1) / 2)] +
      ordered[Math.ceil((ordered.length - 1) / 2)]) /
    2
  );
};
const hash = (data: Buffer) => createHash("sha256").update(data).digest("hex");
const frontendPath = "capture/desktop/ui/frontend";

async function buildInfo(path: string) {
  assert.ok(isAbsolute(path), "Expected an absolute prepared build path");
  const root = await realpath(path);
  const frontend = join(root, frontendPath);
  const revision = (
    await readFile(join(root, "APPARENT_BENCH_REVISION"), "utf8")
  ).trim();
  assert.match(revision, /^[a-f0-9]{40}$/);
  const artifacts = [
    "tests/pill/host.cjs",
    "electron/pill/main.cjs",
    "electron/pill/preload.cjs",
    "electron/pill/t3.cjs",
    "dist/pill/index.html",
    "package-lock.json",
  ];
  const hashes = Object.fromEntries(
    await Promise.all(
      artifacts.map(async (name) => [
        name,
        hash(await readFile(join(frontend, name))),
      ]),
    ),
  );
  return { root, frontend, revision, hashes };
}

export async function runFocused(driver: Driver, args: string[]) {
  const [mode, destination, controlPath, candidatePath = controlPath, extra] =
    args;
  assert.ok(
    ["pilot", "baseline", "compare"].includes(mode) &&
      destination &&
      controlPath &&
      !extra,
    "Expected pilot|baseline|compare PRIVATE_JOB_DIR CONTROL_BUILD [CANDIDATE_BUILD]",
  );
  assert.ok(
    process.platform === "linux" &&
      process.env.DISPLAY &&
      !process.env.WAYLAND_DISPLAY &&
      !process.env.DBUS_SESSION_BUS_ADDRESS,
    "Run with a private Xvfb display and no desktop bus",
  );
  const work = await realpath(destination);
  assert.match(work, /^\/tmp\/apparent-dev-[^/]+$/);
  assert.equal(
    (await stat(work)).mode & 0o077,
    0,
    "Job directory must be private",
  );
  const output = await mkdtemp(join(work, mode + "-"));
  console.error("Retaining evidence in " + output);
  const qualifies = (pressure: Awaited<ReturnType<typeof preflight>>) =>
    pressure.cpuPercent <= policy.cpuPressurePercent &&
    pressure.ioPercent <= policy.ioPressurePercent;
  const meter =
    process.env.RUNNER_ENVIRONMENT === "github-hosted" && mode !== "pilot"
      ? hostedMeter()
      : null;
  const interference = (
    start: ReturnType<NonNullable<typeof meter>["snapshot"]>,
    ioPercent: number,
  ) =>
    hostedInterference(
      start,
      meter!.snapshot(),
      ioPercent,
      policy.cpuPressurePercent,
      policy.ioPressurePercent,
    );
  if (mode !== "pilot") {
    const samples = [];
    const deadline = Date.now() + 120_000;
    let qualified = false;
    do {
      const start = meter?.snapshot();
      const pressure = await preflight();
      const hosted = start && interference(start, pressure.ioPercent);
      qualified = hosted?.qualified ?? qualifies(pressure);
      samples.push({ pressure, hosted, qualified });
      if (!qualified && Date.now() < deadline) await setTimeout(6000);
    } while (!qualified && Date.now() < deadline);
    await writeFile(
      join(output, "preflight.json"),
      JSON.stringify(samples, null, 2),
    );
    assert.ok(qualified, "Host is contended. See preflight.json");
  }
  const control = await buildInfo(controlPath);
  const candidate = await buildInfo(candidatePath);
  if (mode === "compare") {
    assert.notEqual(
      control.revision,
      candidate.revision,
      "Expected a distinct candidate revision",
    );
  } else {
    assert.deepEqual(control, candidate);
  }
  const controlDriver = driver.forBuild(control.frontend);
  const candidateDriver = driver.forBuild(candidate.frontend);
  const tracedHosts = new Map<string, string>();
  let trialIndex = 0;
  async function run(
    build: typeof control,
    provider: typeof controlDriver,
    warm: boolean,
    traced: boolean,
  ) {
    let host = join(build.frontend, "tests/pill/host.cjs");
    if (traced) {
      if (!tracedHosts.has(build.root)) {
        const staged = await mkdtemp(join(output, "probe-build-"));
        await mkdir(join(staged, "electron"));
        await mkdir(join(staged, "tests/pill"), { recursive: true });
        await Promise.all([
          cp(join(build.frontend, "dist"), join(staged, "dist"), {
            recursive: true,
          }),
          cp(
            join(build.frontend, "electron/pill"),
            join(staged, "electron/pill"),
            { recursive: true },
          ),
          cp(host, join(staged, "tests/pill/host.cjs")),
        ]);
        await driver.buildProbes(
          build.root,
          join(staged, "electron/pill/t3.cjs"),
        );
        tracedHosts.set(build.root, join(staged, "tests/pill/host.cjs"));
      }
      host = tracedHosts.get(build.root)!;
    }
    for (
      let attempt = 0;
      attempt < policy.maxTrialPressureAttempts;
      attempt++
    ) {
      const index = ++trialIndex;
      try {
        const start = await pressureSample();
        const cpuStart = meter?.snapshot();
        const trial = await scenario({
          ...provider,
          host,
          scratch: output,
          warm,
          traced,
          proof: mode === "pilot",
        });
        const pressure = pressureDelta(start, await pressureSample());
        const hosted = cpuStart && interference(cpuStart, pressure.ioPercent);
        const qualifiedPressure = hosted?.qualified ?? qualifies(pressure);
        await writeFile(
          join(output, `trial-${index}.json`),
          JSON.stringify(
            {
              ...trial,
              pressure,
              hosted,
              qualifiedPressure,
            },
            null,
            2,
          ),
        );
        if (mode !== "pilot" && !qualifiedPressure) {
          console.error(
            `Trial ${index} invalidated by pressure; see trial-${index}.json`,
          );
          if (attempt + 1 < policy.maxTrialPressureAttempts)
            await setTimeout(2000);
          continue;
        }
        console.error(
          `Trial ${index} ${trial.variant} ${traced ? "traced" : "quiet"} ${millis(trial).toFixed(2)} ms`,
        );
        return trial;
      } catch (error) {
        await writeFile(
          join(output, `invalid-${index}.txt`),
          String((error as Error).stack ?? error),
        );
        throw error;
      }
    }
    if (process.env.RUNNER_ENVIRONMENT === "github-hosted") {
      try {
        const diagnostic = await schedulerDiagnostic();
        try {
          await scenario({
            ...provider,
            host,
            scratch: output,
            warm,
            traced,
            diagnose: diagnostic.mark,
          });
        } finally {
          await diagnostic.mark("after-cleanup");
          await writeFile(
            join(output, "scheduler-diagnostic.json"),
            JSON.stringify(diagnostic.evidence, null, 2),
          );
        }
      } catch (error) {
        await writeFile(
          join(output, "scheduler-diagnostic-error.txt"),
          String(error),
        );
      }
    }
    throw Error(
      "Host did not provide enough quiet time for the next matched trial",
    );
  }

  if (mode === "pilot") {
    for (const warm of [false, true])
      await run(control, controlDriver, warm, true);
    return;
  }

  const quiet: Trial[][] = [];
  const cohort = policy.trialsPerVariantPerBatch;
  for (const [i, build] of [control, candidate, candidate, control].entries()) {
    const trials = [];
    const provider = i === 0 || i === 3 ? controlDriver : candidateDriver;
    for (let round = 0; round < cohort; round++)
      for (const warm of round % 2 ? [true, false] : [false, true])
        trials.push(await run(build, provider, warm, false));
    quiet.push(trials);
  }
  const traced: Trial[] = [];
  for (const [build, provider] of [
    [control, controlDriver],
    [candidate, candidateDriver],
  ] as const)
    for (const warm of [false, true])
      traced.push(await run(build, provider, warm, true));

  const runtime = quiet[0][0].runtime;
  for (const trial of [...quiet.flat(), ...traced])
    assert.deepEqual(
      trial.runtime,
      runtime,
      "Electron runtime changed across repeats",
    );
  const variants = policy.variants;
  const variantWaits = variants.map(
    (variant) =>
      quiet.map((batch) =>
        median(batch.filter((trial) => trial.variant === variant).map(millis)),
      ) as Matched<number>,
  );
  const aggregate = quiet.map((_, index) =>
    mean(variantWaits.map((waits) => waits[index])),
  ) as Matched<number>;
  const resources = (
    ["appCpuSeconds", "appPostSendPssKiB", "durableReceiptBytes"] as const
  ).map((metric) => {
    const values = quiet.map((batch) =>
      mean(batch.map((trial) => trial.resources[metric])),
    );
    return {
      metric,
      control: mean([values[0], values[3]]),
      candidate: [values[1], values[2]],
    };
  });
  const { timings, permitted } = await benchmarkComparison(
    [aggregate, ...variantWaits],
    [
      ...resources.flatMap(({ control, candidate, metric }) =>
        candidate.map(
          (value) =>
            [
              value,
              control,
              metric === "durableReceiptBytes"
                ? policy.retainedReceiptAllowanceBytes
                : policy.relativeAppResourceAllowance * control,
            ] as [number, number, number],
        ),
      ),
      ...variantWaits.flatMap(
        ([a, b, bRepeat, aRepeat]) =>
          [
            [b, a, policy.variantRegressionAllowanceMs],
            [bRepeat, aRepeat, policy.variantRegressionAllowanceMs],
          ] as [number, number, number][],
      ),
    ],
  );
  const absoluteGuard = quiet
    .flat()
    .every(
      ({ resources }) =>
        resources.appCpuSeconds <= policy.maxAppCpuSeconds &&
        resources.appPostSendPssKiB <= policy.maxAppPostSendPssKiB &&
        resources.durableReceiptBytes <= policy.maxRetainedReceiptBytes,
    );
  const baselineScore = 100;
  const quietReference = timings[0].controlMeanMs;
  const noise =
    mode === "baseline"
      ? Math.max(
          ...aggregate.map((ms) => 100 / ((100 * ms) / quietReference)),
        ) -
        Math.min(...aggregate.map((ms) => 100 / ((100 * ms) / quietReference)))
      : null;
  const outputReceipt = {
    schema: 1,
    benchmark: policy.version,
    ...(meter && { pressureContract: "hosted-outside-cpu-v1" }),
    fixture,
    mode,
    runner: {
      platform: process.platform,
      architecture: process.arch,
      kernel: release(),
      cpuModel: cpus()[0]?.model,
      logicalCpuCount: cpus().length,
      node: process.versions.node,
      electron: quiet[0][0].runtime.electron,
      chrome: quiet[0][0].runtime.chrome,
    },
    control,
    candidate,
    qualified:
      absoluteGuard && (mode === "baseline" || permitted.every(Boolean)),
    baselineScore,
    score: mode === "baseline" ? baselineScore : timings[0].score,
    sameBuildSpeedNoise: noise,
    repeats: timings[0],
    variants: Object.fromEntries(
      variants.map((variant, i) => [variant, timings[i + 1]]),
    ),
    resources,
    guardResults: { absolute: absoluteGuard, matched: permitted },
    probeComparison: traced.map((trial, i) => ({
      attempt: trial.attempt,
      side: i < 2 ? "control" : "candidate",
      variant: trial.variant,
      tracedMs: millis(trial),
      quietMedianMs: median(
        quiet
          .slice(i < 2 ? 0 : 1, i < 2 ? 4 : 3)
          .filter((_, batch) => i >= 2 || batch === 0 || batch === 3)
          .flat()
          .filter(({ variant }) => variant === trial.variant)
          .map(millis),
      ),
    })),
    trials: quiet.map((trial) =>
      trial.map(({ attempt, waits, receipt }) => ({ attempt, waits, receipt })),
    ),
    evidenceDirectory: output,
  };
  const receipt = JSON.stringify(outputReceipt, null, 2);
  await writeFile(join(output, "comparison.json"), receipt + "\n");
  console.log(receipt);
}
