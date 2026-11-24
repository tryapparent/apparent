import { readFileSync, realpathSync } from "node:fs";
import {
  benchmarkComparison,
  type Limit,
  type Matched,
} from "../../../../shared/enablement/performance/comparison.ts";
import type { MeasuredWait } from "../../../../shared/enablement/performance/measurement.ts";

type Phase = {
  p95Millicores: number;
  cpuSeconds: number;
  saturationMs: number;
  availableMemoryMiB: number;
  appPssMiB: number;
  guestStealPercent: number;
};
type Capture = {
  outputVerified: boolean;
  recording: Phase;
  finalization: Phase;
  wordErrorRate: number;
};
type StartResources = {
  cpuSeconds: number;
  peakSampledPssMiB: number;
  minAvailableMiB: number;
  guestStealPercent: number;
  hostCpuPressurePercent: number;
  videoBytes: number;
};
type Report = {
  version: string;
  selection?: "skipped";
  diagnostic?: true;
  waits?: Record<string, MeasuredWait>;
  resources?: Record<string, Capture>;
  stages?: Record<string, Record<string, number>>;
  directTakes?: { name: string; resources: StartResources }[];
};

const fixture = "threshold-27";
const [lane, ...paths] = process.argv.slice(2);
if ((lane !== "start" && lane !== "stop") || paths.length !== 4) {
  throw Error(
    "Usage: run.ts start|stop CONTROL_1 CANDIDATE_1 CANDIDATE_2 CONTROL_2",
  );
}
const files = paths.map((path) => realpathSync(path));
if (new Set(files).size !== files.length)
  throw Error("Supply four independent reports");
const reports = files.map((file) => {
  const report = JSON.parse(readFileSync(file, "utf8")) as Report;
  if (
    report?.diagnostic ||
    typeof report?.version !== "string" ||
    !/^apparent\s+\S+\s+·\s+[a-f0-9]{7,40}$/.test(report.version)
  )
    throw Error("Expected an unprofiled native report: " + file);
  return report;
}) as Matched<Report>;
const [a, b, bRepeat, aRepeat] = reports;
if (a.version !== aRepeat.version || b.version !== bRepeat.version)
  throw Error("Revisions must match within each control and candidate pair");
if (
  (a.selection !== undefined &&
    (a.selection !== "skipped" || lane !== "start")) ||
  reports.some((report) => report.selection !== a.selection)
) {
  throw Error("Start reports must use matching source selection");
}

const finite = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n) && n >= 0;
const checkpoint = lane === "start" ? "live" : "paste-22-to-33/" + fixture;
function times(key: string, trials: number) {
  const seen = new Set<string>();
  return reports.map(({ waits }, i) => {
    const wait = waits?.[key];
    if (
      wait?.verified !== true ||
      !finite(wait.ms) ||
      wait.ms < 0.001 ||
      !Array.isArray(wait.intervals) ||
      wait.intervals.length !== trials
    )
      throw Error("Missing verified " + key + " observation: " + files[i]);
    let durationUs = 0;
    for (const trial of wait.intervals) {
      if (
        !Array.isArray(trial) ||
        trial.length !== (a.selection === "skipped" ? 1 : trials)
      )
        throw Error("Missing witness interval: " + files[i]);
      for (const span of trial) {
        if (
          span?.clock !== "host" ||
          !Number.isSafeInteger(span.startUs) ||
          !Number.isSafeInteger(span.endUs) ||
          span.startUs < 0 ||
          span.endUs <= span.startUs
        )
          throw Error("Invalid host timing: " + files[i]);
        durationUs += span.endUs - span.startUs;
      }
    }
    if (Math.abs(durationUs / (trials * 1000) - wait.ms) > 0.005)
      throw Error("Elapsed time disagrees with host timing: " + files[i]);
    const proof = JSON.stringify(wait.intervals);
    if (seen.has(proof)) throw Error("Duplicate timing evidence: " + files[i]);
    seen.add(proof);
    return wait.ms;
  }) as Matched<number>;
}

const primary = times(checkpoint, lane === "start" ? 2 : 1);
const pill = lane === "start" ? times("pill", 2) : undefined;
const captures =
  lane === "stop"
    ? (reports.map(({ resources }, i) => {
        const capture = resources?.[fixture];
        if (
          capture?.outputVerified !== true ||
          !finite(capture.wordErrorRate) ||
          ![capture.recording, capture.finalization].every(
            (phase) =>
              phase &&
              [
                phase.p95Millicores,
                phase.cpuSeconds,
                phase.saturationMs,
                phase.availableMemoryMiB,
                phase.appPssMiB,
                phase.guestStealPercent,
              ].every(finite) &&
              phase.appPssMiB > 0 &&
              phase.availableMemoryMiB > 0,
          )
        )
          throw Error(
            "Missing verified Stop resource or output evidence: " + files[i],
          );
        return capture;
      }) as Matched<Capture>)
    : undefined;

