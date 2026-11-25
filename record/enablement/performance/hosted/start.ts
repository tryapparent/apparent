import assert from "node:assert/strict";
import { accessSync, constants, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  pressureTotalUs,
  quietPressureLimitPercent,
  waitForQuietStart,
} from "../fixtures/host-pressure.ts";
import { locate } from "../local/attempt.ts";
import {
  driverCpuSnapshot,
  hostedAccountingPolicy,
} from "../fixtures/host-accounting.ts";
import {
  apt,
  command,
  cpuSample,
  hostCounters,
  json,
  openJob,
  receipt,
  sha256,
  stageRevision,
  stealSince,
} from "./job.ts";
import { runInMeasurementScope } from "./measurement-scope.ts";
import { verifyAccounting } from "./accounting-proof.ts";
import { startWaterfall } from "./start-waterfall.ts";

const job = openJob("start");
apt("xvfb", "xauth", "xdotool", "libgtk-3-0t64", "libnss3", "libasound2t64");

async function build(checkout: string, revision: string, name: string) {
  const tree = stageRevision(checkout, revision, job, name);
  const desktop = join(tree, "capture/desktop/ui/frontend");
  const options = { cwd: desktop, env: job.env };
  command(
    "npm",
    ["ci", "--ignore-scripts", "--no-audit", "--no-fund"],
    options,
  );
  command(process.execPath, ["node_modules/electron/install.js"], options);
  command("npm", ["run", "build"], options);
  const { runtime, host, renderer } = locate(desktop);
  accessSync(runtime, constants.X_OK);
  receipt(join(job.evidence, name + "-build.json"), {
    revision,
    runtimeSha256: await sha256(runtime),
    hostSha256: await sha256(host),
    rendererEntrySha256: await sha256(renderer),
  });
  return desktop;
}

const control = await build(job.control, job.revisions.control, "control");
const candidate = job.calibrationOnly
  ? undefined
  : await build(job.candidate, job.revisions.candidate, "candidate");
const runner = fileURLToPath(new URL("../local/startup.ts", import.meta.url));

function runFixture(args: string[]) {
  command(process.execPath, [runner, ...args], { env: job.env });
}

function prepareAttempt(output: string, desktop: string) {
  const before = hostCounters();
  const started = performance.now();
  try {
    runFixture(["--prepare", desktop, output]);
  } finally {
    const after = hostCounters();
    const elapsedMs = performance.now() - started;
    const ioPressurePercent =
      (pressureTotalUs(after.pressure.io) -
        pressureTotalUs(before.pressure.io)) /
      (elapsedMs * 10);
    receipt(output + "-runner.json", {
      before,
      after,
      elapsedMs,
      ioPressurePercent,
    });
  }
}

async function prepare(output: string, desktop: string) {
  await waitForQuietStart(AbortSignal.timeout(46_000), ["cpu", "io"]);
  try {
    prepareAttempt(output, desktop);
  } catch (error) {
    const failed = join(output, "cold", "failure.json");
    if (!existsSync(failed)) throw error;
    const failure = json(failed);
    const { ioPressurePercent } = json(output + "-runner.json");
    if (
      failure.probe !== "prepare" ||
      failure.visibleMarkerObserved !== false ||
      failure.replyTimeline.length !== 0 ||
      !(ioPressurePercent > quietPressureLimitPercent)
    ) {
      throw error;
    }
    console.error(
      "Start preparation did not receive readiness during runner I/O pressure",
      error,
    );
    const windows = await waitForQuietStart(AbortSignal.timeout(46_000), [
      "cpu",
      "io",
    ]);
    receipt(output + "-recovery-quiet.json", { windows, ioPressurePercent });
    prepareAttempt(output + "-recovery", desktop);
  }
}

async function run(phase: "baseline" | "comparison", other?: string) {
  const output = join(job.evidence, phase);
  await prepare(output + "-prepare-control", control);
  if (other) await prepare(output + "-prepare-candidate", other);
  const quiet = await waitForQuietStart(AbortSignal.timeout(46_000), [
    "cpu",
    "io",
  ]);
  receipt(join(job.evidence, phase + "-quiet.json"), { windows: quiet });
  const host = hostCounters();
  const before = cpuSample();
  const driverBefore = driverCpuSnapshot();
  let failure: unknown;
  try {
    runInMeasurementScope(
      runner,
      [control, output, ...(other ? [other] : [])],
      job.env,
      join(job.evidence, phase + "-benchmark.log"),
    );
  } catch (error) {
    failure = error;
  } finally {
    receipt(join(job.evidence, phase + "-runner-steal.json"), {
      before,
      after: cpuSample(),
      host,
      hostAfter: hostCounters(),
      driverBefore,
      driverAfter: driverCpuSnapshot(),
    });
  }
  const comparison = join(output, "comparison.json");
  const result = existsSync(comparison) ? json(comparison) : undefined;
  if (result) {
    startWaterfall(join(output, "waterfall.html"), result);
    console.log(
      JSON.stringify({
        phase,
        timing: result.timing,
        guards: result.guards,
        receipt: comparison,
      }),
    );
  }
  if (failure) {
    if (phase === "baseline" && !result) {
      try {
        runFixture([
          "--diagnostic",
          control,
          join(job.evidence, phase + "-diagnostic"),
        ]);
      } catch (diagnosticError) {
        console.error(diagnosticError);
      }
    }
    throw failure;
  }
  const snapshot = json(join(job.evidence, phase + "-runner-steal.json"));
  const stealPercent = stealSince(snapshot.before, snapshot.after);
  receipt(join(job.evidence, phase + "-runner-steal.json"), {
    ...snapshot,
    stealPercent,
    limitPercent: 5,
  });
  assert.ok(stealPercent <= 5, "Hosted runner CPU steal exceeded 5%");
  assert.ok(result, "Missing Start comparison receipt");
  assert.equal(result.eligible, true);
  assert.deepEqual(
    result.order,
    other
      ? ["control", "candidate", "candidate", "control"]
      : ["control", "control"],
  );
  if (!other)
    assert.ok(
      result.timing.every(({ score }: { score: number }) => score === 100),
    );
}

await verifyAccounting(job);
await run("baseline");
if (candidate) await run("comparison", candidate);
receipt(join(job.evidence, "record-run.json"), {
  lane: "start",
  qualified: true,
  revisions: job.revisions,
  hostedRun: {
    provider: "github-hosted",
    image: "ubuntu-24.04",
    id: process.env.GITHUB_RUN_ID,
    attempt: process.env.GITHUB_RUN_ATTEMPT,
  },
  baseline: "baseline/comparison.json",
  comparison: candidate ? "comparison/comparison.json" : null,
  resourcePolicy: hostedAccountingPolicy,
});
