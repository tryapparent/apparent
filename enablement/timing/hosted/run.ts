import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import routes from "./routes.json" with { type: "json" };

const {
  GITHUB_ACTIONS,
  GITHUB_EVENT_NAME,
  GITHUB_REF,
  GITHUB_REPOSITORY,
  RUNNER_ARCH,
  RUNNER_ENVIRONMENT,
  RUNNER_OS,
  RUNNER_TEMP,
  PERFORMANCE_STREAM,
  PERFORMANCE_CONTROL,
  PERFORMANCE_CANDIDATE,
} = process.env;

assert.ok(
  GITHUB_ACTIONS === "true" &&
    GITHUB_EVENT_NAME === "workflow_dispatch" &&
    GITHUB_REPOSITORY === "tryapparent/apparent" &&
    GITHUB_REF === "refs/heads/main" &&
    RUNNER_ENVIRONMENT === "github-hosted" &&
    RUNNER_OS === "Linux" &&
    RUNNER_ARCH === "X64",
  "Run this gateway by manual dispatch on tryapparent/apparent main",
);
assert.ok(RUNNER_TEMP && isAbsolute(RUNNER_TEMP));
const evidence = join(RUNNER_TEMP, "performance-evidence");
mkdirSync(evidence, { mode: 0o700 });
assert.match(readFileSync("/etc/os-release", "utf8"), /^VERSION_ID="24\.04"$/m);
assert.equal(process.versions.node, "22.23.0");
assert.ok(
  PERFORMANCE_STREAM && Object.hasOwn(routes, PERFORMANCE_STREAM),
  "Unregistered stream",
);
const entry = routes[PERFORMANCE_STREAM as keyof typeof routes];
const sha = /^[0-9a-f]{40}$/;
assert.ok(
  PERFORMANCE_CONTROL && sha.test(PERFORMANCE_CONTROL),
  "Control must be a full SHA",
);
assert.ok(
  PERFORMANCE_CANDIDATE && sha.test(PERFORMANCE_CANDIDATE),
  "Candidate must be a full SHA",
);
const git = (...args: string[]) =>
  execFileSync("git", args, { encoding: "utf8" }).trim();
const control = PERFORMANCE_CONTROL;
const candidate = PERFORMANCE_CANDIDATE;
assert.equal(git("rev-parse", control + "^{commit}"), control);
assert.equal(git("rev-parse", candidate + "^{commit}"), candidate);
git("merge-base", "--is-ancestor", control, "refs/remotes/origin/main");
assert.ok(
  git(
    "for-each-ref",
    "--format=%(refname)",
    "--contains",
    candidate,
    "refs/remotes/origin",
  ),
  "Candidate must belong to a published branch in the canonical repository",
);
function sample() {
  return {
    stat: readFileSync("/proc/stat", "utf8")
      .split("\n")
      .filter((line) => /^cpu\d*\s/.test(line)),
    cpuPressure: readFileSync("/proc/pressure/cpu", "utf8"),
    ioPressure: readFileSync("/proc/pressure/io", "utf8"),
  };
}
const manifest = {
  stream: PERFORMANCE_STREAM,
  entry,
  control,
  candidate,
  workflowSha: git("rev-parse", "HEAD"),
  run: process.env.GITHUB_RUN_ID,
  attempt: process.env.GITHUB_RUN_ATTEMPT,
  runnerImage: process.env.ImageVersion,
  node: process.versions.node,
  topology: JSON.parse(execFileSync("lscpu", ["--json"], { encoding: "utf8" })),
  cpuMap: execFileSync("lscpu", ["--parse=CPU,CORE,SOCKET,ONLINE"], {
    encoding: "utf8",
  }),
  before: sample(),
};
const receipt = join(evidence, "gateway.json");
writeFileSync(receipt, JSON.stringify(manifest, null, 2) + "\n");
const work = mkdtempSync(join(RUNNER_TEMP, "performance-builds-"));
const a = join(work, "control");
const b = candidate === control ? a : join(work, "candidate");
git("worktree", "add", "--detach", a, control);
if (b !== a) git("worktree", "add", "--detach", b, candidate);
try {
  execFileSync(process.execPath, [entry, a, b, evidence], { stdio: "inherit" });
} finally {
  writeFileSync(
    receipt,
    JSON.stringify({ ...manifest, after: sample() }, null, 2) + "\n",
  );
}
