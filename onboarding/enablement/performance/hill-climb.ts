import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  bendScratch,
  buildBend,
} from "../../../shared/enablement/bend/build.ts";

import { run } from "../../../shared/enablement/bend/toolchain.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const policySource = "enablement/timing/journey/journey-scoring.bend";
const contractText = await readFile(
  join(root, "enablement/timing/journey/benchmark.json"),
  "utf8",
);
const contract = JSON.parse(contractText);
const contractHash = createHash("sha256").update(contractText).digest("hex");
type Policy = {
  speed_index(score: number): number;
  material_gain(incumbent: number, candidate: number, noise: number): boolean;
  should_stop(
    qualified: boolean,
    ready: boolean,
    first: number,
    second: number,
    earlySum: number,
    percent: number,
    hypotheses: number,
    minimum: number,
  ): boolean;
};

type Comparison = {
  schema: number;
  eligibility?: "hosted-scoring" | "local-diagnostic";
  hostIdentity: {
    provider?: string;
    cohort?: string;
    kernel: string;
    node: string;
  };
  contention: unknown;
  control: { revision: string };
  candidate: { revision: string };
  baseline?: {
    variant: string;
    controlMeanMs: number;
    speedNoise: number;
    qualified: boolean;
  }[];
  observations: {
    group: string;
    variant: string;
    qualified: boolean;
    identity: {
      runtimeSha256: string;
      collectorSha256: string;
      fixtureSha256: string;
    };
    stages: {
      stage: string;
      controlMs: [number, number];
      controlMeanMs: number;
      candidateMs: [number, number];
      candidateMeanMs: number;
    }[];
    runs: { receiptPath: string; attempt: string; valid: boolean }[];
  }[];
};
type Entry = { hypothesis: string; activeSeconds: number } & (
  | {
      comparison: string;
      calibration?: string;
      outcome?: never;
      tested?: never;
    }
  | {
      comparison?: never;
      calibration?: never;
      outcome: string;
      tested: boolean;
    }
);
export async function evaluate(
  policy: Policy,
  baselineFile: string,
  ledgerFile: string,
) {
  const read = async (file: string) => JSON.parse(await readFile(file, "utf8"));
  const baseline: Comparison = await read(baselineFile);
  const ledger: Entry[] = await read(ledgerFile);
  const cold = baseline.baseline?.find(({ variant }) => variant === "cold");
  const primary = baseline.observations.find(
    ({ group, variant }) => group === "repeat" && variant === "cold",
  );
  assert.equal(baseline.schema, 1);
  assert.notEqual(
    baseline.eligibility,
    "local-diagnostic",
    "Local replay is diagnostic",
  );
  assert(
    cold && primary && Number.isFinite(cold.speedNoise) && cold.speedNoise >= 0,
  );
  assert(
    cold.controlMeanMs > 0 &&
      cold.qualified &&
      baseline.baseline?.every(({ qualified }) => qualified),
    "Require a qualified current-main control",
  );
  assert.equal(baseline.candidate.revision, baseline.control.revision);
  const hosted =
    baseline.hostIdentity.provider === "github-hosted-ubuntu-24.04";
  if (hosted) {
    assert.match(baseline.hostIdentity.cohort ?? "", /^[a-f0-9]{64}$/);
    assert(baseline.observations.every(({ qualified }) => qualified));
  }
  const historical = new Set(
    baseline.observations.flatMap(({ runs }) =>
      runs.map(({ attempt }) => attempt),
    ),
  );
  const {
    windowSeconds,
    earlyWindows,
    slowWindows,
    slowRatePercent,
    hypothesesSinceGain,
  } = contract.hillClimb;
  const speedScale = 100_000;
  const noise = Math.ceil(cold.speedNoise * speedScale);
  const speedAt = (ms: number, reference: number) => {
    assert(
      Number.isFinite(ms) &&
        ms > 0 &&
        Number.isFinite(reference) &&
        reference > 0,
    );
    return policy.speed_index(
      Math.max(1, Math.round((10000 * ms) / reference)),
    );
  };
  let seconds = 0;
  let best = {
    revision: baseline.control.revision,
    speed: speedScale,
    score: 100,
  };
  const qualifiedFrontier = [{ at: 0, ...best }];
  const hypotheses = new Set<string>();
  const experiments = [];
  for (const entry of ledger) {
    assert(typeof entry.hypothesis === "string" && entry.hypothesis.trim());
    assert(
      Number.isSafeInteger(entry.activeSeconds) && entry.activeSeconds > 0,
    );
    seconds += entry.activeSeconds;
    assert(seconds <= 7 * 86400);
    const hypothesis = entry.hypothesis.trim().toLowerCase();
    if (!entry.comparison) {
      assert(entry.outcome?.trim() && typeof entry.tested === "boolean");
      if (entry.tested) hypotheses.add(hypothesis);
      experiments.push({ ...entry, accepted: false });
      continue;
    }
    const result: Comparison = await read(entry.comparison);
    assert.equal(result.schema, baseline.schema);
    assert.notEqual(
      result.eligibility,
      "local-diagnostic",
      "Local replay is diagnostic",
    );
    assert.deepEqual(result.contention, baseline.contention);
    assert.equal(result.control.revision, best.revision);
    assert.notEqual(result.candidate.revision, result.control.revision);
    const observation = result.observations.find(
      ({ group, variant }) => group === "candidate" && variant === "cold",
    );
    assert(
      observation &&
        result.observations.some(({ variant }) => variant === "resumed"),
    );
    let comparisonNoise = noise;
    if (hosted) {
      assert(
        entry.calibration,
        "Hosted comparison requires its same-job calibration receipt",
      );
      const calibration: Comparison = await read(entry.calibration);
      assert.equal(calibration.schema, baseline.schema);
      assert.deepEqual(calibration.hostIdentity, result.hostIdentity);
      assert.deepEqual(calibration.contention, result.contention);
      for (const field of ["provider", "cohort", "kernel", "node"] as const)
        assert.equal(
          result.hostIdentity[field],
          baseline.hostIdentity[field],
          field,
        );
      assert.equal(calibration.control.revision, best.revision);
      assert.equal(calibration.candidate.revision, best.revision);
      assert(calibration.observations.every(({ qualified }) => qualified));
      assert.deepEqual(
        calibration.observations.find(
          ({ group, variant }) => group === "repeat" && variant === "cold",
        )?.identity,
        primary.identity,
      );
      const localNoise = calibration.baseline?.find(
        ({ variant }) => variant === "cold",
      );
      assert(
        localNoise?.qualified &&
          Number.isFinite(localNoise.speedNoise) &&
          localNoise.speedNoise >= 0,
      );
      comparisonNoise = Math.max(
        noise,
        Math.ceil(localNoise.speedNoise * best.speed),
      );
    } else {
      assert.deepEqual(result.hostIdentity, baseline.hostIdentity);
    }
    let contentionInvalid = false;
    for (const { runs, identity } of result.observations) {
      assert.deepEqual(identity, primary.identity);
      assert.equal(runs.length, 4);
      for (const run of runs) {
        assert(
          !historical.has(run.attempt),
          "Each comparison needs fresh matched runs",
        );
        historical.add(run.attempt);
        contentionInvalid ||= !run.valid;
      }
    }
    if (!contentionInvalid) hypotheses.add(hypothesis);
    const metric = observation.stages.find(
      ({ stage }) => stage === "coach-open-to-interactive",
    );
    assert(
      metric &&
        metric.controlMs.length === 2 &&
        metric.candidateMs.length === 2,
    );
    const matchedSpeed = (ms: number, reference: number) =>
      hosted
        ? Math.round((speedAt(ms, reference) * best.speed) / speedScale)
        : speedAt(ms, cold.controlMeanMs);
    const speed = matchedSpeed(metric.candidateMeanMs, metric.controlMeanMs);
    const repeats = metric.candidateMs.map((ms) =>
      matchedSpeed(ms, metric.controlMeanMs),
    );
    const pairedSpeed = metric.candidateMs.map(
      (ms, index) =>
        matchedSpeed(ms, metric.controlMs[index]) -
        (hosted
          ? best.speed
          : speedAt(metric.controlMs[index], cold.controlMeanMs)),
    );
    const guardsPassed = result.observations.every(
      ({ qualified }) => qualified,
    );
    const accepted =
      guardsPassed &&
      !contentionInvalid &&
      policy.material_gain(best.speed, speed, comparisonNoise) &&
      repeats.every((repeat) =>
        policy.material_gain(best.speed, repeat, comparisonNoise),
      ) &&
      pairedSpeed.every((difference) => difference > comparisonNoise);
    const summary = {
      revision: result.candidate.revision,
      speed,
      score: hosted
        ? (100 * speedScale) / speed
        : (100 * metric.candidateMeanMs) / cold.controlMeanMs,
    };
    if (accepted) {
      best = summary;
      hypotheses.clear();
      qualifiedFrontier.push({ at: seconds, ...best });
    }
    experiments.push({
      ...entry,
      ...summary,
      repeats,
      pairedSpeed,
      comparisonNoise,
      contentionInvalid,
      guardsPassed,
      accepted,
    });
  }
  const count = Math.floor(seconds / windowSeconds);
  const rates = Array.from({ length: count }, (_, index) => {
    const start = index * windowSeconds;
    const speedAtWindow = (at: number) =>
      qualifiedFrontier.findLast((point) => point.at <= at)!.speed;
    return speedAtWindow(start + windowSeconds) - speedAtWindow(start);
  });
  const early = rates.slice(0, earlyWindows);
  const earlySum = early.reduce((sum, gain) => sum + gain, 0);
  const ready = count >= earlyWindows + slowWindows;
  const stop = policy.should_stop(
    true,
    ready,
    rates.at(-2) ?? 0,
    rates.at(-1) ?? 0,
    earlySum,
    slowRatePercent,
    hypotheses.size,
    hypothesesSinceGain,
  );
  return {
    contractHash,
    baseline: baselineFile,
    incumbent: best,
    speedScale,
    noise,
    activeSeconds: seconds,
    completeWindows: count,
    windowSeconds,
    rates,
    earlyWindows,
    slowWindows,
    slowRatePercent,
    qualifiedIncumbent: true,
    windowGainsPerHour: rates.map((rate) => rate / speedScale),
    earlySpeedGainPerHour:
      early.length === earlyWindows
        ? earlySum / earlyWindows / speedScale
        : null,
    cutoffPerHour:
      early.length === earlyWindows
        ? (earlySum * slowRatePercent) / (100 * earlyWindows * speedScale)
        : null,
    distinctTestedSinceGain: hypotheses.size,
    hypothesesSinceGain,
    qualifiedFrontier,
    experiments,
    stop,
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [baselineFile, ledgerFile, ...extra] = process.argv.slice(2);
  assert(
    baselineFile && ledgerFile && !extra.length,
    "Usage: hill-climb.ts BASELINE.json LEDGER.json",
  );
  const result = await bendScratch(async (scratch) => {
    await buildBend(root, "enablement", scratch, undefined, policySource);
    return run(
      process.execPath,
      [
        "--input-type=module-typescript",
        "-e",
        `
      import policy from "./journey-scoring.mjs";
      import { evaluate } from ${JSON.stringify(import.meta.url)};
      console.log(JSON.stringify(await evaluate(policy, ...process.argv.slice(1)), null, 2));
    `,
        resolve(baselineFile),
        resolve(ledgerFile),
      ],
      scratch,
    );
  });
  process.stdout.write(result);
}
