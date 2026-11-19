import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { probeMovie } from "@apparent/engine-sdk";
import type { FixtureContext, Hole } from "./contracts.ts";

export async function qualifyAudioClocks(
  { directory, probe, make, render, sources, digest, rms }: FixtureContext,
  {
    gap,
    hole,
    gapped,
    explicitEdit,
    combinedEdit,
  }: {
    gap: string;
    hole: Hole;
    gapped: { bytes: Buffer; sampleCount: number };
    explicitEdit: string;
    combinedEdit: string;
  },
) {
  function measuredHole(
    movie: string,
    audio: number,
    minimum: number,
    maximum: number,
  ) {
    const frames: Array<{ pts_time: string; nb_samples: number }> = JSON.parse(
      execFileSync(
        "ffprobe",
        [
          "-v",
          "error",
          "-select_streams",
          `a:${audio}`,
          "-show_frames",
          "-show_entries",
          "frame=pts_time,nb_samples",
          "-of",
          "json",
          movie,
        ],
        { encoding: "utf8" },
      ),
    ).frames;
    const observed = frames.slice(1).map((next, i) => ({
      start: Number(frames[i].pts_time) + frames[i].nb_samples / 16000,
      end: Number(next.pts_time),
    }));
    const found = observed.find(
      (value) =>
        value.end - value.start > minimum && value.end - value.start < maximum,
    );
    assert(
      found,
      `the encoded producer must retain the measured presentation hole: ${JSON.stringify({ movie: basename(movie), minimum, maximum, observed })}`,
    );
    return found;
  }
  const interior = (hole: { start: number; end: number }) =>
    [
      hole.start + (hole.end - hole.start) / 4,
      hole.end - (hole.end - hole.start) / 4,
    ] as const;
  const tone = (
    bytes: Buffer,
    frequency: number,
    first: number,
    last: number,
  ) => {
    let real = 0,
      imaginary = 0,
      count = 0;
    for (
      let sample = Math.round(first * 16000);
      sample < Math.round(last * 16000);
      sample++
    ) {
      const value = bytes.readInt16LE(sample * 2) / 32768;
      real += value * Math.cos((2 * Math.PI * frequency * sample) / 16000);
      imaginary += value * Math.sin((2 * Math.PI * frequency * sample) / 16000);
      count++;
    }
    return (2 * Math.hypot(real, imaginary)) / count;
  };
  function tail(movie: string, audio: { bytes: Buffer; sampleCount: number }) {
    const end = Number(
      JSON.parse(
        execFileSync(
          "ffprobe",
          [
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "json",
            movie,
          ],
          { encoding: "utf8" },
        ),
      ).format.duration,
    );
    assert(Number.isFinite(end) && end > 0.05);
    const extent = audio.sampleCount / 16000;
    assert(
      extent >= end - 0.01 && extent <= end + 1024 / 16000 + 0.002,
      "decoded tail left the selected media extent: " +
        JSON.stringify({
          movie: basename(movie),
          end,
          extent,
          samples: audio.sampleCount,
        }),
    );
    const level = rms(audio.bytes, end - 0.04, end - 0.015);
    assert(
      level > 0.04,
      `the final audible tail was lost: ${JSON.stringify({ end, extent, rms: level })}`,
    );
  }
  tail(gap, gapped);
  if (process.platform === "darwin") {
    const info = await probeMovie({ executable: probe, movie: explicitEdit });
    assert(
      (info.audio[0].segments?.length ?? 0) >= 2,
      "the producer must retain an actual internal track edit",
    );
    const audio = await render(
      explicitEdit,
      info.audio.map((track) => track.streamIndex),
      64_000,
    );
    assert(
      rms(audio.bytes, 0.8, 0.93) < 0.001,
      "explicit edit-list silence was lost",
    );
    assert(
      rms(audio.bytes, 0.72, 0.75) > 0.04,
      "audio before the explicit edit was lost",
    );
    assert(
      rms(audio.bytes, 0.98, 1.01) > 0.04,
      "audio after the explicit edit was shifted or lost",
    );
    tail(explicitEdit, audio);
    const combinedInfo = await probeMovie({
      executable: probe,
      movie: combinedEdit,
    });
    assert(
      (combinedInfo.audio[0].segments?.length ?? 0) >= 2,
      "the combined fixture must retain an actual track edit",
    );
    const packetHole = measuredHole(combinedEdit, 0, 0.04, 0.06);
    const segments = combinedInfo.audio[0].segments!;
    const edits = segments.slice(1).map((next, i) => {
      const previous = segments[i];
      assert(
        previous.startMs !== null &&
          previous.durationMs !== null &&
          next.startMs !== null,
      );
      return {
        start: (previous.startMs + previous.durationMs) / 1000,
        end: next.startMs / 1000,
      };
    });
    const editHole = edits.find(
      (value) =>
        Math.abs(value.start - 1.266) < 0.002 &&
        Math.abs(value.end - value.start - 0.192) < 0.002,
    );
    assert(
      editHole,
      `the combined producer must retain the requested empty edit: ${JSON.stringify(edits)}`,
    );
    assert(
      Math.abs(packetHole.start - hole.start) < 0.002 &&
        Math.abs(editHole.start - 1.266) < 0.002,
    );
    const combined = await render(
      combinedEdit,
      combinedInfo.audio.map((track) => track.streamIndex),
      64_000,
    );
    for (const gap of [packetHole, editHole]) {
      const levels = {
        inside: rms(combined.bytes, ...interior(gap)),
        before: rms(combined.bytes, gap.start - 0.03, gap.start - 0.01),
        after: rms(combined.bytes, gap.end + 0.01, gap.end + 0.04),
      };
      const evidence = JSON.stringify({
        gap,
        levels,
        samples: combined.sampleCount,
      });
      assert(
        levels.inside < 0.001,
        "combined packet/edit silence was shifted: " + evidence,
      );
      assert(
        levels.before > 0.04,
        "combined edit removed preceding audio: " + evidence,
      );
      assert(
        levels.after > 0.04,
        "combined edit shifted following audio: " + evidence,
      );
    }
    tail(combinedEdit, combined);
  }
  const fixtureRoot = new URL("./fixtures/audio-clock/", import.meta.url);
  const fixtures = JSON.parse(
    readFileSync(new URL("provenance.json", fixtureRoot), "utf8"),
  ).files;
  for (const fixture of fixtures) {
    const movie = join(directory, "preserved-" + fixture.file);
    writeFileSync(movie, Buffer.from(fixture.base64, "base64"), {
      mode: 0o600,
      flag: "wx",
    });
    assert.equal(
      digest(movie),
      fixture.sha256,
      "native fixture provenance changed",
    );
    sources.set(movie, digest(movie));
    const facts = await probeMovie({ executable: probe, movie });
    const audio = await render(
      movie,
      facts.audio.map((track) => track.streamIndex),
      64000,
    );
    for (const [first, last] of fixture.silence)
      assert(
        rms(audio.bytes, first, last) < 0.001,
        "native empty edit was flattened",
      );
    for (const [first, last] of fixture.audible)
      assert(
        rms(audio.bytes, first, last) > 0.04,
        "native adjacent samples or tail were lost",
      );
    tail(movie, audio);
  }
  const edited = join(directory, "edited-gap.m4a");
  make(edited, ["-ss", "0.4", "-i", gap, "-map", "0:a", "-c", "copy"]);
  const editedHole = measuredHole(edited, 0, 0.04, 0.06);
  assert(Math.abs(editedHole.start - (hole.start - 0.4)) < 0.002);
  const editedInfo = await probeMovie({ executable: probe, movie: edited });
  const editedAudio = await render(
    edited,
    editedInfo.audio.map((track) => track.streamIndex),
    64_000,
  );
  assert(
    rms(editedAudio.bytes, ...interior(editedHole)) < 0.001,
    "leading trim shifted the internal hole",
  );
  assert(rms(editedAudio.bytes, 0.05, 0.2) > 0.04);

  tail(edited, editedAudio);

  const separated = join(directory, "different-track-gaps.m4a");
  make(separated, [
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=16000:duration=2",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=880:sample_rate=16000:duration=2",
    "-itsoffset",
    "0.5",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=1320:sample_rate=44100:duration=1",
    "-map",
    "0:a",
    "-map",
    "1:a",
    "-map",
    "2:a",
    "-filter:a:0",
    "asetpts='PTS+gte(PTS*TB,0.7)*0.05/TB'",
    "-filter:a:1",
    "asetpts='PTS+gte(PTS*TB,1.2)*0.075/TB'",
    "-c:a",
    "aac",
  ]);
  const separateHoles = [
    measuredHole(separated, 0, 0.04, 0.06),
    measuredHole(separated, 1, 0.07, 0.08),
  ];
  const separateInfo = await probeMovie({
    executable: probe,
    movie: separated,
  });
  assert.equal(separateInfo.audio.length, 3);
  const separateIndices = separateInfo.audio
    .slice(0, 2)
    .map((track) => track.streamIndex);
  const separateMix = await render(separated, separateIndices, 64_000);
  const reversedMix = await render(
    separated,
    [...separateIndices].reverse(),
    64_000,
  );
  for (const [i, hole] of separateHoles.entries()) {
    const window = interior(hole),
      absent = i === 0 ? 440 : 880,
      present = i === 0 ? 880 : 440;
    for (const mixed of [separateMix, reversedMix]) {
      assert(
        tone(mixed.bytes, absent, ...window) < 0.01,
        "a selected track lost its own hole",
      );
      assert(
        tone(mixed.bytes, present, ...window) > 0.05,
        "one track hole silenced another selected track",
      );
    }
  }
  tail(separated, separateMix);
  tail(separated, reversedMix);
  const delayedMix = await render(
    separated,
    [separateIndices[0], separateInfo.audio[2].streamIndex],
    64_000,
  );
  assert(
    tone(delayedMix.bytes, 1320, 0.1, 0.3) < 0.01,
    "composition lost another track leading silence",
  );
  assert(
    tone(delayedMix.bytes, 1320, ...interior(separateHoles[0])) > 0.05,
    "composition lost delayed selected audio",
  );
  assert(tone(delayedMix.bytes, 440, ...interior(separateHoles[0])) < 0.01);
}
