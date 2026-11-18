import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import {
  baseline,
  git,
  primaryIssue,
  parseReference,
  reference,
} from "./reference.ts";
import {
  bind,
  boundIssue,
  instructions,
  verifyIssue,
  isGitHubMerge,
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

export function validatePush(
  input: string,
  cwd: string,
  grandfather = baseline,
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
  const issues = new Map<string, ReturnType<typeof parseReference>>();
  for (const commit of commits) {
    let issue;
    try {
      issue = primaryIssue(
        git(cwd, ["show", "-s", "--format=%B", commit]),
        cwd,
      );
      if (!issue && isGitHubMerge(commit, cwd)) continue;
    } catch (error) {
      throw Error(
        `Commit ${commit}: ${error instanceof Error ? error.message : error}`,
      );
    }
    if (!issue)
      throw Error(
        `Commit ${commit} needs a final Issue: tryapparent/apparent#123 trailer. Existing ancestry through ${grandfather} is grandfathered`,
      );
    issues.set(reference(issue), issue);
  }
  for (const issue of issues.values()) verifyIssue(issue, cwd);
  console.error(
    `issue-traceability: checked ${commits.length} new commits and validated ${issues.size} distinct GitHub issues`,
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
