import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanupClosedBranch } from "./closed-pr.ts";

const sha = "a".repeat(40);
const head = { ref: "fix/example", sha, repo: { id: 1 } };
const closed = {
  number: 42,
  state: "closed",
  merged: false,
  labels: [],
  head,
  base: { ref: "main" },
};
const event = {
  action: "closed",
  repository: {
    id: 1,
    full_name: "tryapparent/apparent",
    default_branch: "main",
  },
  pull_request: closed,
};
const branch = `refs/heads/${head.ref}`;
const pullRef = "refs/pull/42/head";

function run({
  current = closed,
  open = [[]],
  branchTip = sha,
  recoveryTip = sha,
  protectedBranch = false,
}: {
  current?: Parameters<typeof cleanupClosedBranch>[0]["pull_request"];
  open?: unknown[][];
  branchTip?: string;
  recoveryTip?: string;
  protectedBranch?: boolean;
} = {}) {
  const pushes: string[][] = [];
  const result = cleanupClosedBranch(event, (program, args) => {
    if (program === "gh") {
      const path = args.at(-1);
      if (path === "repos/tryapparent/apparent/pulls/42")
        return JSON.stringify(current);
      if (path === "repos/tryapparent/apparent/branches/fix%2Fexample")
        return JSON.stringify({ protected: protectedBranch });
      assert.deepEqual(args, [
        "api",
        "--paginate",
        "--slurp",
        "repos/tryapparent/apparent/pulls?state=open&per_page=100",
      ]);
      return JSON.stringify(open);
    }
    assert.equal(program, "git");
    if (args[0] === "ls-remote") {
      assert.deepEqual(args, [
        "ls-remote",
        "--refs",
        "origin",
        branch,
        pullRef,
      ]);
      return `${branchTip}\t${branch}\n${recoveryTip}\t${pullRef}\n`;
    }
    pushes.push(args.slice(4));
    return "";
  });
  return { result, pushes };
}

test("deletes a closed PR branch with a lease on its recoverable commit", () => {
  const { result, pushes } = run({
    open: [[{ ...closed, head: { ...head, repo: { id: 2 } } }]],
  });
  assert.match(result, /^Deleted/);
  assert.deepEqual(pushes, [
    ["push", `--force-with-lease=${branch}:${sha}`, "origin", `:${branch}`],
  ]);
});

test("skips merged PRs, forks, and reserved branches without issuing commands", () => {
  for (const pr of [
    { ...closed, merged: true },
    { ...closed, head: { ...head, repo: { id: 2 } } },
    { ...closed, head: { ...head, repo: null } },
    ...[
      "main",
      "preview/demo",
      "release/example",
      "migration/reference",
      "preview-mac-feed",
      "t3/onboarding-mac-release-baseline",
    ].map((ref) => ({ ...closed, head: { ...head, ref } })),
  ]) {
    cleanupClosedBranch({ ...event, pull_request: pr }, () =>
      assert.fail("Unexpected command"),
    );
  }
});

test("keeps reopened, protected, advanced, unrecoverable, opted-out, and shared branches", () => {
  for (const options of [
    { current: { ...closed, state: "open" } },
    { current: { ...closed, labels: [{ name: "keep-branch" }] } },
    { protectedBranch: true },
    { branchTip: "b".repeat(40) },
    { recoveryTip: "b".repeat(40) },
    { open: [[], [closed]] },
    {
      open: [
        [
          {
            ...closed,
            base: { ref: head.ref },
            head: { ...head, ref: "fix/child" },
          },
        ],
      ],
    },
  ]) {
    assert.deepEqual(run(options).pushes, []);
  }
});
