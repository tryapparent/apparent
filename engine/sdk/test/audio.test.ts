import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { decodeMovieAudio, EngineAudioError } from "@apparent/engine-sdk";

function fixture(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(join(tmpdir(), "apparent-dev-engine-audio-sdk-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const executable = join(root, "provider"),
    movie = join(root, "space ; $(never-run).mp4");
  let job = 0;
  const output = () => {
    const path = join(root, "job-" + job++);
    mkdirSync(path, { mode: 0o700 });
    return path;
  };
  const provider = (body: string) =>
    writeFileSync(executable, "#!/bin/sh\n" + body + "\n", { mode: 0o700 });
  const call = (extra = {}) =>
    decodeMovieAudio({
      executable,
      movie,
      outputDirectory: output(),
      streamIndexes: [2, 1],
      maxSamples: 2,
      ...extra,
    });
  return { root, executable, movie, output, provider, call };
}
const valid =
  'printf \'\\001\\000\\377\\177\' > "$3/audio.pcm"\nchmod 600 "$3/audio.pcm"';

test("literal provider-local indices and private PCM are returned without WAV policy", async (t) => {
  const f = fixture(t),
    directory = f.output();
  f.provider('printf "%s\\n" "$@" > "$0.args"\n' + valid);
  assert.deepEqual(await f.call({ outputDirectory: directory }), {
    sampleRate: 16000,
    channels: 1,
    sampleFormat: "s16le",
    sampleCount: 2,
    file: join(realpathSync(directory), "audio.pcm"),
  });
  assert.equal(
    readFileSync(f.executable + ".args", "utf8"),
    "audio-v1\n" + f.movie + "\n" + realpathSync(directory) + "\n2\n2,1\n",
  );
});

test("invalid selection, budget and cancellation are refused before execution", async (t) => {
  const f = fixture(t);
  f.provider('echo invoked > "$0.invoked"');
  for (const change of [
    { streamIndexes: [] },
    { streamIndexes: [1, 1] },
    { streamIndexes: Array(2) },
    { streamIndexes: [-1] },
    { streamIndexes: [1.5] },
    { streamIndexes: Array.from({ length: 1025 }, (_, i) => i) },
    { maxSamples: 0 },
    { maxSamples: 2147483649 },
    { maxSamples: NaN },
    { movie: "relative" },
    { movie: "/bad\0name" },
    { timeoutMs: 0 },
    { timeoutMs: 300001 },
    { signal: {} as AbortSignal },
  ])
    await assert.rejects(f.call(change), { code: "invalid_request" });
  await assert.rejects(f.call({ signal: AbortSignal.abort() }), {
    code: "cancelled",
  });
  assert.throws(() => readFileSync(f.executable + ".invoked"));
});

test("unsafe or occupied output never invokes the reader", async (t) => {
  const f = fixture(t);
  f.provider('echo invoked > "$0.invoked"');
  const occupied = f.output();
  writeFileSync(join(occupied, "sentinel"), "keep");
  const publicDir = f.output();
  chmodSync(publicDir, 0o755);
  const link = join(f.root, "link");
  symlinkSync(f.output(), link);
  for (const outputDirectory of [
    occupied,
    publicDir,
    link,
    link + "/",
    join(f.root, "missing"),
  ])
    await assert.rejects(f.call({ outputDirectory }), {
      code: "unsafe_output",
    });
  assert.equal(readFileSync(join(occupied, "sentinel"), "utf8"), "keep");
  assert.throws(() => readFileSync(f.executable + ".invoked"));
});

test("native failures, output limit, deadlines and cancellation stay distinct and redacted", async (t) => {
  const f = fixture(t);
  await assert.rejects(f.call(), { code: "unavailable" });
  for (const [body, code] of [
    ["exit 69", "unavailable"],
    ["exit 72", "resource_limit"],
    ["ulimit -c 0\nkill -s XFSZ $$", "resource_limit"],
    ["echo PRIVATE >&2\nexit 1", "decode_failed"],
  ] as const) {
    f.provider(body);
    await assert.rejects(
      f.call(),
      (error) =>
        error instanceof EngineAudioError &&
        error.code === code &&
        !String(error).includes("PRIVATE"),
    );
  }
  f.provider("exec sleep 20");
  await assert.rejects(f.call({ timeoutMs: 30 }), { code: "timeout" });
  const controller = new AbortController(),
    pending = f.call({ signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { code: "cancelled" });
});

test("unexpected, oversized, odd, linked or public output cannot become audio", async (t) => {
  const f = fixture(t);
  for (const extra of [
    'printf x >> "$3/audio.pcm"',
    'chmod 644 "$3/audio.pcm"',
    'echo keep > "$3/extra"',
    "echo unexpected",
  ]) {
    f.provider(valid + "\n" + extra);
    await assert.rejects(f.call(), { code: "invalid_response" });
  }
  f.provider(valid);
  await assert.rejects(f.call({ maxSamples: 1 }), { code: "invalid_response" });
  const outside = f.executable + ".outside";
  writeFileSync(outside, "keep");
  chmodSync(outside, 0o600);
  for (const kind of ["-s", ""]) {
    f.provider("ln " + kind + ' "$0.outside" "$3/audio.pcm"');
    await assert.rejects(f.call(), { code: "invalid_response" });
    assert.equal(readFileSync(outside, "utf8"), "keep");
  }
});
