import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const contractText = readFileSync(
  new URL("benchmark.json", import.meta.url),
  "utf8",
);
export const contract = JSON.parse(contractText);
export const contractHash = createHash("sha256")
  .update(contractText)
  .digest("hex");
const { cases, weights, stopControls, limits, hillClimb } = contract;
const median = (a: number, b: number) => (a + b) / 2;
const number = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
const positive = (value: unknown): value is number =>
  number(value) && value > 0;
const round = (value: number) => Math.round(value * 1000) / 1000;
const mib = 1024 * 1024;
const u32 = (value: number) => {
  if (!number(value) || value > 0xffffffff)
    throw new Error("Measurement outside supported range");
  return Math.round(value);
};

export type Policy = {
  weight_ratio(weight: number, ratio: number): number;
  normalized_score(total: number): number;
  speed_index(score: number): number;
  material_gain(incumbent: number, candidate: number, noise: number): boolean;
  within_budget(
    observed: number,
    baseline: number,
    tolerance: number,
    percentage: number,
  ): boolean;
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

type Measurement = { ms: number; verified: true };
type Phase = {
  p95Millicores: number;
  saturationMs: number;
  cpuSeconds: number;
  availableMemoryMiB: number;
  appPssMiB: number;
  guestStealPercent: number;
};
type Resources = {
  recording: Phase;
  finalization: Phase;
  bundleBytes: number;
  peakScratchBytes: number;
  outputVerified: true;
};
export type Receipt = {
  contractHash: string;
  revision: string;
  runner: string;
  runId: string;
  vcpus: number;
  waits: Record<string, Measurement>;
  resources: Record<string, Resources>;
};

const idsFor = (id: string): string[] =>
  cases[id]?.map((fixture: string) => id + "/" + fixture) ?? [id];
const scoredIds: string[] = weights.flatMap(([id]: [string]) => idsFor(id));
const controls: string[] = stopControls.map((id: string) => "paste/" + id);
const stopIds = scoredIds
  .filter((id) => id.startsWith("paste/") || id.startsWith("paste-22-to-33/"))
  .concat(controls);
const resourceIds = stopIds.map((id) => id.split("/")[1]);
const phaseFields: (keyof Phase)[] = [
  "p95Millicores",
  "saturationMs",
  "cpuSeconds",
  "availableMemoryMiB",
  "appPssMiB",
  "guestStealPercent",
];
if (
  weights.reduce(
    (sum: number, [, , weight]: [string, string, number]) => sum + weight,
    0,
  ) !== 100 ||
  new Set(scoredIds).size !== scoredIds.length ||
  new Set(resourceIds).size !== resourceIds.length ||
  hillClimb.earlyWindows !== 2 ||
  hillClimb.slowWindows !== 2
) {
  throw new Error("Inconsistent benchmark contract");
}

export function audit(receipt: Receipt) {
  if (
    receipt?.contractHash !== contractHash ||
    !/^[0-9a-f]{40}$/.test(receipt.revision) ||
    !receipt.runId ||
    !receipt.runner ||
    receipt.vcpus !== limits.vcpus
  ) {
    throw new Error("Missing or incompatible run identity");
  }
  const missingWaits = [...scoredIds, ...controls].filter((id) => {
    const row = receipt.waits?.[id];
    return !(row?.verified === true && positive(row.ms));
  });
  const missingResources = resourceIds.filter((id) => {
    const entry = receipt.resources?.[id];
    return !(
      entry?.outputVerified === true &&
      positive(entry.bundleBytes) &&
      number(entry.peakScratchBytes) &&
      ["recording", "finalization"].every((phase) =>
        phaseFields.every((field) =>
          number(entry[phase as "recording" | "finalization"]?.[field]),
        ),
      )
    );
  });
  return {
    missingWaits,
    missingResources,
    complete: !missingWaits.length && !missingResources.length,
  };
}

function pair(receipts: Receipt[], runner: string, seen: Set<string>) {
  if (
    receipts.length !== hillClimb.matchedRepeats ||
    receipts.some(
      (receipt) =>
        receipt.runner !== runner || receipt.revision !== receipts[0].revision,
    )
  ) {
    throw new Error("Expected two matched runs of the same revision");
  }
  for (const receipt of receipts) {
    const report = audit(receipt);
    if (!report.complete)
      throw new Error(receipt.runId + " " + JSON.stringify(report));
    if (seen.has(receipt.runId))
      throw new Error("Repeated run ID: " + receipt.runId);
    seen.add(receipt.runId);
  }
  return receipts as [Receipt, Receipt];
}

function measured(pair: [Receipt, Receipt], id: string) {
  return median(pair[0].waits[id].ms, pair[1].waits[id].ms);
}

function speedScore(
  policy: Policy,
  reference: [Receipt, Receipt],
  observation: [Receipt, Receipt],
) {
  let total = 0;
  const components = weights.map(
    ([id, phase, weight]: [string, string, number]) => {
      const ids = idsFor(id);
      const ratios = ids.map(
        (id) => measured(observation, id) / measured(reference, id),
      );
      const ratio =
        id === "paste-22-to-33"
          ? Math.max(...ids.map((id) => measured(observation, id))) /
            Math.max(...ids.map((id) => measured(reference, id)))
          : ratios.reduce((sum, value) => sum + value, 0) / ratios.length;
      const fixedRatio = u32(Math.max(1, ratio * 10000));
      if (fixedRatio > 10_000_000)
        throw new Error("Wait exceeds the scorer's supported ratio");
      total += policy.weight_ratio(weight, fixedRatio);
      return {
        id,
        phase,
        weight,
        ratio: round(ratio),
        weightedPoints: round(weight * ratio),
      };
    },
  );
  const score = policy.normalized_score(total);
  return { score: score / 100, speed: policy.speed_index(score), components };
}

function guard(
  policy: Policy,
  reference: [Receipt, Receipt],
  receipt: Receipt,
  relative: boolean,
) {
  const failures: string[] = [];
  const fail = (id: string, reason: string) =>
    failures.push(receipt.runId + " " + id + " " + reason);
  const budget = (
    value: number,
    baseline: number,
    allowance: number,
    unit = 1,
  ) =>
    policy.within_budget(
      u32(value * unit),
      u32(baseline * unit),
      u32(allowance * unit),
      limits.relativeTolerancePercent,
    );
  for (const id of stopIds) {
    const observed = receipt.waits[id].ms;
    if (id.startsWith("paste-22-to-33/") && observed > limits.mediumClipboardMs)
      fail(id, "medium clipboard deadline");
    if (id === "paste/long-narration" && observed >= limits.stressClipboardMs)
      fail(id, "five-minute clipboard deadline");
    if (
      relative &&
      !budget(observed, measured(reference, id), limits.clipboardToleranceMs)
    )
      fail(id, "clipboard regression");
  }
  for (const id of resourceIds) {
    const observed = receipt.resources[id];
    const [a, b] = reference.map((row) => row.resources[id]);
    if (observed.recording.p95Millicores > limits.recordingP95Millicores)
      fail(id, "recording CPU p95");
    if (observed.recording.saturationMs >= limits.recordingSaturationMs)
      fail(id, "recording CPU saturation");
    for (const phase of ["recording", "finalization"] as const) {
      const data = observed[phase];
      if (data.availableMemoryMiB < limits.availableMemoryMiB)
        fail(id, phase + " available memory");
      if (data.guestStealPercent > limits.guestStealPercent)
        fail(id, phase + " benchmark CPU contention");
      if (
        relative &&
        !budget(
          data.appPssMiB,
          median(a[phase].appPssMiB, b[phase].appPssMiB),
          limits.appPssToleranceMiB,
          1024,
        )
      ) {
        fail(id, phase + " application memory growth");
      }
    }
    if (
      relative &&
      !budget(
        observed.bundleBytes / 1024,
        median(a.bundleBytes, b.bundleBytes) / 1024,
        limits.bundleToleranceMiB * 1024,
      )
    ) {
      fail(id, "saved bundle growth");
    }
    if (
      relative &&
      !budget(
        observed.peakScratchBytes / 1024,
        median(a.peakScratchBytes, b.peakScratchBytes) / 1024,
        limits.scratchToleranceMiB * 1024,
      )
    ) {
      fail(id, "peak temporary disk growth");
    }
  }
  if (relative && receipt.waits.pill.ms > measured(reference, "pill"))
    fail("pill", "visible start regression");
  return failures;
}

function costs(runs: Record<string, Resources>[]) {
  const entries = runs.flatMap((run) => resourceIds.map((id) => run[id]));
  const cpu = (phase: "recording" | "finalization") =>
    entries.reduce((total, row) => total + row[phase].cpuSeconds, 0) /
    runs.length;
  return {
    recordingCpuSeconds: round(cpu("recording")),
    finalizationCpuSeconds: round(cpu("finalization")),
    peakPssMiB: Math.max(
      ...entries.flatMap((row) => [
        row.recording.appPssMiB,
        row.finalization.appPssMiB,
      ]),
    ),
    totalBundleBytes:
      entries.reduce((total, row) => total + row.bundleBytes, 0) / runs.length,
    peakScratchBytes: Math.max(...entries.map((row) => row.peakScratchBytes)),
  };
}

export type Attempt = {
  hypothesis: string;
  seconds: number;
  outcome?: string;
  runs?: Receipt[];
};

export function evaluate(
  policy: Policy,
  initial: Receipt[],
  attempts: Attempt[],
) {
  const seen = new Set<string>();
  const reference = pair(initial, initial[0]?.runner, seen);
  if (
    reference.some((receipt) =>
      resourceIds.some(
        (id) =>
          receipt.resources[id].recording.guestStealPercent >
            limits.guestStealPercent ||
          receipt.resources[id].finalization.guestStealPercent >
            limits.guestStealPercent,
      ),
    )
  ) {
    throw new Error(
      "Reference run exceeded the benchmark CPU contention limit",
    );
  }
  const baseline = speedScore(policy, reference, reference);
  const singleSpeed = (receipt: Receipt) =>
    speedScore(policy, reference, [receipt, receipt]).speed;
  const noise = Math.abs(singleSpeed(reference[0]) - singleSpeed(reference[1]));
  const baselineFailures = reference.flatMap((receipt) =>
    guard(policy, reference, receipt, false),
  );
  let incumbent = {
    revision: reference[0].revision,
    ...baseline,
    qualified: !baselineFailures.length,
    resources: reference.map((row) => row.resources),
  };
  let frontier = baseline.speed;
  let elapsed = 0;
  const hypotheses = new Set<string>();
  const accepted: { at: number; speed: number }[] = [
    { at: 0, speed: baseline.speed },
  ];
  const experiments = attempts.map((attempt) => {
    if (
      !attempt.hypothesis?.trim() ||
      !Number.isSafeInteger(attempt.seconds) ||
      attempt.seconds <= 0 ||
      (!attempt.runs && !attempt.outcome?.trim())
    )
      throw new Error(
        "Each attempt needs a hypothesis, elapsed seconds and evidence or an outcome",
      );
    elapsed += attempt.seconds;
    if (elapsed > 7 * 86400)
      throw new Error("Ledger exceeds seven days of active effort");
    const hypothesis = attempt.hypothesis.trim();
    hypotheses.add(hypothesis.toLowerCase());
    if (!attempt.runs)
      return { hypothesis, elapsed, outcome: attempt.outcome, accepted: false };
    const candidate = pair(attempt.runs, reference[0].runner, seen);
    const score = speedScore(policy, reference, candidate);
    const failures = candidate.flatMap((receipt) =>
      guard(policy, reference, receipt, true),
    );
    const resources = candidate.map((run) => run.resources);
    const comparison = costs(resources);
    const previous = costs(incumbent.resources);
    const costKeys = Object.keys(previous) as (keyof typeof previous)[];
    const win =
      !failures.length &&
      (!incumbent.qualified ||
        (policy.material_gain(frontier, score.speed, noise) &&
          candidate.every((receipt) =>
            policy.material_gain(frontier, singleSpeed(receipt), noise),
          )));
    const resourceTie =
      !failures.length &&
      incumbent.qualified &&
      Math.abs(score.speed - frontier) <= noise &&
      candidate.every(
        (receipt) => Math.abs(singleSpeed(receipt) - frontier) <= noise,
      ) &&
      costKeys.every((key) => comparison[key] <= previous[key]) &&
      costKeys.some((key) => comparison[key] < previous[key]);
    if (win || resourceTie) {
      incumbent = {
        revision: candidate[0].revision,
        ...score,
        qualified: true,
        resources,
      };
    }
    if (win) {
      frontier = score.speed;
      hypotheses.clear();
      accepted.push({ at: elapsed, speed: score.speed });
    }
    return {
      hypothesis,
      elapsed,
      ...score,
      resources,
      resourceScorecard: comparison,
      failures,
      accepted: win || resourceTie,
      resourceTie,
    };
  });
  const {
    windowSeconds,
    earlyWindows,
    slowWindows,
    slowRatePercent,
    hypothesesSinceGain,
  } = hillClimb;
  const count = Math.floor(elapsed / windowSeconds);
  const rates: number[] = [];
  let best = baseline.speed;
  for (let window = 1; window <= count; window++) {
    const end = window * windowSeconds;
    const next = Math.max(
      best,
      ...accepted
        .filter((point) => point.at <= end)
        .map((point) => point.speed),
    );
    rates.push(next - best);
    best = next;
  }
  const early = rates.slice(0, earlyWindows);
  const earlySum = early.reduce((sum, value) => sum + value, 0);
  const enoughWindows = count >= earlyWindows + slowWindows;
  const stop = policy.should_stop(
    incumbent.qualified,
    enoughWindows,
    rates.at(-2) ?? 0,
    rates.at(-1) ?? 0,
    earlySum,
    slowRatePercent,
    hypotheses.size,
    hypothesesSinceGain,
  );
  const perHour = (gain: number) =>
    round((gain * 3600) / windowSeconds / 100000);
  return {
    version: contract.version,
    contractHash,
    baselineScore: baseline.score,
    baselineFailures,
    baselineResourceScorecard: costs(reference.map((row) => row.resources)),
    noiseSpeedIndex: noise / 100000,
    incumbent: {
      ...incumbent,
      speed: incumbent.speed / 100000,
      resourceScorecard: costs(incumbent.resources),
    },
    experiments: experiments.map((row) =>
      "speed" in row ? { ...row, speed: row.speed / 100000 } : row,
    ),
    stop,
    elapsedSeconds: elapsed,
    completeWindows: count,
    earlySpeedGainPerHour:
      early.length === earlyWindows ? perHour(earlySum / earlyWindows) : null,
    cutoffPerHour:
      early.length === earlyWindows
        ? perHour((earlySum * slowRatePercent) / (100 * earlyWindows))
        : null,
    windowGainsPerHour: rates.map(perHour),
    distinctHypothesesSinceGain: hypotheses.size,
  };
}
