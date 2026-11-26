import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

export function qualifyMovieImport(options: {
  binary: string;
  root: string;
  home: string;
  runtimeDirectory: string;
  silent: string;
}) {
  const { binary, root, home, runtimeDirectory, silent } = options;
  const run = (command: string, args: string[], env = process.env) =>
    execFileSync(command, args, {
      env,
      encoding: "utf8",
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
    });
  const ffmpeg = (args: string[]) =>
    run("ffmpeg", ["-v", "error", "-nostdin", ...args]);
  const hash = (file: string) =>
    createHash("sha256").update(readFileSync(file)).digest("hex");
  const importEnv = {
    ...process.env,
    HOME: home,
    CFFIXED_USER_HOME: home,
    XDG_CONFIG_HOME: join(home, "config"),
    XDG_DATA_HOME: join(home, "data"),
    XDG_RUNTIME_DIR: runtimeDirectory,
    DISPLAY: "",
    WAYLAND_DISPLAY: "",
    DBUS_SESSION_BUS_ADDRESS: "",
    APPIMAGE_EXTRACT_AND_RUN: "1",
  };
  const plain = join(root, "attachment.mov");
  ffmpeg(["-i", silent, "-c", "copy", plain]);
  const plainHash = hash(plain);
  const imported = run(
    "/bin/sh",
    ["-c", 'umask 002; exec "$@"', "record-package", binary, "import", plain],
    importEnv,
  ).trim();
  assert.equal(imported, join(root, "attachment.apparent"));
  const importedManifest = join(imported, "apparent.json");
  const importedBundle = JSON.parse(readFileSync(importedManifest, "utf8"));
  assert.equal(importedBundle.source, "importedMovie");
  assert.equal(importedBundle.device, undefined);
  assert.equal(importedBundle.audio, undefined);
  assert.deepEqual(importedBundle.events, []);
  assert.deepEqual(importedBundle.strokes, []);
  assert.equal(statSync(imported).mode & 0o777, 0o700);
  assert.equal(
    statSync(join(imported, importedBundle.video)).mode & 0o777,
    0o600,
  );
  assert.equal(hash(plain), plainHash);
  assert.equal(hash(join(imported, importedBundle.video)), plainHash);
  ffmpeg([
    "-xerror",
    "-i",
    join(imported, importedBundle.contactSheet),
    "-f",
    "null",
    "-",
  ]);
  const summary = run(binary, ["inspect", imported], importEnv);
  assert(summary.includes(imported));
  assert(summary.includes("Source: imported video"));
  const zoom = run(
    binary,
    ["zoom", imported, "--at", "0:00.5", "--frames", "3", "--full"],
    importEnv,
  );
  const zoomImage = zoom.trim().split("\n")[0];
  ffmpeg(["-xerror", "-i", zoomImage, "-f", "null", "-"]);
  const beforeReprocess = hash(importedManifest);
  const unsafeParent = join(root, "group-writable-output");
  mkdirSync(unsafeParent);
  chmodSync(unsafeParent, 0o770);
  const unsafeOutput = join(unsafeParent, "out.apparent");
  assert.throws(
    () =>
      run(binary, ["reprocess", imported, "--out", unsafeOutput], importEnv),
    /output bundle's parent directory.*group and other write permissions disabled/,
  );
  assert(existsSync(join(unsafeOutput, ".publication-pending")));
  const rebuiltImport = join(root, "reprocessed-import.apparent");
  run(binary, ["reprocess", imported, "--out", rebuiltImport], importEnv);
  assert.equal(
    JSON.parse(readFileSync(join(rebuiltImport, "apparent.json"), "utf8"))
      .source,
    "importedMovie",
  );
  assert.equal(hash(importedManifest), beforeReprocess);
  assert.equal(hash(join(imported, importedBundle.video)), plainHash);
  assert(readFileSync(join(imported, "summary.md"), "utf8").includes(imported));
  assert(summary.includes("The imported movie has no audio track."));

  const narrated = join(root, "narrated.mp4"),
    narratedOutput = join(root, "narrated.apparent");
  ffmpeg([
    "-i",
    silent,
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=1",
    "-map",
    "0:v",
    "-map",
    "1:a",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    narrated,
  ]);
  const transcriber = join(root, "import-transcriber.ts");
  writeFileSync(
    transcriber,
    `import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
assert.equal(readFileSync(process.argv[2]).toString('ascii', 8, 12), 'WAVE');
console.log(JSON.stringify({ version: 1, text: 'Check the opening', segments: [{ t0: 100, t1: 700, text: 'Check the opening' }] }));
`,
    { mode: 0o600 },
  );
  const config = join(root, "import-config.json");
  writeFileSync(
    config,
    JSON.stringify({
      transcriber: "command",
      transcribeCommand: [
        process.execPath,
        "--experimental-strip-types",
        transcriber,
        "{audio}",
      ],
    }),
    { mode: 0o600 },
  );
  const narratedHash = hash(narrated);
  assert.equal(
    run(binary, ["import", narrated, "--out", narratedOutput], {
      ...importEnv,
      APPARENT_CONFIG: config,
    }).trim(),
    narratedOutput,
  );
  const narratedBundle = JSON.parse(
    readFileSync(join(narratedOutput, "apparent.json"), "utf8"),
  );
  assert.match(narratedBundle.transcript.source, /^command:/);
  assert.equal(narratedBundle.transcript.text, "Check the opening");
  assert.equal(
    statSync(join(narratedOutput, narratedBundle.audio)).mode & 0o777,
    0o600,
  );
  assert.equal(hash(join(narratedOutput, narratedBundle.video)), narratedHash);
  assert.equal(hash(narrated), narratedHash);

  const beforeCollision = hash(importedManifest);
  assert.throws(
    () => run(binary, ["import", plain, "--out", imported], importEnv),
    /already exists/,
  );
  assert.equal(hash(importedManifest), beforeCollision);
  const invalid = join(root, "invalid.mp4"),
    invalidOutput = join(root, "invalid.apparent");
  writeFileSync(invalid, "invalid video");
  assert.throws(() =>
    run(binary, ["import", invalid, "--out", invalidOutput], importEnv),
  );
  assert(!existsSync(invalidOutput));
}
