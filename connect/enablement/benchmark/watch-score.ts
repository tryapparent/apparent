import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, stat, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  bendScratch,
  buildBend,
} from "../../../shared/enablement/bend/build.ts";
import {
  benchmarkComparison,
  type Matched,
} from "../../../shared/enablement/performance/comparison.ts";
import type { JourneyContract } from "./watch-ledger.ts";
import type { NativeBuild } from "./native/sender.ts";
import {
  hash,
  quietResources,
  mean,
  read,
  runMs,
  sample,
  validate,
  type Benchmark,
  type Replay,
  type Sample,
} from "./watch-sample.ts";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const contract = JSON.parse(
  execFileSync(
    process.execPath,
    [join(repo, "enablement/timing/journey/run.ts"), "contract"],
    { cwd: repo, encoding: "utf8" },
  ),
) as JourneyContract;
const { contractHash } = contract;
const relativeResourceAllowance = 10;
const resourceKeys = [
  "cpuSeconds",
  "peakProcessRssKiB",
  "storedCaptureBytes",
] as const;
const waitNames = [
  "share to advancing frame",
  "cold share to ready",
  "cold open to frame",
  "warm share to ready",
  "warm open to frame",
];
export async function benchmark(
  mode: "baseline" | "compare",
  directory: string,
  chrome: string,
  cpuSpec: string,
  controlTree = repo,
  referencePath?: string,
  candidateTree = repo,
  hosted?: {
    profile: string;
    cgroup: string;
    native?: { control: NativeBuild; candidate: NativeBuild };
  },
) {
  assert.ok([directory, chrome, controlTree, candidateTree].every(isAbsolute));
  assert.equal(
    (await stat(directory)).mode & 0o077,
    0,
    "Results directory must be private",
  );
  const runtime = {
    host: hosted?.profile ?? hostname(),
    cpuSpec,
    node: process.version,
    chrome: await hash(chrome),
    ffmpeg: execFileSync("ffmpeg", ["-version"], { encoding: "utf8" }).split(
      "\n",
    )[0],
  };
  const reference = referencePath && (await read<Benchmark>(referencePath));
  if (mode === "compare") {
    assert.ok(
      reference && reference.qualified,
      "Comparison requires a qualified baseline",
    );
    assert.equal(reference.mode, "baseline");
    assert.equal(reference.contractHash, contractHash);
    assert.deepEqual(
      runtime,
      reference.runtime,
      "Benchmark host or runtime changed",
    );
  }
  const result = await mkdtemp(join(directory, mode + "-"));
  const baseline = mode === "baseline";
  if (baseline && !hosted) {
    const main = execFileSync("git", ["rev-parse", "origin/main"], {
      cwd: repo,
      encoding: "utf8",
    }).trim();
    const head = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repo,
      encoding: "utf8",
    }).trim();
    assert.equal(
      head,
      main,
      "Collect the baseline on the pinned current-main commit",
    );
  }
  const replay = (tree: string, traced: boolean, native?: NativeBuild) =>
    sample(
      tree,
      result,
      chrome,
      cpuSpec,
      traced,
      hosted?.cgroup,
      Boolean(hosted),
      native,
    );
  const native = hosted?.native;
  const first = await replay(controlTree, !baseline, native?.control);
  const measuredTree = baseline ? controlTree : candidateTree;
  const measuredNative = baseline ? native?.control : native?.candidate;
  const candidate = await replay(measuredTree, true, measuredNative);
  const candidateRepeat = await replay(measuredTree, true, measuredNative);
  const repeat = await replay(controlTree, !baseline, native?.control);
  const samples: Matched<Sample> = [first, candidate, candidateRepeat, repeat];
  for (const item of samples)
    validate(item, reference ? reference.samples[1] : first);
  assert.equal(
    first.replay.workload,
    reference ? reference.samples[1].replay.workload : first.replay.workload,
  );
  assert.ok(
    samples.every((item) => item.replay.workload === first.replay.workload),
  );
  const workload = first.replay.workload;
  assert.equal(first.workerHash, repeat.workerHash);
  assert.equal(candidate.workerHash, candidateRepeat.workerHash);
  if (baseline) assert.equal(first.workerHash, candidate.workerHash);
  const waits = [
    (row: Replay) => runMs(row),
    (row: Replay) => row.attempts[0].rawMs.shareToReady,
    (row: Replay) => row.attempts[0].rawMs.openToAdvancingFrameAck,
    (row: Replay) => row.attempts[1].rawMs.shareToReady,
    (row: Replay) => row.attempts[1].rawMs.openToAdvancingFrameAck,
  ].map(
    (select) => samples.map((item) => select(item.replay)) as Matched<number>,
  );
  const guards = [
    ...benchmarkLimits(first, repeat, candidate, candidateRepeat),
    ...(native
      ? [0, 1].flatMap((variant) => {
          const link = (item: Sample) =>
            item.replay.attempts[variant].rawMs.shareToLinkAvailable;
          const control = Math.max(link(first), link(repeat));
          return [candidate, candidateRepeat].map((item, index) => ({
            name: (variant === 0 ? "cold" : "warm") + " share to pending link",
            repeat: index + 1,
            limit: [
              link(item),
              control,
              Math.max(20, (control * relativeResourceAllowance) / 100),
            ] satisfies [number, number, number],
          }));
        })
      : []),
    ...waits
      .slice(1)
      .flatMap(([first, candidate, candidateRepeat, last], index) => {
        const control = Math.max(first, last);
        const allowance = Math.max(
          20,
          (control * relativeResourceAllowance) / 100,
        );
        return [candidate, candidateRepeat].map((ms, repeat) => ({
          name: waitNames[index + 1],
          repeat: repeat + 1,
          limit: [ms, control, allowance] satisfies [number, number, number],
        }));
      }),
  ];
  const comparison = await benchmarkComparison(
    waits,
    guards.map((guard) => guard.limit),
  );
  const quiet = samples.every(({ resource }) => quietResources(resource));
  const nativeOverlap =
    native &&
    samples.map(({ replay }, index) => {
      const peak = (
        index === 0 || index === 3 ? native.control : measuredNative!
      ).peakPuts;
      return replay.attempts.every(
        ({ proof }) =>
          proof.nativeSender?.peakPuts === peak &&
          proof.nativeSender.workerPeakPuts === peak,
      );
    });
  const valid = quiet && (nativeOverlap?.every(Boolean) ?? true);
  const qualified = valid && (baseline || comparison.permitted.every(Boolean));
  const baselineMs = mean(waits[0].slice(1, 3));
  const noiseSpeedIndex =
    Math.abs(1 / waits[0][1] - 1 / waits[0][2]) * baselineMs;
  const referenceMs =
    reference &&
    mean(reference.samples.slice(1, 3).map((item) => runMs(item.replay)));
  const [a1, b1, b2, a2] = waits[0];
  const pairedGain =
    referenceMs &&
    [1 / b1 - 1 / a1, 1 / b2 - 1 / a2].map(
      (difference) => difference * referenceMs,
    );
  const receipt = join(result, "watch-score.json");
  const payload = {
    mode,
    ...(workload ? { workload } : {}),
    contractHash,
    valid,
    qualified,
    runtime,
    receipt,
    samples,
    noiseSpeedIndex,
    ...(native ? { nativeOverlap } : {}),
    ...(native && reference && pairedGain && referenceMs
      ? {
          nativeConfirmation: {
            referenceNoiseSpeedIndex: reference.noiseSpeedIndex,
            pairedGain,
            material:
              qualified &&
              [
                ...pairedGain,
                (1 / mean([b1, b2]) - 1 / mean([a1, a2])) * referenceMs,
              ].every((gain) => gain > reference.noiseSpeedIndex),
          },
        }
      : {}),
    comparison: comparison.timings.map((timing, index) => ({
      wait: waitNames[index],
      ...timing,
    })),
    guards: guards.map((guard, index) => ({
      ...guard,
      passed: comparison.permitted[index],
    })),
    score: valid
      ? baseline
        ? 100
        : (100 * baselineMs) /
          mean(reference!.samples.slice(1, 3).map((item) => runMs(item.replay)))
      : null,
    ...(baseline
      ? { probeOverheadMs: baselineMs - mean([waits[0][0], waits[0][3]]) }
      : {}),
  };
  await writeFile(receipt, JSON.stringify(payload, null, 2) + "\n", {
    mode: 0o600,
  });
  if (!hosted) console.log(JSON.stringify(payload, null, 2));
  return payload;
}

