import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  createReadStream,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
const id = "threshold-27";
export const threshold = {
  id,
  wait: "paste-22-to-33/" + id,
  seconds: 27,
  strokes: 2,
  model: "parakeet-unified-en-0.6b-Q4_K_M.gguf",
  modelSource: "parakeet:parakeet-unified-en-0.6b-Q4_K_M",
  modelSha256:
    "a8bf3de2b393bd14ead5a858c3748d5e3b07a20fdeabdd3b498fba4f463fa929",
};
export const hostedFixtureId = "record-stop-hosted-threshold-27-v1";

export type Manifest = {
  durationMs: number;
  video: string;
  audio: string;
  strokes: unknown[];
  keyframes: unknown[];
  transcript: {
    source: string;
    estimated?: boolean;
    text: string;
    words: { t0: number; t1: number }[];
  };
};

export const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));

export async function sha256(path: string) {
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  return hash.digest("hex");
}

export function privateJob(path: string) {
  path = realpathSync(path);
  assert.match(path, /^\/tmp\/apparent-dev-[a-zA-Z0-9_-]+$/);
  const stat = statSync(path);
  assert.ok(stat.isDirectory());
  assert.equal(stat.uid, process.getuid?.());
  assert.equal(stat.mode & 0o777, 0o700);
  return path;
}

export function bundleManifest(directory: string): Manifest {
  const manifest: Manifest = json(join(directory, "apparent.json"));
  assert.ok(Math.abs(manifest.durationMs - threshold.seconds * 1000) <= 2250);
  assert.equal(manifest.transcript.source, threshold.modelSource);
  assert.ok(!manifest.transcript.estimated);
  assert.ok(
    manifest.transcript.text.trim() && manifest.transcript.words.length,
  );
  assert.ok(
    manifest.transcript.words.every(
      ({ t0, t1 }, i, words) =>
        Number.isFinite(t0) &&
        Number.isFinite(t1) &&
        t0 >= (i ? words[i - 1].t0 : 0) &&
        t1 >= t0 &&
        t1 <= manifest.durationMs + 1000,
    ),
  );
  assert.equal(manifest.video, "recording.mp4");
  assert.equal(manifest.audio, "audio.wav");
  assert.equal(manifest.strokes.length, threshold.strokes);
  assert.ok(manifest.keyframes.length > 0);
  return manifest;
}

export type StopReference = {
  durationMs: number;
  strokes: unknown[];
  transcript: { text: string };
};

export async function stageStopFixture(
  nativeReport: string,
  directory: string,
) {
  const run = privateJob(dirname(realpathSync(nativeReport)));
  const report = json(nativeReport);
  const wait = report.waits?.[threshold.wait];
  assert.ok(wait?.verified === true && wait.ms > 0);
  assert.equal(report.resources?.[threshold.id]?.outputVerified, true);
  assert.match(report.version, /^apparent\s+\S+\s+·\s+[a-f0-9]{7,40}$/);
  const vm = join(run, "vm");
  const result = json(join(vm, "result.json"));
  assert.equal(result.stage, "finished");
  assert.equal(result.driver, "passed");
  assert.equal(result.artifact_retention, "verified");
  assert.equal(result.scenario_exit, 0);
  const evidence = join(vm, "artifacts");
  const captureConfig = json(
    join(evidence, "config", "apparent", "config.json"),
  );
  assert.equal(captureConfig.experiments?.localStreamingTranscription, false);
  assert.notEqual(captureConfig.experiments?.liveWordWarning, true);
  const status = json(join(evidence, "artifacts", threshold.id + "-stop.json"));
  assert.equal(status.status, "saved");
  assert.match(status.capture_id, /^[a-f0-9]{32}$/);
  const leaf = basename(status.bundle_path);
  assert.match(leaf, /^apparent-[0-9a-z-]+\.apparent$/);
  const capture = join(evidence, "captures", leaf);
  assert.equal(realpathSync(capture), capture);
  for (const file of ["apparent.json", "recording.mp4", "audio.wav"]) {
    assert.ok(lstatSync(join(capture, file)).isFile());
  }
  const manifest = bundleManifest(capture);
  mkdirSync(directory, { mode: 0o700 });
  const files = [];
  for (const name of ["apparent.json", manifest.video, manifest.audio]) {
    const file = join(directory, name);
    copyFileSync(join(capture, name), file);
    files.push({
      name,
      bytes: statSync(file).size,
      sha256: await sha256(file),
    });
  }
  return {
    id: threshold.id,
    directory,
    nativeReport,
    version: report.version,
    attempt: status.capture_id,
    files,
    manifest,
  };
}

