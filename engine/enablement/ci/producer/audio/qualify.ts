import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import {
  decodeMovieAudio,
  EngineAudioError,
  probeMovie,
} from "@apparent/engine-sdk";
import { prepareMacFixtures } from "./mac-fixtures.ts";
import { qualifyFloatAudio } from "./qualify-floats.ts";
import { qualifyAudioClocks } from "./qualify-clocks.ts";
import type { FixtureContext, RenderAudio } from "./contracts.ts";

export async function qualifyAudio(
  executable: string,
  probe: string,
  root: string,
) {
  const directory = join(root, "audio-qualification");
  mkdirSync(directory, { mode: 0o700 });
  const sources = new Map<string, string>();
  const digest = (file: string) =>
    createHash("sha256").update(readFileSync(file)).digest("hex");
  const make = (file: string, args: string[]) => {
    execFileSync("ffmpeg", ["-v", "error", "-nostdin", "-y", ...args, file], {
      timeout: 60_000,
    });
    sources.set(file, digest(file));
  };
  let index = 0;
  const render: RenderAudio = async (
    movie,
    streamIndexes,
    maxSamples,
    extra = {},
  ) => {
    const outputDirectory = join(directory, "job-" + index++);
    mkdirSync(outputDirectory, { mode: 0o700 });
    try {
      const result = await decodeMovieAudio({
        executable,
        movie,
        outputDirectory,
        streamIndexes,
        maxSamples,
        ...extra,
      });
      assert.equal(result.sampleRate, 16000);
      assert.equal(result.channels, 1);
      assert.equal(result.sampleFormat, "s16le");
      assert.equal(lstatSync(result.file).mode & 0o777, 0o600);
      const bytes = readFileSync(result.file);
      assert.equal(bytes.length, result.sampleCount * 2);
      return { bytes, sampleCount: result.sampleCount };
    } catch (error) {
      if (
        process.platform === "darwin" &&
        error instanceof EngineAudioError &&
        error.code === "decode_failed"
      ) {
        const diagnosticDirectory = join(outputDirectory, "diagnostic");
        mkdirSync(diagnosticDirectory, { mode: 0o700 });
        const diagnostic = spawnSync(
          executable,
          [
            "audio-v1",
            movie,
            diagnosticDirectory,
            String(maxSamples),
            streamIndexes.join(","),
          ],
          { encoding: "utf8", timeout: 15_000, maxBuffer: 8192 },
        );
        console.error(
          JSON.stringify({
            fixture: basename(movie),
            streamIndexes,
            status: diagnostic.status,
            signal: diagnostic.signal,
            stderr: diagnostic.stderr?.trim(),
          }),
        );
      }
      const partial = join(outputDirectory, "audio.pcm");
      if (existsSync(partial))
        assert(
          lstatSync(partial).size <= maxSamples * 2,
          "native output exceeded its budget",
        );
      throw error;
    } finally {
      rmSync(outputDirectory, { recursive: true, force: true });
    }
  };
  const rms = (bytes: Buffer, first: number, last: number) => {
    let sum = 0,
      count = 0;
    for (
      let sample = Math.round(first * 16000);
      sample < Math.round(last * 16000);
      sample++
    ) {
      sum += (bytes.readInt16LE(sample * 2) / 32768) ** 2;
      count++;
    }
    return Math.sqrt(sum / count);
  };
  const amplitude = (bytes: Buffer, frequency: number) => {
    let real = 0,
      imaginary = 0,
      count = 0;
    for (let sample = 11200; sample < 16000; sample++) {
      const value = bytes.readInt16LE(sample * 2) / 32768;
      real += value * Math.cos((2 * Math.PI * frequency * sample) / 16000);
      imaginary += value * Math.sin((2 * Math.PI * frequency * sample) / 16000);
      count++;
    }
    return (2 * Math.hypot(real, imaginary)) / count;
  };

  const movie = join(directory, "selected ; $(literal).mp4");
  make(movie, [
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=64x48:r=5:d=2",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000:duration=2",
    "-itsoffset",
    "0.5",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=880:sample_rate=44100:duration=1",
    "-map",
    "0:v",
    "-map",
    "1:a",
    "-map",
    "2:a",
    "-c:v",
    "libx264",
    "-threads",
    "1",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    ...(process.platform === "linux"
      ? [
          "-streamid",
          "0:20",
          "-streamid",
          "1:9",
          "-streamid",
          "2:2",
          "-use_stream_ids_as_track_ids",
          "1",
        ]
      : []),
  ]);
  if (process.platform === "linux") {
    const tracks = JSON.parse(
      execFileSync(
        "ffprobe",
        [
          "-v",
          "error",
          "-show_entries",
          "stream=index,id",
          "-of",
          "json",
          movie,
        ],
        { encoding: "utf8" },
      ),
    ).streams;
    assert.deepEqual(
      tracks.map((track: { id: string }) => Number(track.id)),
      [20, 9, 2],
      "producer must retain track IDs whose decoder pad order differs from probe index order",
    );
  }
  const info = await probeMovie({ executable: probe, movie });
  assert.equal(info.audio.length, 2);
  const [a, b] = info.audio.map((track) => track.streamIndex);
  const first = await (async () => {
    if (process.platform !== "linux") return render(movie, [a], 64_000);
    const previous = process.env.GST_REGISTRY;
    const cache = join(directory, "cold-registry");
    mkdirSync(cache, { mode: 0o700 });
    process.env.GST_REGISTRY = join(cache, "registry.bin");
    try {
      return await render(movie, [a], 64_000);
    } finally {
      if (previous === undefined) delete process.env.GST_REGISTRY;
      else process.env.GST_REGISTRY = previous;
    }
  })();
  const second = await render(movie, [b], 64_000),
    mixed = await render(movie, [a, b], 64_000);
  const reversed = await render(movie, [b, a], 64_000);
  assert(amplitude(first.bytes, 440) > 0.05);
  assert(amplitude(first.bytes, 880) < 0.01);
  assert(amplitude(second.bytes, 880) > 0.05);
  assert(amplitude(second.bytes, 440) < 0.01);
  assert(
    rms(second.bytes, 0, 0.3) < 0.001,
    "selected delayed track lost leading silence",
  );
  assert(
    Math.abs(second.sampleCount / 16 - 1500) < 30,
    "selected track tail lost movie-time alignment",
  );
  for (const [frequency, single] of [
    [440, first],
    [880, second],
  ] as const) {
    const expected = amplitude(single.bytes, frequency);
    assert(
      Math.abs(amplitude(mixed.bytes, frequency) - expected) < expected * 0.1,
      "mix must preserve each selected track at unity",
    );
    assert(
      Math.abs(amplitude(reversed.bytes, frequency) - expected) <
        expected * 0.1,
      "selection order changed the mix",
    );
  }
  assert.equal(
    (await render(movie, [a], first.sampleCount)).sampleCount,
    first.sampleCount,
    "exact budget must not truncate or fail",
  );
  await assert.rejects(render(movie, [a], 128), { code: "resource_limit" });
  await assert.rejects(render(movie, [info.video!.streamIndex], 64_000), {
    code: "decode_failed",
  });
  await assert.rejects(render(movie, [0xffff_ffff], 64_000), {
    code: "decode_failed",
  });

  const gap = join(directory, "gap.m4a");
  make(gap, [
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=16000:duration=2",
    "-af",
    "asetpts='PTS+gte(PTS*TB,0.7)*0.05/TB'",
    "-c:a",
    "aac",
  ]);
  const packets: Array<{ pts_time: string; nb_samples: number }> = JSON.parse(
    execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "a:0",
        "-show_frames",
        "-show_entries",
        "frame=pts_time,nb_samples",
        "-of",
        "json",
        gap,
      ],
      { encoding: "utf8" },
    ),
  ).frames;
  const holes = packets.slice(1).map((next, i) => ({
    start: Number(packets[i].pts_time) + packets[i].nb_samples / 16000,
    end: Number(next.pts_time),
  }));
  const hole = holes.find(
    (value) => value.end - value.start > 0.04 && value.end - value.start < 0.06,
  );
  assert(
    hole,
    "the encoded source must contain a measured small presentation gap",
  );
  const gapInfo = await probeMovie({ executable: probe, movie: gap });
  const context: FixtureContext = {
    directory,
    probe,
    sources,
    digest,
    make,
    render,
    rms,
  };
  const macFixtures = prepareMacFixtures(context, gap);
  const gapped = await render(
    gap,
    gapInfo.audio.map((track) => track.streamIndex),
    64_000,
  );
  const inset = (hole.end - hole.start) / 4;
  const gapRms = rms(gapped.bytes, hole.start + inset, hole.end - inset);
  assert(
    gapRms < 0.001,
    `internal movie-time gap was compressed: ${JSON.stringify({ hole, gapRms, samples: gapped.sampleCount })}`,
  );
  assert(
    rms(gapped.bytes, hole.start - 0.03, hole.start - 0.01) > 0.04,
    "audible samples before the gap were lost",
  );
  assert(
    rms(gapped.bytes, hole.end + 0.01, hole.end + 0.04) > 0.04,
    "audible samples after the gap were lost",
  );
  assert(rms(gapped.bytes, 1, 1.3) > 0.04);

  const floatFailures = await qualifyFloatAudio(context, gap, hole);
  await qualifyAudioClocks(context, { gap, hole, gapped, ...macFixtures });
  const long = join(directory, "long.m4a");
  make(long, [
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000:duration=120",
    "-c:a",
    "aac",
  ]);
  const longInfo = await probeMovie({ executable: probe, movie: long });
  const large = await render(
    long,
    longInfo.audio.map((track) => track.streamIndex),
    16000 * 121,
  );
  assert(large.bytes.length > 3_800_000);
  assert(rms(large.bytes, 119, 119.5) > 0.04);
  await assert.rejects(
    render(long, [longInfo.audio[0].streamIndex], 16000 * 121, {
      timeoutMs: 1,
    }),
    { code: "timeout" },
  );
  const controller = new AbortController(),
    pending = render(long, [longInfo.audio[0].streamIndex], 16000 * 121, {
      signal: controller.signal,
    });
  controller.abort();
  await assert.rejects(pending, { code: "cancelled" });

  const unsafe = join(directory, "occupied");
  mkdirSync(unsafe, { mode: 0o700 });
  const sentinel = join(directory, "sentinel");
  writeFileSync(sentinel, "keep", { mode: 0o600 });
  symlinkSync(sentinel, join(unsafe, "audio.pcm"));
  assert.throws(() =>
    execFileSync(executable, ["audio-v1", movie, unsafe, "64000", String(a)], {
      timeout: 2000,
      stdio: "pipe",
    }),
  );
  assert.equal(readFileSync(sentinel, "utf8"), "keep");
  for (const [file, before] of sources)
    assert.equal(digest(file), before, "audio execution modified its source");
  assert.equal(
    floatFailures.length,
    0,
    "native float cancellation failed: " + JSON.stringify(floatFailures),
  );
  console.log(
    JSON.stringify({
      platform: process.platform,
      arch: process.arch,
      audio: {
        singleSamples: first.sampleCount,
        delayedSamples: second.sampleCount,
        mixedSamples: mixed.sampleCount,
        largeSamples: large.sampleCount,
      },
      checks: [
        "packed-sdk",
        "extracted-native",
        "explicit-track-ids",
        "delayed-and-internal-gaps",
        "adjacent-audible-samples",
        "preserved-AVFoundation-edit-fixtures",
        "float-cancellation-before-clamp",
        "float-byte-order-and-invalid-metadata",
        ...(process.platform === "darwin"
          ? [
              "native-pcm-mapper",
              "explicit-edit-list",
              "same-track-packet-and-edit-gaps",
            ]
          : []),
        "leading-edit-gap",
        "different-track-gaps-before-mixing",
        "delayed-composed-track",
        "audible-tail-and-extent",
        "unity-mix",
        "reordered-selection",
        "exact-budget",
        "real-output-limit",
        "large-private-pcm",
        "deadline",
        "cancellation",
        "native-occupied-output-refusal",
        "source-preservation",
      ],
    }),
  );
}
