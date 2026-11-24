import assert from "node:assert/strict";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { hostedFixtureId, threshold } from "../local/stop-fixture.ts";
import { command, type HostedJob, receipt, sha256 } from "./job.ts";

const filename = threshold.model;
const url =
  "https://huggingface.co/handy-computer/parakeet-unified-en-0.6b-gguf/resolve/7e948f21b7bdbac698d3318db9d350f1096f3b6c/" +
  filename;
const digest = threshold.modelSha256;

export async function model(job: HostedJob) {
  const directory = join(job.scratch, "model");
  mkdirSync(directory, { mode: 0o700 });
  const path = join(directory, filename);
  command(
    "curl",
    ["--fail", "--location", "--retry", "2", "--output", path, url],
    { env: job.env },
  );
  const bytes = statSync(path).size;
  assert.equal(bytes, 477_274_496);
  assert.equal(await sha256(path), digest);
  receipt(path + ".verified.json", { sha256: digest, bytes, url });
  receipt(join(job.evidence, "model.json"), {
    filename,
    sha256: digest,
    bytes,
    url,
  });
  return path;
}

export async function fixture(job: HostedJob) {
  const bundle = join(job.scratch, "synthetic-editor.apparent");
  mkdirSync(bundle, { mode: 0o700 });
  const text = readFileSync(
    fileURLToPath(new URL("../script.txt", import.meta.url)),
    "utf8",
  ).trim();
  const source = join(job.scratch, "speech.wav");
  const audio = "audio.wav";
  const video = "recording.mp4";
  const seconds = String(threshold.seconds);
  command("espeak-ng", ["-v", "en-us", "-s", "210", "-w", source, text], {
    env: job.env,
  });
  const work = { env: job.env, cwd: bundle };
  const ffmpeg = [
    "-nostdin",
    "-v",
    "error",
    "-threads",
    "1",
    "-filter_threads",
    "1",
  ];
  command(
    "ffmpeg",
    [
      ...ffmpeg,
      "-i",
      source,
      "-af",
      "apad",
      "-t",
      seconds,
      "-ar",
      "16000",
      "-ac",
      "1",
      "-c:a",
      "pcm_s16le",
      audio,
    ],
    work,
  );
  const file = "frames/frame-001.png";
  mkdirSync(join(bundle, "frames"), { mode: 0o700 });
  command(
    "ffmpeg",
    [
      ...ffmpeg,
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=1280x720:rate=15:duration=" + seconds,
      "-c:v",
      "libx264",
      "-threads",
      "1",
      "-preset",
      "veryfast",
      "-pix_fmt",
      "yuv420p",
      video,
    ],
    work,
  );
  command(
    "ffmpeg",
    [...ffmpeg, "-i", video, "-frames:v", "1", "-threads", "1", file],
    work,
  );
  const id = hostedFixtureId;
  const width = 1280,
    height = 720;
  const strokes = [
    {
      t0: 5500,
      t1: 5800,
      fw: width,
      fh: height,
      pts: [1000, 1800, 0, 2300, 2100, 300],
    },
    {
      t0: 14200,
      t1: 14500,
      fw: width,
      fh: height,
      pts: [1700, 4200, 0, 4400, 4700, 300],
    },
  ];
  const manifest = {
    version: 2,
    id,
    createdAtMs: 0,
    durationMs: threshold.seconds * 1000,
    video,
    audio,
    target: {
      mode: "display",
      displayId: 0,
      frame: { x: 0, y: 0, width, height, scale: 1 },
    },
    transcript: { source: "none", text: "", segments: [] },
    strokes,
    marks: [],
    events: [],
    contactSheet: file,
    keyframes: [
      { index: 1, t: 0, reason: "initial", file, event: "Synthetic editor" },
    ],
  };
  receipt(join(bundle, "apparent.json"), manifest);
  writeFileSync(join(bundle, "summary.md"), "Synthetic editor benchmark.\n", {
    mode: 0o600,
  });
  const files = [];
  for (const name of ["apparent.json", audio, video, file, "summary.md"])
    files.push({ name, sha256: await sha256(join(bundle, name)) });
  const fixturePath = join(bundle, "fixture.json");
  receipt(fixturePath, { id, text, files });
  receipt(join(job.evidence, "fixture.json"), {
    id,
    files,
    seconds: threshold.seconds,
    strokes: strokes.length,
  });
  return fixturePath;
}
