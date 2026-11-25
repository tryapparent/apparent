import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  bendScratch,
  buildBend,
} from "../../../shared/enablement/bend/build.ts";
import { run } from "../../../shared/enablement/bend/toolchain.ts";
import policy from "./benchmark.json" with { type: "json" };

type Evidence = {
  benchmark: string;
  mode: "baseline" | "compare";
  pressureContract?: string;
  qualified: boolean;
  baselineScore: number;
  score: number;
  runner: Record<string, unknown>;
  sameBuildSpeedNoise: number | null;
  control: { revision: string };
  candidate: { revision: string };
  repeats: {
    controlMs: [number, number];
    candidateMs: [number, number];
  };
};
type LedgerRow = {
  seconds: number;
  outcome?: string;
  hypothesis?: string;
  comparison?: string;
};
type Policy = {
  speed_index(score: number): number;
  material_gain(incumbent: number, candidate: number, noise: number): boolean;
  should_stop(
    qualified: boolean,
    enoughWindows: boolean,
    first: number,
    second: number,
    earlySum: number,
    slowPercent: number,
    hypotheses: number,
    minimum: number,
  ): boolean;
};
const contractText = await readFile(
  new URL("../../../enablement/timing/journey/benchmark.json", import.meta.url),
  "utf8",
);
const contract = JSON.parse(contractText);
const contractHash = createHash("sha256").update(contractText).digest("hex");

const [baselineFile, ledgerFile, ...rest] = process.argv.slice(2);
assert.ok(
  baselineFile && ledgerFile && !rest.length,
  "Usage: stop.ts VERIFIED_BASELINE.json|pending ACTIVE_EFFORT_LEDGER.json",
);
async function evidence(file: string): Promise<Evidence> {
  const value = JSON.parse(await readFile(file, "utf8")) as Evidence;
  assert.equal(value.benchmark, policy.version);
  for (const revision of [value.control.revision, value.candidate.revision]) {
    assert.match(revision, /^[a-f0-9]{40}$/);
  }
  for (const group of [value.repeats.controlMs, value.repeats.candidateMs]) {
    assert.equal(group.length, 2);
    assert.ok(group.every((ms) => Number.isFinite(ms) && ms > 0));
  }
  assert.ok(Number.isFinite(value.score) && value.score > 0);
  return value;
}
const baseline =
  baselineFile === "pending" ? null : await evidence(baselineFile);
