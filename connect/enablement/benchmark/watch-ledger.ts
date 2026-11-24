import assert from "node:assert/strict";
import { mean, read, runMs, validate, type Benchmark } from "./watch-sample.ts";

type Policy = {
  speed_index(score: number): number;
  material_gain(incumbent: number, candidate: number, noise: number): boolean;
  should_stop(
    qualified: boolean,
    enoughWindows: boolean,
    first: number,
    second: number,
    earlySum: number,
    slowRate: number,
    hypotheses: number,
    minimum: number,
  ): boolean;
};

export type JourneyContract = {
  contractHash: string;
  hillClimb: {
    windowSeconds: number;
    earlyWindows: number;
    slowRatePercent: number;
    slowWindows: number;
    hypothesesSinceGain: number;
  };
};

export async function ledger(
  file: string,
  policy: Policy,
  contract: JourneyContract,
) {
  const input = await read<{
    baseline: string;
    entries: {
      hypothesis?: string;
      activeSeconds: number;
      receipt?: string;
      outcome: string;
    }[];
  }>(file);
  const baseline = await read<Benchmark & { noiseSpeedIndex: number }>(
    input.baseline,
  );
  const { contractHash, hillClimb: rule } = contract;
  if (!baseline.qualified) {
    assert.ok(
      input.entries.every((entry) => !entry.hypothesis),
      "A qualified baseline must precede experiments",
    );
    return {
      contractHash,
      rule,
      stop: false,
      incumbent: null,
      activeSeconds: 0,
      completeWindows: 0,
      testedSinceGain: [],
      noiseSpeedIndex: null,
      earlyRatePerHour: null,
      cutoffPerHour: null,
      windowGains: [],
      baseline: input.baseline,
      outcomes: input.entries,
    };
  }
  assert.equal(baseline.mode, "baseline");
  assert.equal(baseline.contractHash, contractHash);
  const noise = Math.round(baseline.noiseSpeedIndex * 100000);
  const baselineMs = mean(
    baseline.samples.slice(1, 3).map((row) => runMs(row.replay)),
  );
  const speed = (ms: number) =>
    policy.speed_index(Math.round((10000 * ms) / baselineMs));
  let activeSeconds = 0;
  let frontier = speed(baselineMs);
  let incumbent = baseline.samples[1].replay.revision;
  const points = [{ activeSeconds, frontier }];
  const testedSinceGain = new Set<string>();
  const measuredReceipts = new Set<string>();
  const results = [];
  for (const entry of input.entries) {
    assert.ok(
      Number.isSafeInteger(entry.activeSeconds) && entry.activeSeconds > 0,
    );
    activeSeconds += entry.activeSeconds;
    assert.ok(activeSeconds <= 7 * 86400);
    const receipt = entry.receipt && (await read<Benchmark>(entry.receipt));
    if (!receipt || !receipt.valid) {
      results.push({ ...entry, atSeconds: activeSeconds, retained: false });
      continue;
    }
    assert.ok(
      entry.receipt && !measuredReceipts.has(entry.receipt),
      "Repeated comparison receipt",
    );
    measuredReceipts.add(entry.receipt);
    assert.equal(receipt.mode, "compare");
    assert.equal(receipt.contractHash, contractHash);
    assert.deepEqual(receipt.runtime, baseline.runtime);
    assert.ok(
      entry.hypothesis?.trim(),
      "Qualified comparison needs a distinct hypothesis name",
    );
    const [control, first, second, controlRepeat] = receipt.samples;
    for (const sample of receipt.samples) validate(sample, baseline.samples[1]);
    assert.equal(control.replay.revision, incumbent);
    assert.equal(controlRepeat.replay.revision, incumbent);
    assert.equal(first.replay.revision, second.replay.revision);
    assert.notEqual(first.replay.revision, incumbent);
    testedSinceGain.add(entry.hypothesis.trim().toLowerCase());
    const firstMs = runMs(first.replay),
      secondMs = runMs(second.replay);
    const candidateSpeed = speed(mean([firstMs, secondMs]));
    const pairedWinners = [
      [control, first],
      [controlRepeat, second],
    ].every(([base, candidate]) =>
      policy.material_gain(
        speed(runMs(base.replay)),
        speed(runMs(candidate.replay)),
        noise,
      ),
    );
    const retained =
      receipt.qualified &&
      pairedWinners &&
      [candidateSpeed, speed(firstMs), speed(secondMs)].every((value) =>
        policy.material_gain(frontier, value, noise),
      );
    if (retained) {
      frontier = candidateSpeed;
      incumbent = first.replay.revision;
      points.push({ activeSeconds, frontier });
      testedSinceGain.clear();
    }
    results.push({
      ...entry,
      atSeconds: activeSeconds,
      retained,
      qualified: receipt.qualified,
      pairedWinners,
      candidateScore: (100 * mean([firstMs, secondMs])) / baselineMs,
    });
  }
  const completeWindows = Math.floor(activeSeconds / rule.windowSeconds);
  const rates: number[] = [];
  let previous = points[0].frontier;
  for (let window = 1; window <= completeWindows; window++) {
    const best = points.findLast(
      (point) => point.activeSeconds <= window * rule.windowSeconds,
    )!.frontier;
    rates.push(best - previous);
    previous = best;
  }
  const earlySum = rates
    .slice(0, rule.earlyWindows)
    .reduce((sum, value) => sum + value, 0);
  const latest = [rates.at(-2) ?? 0, rates.at(-1) ?? 0];
  return {
    contractHash,
    rule,
    activeSeconds,
    completeWindows,
    baselineMs,
    noiseSpeedIndex: noise / 100000,
    incumbent: {
      revision: incumbent,
      qualified: true,
      score: 10000000 / frontier,
    },
    results,
    curve: points.map((point) => ({
      activeSeconds: point.activeSeconds,
      speed: point.frontier / 100000,
    })),
    windowGains: rates.map((value) => value / 100000),
    earlyRatePerHour:
      completeWindows >= rule.earlyWindows
        ? earlySum / rule.earlyWindows / 100000
        : null,
    cutoffPerHour:
      completeWindows >= rule.earlyWindows
        ? (earlySum * rule.slowRatePercent) / (100 * rule.earlyWindows * 100000)
        : null,
    testedSinceGain: [...testedSinceGain],
    stop: policy.should_stop(
      true,
      completeWindows >= rule.earlyWindows + rule.slowWindows,
      latest[0],
      latest[1],
      earlySum,
      rule.slowRatePercent,
      testedSinceGain.size,
      rule.hypothesesSinceGain,
    ),
  };
}