function benchmarkLimits(
  first: Sample,
  repeat: Sample,
  candidate: Sample,
  candidateRepeat: Sample,
) {
  return resourceKeys.flatMap((name) => {
    const control = Math.max(first.resource[name], repeat.resource[name]);
    const allowance =
      name === "storedCaptureBytes"
        ? 0
        : (control * relativeResourceAllowance) / 100;
    return [candidate, candidateRepeat].map((item, repeat) => ({
      name,
      repeat: repeat + 1,
      limit: [item.resource[name], control, allowance] satisfies [
        number,
        number,
        number,
      ],
    }));
  });
}

async function main() {
  const [mode, directory, chrome, cpuSpec, control, reference, ...extra] =
    process.argv.slice(2);
  if (mode === "ledger" && directory && !chrome) {
    const result = await bendScratch(async (scratch) => {
      await buildBend(
        repo,
        "enablement",
        scratch,
        undefined,
        "enablement/timing/journey/journey-scoring.bend",
      );
      return execFileSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `import policy from "./journey-scoring.mjs";
       import { ledger } from ${JSON.stringify(new URL("./watch-ledger.ts", import.meta.url).href)};
       console.log(JSON.stringify(await ledger(process.argv[1], policy, JSON.parse(process.argv[2])), null, 2));`,
          resolve(directory),
          JSON.stringify({ contractHash, hillClimb: contract.hillClimb }),
        ],
        { cwd: scratch, encoding: "utf8" },
      );
    });
    process.stdout.write(result);
  } else if (
    directory &&
    chrome &&
    cpuSpec &&
    !extra.length &&
    ((mode === "baseline" && !control) ||
      (mode === "compare" && control && reference))
  ) {
    const result = await benchmark(
      mode,
      directory,
      chrome,
      cpuSpec,
      control,
      reference,
    );
    if (!result.qualified) process.exitCode = 2;
  } else {
    throw Error(
      "Usage: watch-score.ts baseline|compare PRIVATE_DIR ABSOLUTE_CHROMIUM CPU_LIST [ABSOLUTE_INCUMBENT_TREE BASELINE_RECEIPT] | ledger LEDGER.json",
    );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await main();
}
