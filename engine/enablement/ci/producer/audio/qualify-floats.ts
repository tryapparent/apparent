import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EngineAudioError, probeMovie } from "@apparent/engine-sdk";
import { appendDescription, description } from "./descriptions.ts";
import type { FixtureContext, Hole } from "./contracts.ts";

export async function qualifyFloatAudio(
  { directory, probe, make, render, sources, digest, rms }: FixtureContext,
  gap: string,
  hole: Hole,
) {
  const floatFailures: string[] = [];
  for (const rate of [16000, 96000])
    for (const codec of ["pcm_f32be", "pcm_f32le", "pcm_f64be", "pcm_f64le"]) {
      const movie = join(directory, `${codec}-${rate}-cancellation.mov`);
      make(movie, [
        "-f",
        "lavfi",
        "-i",
        `aevalsrc=1.5:s=${rate}:d=2`,
        "-f",
        "lavfi",
        "-i",
        `aevalsrc=-1:s=${rate}:d=2`,
        "-i",
        gap,
        "-map",
        "0:a",
        "-map",
        "1:a",
        "-map",
        "2:a",
        "-c:a:0",
        codec,
        "-c:a:1",
        codec,
        "-c:a:2",
        "copy",
      ]);
      const facts = await probeMovie({ executable: probe, movie });
      assert.equal(facts.audio.length, 3);
      let canonicalAllTracks:
        | { bytes: Buffer; sampleCount: number }
        | undefined;
      for (const tracks of [facts.audio.slice(0, 2), facts.audio]) {
        for (const indexes of [
          tracks.map((track) => track.streamIndex),
          tracks.map((track) => track.streamIndex).reverse(),
        ]) {
          const audio = await render(movie, indexes, 64000);
          if (tracks.length === facts.audio.length && !canonicalAllTracks)
            canonicalAllTracks = audio;
          let sum = 0,
            count = 0;
          const first = Math.round(
            (hole.start + (hole.end - hole.start) / 4) * 16000,
          );
          const last = Math.round(
            (hole.end - (hole.end - hole.start) / 4) * 16000,
          );
          assert(
            audio.sampleCount >= last,
            "native float track ended early: " +
              JSON.stringify({
                codec,
                rate,
                indexes,
                samples: audio.sampleCount,
                required: last,
              }),
          );
          for (let i = first; i < last; i++) {
            sum += audio.bytes.readInt16LE(i * 2) / 32768;
            count++;
          }
          const mean = sum / count;
          if (!(Math.abs(mean - 0.5) < 2 / 32768)) {
            const failure = JSON.stringify({
              codec,
              rate,
              indexes,
              mean,
              samples: audio.sampleCount,
            });
            console.log("float cancellation failure: " + failure);
            floatFailures.push(failure);
          }
        }
      }
      if (codec === "pcm_f32le" && rate === 16000) {
        const bytes = readFileSync(movie),
          marker = Buffer.from([0, 0, 0, 10, 101, 110, 100, 97]);
        const offset = bytes.indexOf(marker);
        assert(offset >= 0, "producer must declare little endian through enda");
        bytes[offset + 9] = 2;
        const malformed = join(directory, "invalid-float-enda.mov");
        writeFileSync(malformed, bytes, { mode: 0o600 });
        sources.set(malformed, digest(malformed));
        const indexes = facts.audio.map((track) => track.streamIndex);
        if (process.platform === "linux") {
          await assert.rejects(render(malformed, indexes, 64000), {
            code: "decode_failed",
          });
        } else {
          try {
            const audio = await render(malformed, indexes, 64000);
            assert(canonicalAllTracks, "missing canonical all-track reference");
            assert.equal(
              audio.sampleCount,
              canonicalAllTracks.sampleCount,
              "accepted noncanonical metadata changed the selected audio extent",
            );
            let maximumDifference = 0;
            for (let i = 0; i < audio.bytes.length; i += 2)
              maximumDifference = Math.max(
                maximumDifference,
                Math.abs(
                  audio.bytes.readInt16LE(i) -
                    canonicalAllTracks.bytes.readInt16LE(i),
                ),
              );
            assert(
              maximumDifference <= 2,
              "accepted noncanonical metadata changed PCM outside the gap: " +
                JSON.stringify({ maximumDifference }),
            );
            const first = Math.round(
              (hole.start + (hole.end - hole.start) / 4) * 16000,
            );
            const last = Math.round(
              (hole.end - (hole.end - hole.start) / 4) * 16000,
            );
            assert(
              audio.sampleCount >= last,
              "noncanonical float track ended early",
            );
            let sum = 0;
            for (let i = first; i < last; i++)
              sum += audio.bytes.readInt16LE(i * 2) / 32768;
            const mean = sum / (last - first);
            console.log(
              JSON.stringify({
                noncanonicalFloatEndian: {
                  accepted: true,
                  mean,
                  samples: audio.sampleCount,
                  maximumDifference,
                },
              }),
            );
            assert(
              Math.abs(mean - 0.5) < 2 / 32768,
              "accepted noncanonical float metadata corrupted PCM: " +
                JSON.stringify({ mean }),
            );
          } catch (error) {
            if (
              !(error instanceof EngineAudioError) ||
              error.code !== "decode_failed"
            )
              throw error;
            console.log(
              JSON.stringify({
                noncanonicalFloatEndian: { accepted: false, code: error.code },
              }),
            );
          }
        }
      }
    }
  if (process.platform === "linux") {
    const classic = join(directory, "pcm_f32le-16000-cancellation.mov");
    for (const endian of ["le", "be"]) {
      const lpcm = join(directory, `pcm_f32${endian}-96000-cancellation.mov`),
        entry = description(readFileSync(lpcm));
      assert.equal(
        entry.toString("ascii", 4, 8),
        "lpcm",
        "high-rate producer must actually use SoundDescriptionV2",
      );
      const movie = join(directory, "mixed-description-" + endian + ".mov");
      writeFileSync(movie, appendDescription(readFileSync(classic), entry), {
        mode: 0o600,
      });
      sources.set(movie, digest(movie));
      execFileSync(
        "ffmpeg",
        [
          "-v",
          "error",
          "-xerror",
          "-i",
          movie,
          "-map",
          "0:a:0",
          "-f",
          "null",
          "-",
        ],
        { timeout: 20_000 },
      );
      const facts = await probeMovie({ executable: probe, movie });
      if (endian === "be")
        await assert.rejects(
          render(
            movie,
            facts.audio.map((track) => track.streamIndex),
            64000,
          ),
          { code: "decode_failed" },
        );
      else {
        const audio = await render(
          movie,
          facts.audio.map((track) => track.streamIndex),
          64000,
        );
        assert(
          Math.abs(
            rms(audio.bytes, hole.start + 0.0125, hole.end - 0.0125) - 0.5,
          ) <
            2 / 32768,
          "consistent mixed descriptions must retain float cancellation",
        );
      }
    }
  }

  return floatFailures;
}
