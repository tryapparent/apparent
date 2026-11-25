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
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { demoFixtures } from "./fixtures.ts";
import {
  assertHosted,
  cpuLimits,
  processorTicks,
  siblingsOf,
  systemPressure,
  ticksBetween,
} from "./hosted-environment.ts";

assertHosted();
const [controlRoot, candidateRoot, evidence, ...extra] = process.argv.slice(2);
assert(
  !extra.length &&
    [controlRoot, candidateRoot, evidence].every(
      (path) => path && isAbsolute(path),
    ),
  "Usage: node hosted.ts CONTROL_CHECKOUT CANDIDATE_CHECKOUT EVIDENCE_DIR",
);
assert.equal(realpathSync(evidence), evidence);
const root = fileURLToPath(new URL("../../../", import.meta.url));
const scratch = mkdtempSync("/tmp/apparent-dev-agent-hosted-");
const target = join(scratch, "cargo");
const home = join(scratch, "home");
mkdirSync(home, { mode: 0o700 });

const env = {
  PATH: process.env.PATH,
  GITHUB_ACTIONS: process.env.GITHUB_ACTIONS,
  GITHUB_REPOSITORY: process.env.GITHUB_REPOSITORY,
  RUNNER_ENVIRONMENT: process.env.RUNNER_ENVIRONMENT,
  LANG: "C.UTF-8",
  HOME: process.env.HOME,
  RUSTUP_HOME: process.env.RUSTUP_HOME,
  CARGO_HOME: process.env.CARGO_HOME,
  TMPDIR: scratch,
  CARGO_TARGET_DIR: target,
  APPARENT_POSTHOG_TOKEN: "",
  APPARENT_POSTHOG_RELEASE_ID: "",
  APPARENT_REPORTING_ENVIRONMENT: "synthetic",
  APPARENT_DESKTOP_REPORTING: "0",
};
function run(
  label: string,
  command: string,
  args: string[],
  cwd = root,
  stdout?: string,
) {
  const log = openSync(join(evidence, label + ".log"), "a", 0o600);
  const output = stdout ? openSync(stdout, "wx", 0o600) : log;
  try {
    const child = spawnSync(command, args, {
      cwd,
      env,
      stdio: ["ignore", output, log],
      timeout: 20 * 60 * 1000,
    });
    if (child.error) throw child.error;
    assert.equal(child.status, 0, label + " failed. See " + label + ".log");
  } finally {
    if (output !== log) closeSync(output);
    closeSync(log);
  }
}

function identity(checkout: string, beforeBuild = false) {
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", checkout, ...args], { encoding: "utf8" }).trim();
  const sha = git("rev-parse", "HEAD");
  assert(/^[0-9a-f]{40}$/.test(sha));
  assert.equal(
    git(
      "status",
      "--porcelain",
      "--untracked-files=all",
      ...(beforeBuild ? ["--ignored=matching"] : []),
    ),
    "",
    "Build checkout contains files outside the pinned tree or tracked changes",
  );
  return sha;
}

function build(checkout: string, sha: string, jobs: number) {
  const destination = join(scratch, sha);
  mkdirSync(destination);
  run(
    sha + "-build",
    "cargo",
    [
      "+1.99.1",
      "build",
      "--release",
      "--locked",
      "--bin",
      "apparent",
      "--jobs",
      String(jobs),
    ],
    checkout,
  );
  assert.equal(identity(checkout), sha);
  const release = join(target, "release");
  for (const file of readdirSync(release).filter(
    (name) => name === "apparent" || name.includes(".so"),
  )) {
    copyFileSync(join(release, file), join(destination, file));
  }
  return join(destination, "apparent");
}

async function quietCpu(cpus: number[]) {
  const deadline = performance.now() + 30_000;
  const topology = cpus.map((cpu) => ({ cpu, peers: siblingsOf(cpu) }));
  while (performance.now() < deadline) {
    const before = processorTicks();
    await new Promise((done) => setTimeout(done, 750));
    const after = processorTicks();
    const samples = topology.map(({ cpu, peers }) => ({
      cpu,
      peers: peers.map((peer) => {
        assert(
          before.has(peer) && after.has(peer),
          "Missing peer CPU accounting",
        );
        return {
          cpu: peer,
          ...ticksBetween(before.get(peer)!, after.get(peer)!),
        };
      }),
    }));
    const log = openSync(join(evidence, "host-admission.jsonl"), "a", 0o600);
    try {
      writeFileSync(log, JSON.stringify(samples) + "\n");
    } finally {
      closeSync(log);
    }
    const qualified = samples.find(({ peers }) =>
      peers.every(({ busy }) => busy <= 0.1),
    );
    if (qualified) return qualified.cpu;
  }
  throw Error("No guest CPU and visible SMT peers passed quiet admission");
}

