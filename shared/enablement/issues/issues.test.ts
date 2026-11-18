import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  copyFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { primaryIssue, parseReference, git, repository } from "./reference.ts";
import { validatePush } from "./run.ts";
import { bind } from "./binding.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));
function fixture(t: TestContext) {
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
const number = Number(process.argv.at(-1)!.split('/').at(-1));
appendFileSync(process.env.ISSUE_TEST_LOG!, number + '\\n');
if (process.env.ISSUE_TEST_FAILURE) { console.error('synthetic private token must never escape'); process.exit(1); }
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

test("anchored syntax and final trailer block reject invalid IDs, prose, duplicates and quotes", (t) => {
  const f = fixture(t);
  assert.deepEqual(
    primaryIssue("subject\n\nissue: tryapparent/apparent#123\n", f.repo),
    { repository, number: 123 },
  );
  for (const value of [
    "0",
    "-1",
    "123 junk",
    "123.0",
    "prose",
    "9007199254740992",
  ])
    assert.throws(() => parseReference("Issue: tryapparent/apparent#" + value));
  assert.throws(() => parseReference("Issue: another/repo#1"), /repository/);
  for (const body of [
    "Issue: tryapparent/apparent#1\nIssue: tryapparent/apparent#1",
    "Issue:tryapparent/apparent#1",
    "Issue: tryapparent/apparent#1\n continuation",
    "Explanation\nIssue: tryapparent/apparent#1",
  ])
    assert.throws(() => primaryIssue("subject\n\n" + body, f.repo));
  for (const body of [
    "subject Issue: tryapparent/apparent#1",
    "subject\n\n> Issue: tryapparent/apparent#1",
    "subject\n\nIssue: tryapparent/apparent#1\n\nlast prose",
  ])
    assert.equal(primaryIssue(body, f.repo), undefined);
});

test("prepared hooks autofill actual commits, preserve explicit trailer and custom hooks, enforce cached binding offline", (t) => {
  const f = fixture(t);
  for (const name of [".githooks", "shared/enablement/issues", "old-hooks"])
    mkdirSync(join(f.repo, name), { recursive: true });
  for (const name of ["reference.ts", "binding.ts", "run.ts"])
    copyFileSync(
      join(root, "shared/enablement/issues", name),
      join(f.repo, "shared/enablement/issues", name),
    );
  writeFileSync(join(f.repo, ".githooks/pre-commit"), "#!/bin/sh\nexit 0\n", {
    mode: 0o755,
  });
  for (const name of ["prepare-commit-msg", "commit-msg"])
    writeFileSync(
      join(f.repo, "old-hooks", name),
      "#!/bin/sh\nprintf custom >> .git/message-order\n",
      { mode: 0o755 },
    );
  f.runGit("config", "core.hooksPath", "old-hooks");
  const prepared = join(f.dir, "prepared");
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      join(root, "enablement/hooks/prepare.ts"),
      "--output",
      prepared,
    ],
    { cwd: f.repo, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.runGit("config", "--get", "core.hooksPath"), "old-hooks");
  f.runGit("config", "core.hooksPath", prepared);
  const invoke = (message: string) =>
    spawnSync("git", ["commit", "--allow-empty", "-m", message], {
      cwd: f.repo,
      encoding: "utf8",
    });
  assert.notEqual(invoke("missing binding").status, 0);
  bind({ repository, number: 123 }, f.repo);
  process.env.ISSUE_TEST_FAILURE = "offline";
  assert.equal(invoke("autofill").status, 0);
  assert.match(
    f.runGit("log", "-1", "--format=%B"),
    /Issue: tryapparent\/apparent#123$/,
  );
  const explicit = "explicit\n\nissue: tryapparent/apparent#123";
  assert.equal(invoke(explicit).status, 0);
  assert.equal(f.runGit("log", "-1", "--format=%B"), explicit);
  for (const message of [
    "bad\n\nIssue: tryapparent/apparent#0",
    "wrong\n\nIssue: tryapparent/apparent#124",
    "duplicate\n\nIssue: tryapparent/apparent#123\nIssue: tryapparent/apparent#123",
  ])
    assert.notEqual(invoke(message).status, 0);
  assert.match(
    readFileSync(join(f.repo, ".git/message-order"), "utf8"),
    /customcustom/,
  );
  assert.equal(readFileSync(process.env.ISSUE_TEST_LOG!, "utf8"), "123\n");
});

