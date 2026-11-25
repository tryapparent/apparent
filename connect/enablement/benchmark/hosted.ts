import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { hostname } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { quietPreflight, readHostedCpu, waitForQuiet } from "./hosted/cpu.ts";
import { hash, sample } from "./watch-sample.ts";
import { benchmark } from "./watch-score.ts";

const service = "connect/service";
const resultFile =
  /^(cold|warm|watch-replay|watch-score|replay-unit)\.json$|^resources\.txt$|^replay-unit\.log$/;

function revision(tree: string) {
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", tree, ...args], { encoding: "utf8" }).trim();
  const sha = git("rev-parse", "HEAD");
  assert.match(sha, /^[0-9a-f]{40}$/);
  assert.equal(
    git("status", "--porcelain"),
    "",
    "Expected a clean pinned checkout",
  );
  return sha;
}

function run(cwd: string, log: string, command: string, args: string[]) {
  const fd = openSync(log, "wx", 0o600);
  try {
    const result = spawnSync(command, args, { cwd, stdio: ["ignore", fd, fd] });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, `${command} failed. See ${log}`);
  } finally {
    closeSync(fd);
  }
}

export async function copyEvidence(from: string, to: string) {
  for (const item of await readdir(from, { withFileTypes: true })) {
    if (
      item.isDirectory() &&
      /^(baseline|compare|sample|recipient)-/.test(item.name)
    ) {
      const next = join(to, item.name);
      await mkdir(next, { mode: 0o700 });
      await copyEvidence(join(from, item.name), next);
    } else if (item.isFile() && resultFile.test(item.name)) {
      await copyFile(join(from, item.name), join(to, item.name));
    }
  }
}

async function buildInputs(tree: string, sha: string) {
  const root = join(tree, service);
  const migrations = join(root, ".generated/migrations");
  const files = (await readdir(migrations))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  assert.ok(files.includes("0003.sql"), "Missing recipient migration");
  return {
    sha,
    worker: await hash(join(root, "dist/worker.js")),
    lockfile: await hash(join(root, "package-lock.json")),
    migrations: Object.fromEntries(
      await Promise.all(
        files.map(async (name) => [name, await hash(join(migrations, name))]),
      ),
    ),
  };
}

