import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { probeMovie } from "@apparent/engine-sdk";
import { qualifyFrames } from "./qualify-frames.ts";

const [executable, directory] = process.argv.slice(2).map((p) => resolve(p));
if (!executable || !directory)
  throw Error("Use qualify.ts <native executable> <private directory>");
const movie = join(directory, "synthetic movie.mp4");
execFileSync(
  "ffmpeg",
  [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=64x48:r=25:d=1",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000:duration=1",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-y",
    movie,
  ],
  { stdio: "pipe" },
);
const digest = () =>
  createHash("sha256").update(readFileSync(movie)).digest("hex");
const before = digest();
const info = await probeMovie({ executable, movie });
assert.equal(info.video?.width, 64);
assert.equal(info.video?.height, 48);
assert.equal(info.video?.fps, 25);
assert.ok(info.video.durationMs >= 950 && info.video.durationMs <= 1050);
assert.equal(info.audio.length, 1);
assert.equal(digest(), before, "probing must not change media");
const rotated = join(directory, "rotated.mp4");
execFileSync("ffmpeg", [
  "-v",
  "error",
  "-display_rotation:v:0",
  "90",
  "-i",
  movie,
  "-c",
  "copy",
  "-y",
  rotated,
]);
const rotation = await probeMovie({ executable, movie: rotated });
assert.equal(rotation.video?.width, 48);
assert.equal(rotation.video?.height, 64);
const silent = join(directory, "silent.mp4");
execFileSync("ffmpeg", [
  "-v",
  "error",
  "-i",
  movie,
  "-an",
  "-c:v",
  "copy",
  "-y",
  silent,
]);
assert.equal((await probeMovie({ executable, movie: silent })).audio.length, 0);
const broken = join(directory, "broken.mp4");
writeFileSync(broken, "not a movie");
await assert.rejects(probeMovie({ executable, movie: broken }), {
  code: "probe_failed",
});
await assert.rejects(
  probeMovie({ executable, movie: join(directory, "missing.mp4") }),
  { code: "probe_failed" },
);
console.log(
  JSON.stringify({
    platform: process.platform,
    arch: process.arch,
    syntheticMovie: info,
    inputSha256: before,
    checks: [
      "public-packed-sdk",
      "real-native-reader",
      "audio",
      "rotation",
      "silent",
      "invalid",
      "missing",
      "read-only",
    ],
  }),
);
const frames = join(dirname(executable), "apparent-engine-frames");
const previous = process.env.APPARENT_ENGINE_QUALIFY_SEQUENTIAL;
if (process.platform === "darwin")
  delete process.env.APPARENT_ENGINE_QUALIFY_SEQUENTIAL;
try {
  await qualifyFrames(frames, directory, movie, rotated);
  if (process.platform === "darwin") {
    const sequential = join(directory, "sequential-qualification");
    mkdirSync(sequential, { mode: 0o700 });
    process.env.APPARENT_ENGINE_QUALIFY_SEQUENTIAL = "1";
    await qualifyFrames(frames, sequential, movie, rotated);
  }
} finally {
  if (process.platform === "darwin") {
    if (previous === undefined)
      delete process.env.APPARENT_ENGINE_QUALIFY_SEQUENTIAL;
    else process.env.APPARENT_ENGINE_QUALIFY_SEQUENTIAL = previous;
  }
}
