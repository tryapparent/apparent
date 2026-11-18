import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { fixture } from "./fixture.ts";
import { validatePush } from "./run.ts";

test("push looks up each issue outside canonical main once across branches", (t) => {
  const f = fixture(t);
  const checkpoint = f.commit(
    "accepted main\n\nIssue: tryapparent/apparent#11",
  );
  const newerMain = f.commit("newer main\n\nIssue: tryapparent/apparent#14");
  process.env.ISSUE_TEST_MAIN = newerMain;
  validatePush(f.ref(checkpoint), f.repo, f.baseline, checkpoint);
  assert.equal(readFileSync(process.env.ISSUE_TEST_LOG!, "utf8"), "main\n");
  writeFileSync(process.env.ISSUE_TEST_LOG!, "");
  f.runGit("checkout", "-qb", "feature", checkpoint);
  const one = f.commit("first\n\nIssue: tryapparent/apparent#12");
  const two = f.commit("second\n\nIssue: tryapparent/apparent#12");
  const three = f.commit("third\n\nIssue: tryapparent/apparent#13");
  validatePush(
    f.ref(one) +
      f.ref(three, "other") +
      f.ref(newerMain, "more") +
      f.ref("0".repeat(40), "delete"),
    f.repo,
    f.baseline,
    checkpoint,
  );
  const requests = readFileSync(process.env.ISSUE_TEST_LOG!, "utf8")
    .trim()
    .split("\n");
  assert.equal(requests.shift(), "main");
  assert.deepEqual(requests.sort(), ["12", "13"]);
  f.runGit("checkout", "-q", "-b", "bad", two);
  const missing = f.commit("missing trailer");
  assert.throws(
    () => validatePush(f.ref(missing), f.repo, f.baseline, checkpoint),
    /needs a final Issue/,
  );
  validatePush(f.ref("0".repeat(40)), f.repo, "missing");
  assert.throws(
    () => validatePush(f.ref(three), f.repo, "missing"),
    /Git metadata/,
  );
});

test("main authentication fails closed and divergent history cannot borrow a local or advertised checkpoint", (t) => {
  const f = fixture(t);
  const checkpoint = f.commit("accepted\n\nIssue: tryapparent/apparent#12");
  f.runGit("checkout", "-qb", "diverged", f.baseline);
  const diverged = f.commit(
    "different history\n\nIssue: tryapparent/apparent#13",
  );
  f.runGit("update-ref", "refs/remotes/origin/main", diverged);
  const push = (cutoff = checkpoint) =>
    validatePush(
      f.ref(diverged).replace(/0{40}/, diverged),
      f.repo,
      f.baseline,
      cutoff,
    );
  process.env.ISSUE_TEST_MAIN = checkpoint;
  push();
  assert.equal(readFileSync(process.env.ISSUE_TEST_LOG!, "utf8"), "main\n13\n");
  for (const main of ["f".repeat(40), f.baseline, diverged]) {
    process.env.ISSUE_TEST_MAIN = main;
    assert.throws(
      () => push(),
      /Cannot establish the accepted issue checkpoint/,
    );
  }
  f.runGit("replace", "--graft", diverged, checkpoint);
  assert.throws(() => push(), /Cannot establish the accepted issue checkpoint/);
  process.env.ISSUE_TEST_MAIN = checkpoint;
  assert.throws(() => push("f".repeat(40)), /Cannot establish/);
  for (const [name, value, error] of [
    ["ISSUE_TEST_REF", "refs/heads/feature", /canonical main commit/],
    ["ISSUE_TEST_REPO", "fork/apparent", /canonical main commit/],
    ["ISSUE_TEST_FAILURE", "offline", /Cannot validate .* main/],
  ] as const) {
    process.env[name] = value;
    assert.throws(() => push(), error);
    delete process.env[name];
  }
  const bad = f.commit("no trailer");
  f.runGit("update-ref", "refs/remotes/origin/main", bad);
  assert.throws(
    () =>
      validatePush(
        f.ref(bad).replace(/0{40}/, bad),
        f.repo,
        f.baseline,
        checkpoint,
      ),
    /needs a final Issue/,
  );
});

