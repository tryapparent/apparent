import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import {
  type Interval,
  interval,
  type MeasuredWait,
  measuredWait,
} from "../../../../shared/enablement/performance/measurement.ts";
import type { Receipt } from "../score.ts";
import { contract } from "../score.ts";
import { storage } from "../storage.ts";

const [root, ...extra] = process.argv.slice(2);
const profileLane = extra.length === 1 && extra[0] === "--profile-lane";
if (!root || (extra.length && !profileLane))
  throw new Error("Usage: report.ts RETAINED_VM_DIRECTORY [--profile-lane]");
const artifacts = resolve(root, "artifacts/artifacts");
if (existsSync(resolve(artifacts, "profile.json")) && !profileLane)
  throw new Error(
    "Profiled timings are diagnostic and cannot produce a scoring receipt",
  );
if (profileLane && !existsSync(resolve(artifacts, "lane-window.json")))
  throw new Error("Missing completed Perfetto lane window");
const read = (name: string) =>
  readFileSync(resolve(artifacts, name), "utf8").trimEnd();
const rows = (name: string, header = false) =>
  read(name)
    .split("\n")
    .slice(header ? 1 : 0)
    .filter(Boolean)
    .map((line) => line.split("\t"));
const vcpus = Number(read("vcpu.txt"));
const hz = Number(read("clock-ticks.txt"));
const result = JSON.parse(readFileSync(resolve(root, "result.json"), "utf8"));
if (
  result.stage !== "finished" ||
  result.driver !== "passed" ||
  result.artifact_retention !== "verified" ||
  result.scenario_exit !== 0 ||
  vcpus !== contract.limits.vcpus ||
  !(hz > 0)
) {
  throw new Error("Requires a complete and integrity-verified native run");
}
const starts = new Map(
  rows("phase-start.tsv").map(([id, ...times]) => [id, times.map(Number)]),
);
const ends = new Map(
  rows("phase-finish.tsv").map(([id, ...times]) => [id, times.map(Number)]),
);
const round = (n: number) => +n.toFixed(3);
const avg = (ns: number[]) => ns.reduce((s, n) => s + n, 0) / ns.length;
const percentile = (ns: number[], q: number) =>
  [...ns].sort((a, b) => a - b)[Math.ceil(ns.length * q) - 1];
const spanData = rows("spans.tsv");
const measured = (id: string, key: string) =>
  +(
    (spanData.find((s) => s[0] === id && s[1] === key && s[2] === "measured") ??
      [])[3] ?? NaN
  );
const samples = rows("resources.tsv", true)
  .map((raw) => {
    const [
      at,
      dt,
      ticks,
      cpu,
      busy,
      steal,
      rss,
      pss,
      pssCount,
      owned,
      free,
      pid,
    ] = raw.map(Number);
    return {
      at,
      dt,
      pid,
      app: (1000 * ticks) / hz / dt,
      guest: (vcpus * busy) / cpu,
      steal: steal / cpu,
      free: free / 1024,
      rss: rss / 1024,
      pss: pssCount > 0 && pssCount === owned ? pss / 1024 : null,
    };
  })
  .filter((s) => s.dt > 0 && Number.isFinite(s.guest));
if (!samples.length || !samples.some((s) => s.pid > 0))
  throw Error("No verified recorder samples");

