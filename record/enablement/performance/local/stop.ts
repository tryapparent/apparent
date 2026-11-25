import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  closeSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  benchmarkComparison,
  type Limit,
} from "../../../../shared/enablement/performance/comparison.ts";
import { hostedAccounting } from "../fixtures/host-accounting.ts";
import { shutDown } from "./attempt.ts";
import { locateStopBuild, stopAttempt } from "./stop-attempt.ts";
import {
  hostedFixtureId,
  json,
  privateJob,
  sha256,
  stageHostedFixture,
  stageStopFixture,
  threshold,
} from "./stop-fixture.ts";

const usage =
  "stop.ts [--collect] CONTROL_APPDIR NATIVE_REPORT ENGLISH_MODEL NEW_RESULTS [CANDIDATE_APPDIR] | stop.ts --score RESULTS";
const maxPressurePercent = 5;
const traceSpans = process.env.APPARENT_STOP_BENCH_SPANS === "1";

type Trial = Awaited<ReturnType<typeof stopAttempt>>;
type Build = Awaited<ReturnType<typeof locateStopBuild>>;
type Evidence = {
  fixture: string;
  transcription: "whole-file";
  control: Build;
  candidate?: Build;
  trials: Trial[];
};

async function collect(
  controlDir: string,
  reference: string,
  model: string,
  output: string,
  candidateDir?: string,
  hosted = false,
) {
  assert.match(process.env.DISPLAY ?? "", /^:\d+$/);
  assert.equal(process.env.XAUTHORITY, join(output, "display.xauth"));
  assert.equal(basename(model), threshold.model);
  assert.equal(json(model + ".verified.json").sha256, threshold.modelSha256);
  const modelSha256 = await sha256(model);
  assert.equal(modelSha256, threshold.modelSha256);
  const stage = hosted ? stageHostedFixture : stageStopFixture;
  const fixture = await stage(reference, join(output, "source.apparent"));
  const { manifest: _, ...fixtureEvidence } = fixture;
  writeFileSync(
    join(output, "fixture.json"),
    JSON.stringify({ ...fixtureEvidence, modelSha256 }, null, 2),
    { mode: 0o600 },
  );
  const runtime = join(output, "runtime");
  mkdirSync(runtime, { mode: 0o700 });
  process.env.XDG_RUNTIME_DIR = runtime;
  process.env.WAYLAND_DISPLAY = "record-bench";
  const socket = join(runtime, process.env.WAYLAND_DISPLAY);
  const env = { ...process.env, LC_ALL: "C" };
  const westonLog = openSync(join(output, "weston.log"), "wx", 0o600);
  const compositor = spawn(
    "weston",
    [
      "--backend=x11",
      "--renderer=pixman",
      "--socket=" + process.env.WAYLAND_DISPLAY,
      "--width=640",
      "--height=480",
      "--no-config",
      "--idle-time=0",
    ],
    { env, stdio: ["ignore", westonLog, westonLog] },
  );
  closeSync(westonLog);
  const failed = new Promise<never>((_, reject) =>
    compositor.once("error", reject),
  );
  try {
    await Promise.race([
      failed,
      (async () => {
        for (let i = 0; i < 100; i++) {
          if (lstatSync(socket, { throwIfNoEntry: false })?.isSocket()) return;
          assert.equal(compositor.exitCode, null, "Weston exited before ready");
          await delay(50);
        }
        throw Error("Timed out waiting for the isolated Wayland socket");
      })(),
    ]);
    const control = await locateStopBuild(controlDir, env);
    const candidate = candidateDir
      ? await locateStopBuild(candidateDir, env)
      : undefined;
    const evidence: Evidence = {
      fixture: fixture.id,
      transcription: "whole-file",
      control,
      candidate,
      trials: [],
    };
    const builds = [
      control,
      candidate ?? control,
      candidate ?? control,
      control,
    ];
    for (const [i, build] of builds.entries()) {
      evidence.trials.push(
        await stopAttempt(
          build,
          fixture,
          model,
          join(output, "arm-" + i),
          Boolean(candidate) || i === 0 || i === 3,
          traceSpans,
        ),
      );
      writeFileSync(
        join(output, "raw.json"),
        JSON.stringify(evidence, null, 2),
        { mode: 0o600 },
      );
    }
  } finally {
    await shutDown(compositor);
  }
}