test("push fetches only the authenticated main SHA when local objects are missing", (t) => {
  const f = fixture(t);
  const checkpoint = f.commit("accepted\n\nIssue: tryapparent/apparent#12");
  const publisher = join(f.dir, "publisher");
  const url = pathToFileURL(publisher).href;
  f.runGit("clone", "-q", f.repo, publisher);
  const remote = (...args: string[]) => f.runGit("-C", publisher, ...args);
  remote("config", "user.name", "Publisher");
  remote("config", "user.email", "publisher@example.invalid");
  remote("switch", "-qC", "main");
  const publish = (message: string) => {
    remote("commit", "-qm", message, "--allow-empty");
    return remote("rev-parse", "HEAD");
  };
  const candidate = f.commit("feature\n\nIssue: tryapparent/apparent#13");
  f.runGit("update-ref", "refs/remotes/origin/main", candidate);
  f.runGit("config", "fetch.prune", "true");
  const fetchHead = join(f.repo, ".git", "FETCH_HEAD");
  const log = join(f.dir, "fetch.log");
  writeFileSync(fetchHead, "prior fetch\n");
  writeFileSync(log, "");
  const git = execFileSync("sh", ["-c", "command -v git"], {
    encoding: "utf8",
  }).trim();
  writeFileSync(
    join(f.dir, "bin", "git"),
    `#!/bin/sh
set -eu
canonical=https://github.com/tryapparent/apparent.git
if [ "$1" = -c ] && [ "$2" = "http.$canonical.followRedirects=false" ]; then
  test -z "\${GIT_SSL_NO_VERIFY+x}"
  test "$3 $4" = "-c http.$canonical.sslVerify=true"
  test "$5" = fetch
  shift 5
  test "$1 $2 $3 $4 $5 $6 $7 $8" = "--no-tags --no-prune --no-prune-tags --refmap= --no-recurse-submodules --no-write-fetch-head --no-auto-maintenance --no-write-commit-graph"
  shift 8
  repair=
  if [ "$1" = --refetch ]; then repair="$1 "; shift; fi
  test "$1" = "$canonical"
  printf '%s%s\\n' "$repair" "$2" >> '${log}'
  test "$#" = 2
  exec '${git}' fetch --no-tags --no-prune --no-prune-tags --refmap= --no-recurse-submodules --no-write-fetch-head --no-auto-maintenance --no-write-commit-graph \${repair:+--refetch} '${url}' "$2"
fi
exec '${git}' "$@"
`,
    { mode: 0o700 },
  );
  const push = () =>
    validatePush(f.ref(candidate), f.repo, f.baseline, checkpoint);
  process.env.GIT_SSL_NO_VERIFY = "1";
  const refs = f.runGit("show-ref");
  const index = readFileSync(join(f.repo, ".git", "index"));
  const main = publish("first advance");
  process.env.ISSUE_TEST_MAIN = main;
  publish("advance again after API resolution");
  assert.throws(() => f.runGit("cat-file", "-t", main), /Git metadata/);
  push();
  assert.equal(f.runGit("cat-file", "-t", main), "commit");
  assert.equal(readFileSync(log, "utf8"), main + "\n");
  assert.equal(readFileSync(process.env.ISSUE_TEST_LOG!, "utf8"), "main\n13\n");

  publish("missing parent");
  const tip = publish("known tip with missing parent");
  const object = join(tip.slice(0, 2), tip.slice(2));
  const objects = join(f.repo, ".git", "objects");
  mkdirSync(join(objects, tip.slice(0, 2)), { recursive: true });
  copyFileSync(
    join(publisher, ".git", "objects", object),
    join(objects, object),
  );
  process.env.ISSUE_TEST_MAIN = tip;
  push();
  let fetches = `${main}\n--refetch ${tip}\n`;
  assert.equal(readFileSync(log, "utf8"), fetches);

  const inaccessible = "f".repeat(40);
  process.env.ISSUE_TEST_MAIN = inaccessible;
  f.runGit(
    "config",
    `url.${url}.insteadOf`,
    "https://github.com/tryapparent/apparent.git",
  );
  assert.throws(push, /Canonical GitHub URL is rewritten/);
  assert.equal(readFileSync(log, "utf8"), fetches);
  f.runGit("config", "--unset", `url.${url}.insteadOf`);
  assert.throws(push, /Cannot establish the accepted issue checkpoint/);
  fetches += inaccessible + "\n";

  remote("switch", "-qC", "main", f.baseline);
  process.env.ISSUE_TEST_MAIN = publish("main no longer contains checkpoint");
  assert.throws(push, /Expected exact commit ancestry/);
  fetches += process.env.ISSUE_TEST_MAIN + "\n";
  assert.throws(push, /Expected exact commit ancestry/);
  assert.equal(readFileSync(log, "utf8"), fetches);
  assert.equal(readFileSync(fetchHead, "utf8"), "prior fetch\n");
  assert.equal(f.runGit("show-ref"), refs);
  assert.equal(f.runGit("rev-parse", "HEAD"), candidate);
  assert.deepEqual(readFileSync(join(f.repo, ".git", "index")), index);
  writeFileSync(join(f.repo, ".git", "shallow"), checkpoint + "\n");
  assert.throws(push, /needs complete history/);
  assert.equal(readFileSync(log, "utf8"), fetches);
});