function window(from: number, to: number, memoryRequired = true) {
  const s = samples.filter((row) => row.at > from && row.at - row.dt < to);
  if (!s.length) throw Error("Missing samples");
  const duration = to - from;
  let atCap = 0,
    maxRun = 0,
    running = 0,
    guestWeighted = 0,
    appWeighted = 0,
    stealWeighted = 0,
    observed = 0,
    previous = from;
  for (const row of s) {
    const first = Math.max(from, row.at - row.dt),
      last = Math.min(to, row.at);
    const dt = last - first;
    const validInterval = row.dt <= 300;
    if (!validInterval || first - previous > 5) running = 0;
    observed += dt;
    appWeighted += row.app * dt;
    guestWeighted += row.guest * dt;
    stealWeighted += row.steal * dt;
    if (
      validInterval &&
      row.guest >= contract.limits.saturatedMillicores / 1000
    ) {
      atCap += dt;
      running += dt;
      maxRun = Math.max(maxRun, running);
    } else running = 0;
    previous = last;
  }
  const pss = s.flatMap((row) => (row.pss === null ? [] : [row.pss]));
  if (
    s.some((row) => row.pid <= 0) ||
    s.some((row) => row.pid !== s[0].pid) ||
    (memoryRequired && !pss.length) ||
    observed / duration < 0.95
  )
    throw Error("Incomplete recorder process or PSS observation");
  return {
    durationMs: duration,
    samples: s.length,
    pssSamples: pss.length,
    appPid: s[0].pid,
    appMeanCores: round(appWeighted / observed),
    appP95Cores: round(
      percentile(
        s.map((r) => r.app),
        0.95,
      ),
    ),
    appPeakCores: round(Math.max(...s.map((r) => r.app))),
    guestMeanCores: round(guestWeighted / observed),
    guestP95Cores: round(
      percentile(
        s.map((r) => r.guest),
        0.95,
      ),
    ),
    guestPeakCores: round(Math.max(...s.map((r) => r.guest))),
    appPeakPssMiB: pss.length ? round(Math.max(...pss)) : null,
    appPeakRssMiB: round(Math.max(...s.map((r) => r.rss))),
    minGuestAvailableMiB: round(Math.min(...s.map((r) => r.free))),
    stealPercent: round((100 * stealWeighted) / observed),
    saturationMs: atCap,
    longestSaturationMs: maxRun,
    maxIntervalMs: Math.max(...s.map((r) => r.dt)),
  };
}

type Physical = {
  id: string;
  owned: string;
  waitMs: number;
  interval?: Interval;
  pollIntervalMs: number;
  source: string;
};
const physical = new Map<string, Physical>();
for (const line of readFileSync(resolve(root, "physical-finish.jsonl"), "utf8")
  .trim()
  .split("\n")) {
  const row = JSON.parse(line) as Physical;
  if (
    physical.has(row.id) ||
    row.source !== "physical-record-shortcut" ||
    !Number.isFinite(row.waitMs) ||
    row.waitMs <= 0 ||
    !Number.isFinite(row.pollIntervalMs) ||
    row.pollIntervalMs !== 20
  ) {
    throw new Error("Invalid or duplicate physical Finish timing");
  }
  physical.set(row.id, row);
}

const waits: Record<string, MeasuredWait> = {};
const resourceIntervals: Record<
  string,
  { recording: Interval; finalization: Interval }
> = {};
const resources: Receipt["resources"] = {};
const fixtureIds = Object.keys(contract.captureFixtures).filter(
  (id) => id !== "portal-warmup",
);
const phase = (from: number, to: number) => {
  const sample = window(from, to);
  return {
    p95Millicores: Math.round(sample.guestP95Cores * 1000),
    saturationMs: sample.longestSaturationMs,
    cpuSeconds: (sample.appMeanCores * sample.durationMs) / 1000,
    availableMemoryMiB: sample.minGuestAvailableMiB,
    appPssMiB: sample.appPeakPssMiB!,
    guestStealPercent: sample.stealPercent,
  };
};
const words = (text: string) => text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
const sourceWords = words(
  readFileSync(
    new URL(
      "../../../../record/enablement/performance/script.txt",
      import.meta.url,
    ),
    "utf8",
  ),
);
function wordErrorRate(observed: string[], seconds: number) {
  const count = Math.round((seconds * sourceWords.length) / 21.54);
  const min = Math.floor(count * 0.86);
  const max = Math.ceil(count * 1.08);
  let previous = Array.from({ length: max + 1 }, (_, index) => index);
  for (const [index, word] of observed.entries()) {
    const row = [index + 1];
    for (let i = 0; i < max; i++) {
      row.push(
        Math.min(
          row[i] + 1,
          previous[i + 1] + 1,
          previous[i] + Number(word !== sourceWords[i % sourceWords.length]),
        ),
      );
    }
    previous = row;
  }
  return Math.min(
    ...previous.slice(min).map((value, index) => value / (min + index)),
  );
}