test("push validates all post-baseline commits across refs, deduplicates issue lookups and ignores deletion refs", (t) => {
  const f = fixture(t);
  const one = f.commit("first\n\nIssue: tryapparent/apparent#12");
  const two = f.commit("second\n\nIssue: tryapparent/apparent#12");
  const three = f.commit("third\n\nIssue: tryapparent/apparent#13");
  validatePush(
    f.ref(one) + f.ref(three, "other") + f.ref("0".repeat(40), "delete"),
    f.repo,
    f.baseline,
  );
  assert.equal(readFileSync(process.env.ISSUE_TEST_LOG!, "utf8"), "12\n13\n");
  f.runGit("checkout", "-q", "-b", "bad", two);
  const missing = f.commit("missing trailer");
  assert.throws(
    () => validatePush(f.ref(missing), f.repo, f.baseline),
    /needs a final Issue/,
  );
  validatePush(f.ref("0".repeat(40)), f.repo, "missing");
  assert.throws(
    () => validatePush(f.ref(three), f.repo, "missing"),
    /Git metadata/,
  );
});

test("accepted merge receipts validate exact identities without exempting other commits", (t) => {
  const f = fixture(t);
  const objects =
    git(root, [
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir",
    ]).trim() + "/objects";
  writeFileSync(join(f.repo, ".git/objects/info/alternates"), objects + "\n");
  for (const [commit, number] of [
    ["6c64c838fab1b70e05da112ffc25336e5c283ab1", "575"],
    ["18c72f8302d54bab24d1729fb75796329a2a0a81", "171"],
    ["f52fab25ee734cb60262387d0c74e8cdfba97d6a", "530"],
  ]) {
    const parents = f.runGit("show", "-s", "--format=%P", commit).split(" ");
    const tree = f.runGit("rev-parse", commit + "^{tree}");
    const cutoff = f.runGit(
      "commit-tree",
      tree,
      ...parents.flatMap((p) => ["-p", p]),
      "-m",
      "synthetic cutoff",
    );
    writeFileSync(process.env.ISSUE_TEST_LOG!, "");
    validatePush(f.ref(commit), f.repo, cutoff);
    assert.equal(
      readFileSync(process.env.ISSUE_TEST_LOG!, "utf8"),
      number + "\n",
    );
    process.env.ISSUE_TEST_FAILURE = "offline";
    assert.throws(
      () => validatePush(f.ref(commit), f.repo, cutoff),
      /Cannot validate/,
    );
    delete process.env.ISSUE_TEST_FAILURE;
    const copied = f.commit(f.runGit("show", "-s", "--format=%B", commit));
    assert.throws(
      () => validatePush(f.ref(copied), f.repo, f.baseline),
      /needs a final Issue/,
    );
  }
});

test("API mismatch, PR and authentication/not-found/offline failures reject without exposing stderr", (t) => {
  const f = fixture(t),
    issue = { repository, number: 12 };
  for (const [name, value] of [
    ["ISSUE_TEST_PR", "yes"],
    ["ISSUE_TEST_REPO", "other/repo"],
    ["ISSUE_TEST_FAILURE", "404"],
    ["ISSUE_TEST_FAILURE", "auth"],
    ["ISSUE_TEST_FAILURE", "offline"],
  ]) {
    process.env[name] = value;
    assert.throws(
      () => bind(issue, f.repo),
      (error) => !String(error).includes("private token"),
    );
    delete process.env[name];
  }
  const commit = f.commit("valid syntax\n\nIssue: tryapparent/apparent#12");
  process.env.ISSUE_TEST_PR = "yes";
  assert.throws(
    () => validatePush(f.ref(commit), f.repo, f.baseline),
    /pull requests/,
  );
});