async function main(args: string[]) {
  assert.equal(
    args.length,
    3,
    "Expected CONTROL_CHECKOUT CANDIDATE_CHECKOUT EVIDENCE_DIR",
  );
  assert.ok(args.every(isAbsolute), "Expected absolute paths");
  const [control, candidate, evidence] = await Promise.all(
    args.map((path) => realpath(path)),
  );
  assert.equal(
    (await stat(evidence)).mode & 0o077,
    0,
    "Evidence directory must be private",
  );
  assert.ok(
    ![control, candidate].some(
      (tree) => evidence === tree || evidence.startsWith(tree + sep),
    ),
  );
  assert.ok(
    process.env.GITHUB_ACTIONS === "true" &&
      process.env.GITHUB_EVENT_NAME === "workflow_dispatch" &&
      process.env.RUNNER_ENVIRONMENT === "github-hosted" &&
      process.env.RUNNER_OS === "Linux" &&
      process.arch === "x64",
    "Hosted scoring requires manual dispatch on a standard GitHub Linux runner",
  );
  assert.equal(process.version, "v22.23.0");
  const temp = process.env.RUNNER_TEMP;
  const image = process.env.ImageVersion;
  assert.ok(
    temp && isAbsolute(temp) && image,
    "Hosted runner metadata unavailable",
  );
  const controlSha = revision(control);
  const candidateSha = revision(candidate);
  const calibrationOnly = controlSha === candidateSha;
  const scratch = await mkdtemp("/tmp/apparent-dev-cw-");
  assert.ok(scratch !== evidence && !scratch.startsWith(evidence + sep));
  const samples = join(scratch, "samples");
  await mkdir(samples, { mode: 0o700 });
  process.env.TMPDIR = scratch;
  process.env.PLAYWRIGHT_BROWSERS_PATH = join(scratch, "browsers");
  const cpu = await readHostedCpu();
  assert.ok(
    cpu.cpuQuota.limits.every((limit) => limit.startsWith("max ")),
    "A hosted replay unit cannot leave a quota-constrained runner cgroup",
  );
  const runnerProfile = JSON.stringify({
    platform: "github-hosted ubuntu-24.04 x64",
    image,
    topology: cpu.topology,
    cpuQuota: cpu.cpuQuota.limits,
    replayAccounting: "dedicated-systemd-cgroup-file-v2",
    preparation: "unscored-replay-per-build-v1",
  });
  const environment = {
    controlSha,
    candidateSha,
    image,
    runner: hostname(),
    cpu,
  };
  const accounting = {
    profile: runnerProfile,
    cgroup: cpu.cpuQuota.groups[0].path,
  };
  const record = (name: string, value: unknown) =>
    writeFile(join(evidence, name), JSON.stringify(value, null, 2) + "\n", {
      mode: 0o600,
    });
  const preflight = (name: string) =>
    waitForQuiet(
      () => quietPreflight(cpu.cpus),
      (windows) =>
        record(name, { qualified: windows.at(-1)?.qualified, windows }),
    );
  await record("connect-environment.json", environment);

  try {
    const ffmpeg = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" });
    if (
      (ffmpeg.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT"
    ) {
      run(control, join(evidence, "ffmpeg-apt-update.log"), "sudo", [
        "apt-get",
        "update",
      ]);
      run(control, join(evidence, "ffmpeg-install.log"), "sudo", [
        "apt-get",
        "install",
        "-y",
        "--no-install-recommends",
        "ffmpeg",
      ]);
    } else {
      if (ffmpeg.error) throw ffmpeg.error;
      assert.equal(ffmpeg.status, 0, "FFmpeg version probe failed");
    }
    const encoders = execFileSync("ffmpeg", ["-hide_banner", "-encoders"], {
      encoding: "utf8",
    });
    assert.match(encoders, /\blibx264\b/, "FFmpeg with libx264 is required");
    execFileSync("/usr/bin/time", ["--version"], { stdio: "ignore" });
    execFileSync("taskset", ["-pc", String(process.pid)], { stdio: "ignore" });

    for (const [name, tree] of calibrationOnly
      ? [["control", control]]
      : [
          ["control", control],
          ["candidate", candidate],
        ]) {
      run(tree, join(evidence, `install-${name}.log`), "npm", [
        "ci",
        "--ignore-scripts",
        "--prefix",
        service,
      ]);
      run(tree, join(evidence, `build-${name}.log`), "npm", [
        "run",
        "--prefix",
        service,
        "build",
      ]);
    }
    const serviceRoot = join(control, service);
    run(serviceRoot, join(evidence, "chromium-install.log"), process.execPath, [
      "node_modules/playwright-core/cli.js",
      "install",
      "--with-deps",
      "chromium",
    ]);
    const serviceRequire = createRequire(join(serviceRoot, "package.json"));
    if (!calibrationOnly) {
      const candidateRequire = createRequire(
        join(candidate, service, "package.json"),
      );
      assert.equal(
        candidateRequire("playwright-core/package.json").version,
        serviceRequire("playwright-core/package.json").version,
        "Playwright version changed between matched builds",
      );
    }
    const chrome = serviceRequire(
      "playwright-core",
    ).chromium.executablePath() as string;
    assert.ok(isAbsolute(chrome) && (await stat(chrome)).isFile());
    await record("connect-builds.json", {
      control: await buildInputs(control, controlSha),
      candidate: await buildInputs(
        calibrationOnly ? control : candidate,
        candidateSha,
      ),
      chromium: await hash(chrome),
    });

    await record("post-setup-window.json", await quietPreflight(cpu.cpus));
    for (const [label, tree] of calibrationOnly
      ? [["control", control]]
      : [
          ["control", control],
          ["candidate", candidate],
        ]) {
      const staged = await sample(
        tree,
        samples,
        chrome,
        cpu.cpuSpec,
        false,
        accounting.cgroup,
      );
      await record(`prestage-${label}.json`, { scored: false, ...staged });
    }

    assert.ok(
      await preflight("calibration-preflight.json"),
      "Hosted calibration failed the quiet CPU/I/O/steal preflight",
    );
    const baseline = await benchmark(
      "baseline",
      samples,
      chrome,
      cpu.cpuSpec,
      control,
      undefined,
      control,
      accounting,
    );
    await record("calibration.json", {
      sha: controlSha,
      qualified: baseline.qualified,
      receipt: relative(samples, baseline.receipt),
    });
    assert.ok(
      baseline.qualified,
      "Hosted calibration failed resource qualification",
    );
    if (calibrationOnly) return;

    assert.ok(
      await preflight("comparison-preflight.json"),
      "Hosted comparison failed the quiet CPU/I/O/steal preflight",
    );
    const comparison = await benchmark(
      "compare",
      samples,
      chrome,
      cpu.cpuSpec,
      control,
      baseline.receipt,
      candidate,
      accounting,
    );
    await record("comparison.json", {
      controlSha,
      candidateSha,
      qualified: comparison.qualified,
      receipt: relative(samples, comparison.receipt),
    });
    assert.ok(
      comparison.qualified,
      "Hosted comparison failed resource or output qualification",
    );
  } finally {
    await copyEvidence(samples, evidence);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await main(process.argv.slice(2));
}
