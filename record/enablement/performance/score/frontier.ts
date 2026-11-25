import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  bendScratch,
  buildBend,
} from "../../../../shared/enablement/bend/build.ts";
import { run } from "../../../../shared/enablement/bend/toolchain.ts";

type Pair = [number, number];
type Comparison = {
  controlRevision: string;
  candidateRevision: string;
  controlMs: Pair;
  candidateMs: Pair;
  qualified: boolean;
};
type Attempt = {
  idea: string;
  seconds: number;
  evidence: string;
  comparison?: Comparison;
};
type Ledger = {
  reference: {
    revision: string;
    ms: Pair;
    qualified: boolean;
    evidence: string;
  };
  attempts: Attempt[];
};
type Policy = {
  speed_index(score: number): number;
  material_gain(incumbent: number, candidate: number, noise: number): boolean;
  should_stop(
    qualified: boolean,
    enoughWindows: boolean,
    first: number,
    second: number,
    earlyTotal: number,
    slowPercent: number,
    hypotheses: number,
    minimum: number,
  ): boolean;
};

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const source = "enablement/timing/journey/journey-scoring.bend";
const contract = readFileSync(
  join(root, "enablement/timing/journey/benchmark.json"),
  "utf8",
);
const { hillClimb } = JSON.parse(contract);
const mean = ([first, second]: Pair) => (first + second) / 2;
const revision = (value: string) => assert.match(value, /^[a-f0-9]{40}$/);
function checkedPair(values: Pair) {
  assert.ok(
    Array.isArray(values) &&
      values.length === hillClimb.matchedRepeats &&
      values.every((value) => Number.isFinite(value) && value >= 0.001),
    "Expected two independent positive measurements",
  );
  return values;
}

export function evaluate(policy: Policy, ledger: Ledger) {
  const { reference, attempts } = ledger;
  revision(reference.revision);
  const baseline = mean(checkedPair(reference.ms));
  assert.ok(typeof reference.qualified === "boolean" && reference.evidence);
  const speed = (ratio: number) =>
    policy.speed_index(Math.round(ratio * 10000));
  const noise = Math.abs(
    speed(reference.ms[0] / baseline) - speed(reference.ms[1] / baseline),
  );
  let incumbent = {
    revision: reference.revision,
    ratio: 1,
    index: speed(1),
    qualified: reference.qualified,
  };
  const gains = [{ at: 0, index: incumbent.index }];
  const ideas = new Set<string>();
  const usedEvidence = new Set([reference.evidence]);
  let elapsed = 0;
  const experiments = attempts.map(
    ({ idea, seconds, evidence, comparison }) => {
      assert.ok(idea.trim() && evidence && !usedEvidence.has(evidence));
      assert.ok(Number.isSafeInteger(seconds) && seconds > 0);
      usedEvidence.add(evidence);
      elapsed += seconds;
      assert.ok(elapsed <= 7 * 86400);
      if (!comparison) return { idea, evidence, elapsed, tested: false };
      ideas.add(idea.trim().toLowerCase());
      const { controlRevision, candidateRevision, controlMs, candidateMs } =
        comparison;
      assert.equal(
        controlRevision,
        incumbent.revision,
        "Compare against the current incumbent",
      );
      revision(candidateRevision);
      assert.notEqual(controlRevision, candidateRevision);
      assert.ok(typeof comparison.qualified === "boolean");
      checkedPair(controlMs);
      checkedPair(candidateMs);
      const ratio = (incumbent.ratio * mean(candidateMs)) / mean(controlMs);
      const index = speed(ratio);
      const paired = candidateMs.map((ms, i) =>
        speed((incumbent.ratio * ms) / controlMs[i]),
      );
      const accepted =
        comparison.qualified &&
        (!incumbent.qualified ||
          [index, ...paired].every((value) =>
            policy.material_gain(incumbent.index, value, noise),
          ));
      if (accepted) {
        incumbent = {
          revision: candidateRevision,
          ratio,
          index,
          qualified: true,
        };
        gains.push({ at: elapsed, index });
        ideas.clear();
      }
      return {
        idea,
        evidence,
        elapsed,
        tested: true,
        accepted,
        score: ratio * 100,
        speed: index / 100000,
        pairedSpeed: paired.map((value) => value / 100000),
      };
    },
  );
  const {
    windowSeconds,
    earlyWindows,
    slowWindows,
    slowRatePercent,
    hypothesesSinceGain,
  } = hillClimb;
  const completeWindows = Math.floor(elapsed / windowSeconds);
  let best = gains[0].index;
  const rates = Array.from({ length: completeWindows }, (_, i) => {
    const end = (i + 1) * windowSeconds;
    const next = Math.max(
      best,
      ...gains.filter(({ at }) => at <= end).map(({ index }) => index),
    );
    const change = next - best;
    best = next;
    return change;
  });
  const early = rates.slice(0, earlyWindows);
  const earlyTotal = early.reduce((sum, value) => sum + value, 0);
  const stop = policy.should_stop(
    incumbent.qualified,
    completeWindows >= earlyWindows + slowWindows,
    rates.at(-2) ?? 0,
    rates.at(-1) ?? 0,
    earlyTotal,
    slowRatePercent,
    ideas.size,
    hypothesesSinceGain,
  );
  const perHour = (gain: number) => ((gain / 100000) * 3600) / windowSeconds;
  return {
    baselineScore: 100,
    incumbent: {
      revision: incumbent.revision,
      score: incumbent.ratio * 100,
      speed: incumbent.index / 100000,
      qualified: incumbent.qualified,
    },
    noiseSpeedIndex: noise / 100000,
    elapsedSeconds: elapsed,
    completeWindows,
    earlySpeedGainPerHour:
      early.length === earlyWindows ? perHour(earlyTotal / earlyWindows) : null,
    cutoffPerHour:
      early.length === earlyWindows
        ? perHour(((earlyTotal / earlyWindows) * slowRatePercent) / 100)
        : null,
    windowGainsPerHour: rates.map(perHour),
    distinctHypothesesSinceGain: ideas.size,
    stop,
    experiments,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [path, ...rest] = process.argv.slice(2);
  assert.ok(path && !rest.length, "Usage: frontier.ts LEDGER_JSON");
  const result = await bendScratch(async (directory) => {
    await buildBend(root, "enablement", directory, undefined, source);
    return JSON.parse(
      run(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `import { readFileSync } from "node:fs";
        import policy from "./journey-scoring.mjs";
        import { evaluate } from ${JSON.stringify(import.meta.url)};
        console.log(JSON.stringify(evaluate(policy, JSON.parse(readFileSync(process.argv[1], "utf8")))));`,
          resolve(path),
        ],
        directory,
      ),
    );
  });
  console.log(
    JSON.stringify(
      {
        contractSha256: createHash("sha256").update(contract).digest("hex"),
        policySha256: createHash("sha256")
          .update(readFileSync(join(root, source)))
          .digest("hex"),
        ...result,
      },
      null,
      2,
    ),
  );
}