export async function stageHostedFixture(seal: string, directory: string) {
  const source = dirname(realpathSync(seal));
  const definition = json(seal);
  const id = hostedFixtureId;
  assert.equal(definition.id, id);
  const expected = readFileSync(
    new URL("../script.txt", import.meta.url),
    "utf8",
  ).trim();
  assert.equal(definition.text, expected);
  const manifest = json(join(source, "apparent.json"));
  assert.equal(manifest.id, id);
  assert.equal(manifest.durationMs, threshold.seconds * 1000);
  assert.equal(manifest.strokes.length, threshold.strokes);
  assert.equal(manifest.video, "recording.mp4");
  assert.equal(manifest.audio, "audio.wav");
  assert.deepEqual(
    definition.files.map(({ name }: { name: string }) => name),
    [
      "apparent.json",
      "audio.wav",
      "recording.mp4",
      "frames/frame-001.png",
      "summary.md",
    ],
  );
  mkdirSync(directory, { mode: 0o700 });
  mkdirSync(join(directory, "frames"), { mode: 0o700 });
  for (const { name, sha256: digest } of definition.files) {
    const input = join(source, name);
    assert.equal(realpathSync(input), input);
    assert.ok(lstatSync(input).isFile());
    assert.equal(await sha256(input), digest);
    copyFileSync(input, join(directory, name));
  }
  const reference: StopReference = {
    durationMs: manifest.durationMs,
    strokes: manifest.strokes,
    transcript: { text: expected },
  };
  return { id, directory, files: definition.files, manifest: reference };
}

function words(text: string) {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

export function transcriptDistance(baseline: StopReference, actual: Manifest) {
  const source = words(baseline.transcript.text);
  const observed = words(actual.transcript.text);
  assert.ok(
    source.length && observed.length && observed.length <= source.length * 2,
  );
  let previous = Array.from({ length: source.length + 1 }, (_, i) => i);
  for (const [i, word] of observed.entries()) {
    const row = [i + 1];
    for (const [j, expected] of source.entries()) {
      row.push(
        Math.min(
          row[j] + 1,
          previous[j + 1] + 1,
          previous[j] + Number(word !== expected),
        ),
      );
    }
    previous = row;
  }
  return previous.at(-1)! / source.length;
}

export function verifyStopBundle(directory: string, source: StopReference) {
  const bundle = bundleManifest(directory);
  assert.equal(bundle.durationMs, source.durationMs);
  assert.deepEqual(bundle.strokes, source.strokes);
  for (const [file, stream] of [
    [bundle.video, "0:v:0"],
    [bundle.audio, "0:a:0"],
  ]) {
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
        join(directory, file),
        "-map",
        stream,
        "-f",
        "null",
        "-",
      ],
      { timeout: 20_000, stdio: ["ignore", "ignore", "pipe"] },
    );
  }
  assert.ok(statSync(join(directory, "summary.md")).size > 0);
  return {
    transcriptDistance: transcriptDistance(source, bundle),
    bundleBytes: bytes(directory),
  };
}

function bytes(directory: string): number {
  return readdirSync(directory, { withFileTypes: true }).reduce(
    (total, entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return total + bytes(path);
      assert.ok(entry.isFile(), "Unexpected artifact type");
      return total + statSync(path).size;
    },
    0,
  );
}