for (const id of fixtureIds) {
  if (!physical.has(id)) continue;
  const measurement = physical.get(id)!;
  const receipt = JSON.parse(read(id + "-stop.json"));
  const fixture = contract.captureFixtures[id];
  const proof = JSON.parse(read(id + "-proof.json"));
  const leaf = basename(receipt.bundle_path);
  const bundle = resolve(root, "artifacts/captures", leaf);
  const [start, live, stop] = starts.get(id) ?? [];
  const [saved, clipboard] = ends.get(id) ?? [];
  if (
    receipt.capture_id !== measurement.owned ||
    receipt.status !== "saved" ||
    !leaf.endsWith(".apparent") ||
    !(start <= live && live < stop && stop < saved && stop < clipboard) ||
    !read(id + "-clipboard.txt").includes(receipt.bundle_path) ||
    measured(id, "paste") !== clipboard - stop ||
    proof.actualInk !== fixture.strokes ||
    Math.abs(proof.durationMs - fixture.seconds * 1000) > 2250 ||
    proof.keyframes <= 0
  ) {
    throw new Error("Unqualified recording evidence for " + id);
  }
  const manifest = JSON.parse(
    readFileSync(resolve(bundle, "apparent.json"), "utf8"),
  );
  const transcript = manifest.transcript;
  const clocks = transcript.words ?? [];
  if (fixture.audio === "spoken") {
    if (
      !clocks.length ||
      transcript.estimated ||
      !clocks.every(
        (word: { t0: number; t1: number }, index: number) =>
          Number.isFinite(word.t0) &&
          Number.isFinite(word.t1) &&
          word.t0 >= 0 &&
          word.t1 >= word.t0 &&
          word.t1 <= manifest.durationMs + 1000 &&
          (index === 0 || word.t0 >= clocks[index - 1].t0),
      )
    ) {
      throw new Error("Unqualified speech timing for " + id);
    }
  } else if (clocks.length) {
    throw new Error("Unqualified silent fixture " + id);
  }
  const video = resolve(bundle, "recording.mp4");
  execFileSync(
    "ffmpeg",
    ["-nostdin", "-v", "error", "-xerror", "-i", video, "-f", "null", "-"],
    { stdio: ["ignore", "ignore", "pipe"], timeout: 180_000 },
  );
  const scratch = rows(id + "-scratch.tsv").map(([bytes]) => Number(bytes));
  if (
    scratch.length < 2 ||
    scratch.some((bytes) => !Number.isSafeInteger(bytes) || bytes < 0)
  ) {
    throw new Error("Missing sampled scratch usage for " + id);
  }
  const group = contract.cases["paste-22-to-33"].includes(id)
    ? "paste-22-to-33"
    : "paste";
  waits[group + "/" + id] = {
    ms: measurement.waitMs,
    verified: true,
    intervals: measurement.interval ? [[measurement.interval]] : undefined,
  };
  const end = Math.max(saved, clipboard);
  resourceIntervals[id] = {
    recording: interval(live, stop, "guest-boottime"),
    finalization: interval(stop, end, "guest-boottime"),
  };
  resources[id] = {
    recording: phase(live, stop),
    finalization: phase(stop, end),
    bundleBytes: storage(bundle).logicalBytes,
    peakScratchBytes: Math.max(...scratch) - scratch[0],
    outputVerified: true,
    ...(fixture.audio === "spoken"
      ? {
          wordErrorRate: wordErrorRate(words(transcript.text), fixture.seconds),
        }
      : {}),
  };
}
const copyMs = measured("quick-silent", "cli-copy");
if (copyMs > 0) {
  const bounds = spanData
    .find(([id, key]) => id === "quick-silent" && key === "cli-copy")
    ?.slice(4);
  waits.copy =
    bounds?.length === 2
      ? measuredWait(Number(bounds[0]), Number(bounds[1]), "guest-boottime")
      : { ms: copyMs, verified: true };
}
console.log(
  JSON.stringify(
    {
      version: read("version.txt"),
      waits,
      resources,
      resourceIntervals,
      ...(profileLane ? { diagnostic: true } : {}),
    },
    null,
    2,
  ),
);
