import { execFileSync } from "node:child_process";
import { join } from "node:path";

export type HillClimb = {
  windowSeconds: number;
  earlyWindows: number;
  slowWindows: number;
  slowRatePercent: number;
  hypothesesSinceGain: number;
};

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

export const phases = ["cold", "warm"] as const;
export type Phase = (typeof phases)[number];
export type Waits = Record<Phase, number>;
export type Resources = {
  cpuMs: number;
  pluginPeakRssKiB: number;
  descendantPeakRssKiB: number;
};
export type Block = {
  id: string;
  waits: Waits;
  resources: Record<Phase, Resources>;
  result: string;
};
export type Pair = [Block, Block];
export type Comparison = {
  score(
    first: number,
    candidate: number,
    repeat: number,
    second: number,
  ): number;
  within_limit(observed: number, reference: number, allowance: number): boolean;
};
export type Experiment = {
  hypothesis: string;
  seconds: number;
  build: string;
  control?: Pair;
  candidate?: Pair;
  outcome?: string;
};

const units = (ms: number) => Math.round(ms * 1000);
const pool = (first: number, second: number) => (first + second) / 2;
const resourceGuards = {
  cpuMs: { floor: 2, fraction: 0.1 },
  pluginPeakRssKiB: { floor: 1024, fraction: 0.1 },
  descendantPeakRssKiB: { floor: 1024, fraction: 0.1 },
} as const;

function scores(policy: Comparison, [a, a2]: Pair, [b, b2]: Pair) {
  return Object.fromEntries(
    phases.map((p) => [
      p,
      policy.score(
        ...([a, b, b2, a2].map((block) => units(block.waits[p])) as [
          number,
          number,
          number,
          number,
        ]),
      ),
    ]),
  ) as Waits;
}

