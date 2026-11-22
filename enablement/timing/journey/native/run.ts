import assert from "node:assert/strict";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import {
  closeSync,
  createReadStream,
  existsSync,
  openSync,
  realpathSync,
  statSync,
} from "node:fs";
import { chmod, copyFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const [templateArg, user, imageArg, expected, modelArg, jobArg, ...extra] =
  process.argv.slice(2);
assert(
  templateArg &&
    user &&
    imageArg &&
    expected &&
    modelArg &&
    jobArg &&
    !extra.length,
  "Usage: native/run.ts TEMPLATE_DIR SSH_USER APPIMAGE SHA256 MODEL PRIVATE_JOB",
);
const [template, image, model, job] = [
  templateArg,
  imageArg,
  modelArg,
  jobArg,
].map((path) => realpathSync(path));
const repo = fileURLToPath(new URL("../../../../", import.meta.url));
const kit = join(repo, "record/enablement/performance");
const run = (program: string, args: string[]) =>
  execFileSync(program, args, { stdio: "inherit" });
async function sha256(file: string) {
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return hash.digest("hex");
}
assert.match(job, /^\/tmp\/apparent-dev-[a-zA-Z0-9_-]+$/);
const jobStat = statSync(job);
assert(jobStat.uid === process.getuid?.() && (jobStat.mode & 0o777) === 0o700);
assert.match(user, /^[a-z][a-z0-9_-]+$/);
assert.match(expected, /^[0-9a-f]{64}$/);
assert.equal(await sha256(image), expected);
assert.equal(
  await sha256(model),
  "a8bf3de2b393bd14ead5a858c3748d5e3b07a20fdeabdd3b498fba4f463fa929",
);
const staged = join(job, "staged");
await mkdir(staged);
const binary = join(staged, basename(image));
await copyFile(image, binary);
await chmod(binary, 0o700);
const stageFile = (source: string, name: string) =>
  copyFile(source, join(staged, "libbench.so." + name));
const archive = join(job, "collector");
async function source(relative: string) {
  const destination = join(archive, relative);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(join(repo, relative), destination);
}
const launcher = join(job, "scenario");
await writeFile(
  launcher,
  'mkdir -p "$TMPDIR/collector" && tar -C "$TMPDIR/collector" -xf "$SCRAWL_GUI_LIBRARY_PATH/libbench.so.program" && exec "$SCRAWL_GUI_LIBRARY_PATH/libbench.so.node" --experimental-strip-types "$TMPDIR/collector/record/enablement/performance/guest.ts"\n',
  { mode: 0o700, flag: "wx" },
);
const surface = process.env.APPARENT_BENCH_SURFACE === "1";
const media = process.env.APPARENT_BENCH_MEDIA === "1";
const ink = process.env.APPARENT_BENCH_INK === "1";
const detail = process.env.APPARENT_BENCH_DETAIL === "1";
const onboarding = process.env.APPARENT_BENCH_ONBOARDING === "1";
assert(
  (!media && !ink && !detail) || surface,
  "Media and interaction measurements require the surface probe",
);
const settings = process.env.APPARENT_BENCH_SETTINGS;
const cli = process.env.APPARENT_BENCH_LOCAL_CLI_FIXTURES;
assert([surface, onboarding, !!settings, !!cli].filter(Boolean).length <= 1);
const mode = surface
  ? "surface"
  : settings
    ? "settings"
    : cli
      ? "local-cli"
      : onboarding
        ? "onboarding"
        : "draw";
const manifest = await import("../benchmark.json", {
  with: { type: "json" },
}).then((result) => result.default);
const selection = process.env.APPARENT_BENCH_PROBE;
assert(
  !selection ||
    (selection !== "portal-warmup" &&
      Object.hasOwn(manifest.captureFixtures, selection)),
  "Unknown smoke fixture",
);
const cases = Object.entries(manifest.captureFixtures).filter(
  ([id]) =>
    id === "portal-warmup" || (!surface && (!selection || id === selection)),
);
await writeFile(join(staged, "libbench.so.cases"), JSON.stringify(cases), {
  mode: 0o600,
});
await writeFile(join(staged, "libbench.so.mode"), mode, { mode: 0o600 });
if (ink) await writeFile(join(staged, "libbench.so.ink"), "1", { mode: 0o600 });
if (detail)
  await writeFile(join(staged, "libbench.so.detail"), "1", { mode: 0o600 });
await Promise.all([
  stageFile(realpathSync(process.execPath), "node"),
  stageFile(model, "model"),
  stageFile(model + ".verified.json", "receipt"),
  source("record/enablement/performance/guest.ts"),
  stageFile(join(kit, "sample.ts"), "sample.ts"),
  stageFile(
    join(repo, "capture/desktop/scripts/linux/gui/capture-smoke.py"),
    "scene",
  ),
]);
if (surface || onboarding)
  await source("shared/enablement/performance/electron-observer.ts");
if (surface)
  await Promise.all(
    ["surface.ts", "interactions.ts"].map((file) =>
      source("record/enablement/performance/" + file),
    ),
  );
if (onboarding) await source("onboarding/enablement/performance.ts");
if (detail) {
  const preview = process.env.APPARENT_BENCH_PREVIEW_MODEL;
  assert(preview, "The local caption probe needs a pinned preview model");
  const previewFile = realpathSync(preview);
  assert.equal(
    await sha256(previewFile),
    "90d8c89714cd31efc88be62a40c6b2bea57e0cc2063af1ffe2c28f1a228ca110",
  );
  await stageFile(previewFile, "preview-model");
}
await chmod(join(staged, "libbench.so.node"), 0o700);
if (settings) await stageFile(realpathSync(settings), "settings.ts");
if (cli) {
  await source("enablement/timing/journey/native/local-cli-guest.ts");
  const fixtures = JSON.parse(
    await import("node:fs/promises").then((fs) => fs.readFile(cli, "utf8")),
  );
  await source("enablement/timing/journey/local-cli.ts");
  const inputs = ["short", "ink", "long"].map(
    (name) => [name, realpathSync(fixtures[name])] as const,
  );
  for (const [, bundle] of inputs)
    assert(
      /^\/tmp\/apparent-dev-.*\/[^/]+\.apparent$/.test(bundle) &&
        existsSync(join(bundle, "apparent.json")),
    );
  await mkdir(join(job, "cli-fixtures"));
  for (const [name, bundle] of inputs) {
    run("cp", [
      "--reflink=auto",
      "-a",
      bundle,
      join(job, "cli-fixtures", name + ".apparent"),
    ]);
  }
  run("tar", [
    "-C",
    join(job, "cli-fixtures"),
    "-cf",
    join(staged, "libbench.so.cli-fixtures"),
    "short.apparent",
    "ink.apparent",
    "long.apparent",
  ]);
}
run("tar", ["-C", archive, "-cf", join(staged, "libbench.so.program"), "."]);
const speech = join(job, "speech-unit.wav");
const stimulus = join(job, "stimulus.wav");
run("ffmpeg", [
  "-v",
  "error",
  "-f",
  "lavfi",
  "-i",
  "flite=textfile=" + join(kit, "script.txt") + ":voice=slt",
  "-af",
  "apad=pad_dur=0.85",
  "-ar",
  "16000",
  "-ac",
  "1",
  "-c:a",
  "pcm_s16le",
  speech,
]);
run("ffmpeg", [
  "-v",
  "error",
  "-stream_loop",
  "-1",
  "-i",
  speech,
  "-t",
  "304",
  "-c:a",
  "pcm_s16le",
  stimulus,
]);

const vm = join(job, "vm");
const key = join(template, "test_access");
const children = new Map<ChildProcess, Promise<number | null>>();
function start(command: string, args: string[], log: string) {
  const fd = openSync(join(job, log), "wx", 0o600);
  try {
    const child = spawn(command, args, { stdio: ["ignore", fd, fd] });
    const exited = new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", resolve);
    });
    children.set(child, exited);
    return { child, exited };
  } finally {
    closeSync(fd);
  }
}
const interrupt = () => {
  for (const child of children.keys()) child.kill("SIGTERM");
};
process.on("SIGINT", interrupt);
process.on("SIGTERM", interrupt);
console.log("Private run " + job);
try {
  const runner = start(
    "systemd-run",
    [
      "--user",
      "--scope",
      "--quiet",
      "python3",
      join(repo, "capture/desktop/scripts/linux/gui/gui-vm.py"),
      "--template",
      join(template, "system.qcow2"),
      "--ovmf-vars",
      join(template, "OVMF_VARS.fd"),
      "--ssh-key",
      key,
      "--ssh-user",
      user,
      "--binary",
      binary,
      "--scenario",
      launcher,
      "--audio-file",
      stimulus,
      "--results",
      vm,
      "--memory",
      "6144",
      "--input-profile",
      "mouse",
      "--inhibit-idle",
      "--isolated-network",
      "--require-command",
      "jq",
      "--require-command",
      "python3",
      "--require-command",
      "ffmpeg",
      "--require-command",
      "ffprobe",
      "--require-command",
      "pactl",
      "--require-command",
      "pw-play",
      "--require-command",
      "wl-copy",
      "--require-command",
      "wl-paste",
      "--scenario-timeout",
      "900",
      "--job-timeout",
      "1100",
    ],
    "runner.log",
  );
  if (mode === "draw" || mode === "surface" || mode === "onboarding") {
    const ready = join(vm, "result.json");
    while (!existsSync(ready)) {
      if (runner.child.exitCode !== null)
        throw Error("Disposable VM exited before startup");
      await delay(200);
    }
    const here = dirname(fileURLToPath(import.meta.url));
    const driver = start(
      process.execPath,
      [
        join(here, "driver.ts"),
        vm,
        key,
        mode,
        ...(media ? ["media"] : []),
        ...(ink ? ["ink"] : []),
      ],
      "driver.log",
    );
    const [runnerCode, driverCode] = await Promise.all([
      runner.exited,
      driver.exited,
    ]);
    assert.equal(runnerCode, 0, "VM run failed");
    assert.equal(driverCode, 0, "Physical input driver failed");
  } else {
    assert.equal(await runner.exited, 0, "VM run failed");
  }
} finally {
  interrupt();
  await Promise.allSettled(children.values());
}