async function score(output: string) {
  const raw: Evidence = json(join(output, "raw.json"));
  const hosted = raw.fixture === hostedFixtureId;
  const accounting = hostedAccounting();
  if (accounting)
    assert.ok(hosted, "Hosted accounting requires the hosted Stop fixture");
  assert.ok(hosted || raw.fixture === threshold.id);
  assert.equal(raw.transcription, "whole-file");
  assert.equal(raw.trials.length, 4);
  assert.equal(new Set(raw.trials.map((trial) => trial.id)).size, 4);
  assert.ok(
    raw.trials.every(
      (trial, i) =>
        trial.verified === true &&
        Number.isFinite(trial.trace.finishMs) &&
        trial.trace.finishMs > 0 &&
        Number.isFinite(trial.totalMs) &&
        trial.trace.finishMs < trial.totalMs &&
        trial.probe === (Boolean(raw.candidate) || i === 0 || i === 3) &&
        Number.isFinite(trial.cpuPressurePercent) &&
        trial.cpuPressurePercent >= 0,
    ),
  );
  const [a, b, c, d] = raw.trials;
  const comparisonArms = raw.candidate ? [b, c] : [];
  const limits: { dimension: string; limits: Limit[] }[] = [
    {
      dimension: accounting ? "Hosted resource accounting" : "CPU pressure",
      limits: raw.trials.map((trial) =>
        accounting
          ? [trial.hostAccounting?.qualified === true ? 0 : 1, 0]
          : [trial.cpuPressurePercent, maxPressurePercent],
      ),
    },
    {
      dimension: "transcript",
      limits: raw.trials.map((trial) => [
        trial.resources.transcriptDistance,
        0.1,
      ]),
    },
  ];
  const tolerances = [
    ["cpuSeconds", 0.1, 0.2],
    ["peakRssKiB", 0.1, 32 * 1024],
    ["bundleBytes", 0.05, 512 * 1024],
    ["fileOutputs", 0.1, 1024],
    ["transcriptDistance", 0, 0.02],
  ] as const;
  for (const [key, relative, absolute] of tolerances) {
    const baseline = Math.max(a.resources[key], d.resources[key]);
    limits.push({
      dimension: key,
      limits: comparisonArms.map((trial) => [
        trial.resources[key],
        baseline,
        Math.max(baseline * relative, absolute),
      ]),
    });
  }
  const waited = (trial: Trial) =>
    hosted ? trial.totalMs : trial.trace.finishMs;
  const comparison = await benchmarkComparison(
    [
      [
        waited(a),
        waited(raw.candidate ? b : a),
        waited(raw.candidate ? c : d),
        waited(d),
      ],
    ],
    limits.flatMap((row) => row.limits),
  );
  let offset = 0;
  const guards = limits
    .filter((row) => row.limits.length)
    .map(({ dimension, limits }) => {
      const results = comparison.permitted.slice(
        offset,
        offset + limits.length,
      );
      offset += limits.length;
      return { dimension, limits, permitted: results.every(Boolean) };
    });
  const eligible = guards.every((guard) => guard.permitted);
  const receipt = {
    fixture: raw.fixture,
    transcription: raw.transcription,
    timingEndpoint: hosted
      ? "replay-launch-to-verified-clipboard"
      : "replay-finalizer",
    qualified: eligible,
    control: raw.control.version,
    candidate: raw.candidate?.version,
    timing: {
      ...comparison.timings[0],
      score: eligible ? comparison.timings[0].score : null,
    },
    sameBuildGapMs: raw.candidate ? undefined : Math.abs(waited(a) - waited(d)),
    probeOverheadMs: raw.candidate
      ? undefined
      : [waited(a) - waited(b), waited(d) - waited(c)],
    hostedResources: accounting
      ? raw.trials.map((trial) => trial.hostAccounting)
      : undefined,
    guards,
    raw: join(output, "raw.json"),
  };
  const path = join(output, "comparison.json");
  writeFileSync(path, JSON.stringify(receipt, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify({ ...receipt, receipt: path }, null, 2));
  if (!eligible) process.exitCode = 2;
}

const [mode, ...rest] = process.argv.slice(2);
if (mode === "--xvfb-child") {
  const hosted = rest[0] === "--hosted-fixture";
  const [control, reference, model, output, candidate] = hosted
    ? rest.slice(1)
    : rest;
  await collect(
    control,
    reference,
    model,
    privateJob(output),
    candidate,
    hosted,
  );
} else if (mode === "--score") {
  assert.equal(rest.length, 1, usage);
  await score(privateJob(rest[0]));
} else {
  const hosted = mode === "--hosted-fixture";
  const args = mode === "--collect" || hosted ? rest : [mode, ...rest];
  assert.ok(
    (args.length === 4 || args.length === 5) && args.every(Boolean),
    usage,
  );
  const output = resolve(args[3]);
  mkdirSync(output, { mode: 0o700 });
  privateJob(output);
  const paths = args.map((path) => realpathSync(path));
  const home = join(output, "home");
  mkdirSync(home, { mode: 0o700 });
  const child = spawnSync(
    "xvfb-run",
    [
      "-a",
      "-f",
      join(output, "display.xauth"),
      "-s",
      "-screen 0 640x480x24 -nolisten tcp",
      process.execPath,
      resolve(process.argv[1]),
      "--xvfb-child",
      ...(hosted ? ["--hosted-fixture"] : []),
      ...paths,
    ],
    {
      env: {
        PATH: process.env.PATH,
        HOME: home,
        TMPDIR: output,
        APPARENT_STOP_BENCH_SPANS: traceSpans ? "1" : undefined,
        APPARENT_RECORD_HOSTED_SCOPE: process.env.APPARENT_RECORD_HOSTED_SCOPE,
        APPARENT_RECORD_HOST_CPU_LIST:
          process.env.APPARENT_RECORD_HOST_CPU_LIST,
      },
      stdio: "inherit",
    },
  );
  if (child.error) throw child.error;
  if (child.status !== 0) process.exitCode = child.status ?? 1;
  else if (mode !== "--collect") await score(output);
  else console.log(join(output, "raw.json"));
}
