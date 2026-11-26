import { createHash } from "node:crypto";
import {
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { readSpeech, run } from "./media.ts";

export const narration = {
  engine: "kokoro",
  voice: "bm_fable",
  sampleRate: 24000,
  channels: 1,
};

const setupCheck =
  "From an Apparent checkout, run node capture/agent/scripts/provision-narrator.ts --check.";

function cacheDirectory(directory: string) {
  if (!lstatSync(directory, { throwIfNoEntry: false })) {
    try {
      mkdirSync(directory, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  const info = lstatSync(directory);
  if (
    !info.isDirectory() ||
    info.uid !== process.getuid?.() ||
    info.mode & 0o077
  )
    throw Error(
      "--voice-cache must be a private directory owned by the current user (mode 0700).",
    );
  return directory;
}

function save(dir: string, target: string, bytes: Buffer) {
  const temporary = mkdtempSync(join(dir, ".cue-"));
  try {
    const file = join(temporary, "voice.wav");
    writeFileSync(file, bytes, { mode: 0o600, flag: "wx" });
    try {
      linkSync(file, target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

export function narrator(directory?: string) {
  const assets = join(homedir(), ".local/share/apparent/narrator");
  const worker = join(assets, "apparent-narrator");
  let revision: string;
  try {
    revision = JSON.stringify(
      [
        worker,
        join(assets, "model.onnx"),
        join(assets, "voices", narration.voice + ".bin"),
      ].map((path) => {
        const info = statSync(path, { bigint: true });
        if (!info.isFile()) throw Error("Missing narrator asset.");
        return [info.dev, info.ino, info.size, info.mtimeNs].map(String);
      }),
    );
  } catch {
    throw Error(
      `[NARRATION_SETUP] Local Kokoro bm_fable assets are missing. ${setupCheck}`,
    );
  }
  const cache = directory ? cacheDirectory(directory) : undefined;
  const stats = { generated: 0, reused: 0 };
  return {
    stats,
    voice(text: string, cwd: string, name: string) {
      const key = createHash("sha256")
        .update(revision)
        .update("\0")
        .update(text)
        .digest("hex");
      const target = cache && join(cache, key + ".wav");
      if (target && lstatSync(target, { throwIfNoEntry: false })) {
        const speech = readSpeech(target);
        stats.reused++;
        return speech;
      }
      const input = name + ".txt";
      const output = name + ".wav";
      writeFileSync(join(cwd, input), text);
      try {
        run(worker, [assets, input, output], cwd);
      } catch (error) {
        throw Error(
          `[NARRATION_SYNTHESIS] Kokoro bm_fable could not synthesize speech. ${setupCheck} ${error instanceof Error ? error.message : error}`,
        );
      }
      const speech = readSpeech(join(cwd, output));
      if (target) save(dirname(target), target, speech.wav);
      stats.generated++;
      return speech;
    },
  };
}

export function checkNarrator(cwd: string) {
  const sample = narrator().voice(
    "This is Apparent's local narration check.",
    cwd,
    "voice-check",
  );
  return { status: "ready", ...narration, sampleDurationMs: sample.ms };
}