if (baseline) {
  assert.equal(baseline.mode, "baseline");
  assert.equal(baseline.baselineScore, 100);
  assert.equal(baseline.score, 100);
  assert.equal(baseline.control.revision, baseline.candidate.revision);
  assert.ok(
    baseline.sameBuildSpeedNoise !== null && baseline.sameBuildSpeedNoise >= 0,
  );
}
const noise = Math.ceil((baseline?.sameBuildSpeedNoise ?? 0) * 100000);
const ledger = JSON.parse(await readFile(ledgerFile, "utf8")) as LedgerRow[];
assert.ok(Array.isArray(ledger));
const root = fileURLToPath(new URL("../../../", import.meta.url));
await bendScratch(async (destination) => {
  await buildBend(
    root,
    "enablement",
    destination,
    undefined,
    "enablement/timing/journey/journey-scoring.bend",
  );
  function decide<Name extends keyof Policy>(
    name: Name,
    ...args: Parameters<Policy[Name]>
  ): ReturnType<Policy[Name]> {
    return JSON.parse(
      run(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `import policy from "./journey-scoring.mjs";
       const [name, args] = JSON.parse(process.argv[1]);
       console.log(JSON.stringify(policy[name](...args)));`,
          JSON.stringify([name, args]),
        ],
        destination,
      ),
    );
  }

  const speed = (score: number) =>
    decide("speed_index", Math.round(score * 100));
  const rules = contract.hillClimb;
  assert.equal(rules.matchedRepeats, 2);
  assert.equal(rules.earlyWindows, 2);
  assert.equal(rules.slowWindows, 2);
  let incumbent = {
    revision: baseline?.control.revision ?? null,
    score: 100,
    speed: speed(100),
    qualified: baseline?.qualified ?? false,
  };
  const curve = [{ at: 0, speed: incumbent.speed }];
  const hypotheses = new Set<string>();
  const comparisons = new Set<string>();
  let elapsed = 0;
  const series = [];
  for (const row of ledger) {
    assert.ok(Number.isSafeInteger(row.seconds) && row.seconds > 0);
    elapsed += row.seconds;
    assert.ok(elapsed <= 7 * 86400);
    const hypothesis = row.hypothesis?.trim().toLowerCase();
    if (!row.comparison) {
      assert.ok(
        row.outcome?.trim() && !hypothesis,
        "Record invalid or diagnostic effort with an outcome and no tested hypothesis",
      );
      series.push({ ...row, elapsed, accepted: false });
      continue;
    }
    assert.ok(
      hypothesis && !comparisons.has(row.comparison),
      "Expected a distinct comparison receipt",
    );
    comparisons.add(row.comparison);
    const matched = await evidence(row.comparison);
    assert.equal(matched.mode, "compare");
    assert.ok(baseline, "A frozen baseline is required for comparisons");
    assert.equal(
      matched.pressureContract,
      baseline.pressureContract,
      "Comparison pressure contract differs from baseline",
    );
    assert.deepEqual(
      matched.runner,
      baseline.runner,
      "Comparison runner differs from baseline",
    );
    assert.equal(
      matched.control.revision,
      incumbent.revision,
      "Compare with the current incumbent",
    );
    assert.notEqual(matched.candidate.revision, matched.control.revision);
    hypotheses.add(hypothesis);
    const score = (incumbent.score * matched.score) / 100;
    const candidateSpeed = speed(score);
    const repeatSpeeds = matched.repeats.candidateMs.map((ms, i) =>
      speed((incumbent.score * ms) / matched.repeats.controlMs[i]),
    );
    const accepted =
      matched.qualified &&
      (!incumbent.qualified ||
        (decide("material_gain", incumbent.speed, candidateSpeed, noise) &&
          repeatSpeeds.every((repeat) =>
            decide("material_gain", incumbent.speed, repeat, noise),
          )));
    if (accepted) {
      incumbent = {
        revision: matched.candidate.revision,
        score,
        speed: candidateSpeed,
        qualified: true,
      };
      curve.push({ at: elapsed, speed: incumbent.speed });
      hypotheses.clear();
    }
    series.push({
      ...row,
      elapsed,
      accepted,
      score,
      repeatSpeeds: repeatSpeeds.map((value) => value / 100000),
    });
  }
  const gains = [];
  let previous = curve[0].speed;
  for (
    let end = rules.windowSeconds;
    end <= elapsed;
    end += rules.windowSeconds
  ) {
    const next = Math.max(
      previous,
      ...curve.filter(({ at }) => at <= end).map(({ speed }) => speed),
    );
    gains.push(next - previous);
    previous = next;
  }
  const referenceAvailable = gains.length >= rules.earlyWindows;
  const earlySum = referenceAvailable ? gains[0] + gains[1] : 0;
  const latest = [gains.at(-2) ?? 0, gains.at(-1) ?? 0] as const;
  const enoughWindows = gains.length >= rules.earlyWindows + rules.slowWindows;
  const stop = decide(
    "should_stop",
    incumbent.qualified,
    enoughWindows,
    ...latest,
    earlySum,
    rules.slowRatePercent,
    hypotheses.size,
    rules.hypothesesSinceGain,
  );
  console.log(
    JSON.stringify(
      {
        benchmark: policy.version,
        canonicalContract: contract.version,
        canonicalContractHash: contractHash,
        baseline: baseline?.control.revision ?? null,
        incumbent: baseline
          ? { ...incumbent, speed: incumbent.speed / 100000 }
          : null,
        qualifiedIncumbent: incumbent.qualified,
        noiseSpeedIndex: baseline ? noise / 100000 : null,
        series,
        elapsedSeconds: elapsed,
        completeWindows: gains.length,
        enoughWindows,
        windowGainsPerHour: gains.map((gain) => gain / 100000),
        earlySpeedGainPerHour: referenceAvailable ? earlySum / 200000 : null,
        cutoffPerHour: referenceAvailable
          ? Math.floor((earlySum * rules.slowRatePercent) / 200) / 100000
          : null,
        latestCompleteRates: gains
          .slice(-rules.slowWindows)
          .map((gain) => gain / 100000),
        distinctHypothesesSinceGain: hypotheses.size,
        stop,
        rules,
      },
      null,
      2,
    ),
  );
});
