import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  bendScratch,
  buildBend,
} from "../../../shared/enablement/bend/build.ts";
import { run } from "../../../shared/enablement/bend/toolchain.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const canonical = readFileSync(
  new URL("../../../enablement/timing/journey/benchmark.json", import.meta.url),
  "utf8",
);
const contractHash = createHash("sha256").update(canonical).digest("hex");
const contract: {
  hillClimb: {
    windowSeconds: number;
    earlyWindows: number;
    slowWindows: number;
    slowRatePercent: number;
    hypothesesSinceGain: number;
    matchedRepeats: number;
  };
} = JSON.parse(canonical);
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

const {
  windowSeconds,
  earlyWindows,
  slowWindows,
  slowRatePercent,
  hypothesesSinceGain,
} = contract.hillClimb;
assert.equal(earlyWindows, 2);
assert.equal(slowWindows, 2);

export type Experiment = {
  hypothesis: string;
  activeSeconds: number;
  tested: boolean;
  qualified?: boolean;
  score?: number;
  repeatScores?: [number, number];
};

export function loadLedger(
  path: string,
  fixtureIds: { name: string; fingerprint: { sha256: string } }[],
  control: { revision: string; sha256: string },
) {
  const ledger: { referenceReceipt: string; experiments: Experiment[] } =
    JSON.parse(readFileSync(path, "utf8"));
  const reference: {
    schema: number;
    score: number;
    qualified: boolean;
    control: { revision: string; sha256: string };
    candidate: { sha256: string };
    stop: { referenceRepeats: [number, number]; contractHash: string };
    cases: typeof fixtureIds;
  } = JSON.parse(readFileSync(ledger.referenceReceipt, "utf8"));
  assert(
    reference.schema === 1 &&
      reference.qualified === true &&
      reference.score === 100,
    "Ledger requires a qualified frozen control receipt",
  );
  assert.equal(reference.control.sha256, reference.candidate.sha256);
  assert.equal(
    reference.control.sha256,
    control.sha256,
    "Comparison control differs from the frozen control",
  );
  assert.equal(reference.control.revision, control.revision);
  assert.equal(reference.stop.contractHash, contractHash);
  assert.deepEqual(
    fixtureIds.map(({ name, fingerprint }) => [name, fingerprint.sha256]),
    reference.cases.map(({ name, fingerprint }) => [name, fingerprint.sha256]),
    "Fixture corpus differs from the frozen control",
  );
  return {
    reference: reference.control,
    repeats: reference.stop.referenceRepeats,
    experiments: ledger.experiments,
  };
}

export async function stopDecision(
  referenceRepeats: [number, number],
  qualifiedControl: boolean,
  ledger: Experiment[],
): Promise<ReturnType<typeof evaluate>> {
  return bendScratch(async (directory) => {
    await buildBend(
      root,
      "enablement",
      directory,
      undefined,
      "enablement/timing/journey/journey-scoring.bend",
    );
    const program = `import policy from "./journey-scoring.mjs";
      import { evaluate } from ${JSON.stringify(import.meta.url)};
      const inputs = JSON.parse(process.argv[1]);
      process.stdout.write(JSON.stringify(evaluate(policy, ...inputs)));`;
    return JSON.parse(
      run(
        process.execPath,
        [
          "--input-type=module-typescript",
          "-e",
          program,
          JSON.stringify([referenceRepeats, qualifiedControl, ledger]),
        ],
        directory,
      ),
    );
  });
}

export function evaluate(
  policy: Policy,
  referenceRepeats: [number, number],
  qualifiedControl: boolean,
  ledger: Experiment[],
) {
  assert.equal(referenceRepeats.length, contract.hillClimb.matchedRepeats);
  const speed = (score: number) => {
    assert(Number.isFinite(score) && score > 0);
    return policy.speed_index(Math.max(1, Math.round(score * 100)));
  };
  const noise = Math.abs(
    speed(referenceRepeats[0]) - speed(referenceRepeats[1]),
  );
  let incumbent = { score: 100, qualified: qualifiedControl };
  let frontier = speed(100);
  let elapsed = 0;
  const hypotheses = new Set<string>();
  const points = [{ at: 0, speed: frontier }];
  const experiments = ledger.map((row) => {
    assert(
      row.hypothesis.trim() &&
        Number.isSafeInteger(row.activeSeconds) &&
        row.activeSeconds > 0,
    );
    elapsed += row.activeSeconds;
    assert(elapsed <= 7 * 86400);
    if (row.tested) hypotheses.add(row.hypothesis.trim().toLowerCase());
    if (row.qualified && row.tested) {
      assert(
        row.score &&
          row.repeatScores?.length === contract.hillClimb.matchedRepeats,
      );
    }
    const accepted = Boolean(
      row.tested &&
        row.qualified &&
        row.score &&
        row.repeatScores &&
        (!incumbent.qualified ||
          [row.score, ...row.repeatScores].every((result) =>
            policy.material_gain(frontier, speed(result), noise),
          )),
    );
    if (accepted) {
      incumbent = { score: row.score!, qualified: true };
      frontier = speed(incumbent.score);
      hypotheses.clear();
      points.push({ at: elapsed, speed: frontier });
    }
    return { ...row, accepted, elapsed };
  });
  const completed = Math.floor(elapsed / windowSeconds);
  let previous = speed(100);
  const rates = Array.from({ length: completed }, (_, i) => {
    const at = (i + 1) * windowSeconds;
    const next = Math.max(
      previous,
      ...points.filter((point) => point.at <= at).map((point) => point.speed),
    );
    const gain = next - previous;
    previous = next;
    return gain;
  });
  const earlySum = rates
    .slice(0, earlyWindows)
    .reduce((sum, value) => sum + value, 0);
  return {
    contractHash,
    windowSeconds,
    referenceRepeats,
    incumbent: { ...incumbent, speed: frontier / 100000 },
    noiseSpeedIndex: noise / 100000,
    activeSeconds: elapsed,
    completeWindows: completed,
    distinctHypothesesSinceGain: hypotheses.size,
    earlySpeedGainPerHour:
      completed >= earlyWindows ? earlySum / earlyWindows / 100000 : null,
    cutoffPerHour:
      completed >= earlyWindows
        ? (earlySum * slowRatePercent) / (100 * earlyWindows * 100000)
        : null,
    cutoffSpeedUnits:
      completed >= earlyWindows
        ? Math.floor((earlySum * slowRatePercent) / (100 * earlyWindows))
        : null,
    windowGainsPerHour: rates.map((rate) => rate / 100000),
    stop: policy.should_stop(
      incumbent.qualified,
      completed >= earlyWindows + slowWindows,
      rates.at(-2) ?? 0,
      rates.at(-1) ?? 0,
      earlySum,
      slowRatePercent,
      hypotheses.size,
      hypothesesSinceGain,
    ),
    experiments,
  };
}
