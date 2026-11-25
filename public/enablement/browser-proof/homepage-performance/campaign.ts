import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  bendScratch,
  buildBend,
} from "../../../../shared/enablement/bend/build.ts";
import {
  benchmarkComparison,
  type Limit,
  type Matched,
} from "../../../../shared/enablement/performance/comparison.ts";
import {
  browserContract,
  loadHostedEvidence,
  pressureQualified,
  verifyDemoProof,
  type Effort,
  type HostedLedger,
  type Ledger,
  type Receipt,
  type Result,
} from "./campaign-evidence.ts";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const scoringDirectory = "enablement/timing/journey";
const contractText = await readFile(
  join(root, scoringDirectory, "benchmark.json"),
  "utf8",
);
const contract = JSON.parse(contractText);
const contractHash = createHash("sha256").update(contractText).digest("hex");

type Policy = {
  speed_index(score: number): number;
  material_gain(incumbent: number, candidate: number, noise: number): boolean;
  should_stop(
    qualified: boolean,
    enoughWindows: boolean,
    first: number,
    second: number,
    earlySum: number,
    percent: number,
    hypotheses: number,
    required: number,
  ): boolean;
};

const [path, mode, ...extra] = process.argv.slice(2);
const comparisonOnly = mode === "--compare-only";
assert(
  path && !extra.length && (!mode || comparisonOnly),
  "Supply the campaign ledger and optional --compare-only",
);
const ledgerPath = resolve(path);
const read = async <T>(path: string) =>
  JSON.parse(await readFile(resolve(dirname(ledgerPath), path), "utf8")) as T;
const input = await read<Ledger | HostedLedger>(ledgerPath);
const hosted = "calibration" in input;
assert(!hosted || !comparisonOnly, "Hosted evidence belongs to a campaign");
const { ledger, calibration, hostedExperiments } = hosted
  ? await loadHostedEvidence(input, dirname(ledgerPath))
  : { ledger: input, calibration: null, hostedExperiments: [] };
if (comparisonOnly)
  assert(
    ledger.controls.length === 2 &&
      ledger.experiments.length <= 1 &&
      !ledger.unscoredEffort.length &&
      ledger.experiments.every((row) => !row.effort.length),
    "A comparison-only ledger has two controls, at most one bracket, and no effort intervals",
  );
const windows = contract.hillClimb as {
  windowSeconds: number;
  earlyWindows: number;
  slowWindows: number;
  slowRatePercent: number;
  hypothesesSinceGain: number;
};
assert.equal(windows.earlyWindows, 2);
assert.equal(windows.slowWindows, 2);

function interval(effort: Effort) {
  const start = Date.parse(effort.start);
  const end = Date.parse(effort.end);
  assert(
    Number.isFinite(start) && end > start,
    "Invalid active-effort interval",
  );
  return { start, end };
}
const activity = [
  ...ledger.unscoredEffort,
  ...ledger.experiments.flatMap((row) => row.effort),
]
  .map(interval)
  .sort((a, b) => a.start - b.start);
for (const [index, range] of activity.entries())
  assert(
    !index || range.start >= activity[index - 1].end,
    "Overlapping active-effort intervals",
  );
const elapsedThrough = (lastEnd: number) =>
  activity.reduce(
    (total, range) =>
      total + Math.max(0, Math.min(lastEnd, range.end) - range.start),
    0,
  ) / 1000;

