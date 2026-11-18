import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

export function qualifyQuietExport(options: {
  binary: string;
  runtime: string;
  media: string;
  sourceBundle: string;
  root: string;
  home: string;
  runtimeDirectory: string;
  proofDirectory?: string;
}) {
  const { binary, sourceBundle, home, runtimeDirectory, proofDirectory } =
    options;
  const root = join(options.root, "quiet-export");
  mkdirSync(root, { mode: 0o700 });
  const config = join(root, "config.json");
  writeFileSync(config, "{}", { mode: 0o600 });
  const env = {
    ...process.env,
    HOME: home,
    CFFIXED_USER_HOME: home,
    APPARENT_CONFIG: config,
    XDG_CONFIG_HOME: join(home, "config"),
    XDG_DATA_HOME: join(home, "data"),
    XDG_CACHE_HOME: join(home, "cache"),
    XDG_RUNTIME_DIR: runtimeDirectory,
    DISPLAY: "",
    WAYLAND_DISPLAY: "",
    DBUS_SESSION_BUS_ADDRESS: "",
    APPIMAGE_EXTRACT_AND_RUN: "1",
  };
  const run = (program: string, args: string[]) =>
    execFileSync(program, args, {
      env,
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 4 * 1024 * 1024,
    });
  const movie = join(root, "source.mp4");
  run("ffmpeg", [
    "-v",
    "error",
    "-nostdin",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=160x90:r=10:d=40",
    "-c:v",
    "libx264",
    "-threads",
    "1",
    "-pix_fmt",
    "yuv420p",
    movie,
  ]);
  chmodSync(movie, 0o600);
  const nativeFacts = JSON.parse(
    execFileSync(
      options.runtime,
      [
        join(options.media, "worker.js"),
        join(options.media, "native/apparent-engine-media"),
        movie,
        "export-v1",
      ],
      {
        env: { ...env, ELECTRON_RUN_AS_NODE: "1" },
        encoding: "utf8",
        timeout: 35_000,
        maxBuffer: 32 * 1024,
      },
    ),
  );
  const sourceFacts = JSON.parse(
    run("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=start_time,duration,time_base,nb_frames,avg_frame_rate:format=duration",
      "-of",
      "json",
      movie,
    ]),
  );
  const freeze = spawnSync(
    "ffmpeg",
    [
      "-nostdin",
      "-hide_banner",
      "-i",
      movie,
      "-an",
      "-vf",
      "freezedetect=n=-60dB:d=12",
      "-f",
      "null",
      "-",
    ],
    { env, encoding: "utf8", timeout: 60_000, maxBuffer: 1024 * 1024 },
  );
  assert.equal(freeze.status, 0, freeze.stderr);
  const freezeTimes = [
    ...freeze.stderr.matchAll(/freeze_(start|duration|end):\s*(\S+)/g),
  ].map(([, kind, seconds]) => ({ kind, seconds }));
  assert(
    freezeTimes.some((value) => value.kind === "start"),
    "constant source must reach the real freeze detector",
  );
  const sourceObservations = { nativeFacts, sourceFacts, freezeTimes };
  writeFileSync(
    join(root, "source-observations.json"),
    JSON.stringify(sourceObservations, null, 2),
    { mode: 0o600 },
  );
  console.log(
    "Quiet export source observations: " + JSON.stringify(sourceObservations),
  );
  const hash = (path: string) =>
    createHash("sha256").update(readFileSync(path)).digest("hex");
  const wav = (name: string, amplitude: number) => {
    const count = 24000 * 41,
      bytes = Buffer.alloc(44 + count * 2);
    bytes.write("RIFF", 0);
    bytes.writeUInt32LE(bytes.length - 8, 4);
    bytes.write("WAVEfmt ", 8);
    bytes.writeUInt32LE(16, 16);
    bytes.writeUInt16LE(1, 20);
    bytes.writeUInt16LE(1, 22);
    bytes.writeUInt32LE(24000, 24);
    bytes.writeUInt32LE(48000, 28);
    bytes.writeUInt16LE(2, 32);
    bytes.writeUInt16LE(16, 34);
    bytes.write("data", 36);
    bytes.writeUInt32LE(count * 2, 40);
    for (let i = 0; i < count; i++)
      bytes.writeInt16LE(
        Math.round(Math.sin((2 * Math.PI * 400 * i) / 24000) * amplitude),
        44 + i * 2,
      );
    const path = join(root, name + ".wav");
    writeFileSync(path, bytes, { mode: 0o600 });
    return path;
  };
  const voice = wav("voice", 4000),
    low = wav("low-noise", 45),
    high = wav("high-noise", 96);
  const base = JSON.parse(
    readFileSync(join(sourceBundle, "apparent.json"), "utf8"),
  );
  const cases = [
    { name: "paced", expected: 17500 },
    { name: "plain", expected: 40000, plain: true },
    { name: "cursor", expected: 22750, cursor: true },
    { name: "audible", expected: 40000, audio: voice, offset: 1000 },
    { name: "marked", expected: 40000, marked: true },
    { name: "quiet-noise", expected: 17500, audio: low },
    { name: "audible-noise", expected: 40000, audio: high },
  ];
  const proofs = [];
  if (proofDirectory)
    mkdirSync(proofDirectory, { recursive: true, mode: 0o700 });
  for (const c of cases) {
    console.log("Quiet export case: " + c.name);
    const input = join(root, c.name + ".apparent"),
      output = join(root, c.name + ".mp4");
    cpSync(sourceBundle, input, {
      recursive: true,
      force: false,
      errorOnExist: true,
    });
    copyFileSync(movie, join(input, "recording.mp4"));
    chmodSync(join(input, "recording.mp4"), 0o600);
    if (c.audio) {
      copyFileSync(c.audio, join(input, "voice.wav"));
      chmodSync(join(input, "voice.wav"), 0o600);
    }
    const metadata = {
      ...base,
      durationMs: 40000,
      source: "screen",
      device: undefined,
      video: "recording.mp4",
      videoOffsetMs: c.offset ?? 0,
      audio: c.audio ? "voice.wav" : undefined,
      target: {
        mode: "display",
        displayId: 0,
        frame: { x: 0, y: 0, width: 160, height: 90, scale: 1 },
      },
      transcript: { source: "none", text: "", segments: [] },
      keyframes: [],
      events: [],
      strokes: [],
      autocrop: undefined,
      marks: c.marked
        ? [
            {
              id: "result",
              strokes: [],
              t0: 0,
              t1: 40000,
              boxNorm: [0, 0, 1, 1],
              shape: "flag",
              description: "Synthetic important result",
            },
          ]
        : [],
      cursor: c.cursor
        ? [
            [5000, 0.1, 0.1],
            [35000, 0.2, 0.2],
          ]
        : [],
    };
    const manifest = join(input, "apparent.json");
    writeFileSync(manifest, JSON.stringify(metadata), { mode: 0o600 });
    const preserved = [
      movie,
      join(input, "recording.mp4"),
      manifest,
      config,
      ...(c.audio ? [c.audio, join(input, "voice.wav")] : []),
    ].map((path) => [path, hash(path)] as const);
    const exportArgs = [
      "export",
      input,
      "--no-zoom",
      "--no-ink",
      "--no-clicks",
      "--fps",
      "10",
      "--size",
      "160",
      ...(c.audio ? [] : ["--no-audio"]),
    ];
    let quietNoiseEndMs = 35000;
    if (c.name === "quiet-noise") {
      const reference = join(root, "quiet-noise-realtime.mp4");
      const made = spawnSync(
        binary,
        [...exportArgs, "--out", reference, "--no-speedup"],
        { env, encoding: "utf8", timeout: 180_000, maxBuffer: 4 * 1024 * 1024 },
      );
      assert.equal(made.status, 0, made.stderr);
      const clock = JSON.parse(
        run("ffprobe", [
          "-v",
          "error",
          "-select_streams",
          "a:0",
          "-show_frames",
          "-show_entries",
          "frame=pts_time,nb_samples:stream=sample_rate",
          "-of",
          "json",
          reference,
        ]),
      ) as {
        streams: Array<{ sample_rate: string }>;
        frames: Array<{ pts_time: string; nb_samples: number }>;
      };
      assert.equal(clock.streams.length, 1);
      assert(clock.frames.length > 0);
      const rate = Number(clock.streams[0].sample_rate),
        last = clock.frames.at(-1)!;
      assert(Number.isFinite(rate) && rate > 0);
      assert(
        clock.frames.every(
          (frame) =>
            Number.isFinite(Number(frame.pts_time)) &&
            Number.isSafeInteger(frame.nb_samples) &&
            frame.nb_samples > 0,
        ),
      );
      const decodedEndMs = Math.round(
        (Number(last.pts_time) + last.nb_samples / rate) * 1000,
      );
      const packetMs = Math.ceil(
        (clock.frames.reduce(
          (maximum, frame) => Math.max(maximum, frame.nb_samples),
          0,
        ) *
          1000) /
          rate,
      );
      assert(
        Math.abs(decodedEndMs - 40000) <= packetMs,
        "reference audio must retain the full clip within one decoded codec frame",
      );
      const detected = spawnSync(
        "ffmpeg",
        [
          "-nostdin",
          "-hide_banner",
          "-i",
          reference,
          "-vn",
          "-af",
          "silencedetect=n=-55dB:d=1",
          "-f",
          "null",
          "-",
        ],
        { env, encoding: "utf8", timeout: 60_000, maxBuffer: 1024 * 1024 },
      );
      assert.equal(detected.status, 0, detected.stderr);
      const starts = [...detected.stderr.matchAll(/silence_start:\s*(\S+)/g)];
      const ends = [...detected.stderr.matchAll(/silence_end:\s*(\S+)/g)];
      assert.equal(starts.length, 1);
      assert.equal(Number(starts[0][1]), 0);
      assert.equal(ends.length, 1);
      const silenceEndMs = Math.round(Number(ends[0][1]) * 1000);
      assert.equal(
        silenceEndMs,
        decodedEndMs,
        "silence must end at the independently decoded audio clock",
      );
      quietNoiseEndMs = Math.min(40000, silenceEndMs) - 5000;
      console.log(
        "Quiet export rendered-audio observations: " +
          JSON.stringify({
            case: c.name,
            rate,
            decodedEndMs,
            silenceEndMs,
            packetMs,
          }),
      );
    }
    const result = spawnSync(
      binary,
      [...exportArgs, "--out", output, ...(c.plain ? ["--no-speedup"] : [])],
      { env, encoding: "utf8", timeout: 180_000, maxBuffer: 4 * 1024 * 1024 },
    );
    assert.equal(result.status, 0, result.stderr);
    const probe = JSON.parse(
      run("ffprobe", [
        "-v",
        "error",
        "-show_format",
        "-show_streams",
        "-of",
        "json",
        output,
      ]),
    );
    const durationMs = Math.round(Number(probe.format.duration) * 1000);
    assert(
      Math.abs(durationMs - c.expected) < 250,
      c.name + ": incorrect actual movie duration",
    );
    assert.equal(
      probe.streams.some(
        (stream: { codec_type: string }) => stream.codec_type === "audio",
      ),
      Boolean(c.audio),
    );
    const match =
      /Quiet-stretch speedup \(source video milliseconds\): (\[[^\n]*\])/.exec(
        result.stderr ?? "",
      );
    const intervals = match ? JSON.parse(match[1]) : [];
    const expected =
      c.name === "paced" || c.name === "quiet-noise"
        ? [
            {
              startMs: 5000,
              endMs: c.name === "quiet-noise" ? quietNoiseEndMs : 35000,
              rate: 4,
            },
          ]
        : c.name === "cursor"
          ? [{ startMs: 10000, endMs: 33000, rate: 4 }]
          : [];
    assert.deepEqual(
      intervals,
      expected,
      c.name +
        ": real observations must select the exact source intervals; source facts: " +
        JSON.stringify(sourceObservations),
    );
    if (expected.length)
      assert.equal(
        probe.format.tags?.comment,
        "Apparent quiet-stretch source intervals: " + JSON.stringify(expected),
      );
    const pixels = execFileSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-nostdin",
        "-i",
        output,
        "-an",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgba",
        "-threads",
        "1",
        "-",
      ],
      { env, timeout: 30_000, maxBuffer: 32 * 1024 * 1024 },
    );
    assert.equal(pixels.length % (160 * 90 * 4), 0);
    assert(
      pixels[2] > pixels[0] + 100,
      "actual exported pixels must remain blue",
    );
    for (const [path, before] of preserved)
      assert.equal(hash(path), before, "source or isolated config changed");
    if (proofDirectory) {
      copyFileSync(
        output,
        join(proofDirectory, "record-quiet-" + c.name + ".mp4"),
      );
      run("ffmpeg", [
        "-v",
        "error",
        "-nostdin",
        "-i",
        output,
        "-vf",
        "fps=1,tile=8x5",
        "-frames:v",
        "1",
        "-threads",
        "1",
        join(proofDirectory, "record-quiet-" + c.name + ".png"),
      ]);
    }
    proofs.push({
      name: c.name,
      durationMs,
      intervals,
      audio: Boolean(c.audio),
      frames: pixels.length / (160 * 90 * 4),
      decodedHash: createHash("sha256").update(pixels).digest("hex"),
      sourcePreserved: true,
    });
  }
  if (proofDirectory) {
    writeFileSync(
      join(proofDirectory, "record-quiet-proof.json"),
      JSON.stringify(proofs, null, 2),
      { mode: 0o600 },
    );
  }
}
