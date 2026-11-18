import type { TestContext } from "node:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { git } from "./reference.ts";

export function fixture(t: TestContext) {
  const dir = mkdtempSync("/tmp/apparent-dev-issues-"),
    repo = join(dir, "repo");
  mkdirSync(repo);
  mkdirSync(join(dir, "bin"));
  const old = { ...process.env };
  for (const name of Object.keys(process.env))
    if (name.startsWith("GIT_") || name === "NODE_TEST_CONTEXT")
      delete process.env[name];
  process.env.GIT_CONFIG_GLOBAL = "/dev/null";
  process.env.GIT_CONFIG_NOSYSTEM = "1";
  process.env.PATH = join(dir, "bin") + ":" + process.env.PATH;
  process.env.ISSUE_TEST_LOG = join(dir, "gh.log");
  t.after(() => {
    process.env = old;
    rmSync(dir, { recursive: true, force: true });
  });
  writeFileSync(
    join(dir, "gh.ts"),
    `import {appendFileSync} from 'node:fs';
const route = process.argv.at(-1)!;
const number = Number(route.split('/').at(-1));
const isMain = route.endsWith('/git/ref/heads/main');
const isCommit = route.includes('/commits/');
appendFileSync(process.env.ISSUE_TEST_LOG!, (isMain ? 'main' : isCommit ? 'commit' : number) + '\\n');
if (process.env.ISSUE_TEST_FAILURE || (!isMain && process.env.ISSUE_TEST_ISSUE_FAILURE)) {
  console.error('synthetic private token must never escape');
  process.exit(1);
}
if (isMain) {
  console.log(JSON.stringify({
    ref: process.env.ISSUE_TEST_REF || 'refs/heads/main',
    url: 'https://api.github.com/repos/' + (process.env.ISSUE_TEST_REPO || 'tryapparent/apparent') + '/git/refs/heads/main',
    object: {type:'commit', sha:process.env.ISSUE_TEST_MAIN},
  }));
  process.exit(0);
}
if (isCommit) {
  console.log(process.env.ISSUE_TEST_COMMIT || '{}');
  process.exit(0);
}
console.log(JSON.stringify({id: 1000 + number, number, repository_url: 'https://api.github.com/repos/tryapparent/apparent',
url: 'https://api.github.com/repos/' + (process.env.ISSUE_TEST_REPO || 'tryapparent/apparent') + '/issues/' + number,
...(process.env.ISSUE_TEST_PR ? {pull_request: {}} : {})}));\n`,
  );
  writeFileSync(
    join(dir, "bin/gh"),
    `#!/bin/sh\nexec '${process.execPath}' --experimental-strip-types '${join(dir, "gh.ts")}' "$@"\n`,
    { mode: 0o755 },
  );
  const runGit = (...args: string[]) => git(repo, args).trim();
  runGit("init", "-q");
  runGit("config", "gc.auto", "0");
  runGit("config", "maintenance.auto", "false");
  runGit("config", "user.name", "Synthetic");
  runGit("config", "user.email", "synthetic@example.invalid");
  writeFileSync(join(repo, "file"), "base");
  runGit("add", ".");
  runGit("commit", "-qm", "prepolicy base");
  const baseline = runGit("rev-parse", "HEAD");
  process.env.ISSUE_TEST_MAIN = baseline;
  const commit = (message: string) => {
    writeFileSync(join(repo, "file"), message);
    runGit("add", ".");
    runGit("commit", "-qm", message);
    return runGit("rev-parse", "HEAD");
  };
  const ref = (head: string, remote = "feature") =>
    `refs/heads/feature ${head} refs/heads/${remote} ${"0".repeat(40)}\n`;
  return { repo, dir, runGit, baseline, commit, ref };
}