const checks: { limits: Limit[]; failure: string; invalid?: true }[] = [];
if (a.selection === "skipped") {
  for (const [index, report] of reports.entries()) {
    const takes = report.directTakes;
    if (
      takes?.length !== 2 ||
      takes[0].name !== "shortcut-first" ||
      takes[1].name !== "shortcut-repeat"
    )
      throw Error("Missing picker-skipped resource evidence");
    for (const [sample, { resources }] of takes.entries()) {
      if (
        !resources ||
        ![
          resources.cpuSeconds,
          resources.peakSampledPssMiB,
          resources.minAvailableMiB,
          resources.guestStealPercent,
          resources.hostCpuPressurePercent,
          resources.videoBytes,
        ].every(finite) ||
        resources.videoBytes <= 0 ||
        resources.peakSampledPssMiB <= 0
      )
        throw Error("Invalid picker-skipped resource evidence");
      checks.push({
        limits: [
          [resources.guestStealPercent, 5],
          [resources.hostCpuPressurePercent, 5],
        ],
        failure: "CPU contention exceeded 5%: " + files[index],
        invalid: true,
      });
      if (index === 1 || index === 2) {
        const left = a.directTakes?.[sample].resources;
        const right = aRepeat.directTakes?.[sample].resources;
        if (!left || !right) throw Error("Missing matching control resources");
        const maxCpu = Math.max(left.cpuSeconds, right.cpuSeconds);
        checks.push({
          limits: [
            [resources.cpuSeconds, maxCpu, Math.max(0.2, maxCpu * 0.1)],
            [
              resources.peakSampledPssMiB,
              Math.max(left.peakSampledPssMiB, right.peakSampledPssMiB),
              128,
            ],
            [1024, resources.minAvailableMiB],
            [
              resources.videoBytes / 1048576,
              Math.max(left.videoBytes, right.videoBytes) / 1048576,
              16,
            ],
          ],
          failure:
            "Run " +
            (index + 1) +
            " exceeded the picker-skipped resource budget",
        });
      }
    }
  }
}
if (captures) {
  const controlPss =
    (captures[0].recording.appPssMiB + captures[3].recording.appPssMiB) / 2;
  const controlWordError =
    (captures[0].wordErrorRate + captures[3].wordErrorRate) / 2;
  for (const [
    i,
    { recording, finalization, wordErrorRate },
  ] of captures.entries()) {
    checks.push({
      limits: [
        [recording.guestStealPercent, 5],
        [finalization.guestStealPercent, 5],
      ],
      failure: "CPU contention exceeded 5%: " + files[i],
      invalid: true,
    });
    if (i === 0 || i === 3) continue;
    const failure = "Run " + (i + 1) + " exceeded the ";
    checks.push(
      {
        limits: [
          [recording.p95Millicores, 3500],
          [recording.saturationMs, 499],
        ],
        failure: failure + "recording CPU budget",
      },
      {
        limits: [
          [1024, recording.availableMemoryMiB],
          [recording.appPssMiB, controlPss, 128],
        ],
        failure: failure + "recording memory budget",
      },
      {
        limits: [[wordErrorRate, controlWordError, 0.02]],
        failure: failure + "transcript error budget",
      },
    );
  }
}

const {
  timings: [timing, visiblePill],
  permitted,
} = await benchmarkComparison(
  pill ? [primary, pill] : [primary],
  checks.flatMap(({ limits }) => limits),
);
const failures = [];
let offset = 0;
for (const check of checks) {
  const end = offset + check.limits.length;
  const passed = permitted.slice(offset, end).every(Boolean);
  offset = end;
  if (passed) continue;
  if (check.invalid) throw Error(check.failure);
  failures.push(check.failure);
}
console.log(
  JSON.stringify(
    {
      stream: "record",
      lane,
      ...(a.selection ? { selection: a.selection } : {}),
      ...(a.selection
        ? {
            startResources: reports.map(({ directTakes }) =>
              directTakes?.map(({ resources }) => resources),
            ),
          }
        : {}),
      ...(lane === "stop" ? { fixture } : {}),
      control: a.version,
      candidate: b.version,
      baselineScore: 100,
      score: timing.score,
      timing,
      ...(visiblePill ? { visiblePill } : {}),
      ...(captures
        ? {
            captures,
            stages: reports.map(({ stages }) => stages?.[fixture] ?? null),
          }
        : {}),
      failures,
    },
    null,
    2,
  ),
);
