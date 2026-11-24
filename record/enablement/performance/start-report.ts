import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import {
  type Interval,
  type MeasuredWait,
} from "../../../shared/enablement/performance/measurement.ts";
import { type InkEvidence, verifiedInk } from "./ink.ts";
import { pressureReader } from "./native/pressure.ts";
import { startupSpans } from "./native/start-spans.ts";
import { verifiedStart } from "./start.ts";

const [root, ...extra] = process.argv.slice(2);
if (!root || extra.length)
  throw Error("Usage: start-report.ts RETAINED_VM_DIRECTORY");
const read = (file: string) => readFileSync(resolve(root, file), "utf8");
const result = JSON.parse(read("result.json"));
if (
  result.stage !== "finished" ||
  result.driver !== "passed" ||
  result.artifact_retention !== "verified" ||
  result.scenario_exit !== 0
) {
  throw Error("Requires a successfully retained native Start run");
}
const rows = read("weighted-start-observations.jsonl")
  .trim()
  .split("\n")
  .map((row) => JSON.parse(row));
const names = ["shortcut-first", "shortcut-repeat"];
if (rows.length !== names.length)
  throw Error("Expected exactly two native observations");
const artifact = (name: string, suffix: string) =>
  JSON.parse(read("artifacts/artifacts/" + name + "-" + suffix + ".json"));
let ms = 0;
const live: number[] = [];
const ink: number[] = [];
const owned = new Set<string>();
const pillIntervals: Interval[][] = [];
const liveIntervals: Interval[][] = [];
const inkIntervals: Interval[][] = [];
const directTakes = [];
const selection = rows[0]?.selection;
const hostPressure =
  selection === "skipped"
    ? pressureReader(
        readFileSync(resolve(dirname(root), "host-pressure.tsv"), "utf8"),
      )
    : undefined;
const resources =
  selection === "skipped"
    ? read("artifacts/artifacts/resources.tsv")
        .trim()
        .split("\n")
        .slice(1)
        .map((line) => line.split("\t").map(Number))
    : [];
for (const name of names) {
  const row = rows.find((row) => row.name === name);
  if (!row || row.selection !== selection || !verifiedStart(row))
    throw Error("Unqualified native Start observation");
  const state = artifact(name, "state").state;
  const saved = artifact(name, "stop");
  const bundle = basename(saved.bundle_path);
  const output = JSON.parse(
    read("artifacts/captures/" + bundle + "/apparent.json"),
  );
  if (
    state.phase !== "recording" ||
    saved.status !== "saved" ||
    !/^[a-f0-9]{32}$/.test(state.capture_id) ||
    state.capture_id !== saved.capture_id ||
    owned.has(state.capture_id) ||
    !bundle.endsWith(".apparent") ||
    output.video !== "recording.mp4" ||
    !Array.isArray(output.keyframes) ||
    !output.keyframes.length ||
    statSync(resolve(root, "artifacts/captures", bundle, output.video)).size <=
      0
  ) {
    throw Error("Native Start was not followed by a usable owned capture");
  }
  owned.add(state.capture_id);
  if (hostPressure) {
    const movie = resolve(root, "artifacts/captures", bundle, output.video);
    execFileSync(
      "ffmpeg",
      [
        "-nostdin",
        "-v",
        "error",
        "-xerror",
        "-threads",
        "1",
        "-i",
        movie,
        "-map",
        "0:v:0",
        "-map",
        "0:a?",
        "-f",
        "null",
        "-",
      ],
      { timeout: 12000 },
    );
    const trace = artifact(name, "startup");
    const appRelativeSpans = startupSpans(trace, () =>
      read("artifacts/artifacts/application.log"),
    );
    const samples = resources.filter(
      (sample) =>
        sample[0] >= trace.resourceWindow.started &&
        sample[0] <= trace.resourceWindow.stoppedAt &&
        sample[11] > 0,
    );
    const pss = samples.filter(
      (sample) => sample[8] > 0 && sample[8] === sample[9],
    );
    const cpu = samples.reduce((sum, sample) => sum + sample[3], 0);
    const [witness] = row.intervals?.live ?? [];
    if (
      trace.captureId !== state.capture_id ||
      !row.live ||
      !appRelativeSpans.length ||
      !samples.length ||
      !pss.length ||
      cpu <= 0 ||
      !witness
    ) {
      throw Error("Missing picker-skipped Start trace or resource evidence");
    }
    const pressure = hostPressure(witness);
    directTakes.push({
      name,
      ...trace,
      appRelativeSpans,
      observation: row,
      hostPressureWindow: pressure,
      resources: {
        cpuSeconds:
          samples.reduce((sum, sample) => sum + sample[2], 0) /
          Number(read("artifacts/artifacts/clock-ticks.txt")),
        peakSampledPssMiB: Math.max(...pss.map((sample) => sample[7])) / 1024,
        minAvailableMiB:
          Math.min(...samples.map((sample) => sample[10])) / 1024,
        guestStealPercent:
          (100 * samples.reduce((sum, sample) => sum + sample[5], 0)) / cpu,
        hostCpuPressurePercent: pressure.percent,
        videoBytes: statSync(movie).size,
      },
    });
  }
  ms += row.ms / names.length;
  if (row.intervals?.pill) pillIntervals.push(row.intervals.pill);
  if (row.ink !== undefined) {
    if (
      !verifiedInk(row.ink as InkEvidence) ||
      !Array.isArray(output.strokes) ||
      output.strokes.length !== 1
    )
      throw Error("Visible ink was not followed by one saved stroke");
    ink.push(row.ink.ms);
    if (row.ink.interval) inkIntervals.push([row.ink.interval]);
  }
  if (row.live !== undefined) {
    const milestones = [
      row.live.screenMs,
      row.live.microphoneMs,
      row.live.pillMs,
    ];
    if (
      !milestones.every((value) => Number.isFinite(value) && value > 0) ||
      row.live.pillMs < row.pill.ms
    )
      throw Error("Unqualified first media observation");
    live.push((row.picker?.ms ?? 0) + Math.max(...milestones));
    if (row.intervals?.live) liveIntervals.push(row.intervals.live);
  }
}
if (live.length && live.length !== names.length)
  throw Error("First media proof must cover both trials");
