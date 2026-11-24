import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  createReadStream,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { availableParallelism } from "node:os";
import { isAbsolute, join, relative } from "node:path";

export function command(
  program: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    capture?: boolean;
  } = {},
) {
  const result = spawnSync(program, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "inherit"] : "inherit",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  assert.equal(
    result.status,
    0,
    program + " failed with " + (result.signal ?? result.status),
  );
  return result.stdout?.trim() ?? "";
}

export function json(path: string) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function receipt(path: string, value: unknown) {
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
}

export async function sha256(path: string) {
  const digest = createHash("sha256");
  for await (const bytes of createReadStream(path)) digest.update(bytes);
  return digest.digest("hex");
}

export function openJob(lane: string, args = process.argv.slice(2)) {
  assert.equal(
    args.length,
    3,
    "Expected CONTROL_CHECKOUT CANDIDATE_CHECKOUT EVIDENCE_DIR",
  );
  assert.ok(args.every(isAbsolute));
  assert.equal(process.env.RUNNER_ENVIRONMENT, "github-hosted");
  assert.equal(process.env.GITHUB_REPOSITORY, "tryapparent/apparent");
  assert.equal(process.platform, "linux");
  assert.equal(process.arch, "x64");
  assert.equal(process.version, "v22.23.0");
  assert.match(
    readFileSync("/etc/os-release", "utf8"),
    /^VERSION_ID="24\.04"$/m,
  );
  const [control, candidate, evidence] = args.map((path) => realpathSync(path));
  const revision = (path: string) =>
    command("git", ["-C", path, "rev-parse", "HEAD"], { capture: true });
  const revisions = {
    control: revision(control),
    candidate: revision(candidate),
  };
  assert.ok(
    Object.values(revisions).every((sha) => /^[a-f0-9]{40}$/.test(sha)),
  );
  const temp = realpathSync(process.env.RUNNER_TEMP ?? "/tmp");
  const scratch = mkdtempSync(join(temp, "apparent-dev-record-" + lane + "-"));
  const within = relative(evidence, scratch);
  assert.ok(
    within === ".." || within.startsWith("../"),
    "Build scratch must be outside evidence",
  );
  const home = join(scratch, "home");
  mkdirSync(home, { mode: 0o700 });
  const env = {
    PATH: process.env.PATH,
    HOME: home,
    TMPDIR: scratch,
    CI: "true",
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
  };
  receipt(join(evidence, "record-inputs.json"), {
    lane,
    revisions,
    calibrationOnly: revisions.control === revisions.candidate,
  });
  return {
    control,
    candidate,
    evidence,
    scratch,
    env,
    revisions,
    calibrationOnly: revisions.control === revisions.candidate,
  };
}
export type HostedJob = ReturnType<typeof openJob>;

export function stageRevision(
  checkout: string,
  revision: string,
  job: HostedJob,
  name: string,
) {
  const destination = join(job.scratch, name);
  const tar = destination + ".tar";
  mkdirSync(destination, { mode: 0o700 });
  command(
    "git",
    ["-C", checkout, "archive", "--format=tar", "--output", tar, revision],
    { env: job.env },
  );
  command("tar", ["-xf", tar, "-C", destination], { env: job.env });
  rmSync(tar);
  return destination;
}

export function apt(...packages: string[]) {
  command("sudo", ["-n", "apt-get", "update"]);
  command("sudo", [
    "-n",
    "apt-get",
    "install",
    "-y",
    "--no-install-recommends",
    ...packages,
  ]);
}

type CpuSample = { total: number; steal: number };

export function parseCpu(line: string): CpuSample {
  assert.match(line, /^cpu\s+/);
  const values = line.trim().split(/\s+/).slice(1, 9).map(Number);
  assert.equal(values.length, 8);
  assert.ok(values.every((value) => Number.isSafeInteger(value) && value >= 0));
  return {
    total: values.reduce((sum, value) => sum + value, 0),
    steal: values[7],
  };
}

export function cpuSample() {
  return parseCpu(readFileSync("/proc/stat", "utf8").split("\n")[0]);
}

export function stealSince(before: CpuSample, after: CpuSample) {
  const elapsed = after.total - before.total;
  const stolen = after.steal - before.steal;
  assert.ok(
    elapsed > 0 && stolen >= 0 && stolen <= elapsed,
    "Invalid runner steal counters",
  );
  return (100 * stolen) / elapsed;
}

export function hostCounters() {
  const online = readFileSync("/sys/devices/system/cpu/online", "utf8").trim();
  const cpus = online.split(",").flatMap((range) => {
    const [start, end = start] = range.split("-").map(Number);
    assert.ok(
      Number.isSafeInteger(start) && Number.isSafeInteger(end) && start <= end,
    );
    return Array.from({ length: end - start + 1 }, (_, index) => start + index);
  });
  return {
    online,
    availableParallelism: availableParallelism(),
    topology: cpus.map((cpu) => ({
      cpu,
      siblings: readFileSync(
        "/sys/devices/system/cpu/cpu" + cpu + "/topology/thread_siblings_list",
        "utf8",
      ).trim(),
    })),
    pressure: {
      cpu: readFileSync("/proc/pressure/cpu", "utf8"),
      io: readFileSync("/proc/pressure/io", "utf8"),
    },
    ticks: cpuSample(),
  };
}
