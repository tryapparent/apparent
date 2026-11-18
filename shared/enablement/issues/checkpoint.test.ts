import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { fixture } from "./fixture.ts";
import { validatePush } from "./run.ts";

test("push checks all trailers and validates newly introduced issue identities across branches once", (t) => {
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
  assert.deepEqual(requests.sort(), ["12", "13", "14"]);
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
  process.env.ISSUE_TEST_MAIN = bad;
  assert.throws(
    () => validatePush(f.ref(bad), f.repo, f.baseline, bad),
    /needs a final Issue/,
  );
});