function retainReceipts() {
  for (const job of readdirSync(scratch).filter((name) =>
    name.startsWith("inspect-"),
  )) {
    const directory = join(scratch, job);
    for (const name of readdirSync(directory).filter((row) =>
      /^[0-9a-f]{64}$/.test(row),
    )) {
      for (const file of readdirSync(join(directory, name))) {
        if (/^(?:trace\.bt|probe-.+\.txt)$/.test(file)) {
          copyFileSync(
            join(directory, name, file),
            join(evidence, job + "-" + name + "-" + file),
          );
        }
      }
    }
    for (const file of ["quiet.json", "failure.json", "receipt.json"]) {
      const source = join(scratch, job, file);
      try {
        copyFileSync(source, join(evidence, job + "-" + file));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }
}

try {
  const controlSha = identity(controlRoot, true),
    candidateSha = identity(candidateRoot, true);
  const limits = cpuLimits();
  assert(
    limits.effectiveCpus >= 1,
    "CPU limit cannot support one benchmark CPU",
  );
  writeFileSync(
    join(evidence, "agent-host.json"),
    JSON.stringify(
      {
        controlSha,
        candidateSha,
        limits,
        topology: limits.cpus.map((cpu) => ({
          cpu,
          siblings: siblingsOf(cpu),
        })),
        node: process.version,
        pressure: systemPressure(),
        kernel: readFileSync("/proc/sys/kernel/osrelease", "utf8").trim(),
      },
      null,
      2,
    ),
  );
  run("apt", "bash", [
    join(root, "capture/desktop/scripts/linux/appimage/dependencies.sh"),
  ]);
  run("bpftrace-install", "/usr/bin/sudo", [
    "-n",
    "apt-get",
    "install",
    "-y",
    "--no-install-recommends",
    "bpftrace",
  ]);
  run("bpftrace", "/usr/bin/sudo", [
    "-n",
    "bpftrace",
    "-q",
    "-e",
    "BEGIN { exit(); }",
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
    { cwd: root, env, encoding: "utf8" },
  ).trim();
  assert(isAbsolute(bun));
  env.PATH = dirname(bun) + ":" + env.PATH;
  const jobs = Math.floor(limits.effectiveCpus);
  const control = build(controlRoot, controlSha, jobs);
  const candidate =
    controlSha === candidateSha
      ? control
      : build(candidateRoot, candidateSha, jobs);
  const fixtures = demoFixtures(scratch, (path) => {
    const child = spawnSync(control, ["demo", "--out", path], {
      cwd: scratch,
      env: {
        ...env,
        HOME: home,
        XDG_CONFIG_HOME: home,
        APPARENT_CONFIG: join(home, "config.json"),
      },
      encoding: "utf8",
      timeout: 120_000,
    });
    writeFileSync(join(evidence, "synthetic-producer.log"), child.stderr ?? "");
    if (child.error) throw child.error;
    assert.equal(child.status, 0, "Synthetic demo producer failed");
  });
  const manifest = join(scratch, "fixtures.json");
  writeFileSync(manifest, JSON.stringify(fixtures));
  const entry = fileURLToPath(new URL("./inspect.ts", import.meta.url));
  const proof = fileURLToPath(
    new URL("./hosted-contention-proof.ts", import.meta.url),
  );
  const initialCpu = await quietCpu(limits.cpus);
  run(
    "contention-proof",
    "taskset",
    ["-c", String(initialCpu), process.execPath, proof],
    root,
    join(evidence, "contention-proof.json"),
  );
  const compare = async (label: string, binary: string, ledger?: string) => {
    const cpu = await quietCpu([initialCpu]);
    const output = join(evidence, label + ".json");
    const command = [
      "-c",
      String(cpu),
      process.execPath,
      entry,
      control,
      binary,
      scratch,
      manifest,
      ...(ledger ? [ledger] : []),
    ];
    writeFileSync(
      join(evidence, label + "-command.json"),
      JSON.stringify(["taskset", ...command]),
    );
    run(label, "taskset", command, root, output);
    return output;
  };
  Object.assign(env, {
    APPARENT_AGENT_HOSTED: "1",
    APPARENT_AGENT_BUILD_REVISIONS: [controlSha, candidateSha].join(","),
  });
  const referenceReceipt = await compare("calibration", control);
  if (control !== candidate) {
    const ledger = join(scratch, "ledger.json");
    writeFileSync(
      ledger,
      JSON.stringify({ referenceReceipt, experiments: [] }),
    );
    await compare("comparison", candidate, ledger);
  }
} finally {
  retainReceipts();
  writeFileSync(
    join(evidence, "host-pressure-after.json"),
    JSON.stringify(systemPressure(), null, 2),
  );
  rmSync(scratch, { recursive: true, force: true });
}
