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
const launcher = join(job, "scenario");
await writeFile(
  launcher,
  'exec "$SCRAWL_GUI_LIBRARY_PATH/libbench.so.node" --experimental-strip-types "$SCRAWL_GUI_LIBRARY_PATH/libbench.so.guest.ts"\n',
  { mode: 0o700, flag: "wx" },
);
const surface = process.env.APPARENT_BENCH_SURFACE === "1";
const settings = process.env.APPARENT_BENCH_SETTINGS;
const cli = process.env.APPARENT_BENCH_LOCAL_CLI_FIXTURES;
assert([surface, !!settings, !!cli].filter(Boolean).length <= 1);
const mode = surface
  ? "surface"
  : settings
    ? "settings"
    : cli
      ? "local-cli"
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
await Promise.all([
  stageFile(realpathSync(process.execPath), "node"),
  stageFile(model, "model"),
  stageFile(model + ".verified.json", "receipt"),
  stageFile(join(kit, "guest.ts"), "guest.ts"),
  stageFile(join(kit, "sample.ts"), "sample.ts"),
  stageFile(
    join(repo, "capture/desktop/scripts/linux/gui/capture-smoke.py"),
    "scene",
  ),
]);
await chmod(join(staged, "libbench.so.node"), 0o700);
if (settings) await stageFile(realpathSync(settings), "settings.ts");
if (cli) {
  const fixtures = JSON.parse(
    await import("node:fs/promises").then((fs) => fs.readFile(cli, "utf8")),
  );
  await stageFile(
    join(repo, "enablement/timing/journey/local-cli.ts"),
    "local-cli.ts",
  );
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
  if (mode === "draw" || mode === "surface") {
    const ready = join(vm, "result.json");
    while (!existsSync(ready)) {
      if (runner.child.exitCode !== null)
        throw Error("Disposable VM exited before startup");
      await delay(200);
    }
    const here = dirname(fileURLToPath(import.meta.url));
    const driver = start(
      process.execPath,
      [join(here, "driver.ts"), vm, key, mode],
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
