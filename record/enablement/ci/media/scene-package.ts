import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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

export function qualifyScenes(options: {
  binary: string;
  sourceBundle: string;
  root: string;
  home: string;
  runtimeDirectory: string;
  proofDirectory?: string;
}) {
  const { binary, sourceBundle, home, runtimeDirectory, proofDirectory } =
    options;
  const root = join(options.root, "scene-selection");
  mkdirSync(root, { mode: 0o700 });
  const transcriber = join(root, "transcriber.ts");
  writeFileSync(
    transcriber,
    "console.log(JSON.stringify({version:1,text:''}));\n",
    { mode: 0o600 },
  );
  const config = join(root, "config.json");
  writeFileSync(
    config,
    JSON.stringify({
      transcriber: "command",
      transcribeTimeoutSeconds: 10,
      transcribeCommand: [
        process.execPath,
        "--experimental-strip-types",
        transcriber,
        "{audio}",
      ],
    }),
    { mode: 0o600 },
  );
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
      timeout: 90000,
      maxBuffer: 2 * 1024 * 1024,
    });
  const hash = (path: string) =>
    createHash("sha256").update(readFileSync(path)).digest("hex");
  const base = JSON.parse(
      readFileSync(join(sourceBundle, "apparent.json"), "utf8"),
    ),
    rows = [];
  if (proofDirectory)
    mkdirSync(proofDirectory, { recursive: true, mode: 0o700 });
  for (const kind of ["static", "settled", "separate", "cursor"]) {
    const movie = join(root, kind + ".mp4");
    const colors =
      kind === "separate" ? ["black", "white", "white", "black"] : ["blue"];
    const args = ["-v", "error", "-nostdin", "-y"];
    if (kind === "settled")
      args.push(
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=96x64:r=25:d=6,geq=lum='min(255,T*255)':cb=128:cr=128",
      );
    else
      for (let i = 0; i < colors.length; i++)
        args.push(
          "-f",
          "lavfi",
          "-i",
          `color=c=${colors[i]}:s=96x64:r=25:d=${colors.length === 1 ? 6 : i === 3 ? 3 : 1}`,
        );
    args.push("-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono:d=6");
    if (colors.length > 1)
      args.push(
        "-filter_complex",
        "[0:v][1:v][2:v][3:v]concat=n=4:v=1:a=0[out]",
        "-map",
        "[out]",
      );
    else args.push("-map", "0:v");
    args.push("-map", String(colors.length) + ":a");
    if (kind === "cursor")
      args.push(
        "-vf",
        "drawbox=x=2:y=2:w=2:h=2:color=white:t=fill:enable='between(t,1,3)'",
      );
    args.push(
      "-c:v",
      "libx264",
      "-threads",
      "1",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-shortest",
      movie,
    );
    run("ffmpeg", args);
    chmodSync(movie, 0o600);
    for (const route of ["phone", "screen", "recovery"]) {
      const stem = kind + "-" + route,
        input = join(root, stem + ".apparent"),
        output = join(root, stem + "-output.apparent");
      cpSync(sourceBundle, input, {
        recursive: true,
        force: false,
        errorOnExist: true,
      });
      copyFileSync(movie, join(input, "recording.mp4"));
      chmodSync(join(input, "recording.mp4"), 0o600);
      const metadata = {
        ...base,
        durationMs: 6000,
        source: route === "phone" ? "iphone" : "screen",
        device:
          route === "phone"
            ? {
                name: "Synthetic file",
                capture: "mirror",
                width: 96,
                height: 64,
              }
            : undefined,
        target: {
          mode: "display",
          displayId: 0,
          frame: { x: 0, y: 0, width: 96, height: 64, scale: 1 },
        },
        video: "recording.mp4",
        videoOffsetMs: 0,
        audio: undefined,
        videoInk: undefined,
        transcript: { source: "none", text: "", segments: [] },
        strokes: [],
        events: [],
        cursor: [],
        marks: [],
        autocrop: undefined,
      };
      const manifest = join(input, "apparent.json");
      writeFileSync(manifest, JSON.stringify(metadata), { mode: 0o600 });
      const preserved = [
        movie,
        join(input, "recording.mp4"),
        manifest,
        config,
        transcriber,
      ].map((path) => [path, hash(path)] as const);
      run(binary, [
        "reprocess",
        input,
        "--out",
        output,
        "--transcriber",
        "command",
        ...(route === "screen" ? ["--bench", "1"] : []),
      ]);
      const result = JSON.parse(
        readFileSync(join(output, "apparent.json"), "utf8"),
      );
      assert(
        result.keyframes.length > 0,
        "every real route must retain a visual outcome",
      );
      if (kind === "static" || kind === "cursor")
        assert.equal(
          result.keyframes.length,
          1,
          "unchanged/cursor-only pixels must not produce extra scenes",
        );
      else
        assert(
          result.keyframes.some(
            (frame: { reason: string }) => frame.reason === "scene_change",
          ),
          "real changes must produce a scene candidate",
        );
      const frameHashes = result.keyframes.map((frame: { file: string }) =>
        hash(join(output, frame.file)),
      );
      const summary = readFileSync(join(output, "summary.md"), "utf8");
      for (const frame of result.keyframes)
        assert(summary.includes(frame.event));
      for (const [path, before] of preserved)
        assert.equal(
          hash(path),
          before,
          "scene selection changed source/config",
        );
      const sheet = join(output, result.contactSheet);
      if (proofDirectory)
        copyFileSync(
          sheet,
          join(proofDirectory, "record-scene-" + stem + ".png"),
        );
      rows.push({
        kind,
        route,
        keyframes: result.keyframes,
        frameHashes,
        sheetHash: hash(sheet),
        sourcePreserved: true,
      });
    }
  }
  if (proofDirectory) {
    writeFileSync(
      join(proofDirectory, "record-scene-proof.json"),
      JSON.stringify(rows, null, 2),
      { mode: 0o600 },
    );
  }
}