if (ink.length && ink.length !== names.length)
  console.error("Visible ink proof is missing on one of the trials");
const version = read("artifacts/artifacts/version.txt").trim();
const interactions: Record<string, MeasuredWait> = {};
const detailPath = "artifacts/artifacts/interaction-waits.json";
if (existsSync(resolve(root, detailPath))) {
  const detail = JSON.parse(read(detailPath));
  if (detail.version !== version)
    throw Error("Mismatched desktop probe version");
  for (const name of ["captions", "cancel"]) {
    const measurement = detail.waits[name];
    if (measurement === undefined) continue;
    const verified = JSON.parse(
      read("artifacts/artifacts/" + name + "-verified.json"),
    );
    if (
      measurement.verified !== true ||
      !Number.isFinite(measurement.ms) ||
      measurement.ms <= 0 ||
      measurement.ms !== verified.ms ||
      !/^[a-f0-9]{32}$/.test(verified.captureId) ||
      (name === "captions" &&
        !/\bopen the project settings\b/i.test(verified.text))
    )
      throw Error("Invalid interaction readback: " + name);
    interactions[name] = measurement;
  }
  const timingFile = "physical-interactions.jsonl";
  if (existsSync(resolve(root, timingFile))) {
    for (const line of read(timingFile).trim().split("\n")) {
      const { name, ms, intervals } = JSON.parse(line);
      if (
        !["note", "paste-last"].includes(name) ||
        interactions[name] ||
        !Number.isFinite(ms) ||
        ms <= 0
      )
        throw Error("Invalid physical input proof");
      const verified = JSON.parse(
        read("artifacts/artifacts/" + name + "-verified.json"),
      );
      if (
        name === "note" &&
        (verified.value !== "Synthetic note accepted" ||
          !/^[a-f0-9]{32}$/.test(verified.captureId))
      )
        throw Error("Focused note did not accept the fixture text");
      if (
        name === "paste-last" &&
        verified.value !==
          read("artifacts/artifacts/shortcut-repeat-expected.txt").trimEnd()
      )
        throw Error("Focused draft differs from the saved clipboard payload");
      interactions[name] = { ms, verified: true, intervals };
    }
  }
}
console.log(
  JSON.stringify(
    {
      version,
      ...(selection ? { selection } : {}),
      ...(directTakes.length ? { directTakes } : {}),
      waits: {
        pill: { ms, verified: true, intervals: pillIntervals },
        ...interactions,
        ...(ink.length === names.length
          ? {
              ink: {
                ms: ink.reduce((sum, value) => sum + value, 0) / ink.length,
                intervals: inkIntervals,
                verified: true,
              },
            }
          : {}),
        ...(live.length
          ? {
              live: {
                ms: live.reduce((sum, value) => sum + value, 0) / live.length,
                intervals: liveIntervals,
                verified: true,
              },
            }
          : {}),
      },
    },
    null,
    2,
  ),
);