const diagnostics = ledger.diagnostics ?? [];
assert(diagnostics.every((row) => row.reason.trim() && row.evidence.trim()));
assert(
  ledger.controls.length === 0 || ledger.controls.length === 2,
  "Expected two matched frozen controls",
);
if (!ledger.controls.length) {
  assert(
    !ledger.experiments.length && !activity.length,
    "A campaign needs a qualified frozen control before it starts",
  );
  console.log(
    JSON.stringify(
      {
        contractHash,
        windows,
        diagnostics,
        incumbent: null,
        baselineQuietMs: [],
        repeatVariationSpeed: null,
        activeSeconds: 0,
        completeWindows: 0,
        earlyRate: null,
        cutoff: null,
        latestCompleteRates: [],
        distinctHypothesesSinceGain: 0,
        stop: false,
        blocker: "qualified frozen control missing",
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
const seen = new Set<string>();
const readRun = async (path: string) => {
  const row = await read<Receipt>(path);
  if (row.compatible.hostedInterference) {
    const eligible = row.receipts.filter((wait) => wait.eligible);
    assert(
      eligible.length && eligible.every((wait) => pressureQualified(row, wait)),
      "Hosted run marked an interfered observation eligible",
    );
  }
  assert(
    row.qualified &&
      !row.compatible.detailed &&
      (row.mode === "quiet" || (!hosted && row.mode === "calibrate")),
    "Only verified uncontended quiet waits enter the frontier",
  );
  assert(!seen.has(row.runId), "Repeated receipt");
  seen.add(row.runId);
  return row;
};
const [first, second] = await Promise.all(ledger.controls.map(readRun));
assert.equal(first.revision, second.revision);
assert.equal(first.packageSha256, second.packageSha256);
assert.deepEqual(first.compatible, second.compatible);
if (calibration) {
  assert.equal(first.revision, calibration.gateway.control);
  assert.equal(first.compatible.runner.affinity, calibration.platform.affinity);
  assert.equal(first.compatible.runner.node, calibration.platform.node);
}

const probeOverheadMs = calibration
  ? await verifyDemoProof(
      join(dirname(calibration.controls[0]), "../control-overhead"),
      first,
      "calibrate",
    )
  : null;

const median = (values: number[]) => {
  assert(
    values.length > 0 &&
      values.every((value) => Number.isFinite(value) && value >= 0),
  );
  const sorted = [...values].sort((a, b) => a - b);
  return (
    (sorted[Math.floor((sorted.length - 1) / 2)] +
      sorted[Math.floor(sorted.length / 2)]) /
    2
  );
};
const metric = (
  row: Receipt,
  navigation: Result["navigation"],
  get: (result: Result) => number,
) =>
  median(
    row.receipts
      .filter(
        (r) =>
          r.navigation === navigation &&
          !r.detailed &&
          r.verified &&
          r.eligible &&
          pressureQualified(row, r),
      )
      .map(get),
  );
function wait(row: Receipt) {
  const ms = metric(row, "cold", (result) => result.verifiedMs);
  assert(ms > 0, "Waits must be positive");
  return ms;
}
const warm = (row: Receipt) =>
  metric(row, "warm", (result) => result.verifiedMs);
const cpu = (row: Receipt) =>
  metric(row, "cold", (result) => result.chromiumCpuMs);
const ram = (row: Receipt) =>
  metric(row, "cold", (result) => result.sampledChromiumPssKiB);
const wire = (row: Receipt) =>
  metric(
    row,
    "cold",
    (result) =>
      result.pageTiming.document.transferBytes +
      result.pageTiming.resources
        .filter((resource) => new URL(resource.name).hostname === "127.0.0.1")
        .reduce((total, resource) => total + resource.transferBytes, 0),
  ) / 1024;
const disk = (row: Receipt) => row.packageBytes / 1024;
const guardMetrics = {
  warmMs: warm,
  browserCpuMs: cpu,
  browserPssKiB: ram,
  loopbackKiB: wire,
  packageKiB: disk,
};
function allowances(first: Receipt, second: Receipt) {
  return Object.fromEntries(
    Object.entries(guardMetrics).map(([name, get]) => {
      const x = get(first);
      const y = get(second);
      return [name, Math.max(Math.abs(x - y), (x + y) * 0.05)];
    }),
  );
}
const guardAllowances = allowances(first, second);
const controlMs = (wait(first) + wait(second)) / 2;

const result = await bendScratch(async (directory) => {
  await buildBend(
    root,
    "enablement",
    directory,
    undefined,
    scoringDirectory + "/journey-scoring.bend",
  );
  const loadCompiled = createRequire(join(directory, "campaign.cjs"));
  const { default: policy } = loadCompiled("./journey-scoring.mjs") as {
    default: Policy;
  };
  const scoreFor = (ms: number) => (100 * ms) / controlMs;
  const speedOf = (score: number) =>
    policy.speed_index(Math.max(1, Math.round(100 * score)));
  const speed = (ms: number) => speedOf(scoreFor(ms));
  const repeatVariation = Math.abs(speed(wait(first)) - speed(wait(second)));
  const initialSpeed = speed(controlMs);
  let incumbent = {
    revision: first.revision,
    packageSha256: first.packageSha256,
    speed: initialSpeed,
    score: 100,
  };
  const frontier = [{ activeSeconds: 0, speed: initialSpeed }];
  const sinceGain = new Set<string>();
  const experiments = [];
  let lastEnd = 0;
  for (const [index, experiment] of ledger.experiments.entries()) {
    const end = comparisonOnly
      ? 0
      : Math.max(...experiment.effort.map((row) => interval(row).end));
    assert(
      experiment.hypothesis.trim() &&
        experiment.qualityEvidence.trim() &&
        experiment.effort.every((row) => interval(row).start >= lastEnd) &&
        (comparisonOnly || end > lastEnd),
    );
    lastEnd = end;
    const activeSeconds = elapsedThrough(end);
    const runs = (await Promise.all(
      experiment.runs.map(readRun),
    )) as Matched<Receipt>;
    const [a, b, repeatB, repeatA] = runs;
    const job = hostedExperiments[index];
    let matchedAllowances = guardAllowances;
    let noise = repeatVariation;
    if (job) {
      const [jobFirst, jobSecond] = await Promise.all(
        job.controls.map(readRun),
      );
      assert.equal(job.gateway.control, incumbent.revision);
      assert.equal(job.gateway.candidate, b.revision);
      assert.equal(a.compatible.runner.affinity, job.platform.affinity);
      assert.deepEqual(
        browserContract(a.compatible),
        browserContract(first.compatible),
        "Hosted browser, scenario and probe must match the frozen control",
      );
      for (const row of [jobFirst, jobSecond]) {
        assert.equal(row.revision, a.revision);
        assert.equal(row.packageSha256, a.packageSha256);
        assert.deepEqual(row.compatible, a.compatible);
      }
      await Promise.all([
        verifyDemoProof(
          join(dirname(job.controls[0]), "../control-overhead"),
          a,
          "calibrate",
        ),
        verifyDemoProof(
          dirname(experiment.qualityEvidence),
          b,
          "trace",
          false,
          experiment.qualityEvidence,
        ),
        verifyDemoProof(
          join(dirname(experiment.qualityEvidence), "../candidate-small-dark"),
          b,
          "trace",
          true,
        ),
      ]);
      matchedAllowances = allowances(jobFirst, jobSecond);
      const mean = (wait(jobFirst) + wait(jobSecond)) / 2;
      const jobSpeed = (row: Receipt) =>
        speedOf((incumbent.score * wait(row)) / mean);
      noise = Math.max(
        noise,
        Math.abs(jobSpeed(jobFirst) - jobSpeed(jobSecond)),
      );
    }
    for (const run of runs)
      assert.deepEqual(run.compatible, job ? a.compatible : first.compatible);
    for (const run of [a, repeatA]) {
      assert.equal(incumbent.revision, run.revision);
      assert.equal(incumbent.packageSha256, run.packageSha256);
    }
    assert.equal(b.revision, repeatB.revision);
    assert.equal(b.packageSha256, repeatB.packageSha256);
    assert.notEqual(
      b.packageSha256,
      a.packageSha256,
      "Identical build is a repeat, not a hypothesis",
    );
    const guards = [b, repeatB].flatMap((candidate, i) =>
      Object.entries(guardMetrics).map(([name, get]) => ({
        name,
        repeat: i + 1,
        limit: [
          get(candidate),
          get(i ? repeatA : a),
          matchedAllowances[name],
        ] as Limit,
      })),
    );
    const comparison = await benchmarkComparison(
      [runs.map(wait) as Matched<number>],
      guards.map((row) => row.limit),
    );
    const timing = comparison.timings[0];
    const relativeScore = (candidate: number, reference: number) =>
      (incumbent.score * candidate) / reference;
    const score = job
      ? relativeScore(timing.candidateMeanMs, timing.controlMeanMs)
      : scoreFor(timing.candidateMeanMs);
    const candidateSpeed = speedOf(score);
    sinceGain.add(experiment.hypothesis.trim().toLowerCase());
    const guardResult = guards.map((guard, i) => ({
      ...guard,
      passed: comparison.permitted[i],
    }));
    const accepted =
      comparison.permitted.every(Boolean) &&
      policy.material_gain(incumbent.speed, candidateSpeed, noise) &&
      [
        [a, b],
        [repeatA, repeatB],
      ].every(([reference, candidate]) => {
        const referenceMs = wait(reference);
        const candidateMs = wait(candidate);
        return job
          ? policy.material_gain(
              incumbent.speed,
              speedOf(relativeScore(candidateMs, referenceMs)),
              noise,
            )
          : policy.material_gain(
              Math.max(incumbent.speed, speed(referenceMs)),
              speed(candidateMs),
              noise,
            );
      });
    if (accepted) {
      incumbent = {
        revision: b.revision,
        packageSha256: b.packageSha256,
        speed: candidateSpeed,
        score,
      };
      frontier.push({ activeSeconds, speed: candidateSpeed });
      sinceGain.clear();
    }
    experiments.push({
      ...experiment,
      activeSeconds,
      ...timing,
      ...(job && {
        hostedRun: job.gateway.run,
        hostedAttempt: job.gateway.attempt,
        controlRevision: a.revision,
        candidateRevision: b.revision,
        matchedScore: timing.score,
        repeatVariationSpeed: noise / 100000,
      }),
      score,
      candidateSpeed: candidateSpeed / 100000,
      guardResult,
      accepted,
    });
  }
  const activeSeconds = elapsedThrough(Infinity);
  const completeWindows = Math.floor(activeSeconds / windows.windowSeconds);
  let last = initialSpeed;
  const gainPerWindow = Array.from({ length: completeWindows }, (_, index) => {
    const end = (index + 1) * windows.windowSeconds;
    const current = frontier.findLast(
      (point) => point.activeSeconds <= end,
    )!.speed;
    const gain = current - last;
    last = current;
    return gain;
  });
  const early = gainPerWindow.slice(0, windows.earlyWindows);
  const earlySum = early.reduce((sum, gain) => sum + gain, 0);
  const enoughWindows =
    completeWindows >= windows.earlyWindows + windows.slowWindows;
  const [firstRecent = 0, secondRecent = 0] = gainPerWindow.slice(-2);
  return {
    contractHash,
    windows,
    diagnostics,
    controlMs,
    baselineQuietMs: [wait(first), wait(second)],
    ...(calibration && {
      hostedCalibration: {
        run: calibration.gateway.run,
        attempt: calibration.gateway.attempt,
        probeOverheadMs,
      },
    }),
    controlScore: 100,
    repeatVariationSpeed: repeatVariation / 100000,
    guardAllowances,
    incumbent: {
      ...incumbent,
      speed: incumbent.speed / 100000,
      qualified: true,
    },
    frontier: frontier.map((point) => ({
      ...point,
      speed: point.speed / 100000,
    })),
    experiments,
    activeSeconds,
    completeWindows,
    gainPerWindow: gainPerWindow.map((gain) => gain / 100000),
    earlyRate: early.length === 2 ? earlySum / 200000 : null,
    cutoff:
      early.length === 2
        ? (earlySum * windows.slowRatePercent) / 20_000_000
        : null,
    latestCompleteRates: gainPerWindow.slice(-2).map((gain) => gain / 100000),
    distinctHypothesesSinceGain: sinceGain.size,
    comparisonOnly,
    stop: policy.should_stop(
      true,
      enoughWindows,
      firstRecent,
      secondRecent,
      earlySum,
      windows.slowRatePercent,
      sinceGain.size,
      windows.hypothesesSinceGain,
    ),
  };
});
console.log(JSON.stringify(result, null, 2));
