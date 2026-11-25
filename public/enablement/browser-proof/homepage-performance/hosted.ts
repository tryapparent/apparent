import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  accessSync,
  constants,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { availableParallelism } from "node:os";
import { delimiter, isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  hostedInterference,
  scopeCommand,
} from "./hosted-guard/interference.ts";
import { idlePreflight } from "./resources.ts";

const inputs = process.argv.slice(2);
assert(
  inputs.length === 3 && inputs.every(isAbsolute),
  "Supply CONTROL_CHECKOUT CANDIDATE_CHECKOUT EVIDENCE_DIR as absolute paths",
);
assert.equal(process.versions.node, "22.23.0");
assert.equal(process.env.GITHUB_REPOSITORY, "tryapparent/apparent");
assert.equal(process.env.RUNNER_ENVIRONMENT, "github-hosted");
assert.equal(process.env.RUNNER_OS, "Linux");
assert.equal(process.env.RUNNER_ARCH, "X64");
assert.equal(process.env.ImageOS, "ubuntu24");
assert.match(readFileSync("/etc/os-release", "utf8"), /^VERSION_ID="24\.04"$/m);
const runnerTemp = process.env.RUNNER_TEMP;
assert(runnerTemp && isAbsolute(runnerTemp));

const [control, candidate, destination] = inputs.map((path) =>
  realpathSync(path),
);
const reviewed = fileURLToPath(new URL("../../../../", import.meta.url));
const outside = (root: string, path: string) =>
  relative(root, path).startsWith("../");
assert(
  [control, candidate, reviewed].every(
    (root) => outside(root, destination) && outside(root, runnerTemp),
  ),
);
assert.notEqual(destination, runnerTemp);
const evidence = join(destination, "public");
mkdirSync(evidence, { mode: 0o700 });
const scratch = mkdtempSync(join(runnerTemp, "apparent-public-hosted-"));
assert(outside(evidence, scratch));
const env: NodeJS.ProcessEnv = Object.fromEntries(
  [
    "PATH",
    "HOME",
    "LANG",
    "LC_ALL",
    "USER",
    "LOGNAME",
    "CI",
    "CHROME_DEVEL_SANDBOX",
  ].flatMap((key) =>
    process.env[key] === undefined ? [] : [[key, process.env[key]]],
  ),
);
Object.assign(env, {
  TMPDIR: scratch,
  RUNNER_TEMP: scratch,
  npm_config_cache: join(scratch, "npm-cache"),
  BUN_INSTALL_CACHE_DIR: join(scratch, "bun-cache"),
  PLAYWRIGHT_BROWSERS_PATH: join(scratch, "browsers"),
});

function json(name: string, value: unknown) {
  writeFileSync(
    join(evidence, name + ".json"),
    JSON.stringify(value, null, 2) + "\n",
  );
}