export function evaluate(
  comparison: Comparison,
  policy: Policy,
  hillClimb: HillClimb,
  reference: Pair,
  baselineBuild: string,
  experiments: Experiment[],
) {
  const {
    windowSeconds,
    earlyWindows,
    slowWindows,
    slowRatePercent,
    hypothesesSinceGain,
  } = hillClimb;
  function index(control: Pair, candidate: Pair) {
    const values = scores(comparison, control, candidate);
    const score = Math.round(pool(values.cold, values.warm));
    return {
      score: score / 100,
      speed: policy.speed_index(score),
      byPhase: { cold: values.cold / 100, warm: values.warm / 100 },
    };
  }
  const [a, a2] = reference;
  const single = (row: Block): Pair => [row, row];
  const noise = Math.abs(
    index(reference, single(a)).speed - index(reference, single(a2)).speed,
  );
  const baseline = index(reference, reference);
  const phaseNoise = {
    cold: Math.abs(a.waits.cold - a2.waits.cold),
    warm: Math.abs(a.waits.warm - a2.waits.warm),
  };
  let incumbent = { build: baselineBuild, ...baseline, qualified: true };
  const curve = [{ elapsedSeconds: 0, speed: baseline.speed }];
  const tested = new Set<string>();
  let elapsedSeconds = 0;
  const rows = experiments.map((attempt) => {
    if (
      !Number.isSafeInteger(attempt.seconds) ||
      attempt.seconds <= 0 ||
      !attempt.hypothesis.trim()
    )
      throw new Error(
        "An experiment needs measured active seconds and a named hypothesis",
      );
    elapsedSeconds += attempt.seconds;
    if (!attempt.control || !attempt.candidate) {
      if (!attempt.outcome) throw new Error("Missing invalid-run explanation");
      return { ...attempt, elapsedSeconds, accepted: false };
    }
    tested.add(attempt.hypothesis.toLowerCase());
    const [c, c2] = attempt.control;
    const [b, b2] = attempt.candidate;
    const pooled = index(reference, attempt.candidate);
    const matched = [
      [c, b],
      [c2, b2],
    ] as const;
    const failures = matched.flatMap(([control, candidate], repeat) => {
      const issues = candidate.result === a.result ? [] : ["result digest"];
      for (const p of phases) {
        if (
          candidate.waits[p] >
          control.waits[p] + Math.max(phaseNoise[p], control.waits[p] * 0.05)
        )
          issues.push(p + " latency");
        for (const key of Object.keys(resourceGuards) as (keyof Resources)[]) {
          const { floor, fraction } = resourceGuards[key];
          const before = control.resources[p][key];
          const after = candidate.resources[p][key];
          if (
            !comparison.within_limit(
              units(after),
              units(before),
              units(Math.max(floor, before * fraction)),
            )
          )
            issues.push(p + " " + key);
        }
      }
      return issues.map((issue) => ({ repeat: repeat + 1, issue }));
    });
    const matchedSpeeds = matched.map(
      ([control, candidate]) => index(single(control), single(candidate)).speed,
    );
    const pooledMatched = index(attempt.control, attempt.candidate);
    const absoluteSpeeds = attempt.candidate.map(
      (candidate) => index(reference, single(candidate)).speed,
    );
    const accepted =
      failures.length === 0 &&
      [pooledMatched.speed, ...matchedSpeeds].every((speed) =>
        policy.material_gain(baseline.speed, speed, noise),
      ) &&
      [pooled.speed, ...absoluteSpeeds].every((speed) =>
        policy.material_gain(incumbent.speed, speed, noise),
      );
    if (accepted) {
      incumbent = { build: attempt.build, ...pooled, qualified: true };
      curve.push({ elapsedSeconds, speed: pooled.speed });
      tested.clear();
    }
    return {
      ...attempt,
      elapsedSeconds,
      accepted,
      ...pooled,
      speed: pooled.speed / 100000,
      matchedScore: pooledMatched.score,
      matchedScores: matched.map(([c, b]) => index(single(c), single(b)).score),
      failures,
    };
  });
  let previous = baseline.speed;
  const completeWindows = Math.floor(elapsedSeconds / windowSeconds);
  const rates = Array.from({ length: completeWindows }, (_, i) => {
    const end = (i + 1) * windowSeconds;
    const speed = Math.max(
      previous,
      ...curve
        .filter((point) => point.elapsedSeconds <= end)
        .map((point) => point.speed),
    );
    const gain = speed - previous;
    previous = speed;
    return gain;
  });
  const earlySum = rates
    .slice(0, earlyWindows)
    .reduce((sum, rate) => sum + rate, 0);
  const enoughWindows = completeWindows >= earlyWindows + slowWindows;
  const distinctHypothesesSinceGain = tested.size;
  const stop = policy.should_stop(
    incumbent.qualified,
    enoughWindows,
    rates.at(-2) ?? 0,
    rates.at(-1) ?? 0,
    earlySum,
    slowRatePercent,
    distinctHypothesesSinceGain,
    hypothesesSinceGain,
  );
  return {
    elapsedSeconds,
    stop,
    completeWindows,
    enoughWindows,
    distinctHypothesesSinceGain,
    hillClimb,
    baselineScore: baseline.score,
    noiseSpeedIndex: noise / 100000,
    phaseNoiseMs: phaseNoise,
    incumbent: { ...incumbent, speed: incumbent.speed / 100000 },
    curve: curve.map((point) => ({ ...point, speed: point.speed / 100000 })),
    earlySpeedGainPerHour:
      completeWindows >= earlyWindows ? earlySum / earlyWindows / 100000 : null,
    cutoffPerHour:
      completeWindows >= earlyWindows
        ? ((earlySum / earlyWindows) * slowRatePercent) / 100 / 100000
        : null,
    windowGainsPerHour: rates.map((rate) => rate / 100000),
    experiments: rows,
  };
}

export function evaluateInJob(
  job: string,
  hillClimb: HillClimb,
  reference: Pair,
  build: string,
  experiments: Experiment[],
) {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
    import { readFileSync } from "node:fs";
    import comparison from "./comparison.mjs";
    import policy from "./journey-scoring.mjs";
    const { evaluate } = await import(process.argv[1]);
    const args = JSON.parse(readFileSync(0, "utf8"));
    console.log(JSON.stringify(evaluate(comparison, policy, ...args)));
    `,
        import.meta.url,
      ],
      {
        cwd: join(job, "policy"),
        input: JSON.stringify([hillClimb, reference, build, experiments]),
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
      },
    ),
  ) as ReturnType<typeof evaluate>;
}
