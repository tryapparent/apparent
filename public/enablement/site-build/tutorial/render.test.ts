import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const renderer = fileURLToPath(new URL("./render.ts", import.meta.url));
const soundtrack = fileURLToPath(
  new URL("./media/soundtrack.wav", import.meta.url),
);
const ffmpeg = (...args: string[]) =>
  execFileSync("ffmpeg", ["-v", "error", "-nostdin", ...args], {
    maxBuffer: 4 * 1024 * 1024,
  });

function samples(file: string): Buffer {
  return ffmpeg(
    "-i",
    file,
    "-map",
    "0:a:0",
    "-ac",
    "1",
    "-ar",
    "44100",
    "-f",
    "s16le",
    "-",
  );
}

function checkMovieFrames(movie: string) {
  const positions = [105, 335, 440, 740, 985, 1320];
  const pixels = ffmpeg(
    "-i",
    movie,
    "-vf",
    `select='${positions.map((frame) => `eq(n,${frame})`).join("+")}',crop=1600:910:160:50,scale=160:91,format=gray`,
    "-fps_mode",
    "passthrough",
    "-f",
    "rawvideo",
    "-",
  );
  const frameSize = 160 * 91;
  assert.equal(pixels.length, positions.length * frameSize);

  let previous = Buffer.alloc(0);
  for (const [index, position] of positions.entries()) {
    const frame = pixels.subarray(index * frameSize, (index + 1) * frameSize);
    assert.ok(
      frame.some((pixel) => pixel > 180),
      `Frame ${position} should contain bright foreground`,
    );
    if (previous.length > 0) {
      const changed = frame.reduce(
        (sum, pixel, i) => sum + Number(Math.abs(pixel - previous[i]) > 12),
        0,
      );
      assert.ok(
        changed > 160,
        `Frame ${position} should differ visibly from the previous sample`,
      );
    }
    previous = frame;
  }
}

test("Public tutorial CLI renders stills and a complete motion picture with the source soundtrack", {
  timeout: 720_000,
}, (t) => {
  const job = mkdtempSync(join(tmpdir(), "apparent-dev-tutorial-test-"));
  t.after(() => rmSync(job, { recursive: true, force: true }));
  const movie = join(job, "tutorial.mp4");
  const still = join(job, "frame.png");
  const render = (...args: string[]) =>
    execFileSync(process.execPath, [renderer, ...args], {
      encoding: "utf8",
      timeout: 660_000,
    }).trim();

  assert.equal(render("frame", still, "105"), still);
  const stillBytes = readFileSync(still);
  assert.equal(stillBytes.toString("ascii", 1, 4), "PNG");
  assert.equal(stillBytes.readUInt32BE(16), 1920);
  assert.equal(stillBytes.readUInt32BE(20), 1080);

  const invalid = join(job, "invalid.png");
  assert.equal(
    spawnSync(process.execPath, [renderer, "frame", invalid, "1439"]).status,
    1,
  );
  assert.equal(existsSync(invalid), false);

  assert.equal(render("movie", movie), movie);
  const probe = JSON.parse(
    execFileSync(
      "ffprobe",
      ["-v", "error", "-show_streams", "-of", "json", movie],
      { encoding: "utf8" },
    ),
  );
  const [video, audio] = probe.streams;
  assert.equal(probe.streams.length, 2);
  assert.equal(video.codec_name, "h264");
  assert.equal(video.pix_fmt, "yuv420p");
  assert.equal(video.width, 1920);
  assert.equal(video.height, 1080);
  assert.equal(video.avg_frame_rate, "60/1");
  assert.equal(video.nb_frames, "1439");
  assert.equal(audio.codec_name, "aac");
  assert.ok(Math.abs(Number(video.duration) - Number(audio.duration)) < 0.02);
  checkMovieFrames(movie);

  const source = samples(soundtrack);
  const decoded = samples(movie);
  assert.equal(source.length, 24 * 44_100 * 2);
  assert.ok(
    Math.abs(decoded.length - Math.round((1439 / 60) * 44_100) * 2) <= 2048,
  );
  assert.ok(
    source.every((sample) => sample === 0),
    "The original WAV is silent",
  );
  assert.ok(
    decoded.every((sample) => sample === 0),
    "The encoded AAC should preserve the source silence",
  );
});
