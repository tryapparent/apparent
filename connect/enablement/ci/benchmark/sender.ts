import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const control = process.env.CONNECT_CONTROL;
const temporary = process.env.RUNNER_TEMP;
assert.ok(
  control && /^[0-9a-f]{40}$/.test(control),
  "Expected full main control SHA",
);
assert.ok(temporary && isAbsolute(temporary));
assert.equal(process.env.GITHUB_REPOSITORY, "tryapparent/apparent");
assert.equal(process.env.GITHUB_EVENT_NAME, "workflow_dispatch");
assert.equal(process.env.RUNNER_ENVIRONMENT, "github-hosted");
assert.match(readFileSync("/etc/os-release", "utf8"), /^VERSION_ID="24\.04"$/m);
const candidate = process.env.GITHUB_SHA;
const git = (...args: string[]) =>
  execFileSync("git", args, { encoding: "utf8" }).trim();
assert.equal(candidate, git("rev-parse", "HEAD"));
git("merge-base", "--is-ancestor", control, "refs/remotes/origin/main");
git("merge-base", "--is-ancestor", control, candidate!);
git(
  "diff",
  "--exit-code",
  control,
  candidate!,
  "--",
  "connect/client/Cargo.toml",
  "connect/client/Cargo.lock",
  "connect/client/typescript",
  "connect/service",
  "shared/assets",
  "shared/ui",
);
const evidence = join(temporary, "connect-native-sender-evidence");
mkdirSync(evidence, { mode: 0o700 });
const pinned = join(
  mkdtempSync(join(temporary, "connect-native-control-")),
  "checkout",
);
git("worktree", "add", "--detach", pinned, control);
execFileSync(
  process.execPath,
  [
    fileURLToPath(new URL("../../benchmark/hosted.ts", import.meta.url)),
    pinned,
    git("rev-parse", "--show-toplevel"),
    evidence,
    "native-sender",
  ],
  { stdio: "inherit" },
);
