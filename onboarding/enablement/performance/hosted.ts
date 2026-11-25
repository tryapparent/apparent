import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { createReadStream } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  readlink,
  realpath,
  rm,
  stat,
  statfs,
  writeFile,
} from "node:fs/promises";
import { availableParallelism, tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { allowedCpus, choosePlacement } from "./hosted/placement.ts";

const args = process.argv.slice(2);
assert(
  args.length === 3 && args.every(isAbsolute),
  "Usage: hosted.ts CONTROL_CHECKOUT CANDIDATE_CHECKOUT EVIDENCE_DIR (absolute paths)",
);
assert(
  process.env.GITHUB_ACTIONS === "true" &&
    process.env.RUNNER_ENVIRONMENT === "github-hosted" &&
    process.env.GITHUB_REPOSITORY === "tryapparent/apparent" &&
    process.platform === "linux" &&
    process.arch === "x64",
  "Onboarding scoring requires the standard hosted x64 runner on tryapparent/apparent",
);
const release = await readFile("/etc/os-release", "utf8");
assert.match(release, /^ID=ubuntu$/m);
assert.match(release, /^VERSION_ID="24\.04"$/m);
assert.equal(process.version, "v22.23.0");
const [control, candidate, evidence] = await Promise.all(
  args.map((path) => realpath(path)),
);
const evidenceInfo = await stat(evidence);
assert(
  evidenceInfo.isDirectory() &&
    evidenceInfo.uid === process.getuid?.() &&
    (evidenceInfo.mode & 0o077) === 0,
  "Expected a private evidence directory",
);
assert(
  ![control, candidate].some((checkout) => {
    const path = relative(checkout, evidence);
    return path === "" || !path.startsWith("..");
  }),
  "Evidence must be outside the measured checkouts",
);

const scratch = await mkdtemp(join(tmpdir(), "onboarding-build-"));
const source = fileURLToPath(new URL("../../../", import.meta.url));
const benchmark = fileURLToPath(new URL("./benchmark.ts", import.meta.url));
const receipt = async (file: string, value: unknown) =>
  writeFile(join(evidence, file), JSON.stringify(value, null, 2) + "\n", {
    flag: "wx",
  });
const output = (cwd: string, program: string, ...argv: string[]) =>
  execFileSync(program, argv, { cwd, encoding: "utf8" }).trim();
const stage = async (
  name: string,
  cwd: string,
  program: string,
  ...argv: string[]
) => {
  const log = await open(join(evidence, name + ".log"), "ax", 0o600);
  try {
    await log.write(JSON.stringify({ cwd, program, argv }) + "\n");
    execFileSync(program, argv, {
      cwd,
      timeout: 600_000,
      env: { ...process.env, TMPDIR: scratch, BEND_NO_TELEMETRY: "1" },
      stdio: ["ignore", log.fd, log.fd],
    });
  } catch (error) {
    throw new Error(`${name} failed. See ${name}.log.`, { cause: error });
  } finally {
    await log.close();
  }
};
function revision(checkout: string) {
  assert.equal(
    output(checkout, "git", "rev-parse", "--show-toplevel"),
    checkout,
  );
  assert.equal(
    output(checkout, "git", "rev-parse", "--is-shallow-repository"),
    "false",
  );
  assert.equal(
    output(checkout, "git", "rev-parse", "--abbrev-ref", "HEAD"),
    "HEAD",
  );
  assert.equal(
    output(
      checkout,
      "git",
      "status",
      "--porcelain=v1",
      "--untracked-files=normal",
    ),
    "",
  );
  const sha = output(checkout, "git", "rev-parse", "HEAD");
  assert.match(sha, /^[a-f0-9]{40}$/);
  return sha;
}

async function digest(path: string) {
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  return hash.digest("hex");
}

async function treeDigest(root: string) {
  const hash = createHash("sha256");
  async function visit(path: string) {
    const info = await lstat(path);
    if (info.isDirectory()) {
      for (const child of (await readdir(path)).sort())
        await visit(join(path, child));
    } else {
      const content = info.isSymbolicLink()
        ? await readlink(path)
        : await digest(path);
      hash.update(
        JSON.stringify([relative(root, path), info.mode & 0o777, content]) +
          "\n",
      );
    }
  }
  await visit(root);
  return hash.digest("hex");
}

async function installPrerequisites() {
  const packages = [
    "xvfb",
    "xauth",
    "time",
    "fonts-liberation",
    "libgtk-3-0t64",
    "libnss3",
    "libasound2t64",
    "libgbm1",
    "libnotify4",
    "libxss1",
    "libxtst6",
  ];
  const missing = packages.filter((name) => {
    try {
      return (
        output(scratch, "dpkg-query", "-W", "-f=${db:Status-Status}", name) !==
        "installed"
      );
    } catch {
      return true;
    }
  });
  if (missing.length) {
    await stage("apt-update", scratch, "sudo", "apt-get", "update");
    await stage(
      "apt-install",
      scratch,
      "sudo",
      "apt-get",
      "install",
      "-y",
      "--no-install-recommends",
      ...missing,
    );
  }
}

async function cpuQuotas() {
  const root = "/sys/fs/cgroup";
  assert.equal((await statfs(root)).type, 0x63677270, "Expected cgroup v2");
  const membership = (await readFile("/proc/self/cgroup", "utf8")).match(
    /^0::(\/.*)$/m,
  )?.[1];
  assert(membership, "Expected a unified CPU cgroup membership");
  const limits = [];
  for (
    let dir = resolve(root, "." + membership);
    dir !== root;
    dir = dirname(dir)
  ) {
    assert(dir.startsWith(root + "/"));
    const limit = await readFile(join(dir, "cpu.max"), "utf8").catch(
      (error) => {
        if (error.code !== "ENOENT") throw error;
        return "";
      },
    );
    if (limit && !limit.startsWith("max ")) limits.push(limit.trim());
  }
  return { membership, limits };
}

async function build(label: string, checkout: string, sha: string) {
  const assets = join(checkout, "capture/desktop/ui/frontend");
  await stage(
    label + "-npm-ci",
    assets,
    "npm",
    "ci",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
  );
  const electronPackage = join(assets, "node_modules/electron");
  if (!(await stat(join(electronPackage, "dist/electron")).catch(() => false)))
    await stage(
      label + "-electron-install",
      assets,
      process.execPath,
      "node_modules/electron/install.js",
    );
  await stage(label + "-frontend-build", assets, "npm", "run", "build");
  assert.equal(output(checkout, "git", "rev-parse", "HEAD"), sha);
  assert.equal(
    output(
      checkout,
      "git",
      "status",
      "--porcelain=v1",
      "--untracked-files=normal",
    ),
    "",
  );
  const runtime = join(electronPackage, "dist");
  return { assets, runtime, sha, label };
}

async function buildReceipt(staged: Awaited<ReturnType<typeof build>>) {
  const { assets, runtime } = staged;
  return {
    revision: staged.sha,
    lockSha256: await digest(join(assets, "package-lock.json")),
    frontendSha256: await treeDigest(join(assets, "dist")),
    electronEntrySupportSha256: await treeDigest(join(assets, "electron")),
    runtimeSha256: await treeDigest(runtime),
  };
}

function runScoped(
  name: "proof" | "calibration" | "matched",
  placement: Awaited<ReturnType<typeof choosePlacement>>,
  entry: string,
  args: string[],
) {
  const runId = process.env.GITHUB_RUN_ID ?? "";
  const attempt = process.env.GITHUB_RUN_ATTEMPT ?? "";
  assert.match(runId, /^\d+$/);
  assert.match(attempt, /^\d+$/);
  const uid = process.getuid?.();
  const gid = process.getgid?.();
  assert(uid && gid !== undefined);
  const scope = `apparent-onboarding-${runId}-${attempt}-${name}.service`;
  return stage(
    name,
    source,
    "sudo",
    "-n",
    "/usr/bin/systemd-run",
    "--quiet",
    "--wait",
    "--pipe",
    "--collect",
    "--expand-environment=no",
    "--service-type=exec",
    "--unit=" + scope,
    "--uid=" + uid,
    "--gid=" + gid,
    "--working-directory=" + source,
    "--property=CPUAccounting=yes",
    "--property=RuntimeMaxSec=9min",
    "--property=AllowedCPUs=" + placement.cpus.join(","),
    ...[
      "PATH",
      "GITHUB_ACTIONS",
      "GITHUB_REPOSITORY",
      "GITHUB_RUN_ID",
      "GITHUB_RUN_ATTEMPT",
      "RUNNER_ENVIRONMENT",
      "ImageVersion",
      "APPARENT_ONBOARDING_HOSTED_COHORT",
    ].map((key) => "--setenv=" + key + "=" + process.env[key]),
    "--setenv=TMPDIR=" + scratch,
    "--setenv=BEND_NO_TELEMETRY=1",
    "--setenv=APPARENT_ONBOARDING_HOSTED_SCOPE=" + scope,
    "--setenv=APPARENT_ONBOARDING_HOSTED_CPUS=" + placement.cpus.join(","),
    "--",
    process.execPath,
    entry,
    ...args,
  );
}

async function proveOutsideCpu(
  placement: Awaited<ReturnType<typeof choosePlacement>>,
) {
  const entry = fileURLToPath(
    new URL("./hosted/injection.ts", import.meta.url),
  );
  const load = spawn(
    "taskset",
    ["-c", placement.cpus.join(","), process.execPath, entry, "inject"],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  const closed = once(load, "close");
  void closed.catch(() => {});
  try {
    const [ready] = await Promise.race([
      once(load.stdout, "data", { signal: AbortSignal.timeout(5000) }),
      closed.then(() => {
        throw Error("Outside CPU injector exited before ready");
      }),
    ]);
    assert.equal(ready.toString().trim(), "ready");
    const [status, membership] = await Promise.all([
      readFile(`/proc/${load.pid}/status`, "utf8"),
      readFile(`/proc/${load.pid}/cgroup`, "utf8"),
    ]);
    assert.deepEqual(allowedCpus(status), placement.cpus);
    assert.match(membership, /^0::\//);
    assert(!membership.includes("apparent-onboarding-"));
    await receipt("injection-placement.json", {
      scored: false,
      cpus: placement.cpus,
      membership: membership.trim(),
    });
    await runScoped("proof", placement, entry, [
      "sample",
      join(evidence, "injection.json"),
    ]);
    await stat(`/proc/${load.pid}/status`);
  } finally {
    load.kill();
    await closed;
  }
}

async function replay(
  name: "calibration" | "matched",
  placement: Awaited<ReturnType<typeof choosePlacement>>,
  args: string[],
) {
  const dir = join(evidence, name);
  await mkdir(dir, { mode: 0o700 });
  await runScoped(name, placement, benchmark, [
    ...args.slice(0, 3),
    dir,
    ...args.slice(3),
  ]);
  return join(name, "benchmark.json");
}

try {
  const [controlSha, candidateSha] = [revision(control), revision(candidate)];
  delete process.env.APPARENT_ONBOARDING_FIXTURE_NO_SANDBOX;
  delete process.env.ELECTRON_SKIP_BINARY_DOWNLOAD;
  const imageVersion = process.env.ImageVersion;
  assert(
    imageVersion && process.env.GITHUB_RUN_ID && process.env.GITHUB_RUN_ATTEMPT,
  );
  const logicalCpus = output(scratch, "lscpu", "-p=CPU,CORE,SOCKET");
  const affinity = (await readFile("/proc/self/status", "utf8")).match(
    /^Cpus_allowed_list:\s+(.*)$/m,
  )?.[1];
  assert(affinity);
  const cpuQuota = await cpuQuotas();
  assert.equal(
    cpuQuota.limits.length,
    0,
    "Runner CPU quota prevents an equivalent scope",
  );
  const cpuModel = (await readFile("/proc/cpuinfo", "utf8")).match(
    /^model name\s+:\s+(.+)$/m,
  )?.[1];
  assert(cpuModel);
  await installPrerequisites();
  await stage(
    "hosted-contention-tests",
    source,
    process.execPath,
    "--test",
    fileURLToPath(new URL("./hosted-contention.test.ts", import.meta.url)),
  );
  const a = await build("control", control, controlSha);
  const b =
    controlSha === candidateSha
      ? a
      : await build("candidate", candidate, candidateSha);
  const aReceipt = await buildReceipt(a);
  const bReceipt = b === a ? aReceipt : await buildReceipt(b);
  await receipt("builds.json", { control: aReceipt, candidate: bReceipt });
  assert.equal(
    aReceipt.runtimeSha256,
    bReceipt.runtimeSha256,
    "Use identical locked Electron runtimes",
  );

  const runtime = join(a.runtime, "electron");
  const helper = join(a.runtime, "chrome-sandbox");
  assert(
    (await lstat(helper)).isFile(),
    "Expected Electron's regular setuid helper",
  );
  await stage("sandbox-owner", scratch, "sudo", "chown", "root:root", helper);
  await stage("sandbox-mode", scratch, "sudo", "chmod", "4755", helper);
  const metadata = await stat(helper);
  assert(
    metadata.uid === 0 &&
      metadata.gid === 0 &&
      (metadata.mode & 0o7777) === 0o4755,
  );
  const placement = await choosePlacement(affinity);
  const cohort = createHash("sha256")
    .update(
      JSON.stringify({
        placement: {
          protocol: placement.protocol,
          cpus: placement.cpus,
          topology: placement.topology,
        },
        imageVersion,
        logicalCpus,
        affinity,
        limits: cpuQuota.limits,
        cpuModel,
      }),
    )
    .digest("hex");
  process.env.APPARENT_ONBOARDING_HOSTED_COHORT = cohort;
  await receipt("hosted-inputs.json", {
    schema: 1,
    mode: "synthetic-electron-click-through",
    controlSha,
    candidateSha,
    collectorSha: output(source, "git", "rev-parse", "HEAD"),
    runId: process.env.GITHUB_RUN_ID,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    imageVersion,
    node: process.version,
    availableParallelism: availableParallelism(),
    topology: JSON.parse(output(scratch, "lscpu", "--json")),
    logicalCpus,
    affinity,
    cpuQuota,
    cpuModel,
    placement,
    cohort,
  });
  await proveOutsideCpu(placement);
  const calibration = await replay("calibration", placement, [
    runtime,
    a.assets,
    controlSha,
  ]);
  const comparison =
    b === a
      ? undefined
      : await replay("matched", placement, [
          runtime,
          a.assets,
          controlSha,
          b.assets,
          candidateSha,
        ]);
  await receipt("hosted-result.json", {
    schema: 1,
    controlSha,
    candidateSha,
    calibration,
    comparison,
    identicalFrontend:
      aReceipt.frontendSha256 === bReceipt.frontendSha256 &&
      aReceipt.electronEntrySupportSha256 ===
        bReceipt.electronEntrySupportSha256,
  });
  console.log(
    JSON.stringify({ controlSha, candidateSha, calibration, comparison }),
  );
} finally {
  await rm(scratch, { recursive: true, force: true });
}