function run(
  label: string,
  command: string,
  args: string[],
  cwd = reviewed,
  environment = env,
) {
  console.log(label);
  const result = spawnSync(command, args, {
    cwd,
    env: environment,
    encoding: "utf8",
    timeout: 240_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  writeFileSync(
    join(evidence, label + ".log"),
    [
      JSON.stringify({ command, args, cwd }),
      result.stdout,
      result.stderr,
      result.error?.message,
    ]
      .filter(Boolean)
      .join("\n"),
  );
  assert.equal(result.status, 0, label + " failed; see the retained log");
  return result.stdout;
}

function head(label: string, checkout: string) {
  const sha = run(
    label,
    "git",
    ["rev-parse", "--verify", "HEAD"],
    checkout,
  ).trim();
  assert.match(sha, /^[a-f0-9]{40}$/);
  return sha;
}

function snapshot() {
  const pressure = Object.fromEntries(
    ["cpu", "io", "memory"].map((name) => {
      const text = readFileSync("/proc/pressure/" + name, "utf8");
      assert.match(text, /^some .*total=\d+/m);
      return [name, text];
    }),
  );
  const cpu = readFileSync("/proc/stat", "utf8")
    .match(/^cpu +([0-9 ]+)$/m)?.[1]
    .trim()
    .split(/ +/)
    .map(Number);
  assert(cpu && cpu.length >= 8 && cpu.slice(0, 8).every(Number.isSafeInteger));
  return {
    monotonicNs: process.hrtime.bigint().toString(),
    pressure,
    cpuTotalTicks: cpu.slice(0, 8).reduce((total, value) => total + value, 0),
    cpuStealTicks: cpu[7],
  };
}

function shaArchive(label: string, checkout: string, sha: string) {
  const source = join(scratch, label);
  mkdirSync(source);
  const tar = source + ".tar";
  run(
    label + "-archive",
    "git",
    ["archive", "--format=tar", "--output=" + tar, sha],
    checkout,
  );
  run(label + "-extract", "tar", ["-xf", tar, "-C", source]);
  rmSync(tar);
  return source;
}

function executable(name: string) {
  if (isAbsolute(name)) return realpathSync(name);
  for (const directory of (env.PATH ?? "").split(delimiter)) {
    if (!isAbsolute(directory)) continue;
    const path = join(directory, name);
    try {
      accessSync(path, constants.X_OK);
      return realpathSync(path);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "EACCES" && code !== "ENOTDIR")
        throw error;
    }
  }
  throw new Error("Required executable is missing: " + name);
}

function buildEnvironment(bun: string) {
  const bin = join(scratch, "build-bin");
  mkdirSync(bin);
  const commands = Object.fromEntries(
    Object.entries({
      node: process.execPath,
      bun,
      npm: "npm",
      python3: "python3",
      git: "git",
      sh: "sh",
    }).map(([name, command]) => {
      const target = executable(command);
      symlinkSync(target, join(bin, name));
      return [name, target];
    }),
  );
  json("build-toolchain", { commands });
  return { ...env, PATH: bin };
}

function packageSite(
  label: string,
  checkout: string,
  sha: string,
  environment: NodeJS.ProcessEnv,
) {
  const source = shaArchive(label, checkout, sha);
  run(
    label + "-install",
    "bun",
    ["install", "--cwd", join(source, "public"), "--frozen-lockfile"],
    reviewed,
    environment,
  );
  const site = join(source, "public/site");
  run(label + "-build", "npm", ["run", "build"], site, environment);
  run(
    label + "-package",
    process.execPath,
    ["../enablement/site-build/package-apparent.mjs"],
    site,
    environment,
  );
  return { artifact: join(site, "dist-apparent"), sha };
}

type Site = ReturnType<typeof packageSite>;
type Replay = {
  qualified: boolean;
  diagnostic?: boolean;
  compatible: { hostedInterference: string };
  receipt: string;
  revision: string;
  packageSha256: string;
  receipts: {
    eligible: boolean;
    sampledChromiumPssKiB: number;
    interference: { passed: boolean };
  }[];
};

let benchmarkScope: string | undefined;
function replay(
  label: string,
  site: Site,
  options: string[],
  diagnostic = false,
) {
  const before = snapshot();
  try {
    assert(benchmarkScope);
    const result = JSON.parse(
      run(
        label,
        "sh",
        scopeCommand(benchmarkScope, process.execPath, [
          fileURLToPath(new URL("homepage.ts", import.meta.url)),
          "--artifact",
          site.artifact,
          "--revision",
          site.sha,
          "--output",
          join(evidence, label),
          ...options,
        ]),
      ),
    ) as Replay;
    assert(
      (diagnostic
        ? result.diagnostic && !result.qualified
        : result.qualified) &&
        result.compatible.hostedInterference === hostedInterference &&
        result.revision === site.sha &&
        /^[a-f0-9]{64}$/.test(result.packageSha256),
    );
    assert(
      isAbsolute(result.receipt) &&
        realpathSync(result.receipt).startsWith(evidence + "/"),
    );
    const raw = JSON.parse(readFileSync(result.receipt, "utf8")) as Replay;
    const resourceRows = raw.receipts.filter(
      (row) => diagnostic || row.eligible,
    );
    assert(
      resourceRows.length &&
        resourceRows.every(
          (row) =>
            row.sampledChromiumPssKiB > 0 &&
            (diagnostic ? row.interference : row.interference.passed),
        ),
      "Chromium PSS or required host evidence was unavailable",
    );
    return result;
  } finally {
    const after = snapshot();
    json(label + "-guest", {
      before,
      after,
      stealDeltaTicks: after.cpuStealTicks - before.cpuStealTicks,
    });
  }
}

async function execute() {
  const aSha = head("control-head", control);
  const bSha = head("candidate-head", candidate);
  const affinity = readFileSync("/proc/self/status", "utf8").match(
    /^Cpus_allowed_list:\s*([^\n]+)$/m,
  )?.[1];
  assert(
    affinity && availableParallelism() > 0,
    "Linux CPU topology was unavailable",
  );
  json("platform", {
    repository: process.env.GITHUB_REPOSITORY,
    runId: process.env.GITHUB_RUN_ID,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    imageOS: process.env.ImageOS,
    imageVersion: process.env.ImageVersion,
    node: process.version,
    availableParallelism: availableParallelism(),
    affinity,
    topology: JSON.parse(run("lscpu", "lscpu", ["--json"])),
    hostPolicy:
      "Linux guest PSI and process PSS are measured; hypervisor host PSI is not available",
    initial: snapshot(),
    control: aSha,
    candidate: bSha,
    reviewed: head("reviewed-head", reviewed),
  });

  const pin = "1.3.10";
  const suggested = spawnSync("bun", ["--version"], { env, encoding: "utf8" });
  let bun = "bun";
  if (suggested.status !== 0 || suggested.stdout.trim() !== pin) {
    const tools = join(scratch, "toolchain");
    run("install-bun", "npm", [
      "install",
      "--prefix",
      tools,
      "--no-audit",
      "--no-fund",
      "bun@" + pin,
    ]);
    bun = join(tools, "node_modules/.bin/bun");
  }
  assert.equal(run("bun-version", bun, ["--version"]).trim(), pin);

  run("replay-dependencies", bun, [
    "install",
    "--cwd",
    join(reviewed, "public"),
    "--frozen-lockfile",
  ]);
  run("chromium", process.execPath, [
    join(reviewed, "public/node_modules/playwright-core/cli.js"),
    "install",
    "--with-deps",
    "chromium",
  ]);

  const environment = buildEnvironment(bun);
  const a = packageSite("control", control, aSha, environment);
  const b =
    aSha === bSha
      ? null
      : packageSite("candidate", candidate, bSha, environment);
  const suffix = `${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`;
  assert.match(suffix, /^[0-9]+-[0-9]+$/);
  const scope = "/sys/fs/cgroup/apparent-public-" + suffix;
  run("create-benchmark-cgroup", "sudo", ["-n", "mkdir", scope]);
  benchmarkScope = scope;
  env.APPARENT_PUBLIC_BENCHMARK_CGROUP = scope;
  env.APPARENT_PUBLIC_GUEST_CLOCK_TICKS = run("guest-clock-ticks", "getconf", [
    "CLK_TCK",
  ]).trim();
  if (!b) json("post-build-idle", await idlePreflight());
  const quiet = ["--mode", "quiet", "--runs", "5", "--max-blocks", "25"];
  const controlOne = replay("noise-first", a, quiet);
  const controlTwo = replay("noise-second", a, quiet);
  const controls = [controlOne.receipt, controlTwo.receipt];
  const trace = ["--mode", "trace", "--runs", "1", "--max-blocks", "8"];
  let experiments: {
    hypothesis: string;
    effort: never[];
    runs: string[];
    qualityEvidence: string;
  }[] = [];
  if (b) {
    const refs = controls.flatMap((path) => ["--control", path]);
    const runQuiet = (label: string, site: Site) =>
      replay(label, site, [...quiet, ...refs]).receipt;
    const runs = [
      runQuiet("a-first", a),
      runQuiet("b-first", b),
      runQuiet("b-repeat", b),
      runQuiet("a-repeat", a),
    ];
    const desktop = replay("candidate-desktop", b, trace);
    const mobile = replay("candidate-small-dark", b, [
      ...trace,
      "--size",
      "small-phone",
      "--theme",
      "dark",
    ]);
    assert.equal(desktop.packageSha256, mobile.packageSha256);
    experiments = [
      {
        hypothesis: "Pinned Public candidate " + bSha,
        effort: [],
        runs,
        qualityEvidence: desktop.receipt,
      },
    ];
  }

  replay("control-overhead", a, [
    "--mode",
    "calibrate",
    "--runs",
    "2",
    "--max-blocks",
    "10",
  ]);

  if (!b) {
    const proof = run("guest-interference-proof", process.execPath, [
      fileURLToPath(new URL("hosted-guard/proof.ts", import.meta.url)),
      "prove",
      scope,
    ]);
    json("guest-interference-proof", JSON.parse(proof));
    const options = [
      "--pressure-diagnostic",
      "--mode",
      "calibrate",
      "--runs",
      "1",
      "--max-blocks",
      "1",
    ];
    replay("pressure-a-first", a, options, true);
    const preflight = [...options, "--idle-preflight"];
    replay("pressure-b-first", a, preflight, true);
    replay("pressure-b-repeat", a, preflight, true);
    replay("pressure-a-repeat", a, options, true);
  }

  json("comparison-ledger", {
    controls: controls.map((path) => relative(evidence, path)),
    experiments: experiments.map((experiment) => ({
      ...experiment,
      runs: experiment.runs.map((path) => relative(evidence, path)),
      qualityEvidence: relative(evidence, experiment.qualityEvidence),
    })),
    unscoredEffort: [],
  });
  const score = JSON.parse(
    run("compare", process.execPath, [
      fileURLToPath(new URL("campaign.ts", import.meta.url)),
      join(evidence, "comparison-ledger.json"),
      "--compare-only",
    ]),
  ) as {
    incumbent: { qualified: boolean };
    experiments: { guardResult: { passed: boolean }[] }[];
  };
  json("comparison", score);
  assert(
    score.incumbent.qualified &&
      score.experiments.every((experiment) =>
        experiment.guardResult.every((guard) => guard.passed),
      ),
    "Public output or resource guard failed; see comparison.json",
  );
}

try {
  await execute();
} catch (error) {
  json("failure", {
    message: error instanceof Error ? error.message : String(error),
  });
  throw error;
} finally {
  try {
    if (benchmarkScope)
      run("remove-benchmark-cgroup", "sudo", ["-n", "rmdir", benchmarkScope]);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
