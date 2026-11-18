import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import {
  baseline,
  acceptedMain,
  git,
  runGit,
  primaryIssue,
  parseReference,
  reference,
  acceptedMergeIssue,
  isAcceptedReleaseCommit,
} from "./reference.ts";
import {
  bind,
  boundIssue,
  canonicalMain,
  fetchCanonicalMain,
  instructions,
  isGitHubMerge,
  verifyIssue,
} from "./binding.ts";

export function prepareMessage(file: string, cwd: string): void {
  const message = readFileSync(file, "utf8");
  if (primaryIssue(message, cwd)) return;
  const issue = boundIssue(cwd);
  const updated = git(
    cwd,
    ["interpret-trailers", "--trailer", `Issue: ${reference(issue)}`],
    message,
  );
  writeFileSync(file, updated);
}

export function validateMessage(file: string, cwd: string): void {
  const issue = primaryIssue(readFileSync(file, "utf8"), cwd);
  if (!issue) throw Error(`Missing final Issue trailer. ${instructions}`);
  const bound = boundIssue(cwd);
  if (reference(issue) !== reference(bound))
    throw Error(
      `Issue trailer differs from API-validated worktree binding ${reference(bound)}. ${instructions}`,
    );
}

function checkpointStatus(
  cwd: string,
  grandfather: string,
  checkpoint: string,
  main: string,
) {
  for (const sha of [checkpoint, main]) {
    const result = runGit(cwd, ["cat-file", "-t", sha]);
    if (result.status !== 0) return result.status;
    if (result.stdout.trim() !== "commit") return 1;
  }
  for (const [ancestor, descendant] of [
    [grandfather, checkpoint],
    [checkpoint, main],
  ]) {
    const { status, stderr } = runGit(cwd, [
      "merge-base",
      "--is-ancestor",
      ancestor,
      descendant,
    ]);
    if (status !== 0) return status === 1 && stderr ? 128 : status;
  }
  return 0;
}

export function validatePush(
  input: string,
  cwd: string,
  grandfather = baseline,
  checkpoint = acceptedMain,
): void {
  const rows = input
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => line.trim().split(/\s+/));
  if (
    rows.some(
      (row) =>
        row.length !== 4 ||
        !/^[a-f0-9]{40}$/.test(row[1]) ||
        !/^[a-f0-9]{40}$/.test(row[3]),
    )
  )
    throw Error("Malformed pre-push ref input");
  const heads = [
    ...new Set(rows.filter((row) => !/^0+$/.test(row[1])).map((row) => row[1])),
  ];
  if (!heads.length) return;
  git(cwd, ["rev-parse", "--verify", grandfather + "^{commit}"]);
  if (git(cwd, ["rev-parse", "--is-shallow-repository"]).trim() !== "false")
    throw Error(
      "Issue traceability needs complete history through the fixed integration baseline; fetch full history before pushing",
    );
  const commits = git(cwd, ["rev-list", ...heads, "--not", grandfather, "--"])
    .trim()
    .split("\n")
    .filter(Boolean);
  const main = canonicalMain(cwd);
  try {
    let status = checkpointStatus(cwd, grandfather, checkpoint, main);
    if (status === 128) {
      fetchCanonicalMain(
        cwd,
        main,
        runGit(cwd, ["cat-file", "-t", main]).status === 0,
      );
      status = checkpointStatus(cwd, grandfather, checkpoint, main);
    }
    if (status !== 0) throw Error("Expected exact commit ancestry");
  } catch (error) {
    throw Error(
      `Cannot establish the accepted issue checkpoint on canonical main. Check canonical GitHub access, local history and whether main was rewritten. ${error instanceof Error ? error.message : ""}`,
    );
  }
  const introduced = new Set(
    git(cwd, ["rev-list", ...heads, "--not", checkpoint, "--"])
      .trim()
      .split("\n"),
  );
  const issues = new Map<string, ReturnType<typeof parseReference>>();
  for (const commit of commits) {
    let issue;
    try {
      issue =
        primaryIssue(git(cwd, ["show", "-s", "--format=%B", commit]), cwd) ??
        acceptedMergeIssue(commit);
      if (
        !issue &&
        (isAcceptedReleaseCommit(commit, main, cwd) ||
          isGitHubMerge(commit, cwd))
      )
        continue;
    } catch (error) {
      throw Error(
        `Commit ${commit}: ${error instanceof Error ? error.message : error}`,
      );
    }
    if (!issue)
      throw Error(
        `Commit ${commit} needs a final Issue: tryapparent/apparent#123 trailer. Existing ancestry through ${grandfather} is grandfathered`,
      );
    if (introduced.has(commit)) issues.set(reference(issue), issue);
  }
  for (const issue of issues.values()) verifyIssue(issue, cwd);
  console.error(
    `issue-traceability: validated ${commits.length} commit trailers and ${issues.size} distinct GitHub issues beyond ${checkpoint}`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const [command, value, ...extra] = process.argv.slice(2),
      cwd = process.cwd();
    if (extra.length) throw Error("Unexpected issue traceability arguments");
    if (command === "bind" && value)
      bind(parseReference("Issue: " + value), cwd);
    else if (command === "prepare-message" && value) prepareMessage(value, cwd);
    else if (command === "validate-message" && value)
      validateMessage(value, cwd);
    else if (command === "push" && !value)
      validatePush(readFileSync(0, "utf8"), cwd);
    else
      throw Error(
        `Usage: run.ts bind owner/repo#123 | prepare-message FILE | validate-message FILE | push. ${instructions}`,
      );
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Issue traceability failed",
    );
    process.exitCode = 1;
  }
}