test("real Git push checks issues before verification and preserves HEAD and deletion contracts", (t) => {
  const f = fixture(t);
  for (const name of ["reference.ts", "binding.ts", "run.ts"]) {
    mkdirSync(join(f.repo, "shared/enablement/issues"), { recursive: true });
    copyFileSync(
      join(root, "shared/enablement/issues", name),
      join(f.repo, "shared/enablement/issues", name),
    );
  }
  mkdirSync(join(f.repo, "enablement/local-tests"), { recursive: true });
  writeFileSync(
    join(f.repo, "enablement/local-tests/run.ts"),
    "import {appendFileSync} from 'node:fs'; appendFileSync('.git/verification','ran\\n');\n",
  );
  mkdirSync(join(f.repo, "enablement/timing"), { recursive: true });
  copyFileSync(
    join(root, "enablement/timing/command.ts"),
    join(f.repo, "enablement/timing/command.ts"),
  );
  process.env.APPARENT_TIMING_FILE = join(f.dir, "timing.jsonl");
  const objects =
    git(root, [
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir",
    ]).trim() + "/objects";
  writeFileSync(join(f.repo, ".git/objects/info/alternates"), objects + "\n");
  f.runGit("add", ".");
  const tree = f.runGit("write-tree");
  const head = f.runGit(
    "commit-tree",
    tree,
    "-p",
    "d559dbbd2a3fbf9428593931b526e13b626c8ab9",
    "-m",
    "fixture\n\nIssue: tryapparent/apparent#12",
  );
  f.runGit("update-ref", "HEAD", head);
  f.runGit("update-ref", "refs/remotes/origin/main", head);
  copyFileSync(
    join(root, ".githooks/pre-push"),
    join(f.repo, ".git/hooks/pre-push"),
  );
  const remote = join(f.dir, "remote.git");
  f.runGit("init", "--bare", "-q", remote);
  git(remote, ["config", "receive.autogc", "false"]);
  git(remote, ["config", "gc.auto", "0"]);
  git(remote, ["config", "maintenance.auto", "false"]);
  f.runGit("remote", "add", "origin", remote);
  const push = (...args: string[]) =>
    spawnSync("git", ["push", "origin", ...args], {
      cwd: f.repo,
      encoding: "utf8",
    });
  process.env.ISSUE_TEST_FAILURE = "offline";
  const rejected = push("HEAD:refs/heads/first");
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /Cannot validate/);
  assert.throws(() => readFileSync(join(f.repo, ".git/verification")));
  delete process.env.ISSUE_TEST_FAILURE;
  assert.equal(
    push("HEAD:refs/heads/first", "HEAD:refs/heads/second").status,
    0,
  );
  assert.equal(
    readFileSync(join(f.repo, ".git/verification"), "utf8"),
    "ran\n",
  );
  assert.equal(readFileSync(process.env.ISSUE_TEST_LOG!, "utf8"), "12\n12\n");
  assert.equal(push(":refs/heads/second").status, 0);
  assert.equal(readFileSync(process.env.ISSUE_TEST_LOG!, "utf8"), "12\n12\n");
  const timings = readFileSync(process.env.APPARENT_TIMING_FILE!, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.ok(
    timings.some(
      (row) =>
        row.label === "push-admission" &&
        row.sha === head &&
        row.state === "finished" &&
        row.code === 0,
    ),
  );
  assert.ok(timings.some((row) => row.state === "finished" && row.code === 1));
  f.commit("next\n\nIssue: tryapparent/apparent#12");
  assert.match(
    push(head + ":refs/heads/older").stderr,
    /not the checked-out HEAD/,
  );
});

test("binding stays in each worktree's private administrative metadata", (t) => {
  const f = fixture(t);
  const other = join(f.dir, "other");
  f.runGit("worktree", "add", "-q", "-b", "t3/synthetic-other", other);
  const config = readFileSync(join(f.repo, ".git/config"));
  const index = readFileSync(join(f.repo, ".git/index"));
  const branch = f.runGit("symbolic-ref", "HEAD");
  bind({ repository, number: 12 }, f.repo);
  bind({ repository, number: 13 }, other);
  assert.equal(
    JSON.parse(readFileSync(join(f.repo, ".git/apparent-issue.json"), "utf8"))
      .number,
    12,
  );
  const otherGit = git(other, ["rev-parse", "--absolute-git-dir"]).trim();
  assert.equal(
    JSON.parse(readFileSync(join(otherGit, "apparent-issue.json"), "utf8"))
      .number,
    13,
  );
  assert.deepEqual(readFileSync(join(f.repo, ".git/config")), config);
  assert.deepEqual(readFileSync(join(f.repo, ".git/index")), index);
  assert.equal(f.runGit("symbolic-ref", "HEAD"), branch);
});
