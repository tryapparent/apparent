import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

export function qualifyPhonePreparation(options: {
  binary: string;
  sourceBundle: string;
  root: string;
  home: string;
  runtimeDirectory: string;
  runtime?: string;
  media?: string;
  proofDir?: string;
}) {
  const { binary, sourceBundle, home, runtimeDirectory } = options;
  const root = join(options.root, "phone-preparation");
  mkdirSync(root, { mode: 0o700 });
  const hash = (path: string) =>
    createHash("sha256").update(readFileSync(path)).digest("hex");
  const run = (
    program: string,
    args: string[],
    env: NodeJS.ProcessEnv = process.env,
  ) =>
    execFileSync(program, args, {
      env,
      encoding: "utf8",
      timeout: 90000,
      maxBuffer: 2 * 1024 * 1024,
    });
  const cases = [
    { name: "silent", tracks: 0 },
    { name: "silent-marked", tracks: 0, marked: true },
    { name: "silent-external-wav", tracks: 0, external: true },
    { name: "one-track", tracks: 1 },
    { name: "two-tracks", tracks: 2 },
    { name: "audible-marked", tracks: 1, marked: true },
  ];
  const rows = [];
  for (const c of cases) {
    const input = join(root, c.name + ".apparent"),
      output = join(root, c.name + "-rebuilt.apparent");
    cpSync(sourceBundle, input, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    chmodSync(input, 0o700);
    const movie = join(input, "recording.mp4");
    const args = [
      "-v",
      "error",
      "-nostdin",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=96x64:r=10:d=2",
    ];
    for (let n = 0; n < c.tracks; n++)
      args.push(
        "-f",
        "lavfi",
        "-i",
        `sine=frequency=${440 + n * 440}:sample_rate=48000:duration=2`,
      );
    args.push("-map", "0:v");
    for (let n = 0; n < c.tracks; n++) args.push("-map", `${n + 1}:a`);
    args.push(
      "-c:v",
      "libx264",
      "-threads",
      "1",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      movie,
    );
    run("ffmpeg", args);
    chmodSync(movie, 0o600);
    const sourceFacts = JSON.parse(
      run("ffprobe", ["-v", "error", "-show_streams", "-of", "json", movie]),
    );
    assert.equal(
      sourceFacts.streams.filter(
        (s: { codec_type: string }) => s.codec_type === "audio",
      ).length,
      c.tracks,
    );
    const manifest = join(input, "apparent.json"),
      original = JSON.parse(readFileSync(manifest, "utf8"));
    const marks = c.marked
      ? [0, 250, 500, 750, 1000, 1250].map((t, index) => ({
          id: `f${index + 1}`,
          shape: "flag",
          strokes: [],
          t0: t,
          t1: t,
          boxNorm: [0, 0, 1, 1],
          description: "flagged this moment",
        }))
      : [];
    const external = join(input, "supplement.wav");
    if (c.external) {
      run("ffmpeg", [
        "-v",
        "error",
        "-nostdin",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=990:sample_rate=16000:duration=2",
        "-c:a",
        "pcm_s16le",
        external,
      ]);
      chmodSync(external, 0o600);
    }
    writeFileSync(
      manifest,
      JSON.stringify({
        ...original,
        source: "iphone",
        durationMs: 2000,
        video: "recording.mp4",
        videoOffsetMs: 0,
        target: {
          mode: "device",
          app: "Synthetic file",
          displayId: 0,
          frame: { x: 0, y: 0, width: 1, height: 1, scale: 1 },
        },
        device: {
          name: "Synthetic file",
          capture: "mirror",
          width: 1,
          height: 1,
        },
        audio: c.external ? "supplement.wav" : undefined,
        transcript: { source: "none", text: "", segments: [] },
        keyframes: [],
        events: [],
        cursor: [],
        strokes: [],
        marks,
      }),
      { mode: 0o600 },
    );
    const command = join(root, c.name + "-transcriber.ts"),
      receipt = join(root, c.name + "-handoff.json"),
      config = join(root, c.name + "-config.json");
    writeFileSync(
      command,
      `import{readFileSync,writeFileSync}from'node:fs';import{createHash}from'node:crypto';const b=readFileSync(process.argv[2]);writeFileSync(process.argv[3],JSON.stringify({sha256:createHash('sha256').update(b).digest('hex')}),{mode:0o600,flag:'wx'});console.log(JSON.stringify({version:1,text:''}));`,
      { mode: 0o600 },
    );
    writeFileSync(
      config,
      JSON.stringify({
        transcriber: "command",
        transcribeTimeoutSeconds: 10,
        transcribeCommand: [
          process.execPath,
          "--experimental-strip-types",
          command,
          "{audio}",
          receipt,
        ],
        unrelated: { synthetic: "preserved" },
      }),
      { mode: 0o600 },
    );
    const env = {
      ...process.env,
      HOME: home,
      CFFIXED_USER_HOME: home,
      APPARENT_CONFIG: config,
      APPARENT_MODELS_DIR: join(home, "unused-models"),
      XDG_CONFIG_HOME: join(home, "config"),
      XDG_DATA_HOME: join(home, "data"),
      XDG_CACHE_HOME: join(home, "cache"),
      XDG_RUNTIME_DIR: runtimeDirectory,
      DISPLAY: "",
      WAYLAND_DISPLAY: "",
      DBUS_SESSION_BUS_ADDRESS: "",
      APPIMAGE_EXTRACT_AND_RUN: "1",
    };
    const paths = [movie, manifest, config, ...(c.external ? [external] : [])],
      before = paths.map((p) => [p, hash(p)] as const);
    if (options.runtime && options.media) {
      const plan = JSON.parse(
        run(
          options.runtime,
          [
            join(options.media, "worker.js"),
            join(options.media, "native/apparent-engine-media"),
            movie,
            "phone-v1",
          ],
          { ...env, ELECTRON_RUN_AS_NODE: "1" },
        ),
      );
      assert.equal(plan.version, 1);
      assert.equal(plan.probe.audioTracks, c.tracks);
      assert.equal(plan.audio, c.tracks === 0 ? "skip-absent" : "extract");
      assert.equal(plan.probe.width, 96);
      assert.equal(plan.probe.height, 64);
      assert.equal(plan.probe.durationMs, 2000);
    }
    const started = performance.now();
    const result = spawnSync(
      "/bin/sh",
      [
        "-c",
        'umask 002; exec "$@"',
        "phone-preparation",
        binary,
        "reprocess",
        input,
        "--out",
        output,
        "--transcriber",
        "command",
      ],
      { env, encoding: "utf8", timeout: 90000, maxBuffer: 2 * 1024 * 1024 },
    );
    const elapsedMs = performance.now() - started;
    assert.equal(result.status, 0, result.stderr);
    writeFileSync(
      join(root, c.name + "-execution.json"),
      JSON.stringify({
        elapsedMs,
        stderr: result.stderr,
        status: result.status,
      }),
      { mode: 0o600 },
    );
    const bundle = JSON.parse(
      readFileSync(join(output, "apparent.json"), "utf8"),
    );
    assert.equal(bundle.durationMs, 2000);
    assert.equal(bundle.target.frame.width, 96);
    assert.equal(bundle.target.frame.height, 64);
    assert.equal(Boolean(bundle.audio), c.tracks > 0);
    assert.equal(existsSync(receipt), c.tracks > 0);
    if (c.tracks > 0) {
      assert.match(bundle.transcript.source, /^command:/);
      assert.equal(statSync(join(output, bundle.audio)).mode & 0o777, 0o600);
      assert.equal(
        hash(join(output, bundle.audio)),
        JSON.parse(readFileSync(receipt, "utf8")).sha256,
      );
    } else {
      assert.equal(bundle.transcript.source, "none");
      assert(!existsSync(join(output, "audio.wav")));
    }
    assert(bundle.keyframes.length > 0);
    if (c.marked) {
      assert.equal(bundle.marks.length, 6);
      assert(
        bundle.keyframes.every((f: { reason: string }) => f.reason === "mark"),
      );
    }
    const frames = bundle.keyframes.map((frame: { file: string }) => {
      const bytes = execFileSync(
        "ffmpeg",
        [
          "-v",
          "error",
          "-nostdin",
          "-i",
          join(output, frame.file),
          "-f",
          "rawvideo",
          "-pix_fmt",
          "rgba",
          "-threads",
          "1",
          "-",
        ],
        { timeout: 30000, maxBuffer: 4 * 1024 * 1024 },
      );
      assert.equal(bytes.length, 96 * 64 * 4);
      return {
        ...frame,
        decodedSha256: createHash("sha256").update(bytes).digest("hex"),
      };
    });
    for (const [p, digest] of before)
      assert.equal(hash(p), digest, "source or config changed");
    rows.push({
      name: c.name,
      durationMs: bundle.durationMs,
      target: bundle.target,
      device: bundle.device,
      transcript: bundle.transcript,
      audio: bundle.audio ?? null,
      audioSha256: bundle.audio ? hash(join(output, bundle.audio)) : null,
      keyframes: frames,
      marks: bundle.marks,
      contactSheetSha256: hash(join(output, bundle.contactSheet)),
      sourcePreserved: true,
    });
  }
  if (options.proofDir) {
    mkdirSync(options.proofDir, { recursive: true, mode: 0o700 });
    writeFileSync(
      join(options.proofDir, "record-phone-preparation-proof.json"),
      JSON.stringify(rows, null, 2),
      { mode: 0o600 },
    );
    for (const row of rows) {
      copyFileSync(
        join(root, row.name + "-rebuilt.apparent", "contact-sheet.png"),
        join(options.proofDir, "record-phone-preparation-" + row.name + ".png"),
      );
    }
  }
  return rows;
}
