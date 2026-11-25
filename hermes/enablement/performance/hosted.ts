import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  closeSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const runner = fileURLToPath(new URL("run.ts", import.meta.url));
const [control, candidate, evidence, ...extra] = process.argv.slice(2);
assert(
  !extra.length &&
    [control, candidate, evidence].every((path) => path && isAbsolute(path)),
  "Expected CONTROL_CHECKOUT CANDIDATE_CHECKOUT EVIDENCE_DIRECTORY",
);
assert.equal(process.env.RUNNER_ENVIRONMENT, "github-hosted");
assert.equal(process.env.GITHUB_REPOSITORY, "tryapparent/apparent");
assert.equal(process.env.GITHUB_EVENT_NAME, "workflow_dispatch");
assert.equal(process.env.GITHUB_REF, "refs/heads/main");
assert.equal(process.platform, "linux");
assert.equal(process.arch, "x64");
assert.equal(process.version, "v22.23.0");
assert.equal(realpathSync(evidence), evidence);
assert.equal(statSync(evidence).mode & 0o077, 0);

function revision(checkout: string) {
  const sha = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: checkout,
    encoding: "utf8",
  }).trim();
  assert.match(sha, /^[0-9a-f]{40}$/);
  return sha;
}

const controlSha = revision(control);
const candidateSha = revision(candidate);
const scratch = mkdtempSync("/tmp/apparent-dev-hermes-hosted-");
const job = join(scratch, "job");
mkdirSync(job, { mode: 0o700 });
const target = join(scratch, "target");
const env = {
  PATH: process.env.PATH ?? "/usr/bin:/bin",
  HOME: process.env.HOME,
  CARGO_HOME: process.env.CARGO_HOME,
  RUSTUP_HOME: process.env.RUSTUP_HOME,
  LANG: "C.UTF-8",
  TMPDIR: scratch,
  CARGO_TARGET_DIR: target,
  APPARENT_POSTHOG_TOKEN: "",
  APPARENT_POSTHOG_RELEASE_ID: "",
  APPARENT_REPORTING_ENVIRONMENT: "synthetic",
  APPARENT_DESKTOP_REPORTING: "0",
};

function run(label: string, command: string, args: string[], cwd = root) {
  const log = openSync(join(evidence, label + ".log"), "wx", 0o600);
  try {
    const child = spawnSync(command, args, {
      cwd,
      env,
      stdio: ["ignore", log, log],
      timeout: 20 * 60_000,
    });
    if (child.error) throw child.error;
    assert.equal(child.status, 0, label + " failed. See " + label + ".log");
  } finally {
    closeSync(log);
  }
}

function cpuTicks() {
  return new Map(
    readFileSync("/proc/stat", "utf8")
      .split("\n")
      .filter((row) => /^cpu\d+\s/.test(row))
      .map((row) => {
        const [id, ...fields] = row.trim().split(/\s+/);
        const ticks = fields.slice(0, 8).map(Number);
        return [
          Number(id.slice(3)),
          { idle: ticks[3], total: ticks.reduce((a, b) => a + b, 0) },
        ];
      }),
  );
}

async function quietCpu() {
  const affinity = execFileSync("taskset", ["-pc", String(process.pid)], {
    encoding: "utf8",
  })
    .trim()
    .split(": ")
    .at(-1)!;
  const cpus = expandCpuList(affinity);
  const pairs = cpus
    .map((cpu) => ({
      cpu,
      peers: expandCpuList(
        readFileSync(
          "/sys/devices/system/cpu/cpu" +
            cpu +
            "/topology/thread_siblings_list",
          "utf8",
        ).trim(),
      ),
    }))
    .filter(
      ({ cpu, peers }) =>
        peers.includes(cpu) &&
        peers.length <= 2 &&
        peers.every((peer) => cpus.includes(peer)),
    );
  assert.ok(pairs.length, "No supported physical core in process affinity");
  const deadline = performance.now() + 30_000;
  while (performance.now() < deadline) {
    const before = cpuTicks();
    await new Promise((done) => setTimeout(done, 750));
    const after = cpuTicks();
    const quiet = pairs.find(({ peers }) =>
      peers.every((peer) => {
        const a = before.get(peer);
        const b = after.get(peer);
        if (!a || !b || b.total <= a.total) return false;
        return (b.idle - a.idle) / (b.total - a.total) >= 0.9;
      }),
    );
    if (quiet) return String(quiet.cpu);
  }
  throw Error("No quiet physical core and sibling during hosted preflight");
}

function expandCpuList(value: string) {
  assert.match(value, /^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/);
  return value.split(",").flatMap((range) => {
    const [first, last = first] = range.split("-").map(Number);
    return Array.from(
      { length: last - first + 1 },
      (_, offset) => first + offset,
    );
  });
}

try {
  run("native-dependencies", "bash", [
    join(root, "capture/desktop/scripts/linux/appimage/dependencies.sh"),
  ]);
  run("pillow", "sudo", [
    "-n",
    "apt-get",
    "install",
    "-y",
    "--no-install-recommends",
    "python3-pil",
  ]);
  run("rust", "rustup", [
    "toolchain",
    "install",
    "1.99.1",
    "--profile",
    "minimal",
  ]);
  const bun = execFileSync(
    "npm",
    ["exec", "--yes", "--package=bun@1.3.10", "--", "which", "bun"],
    {
      cwd: root,
      env,
      encoding: "utf8",
    },
  ).trim();
  assert.ok(isAbsolute(bun));
  env.PATH = bun.slice(0, bun.lastIndexOf("/")) + ":" + env.PATH;
  run(
    "control-build",
    "cargo",
    [
      "+1.99.1",
      "build",
      "--release",
      "--locked",
      "--bin",
      "apparent",
      "--jobs",
      "4",
    ],
    control,
  );
  assert.equal(revision(control), controlSha);
  run("scorer-prepare", process.execPath, [runner, "prepare", job]);
  const cpu = await quietCpu();
  const cli = join(target, "release", "apparent");
  run("baseline", process.execPath, [
    runner,
    "baseline",
    job,
    cli,
    cpu,
    controlSha,
  ]);
  if (candidateSha !== controlSha) {
    const started = performance.now();
    assert.equal(revision(candidate), candidateSha);
    const plugin = join(candidate, "hermes");
    assert.ok(statSync(plugin).isDirectory());
    const seconds = Math.max(
      1,
      Math.ceil((performance.now() - started) / 1000),
    );
    run("compare", process.execPath, [
      runner,
      "compare",
      job,
      cli,
      cpu,
      plugin,
      candidateSha,
      String(seconds),
    ]);
  }
  run("status", process.execPath, [runner, "status", job]);
} finally {
  for (const name of readdirSync(job)) {
    if (name.endsWith(".json"))
      copyFileSync(join(job, name), join(evidence, name));
  }
  const ledger = join(evidence, "experiments");
  mkdirSync(ledger, { mode: 0o700 });
  const experiments = join(job, "experiments");
  if (statSync(experiments, { throwIfNoEntry: false })?.isDirectory()) {
    for (const name of readdirSync(experiments)) {
      if (name.endsWith(".json"))
        copyFileSync(join(experiments, name), join(ledger, name));
    }
  }
  rmSync(scratch, { recursive: true });
}
