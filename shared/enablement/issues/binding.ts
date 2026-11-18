import { spawnSync } from "node:child_process";
import {
  lstatSync,
  readFileSync,
  renameSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { git, repository, reference, type Issue } from "./reference.ts";

export const instructions =
  "Bind this worktree to an existing issue with node --experimental-strip-types shared/enablement/issues/run.ts bind tryapparent/apparent#123";

function githubLookup(cwd: string, endpoint: string) {
  return spawnSync(
    "gh",
    ["api", "--hostname", "github.com", `repos/${repository}/${endpoint}`],
    {
      cwd,
      encoding: "utf8",
      timeout: 20000,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, GH_PROMPT_DISABLED: "1" },
    },
  );
}

export function isGitHubMerge(commit: string, cwd: string): boolean {
  const [email, ...parents] = git(cwd, [
    "show",
    "-s",
    "--format=%ce %P",
    commit,
  ])
    .trim()
    .split(" ");
  if (email !== "noreply@github.com" || parents.length !== 2) return false;

  const endpoint = `commits/${commit}`;
  const result = githubLookup(cwd, endpoint);
  if (result.error || result.status !== 0)
    throw Error(
      "Cannot verify GitHub merge provenance through authenticated gh API",
    );
  try {
    const data = JSON.parse(result.stdout);
    return (
      data?.sha === commit &&
      data?.url === `https://api.github.com/repos/${repository}/${endpoint}` &&
      data.committer?.login === "web-flow" &&
      data.commit?.verification?.verified === true &&
      data.commit.verification.reason === "valid" &&
      Array.isArray(data.parents) &&
      data.parents.length === parents.length &&
      parents.every((parent, index) => data.parents[index]?.sha === parent)
    );
  } catch {
    throw Error("GitHub returned an invalid commit response");
  }
}

export function verifyIssue(issue: Issue, cwd: string): number {
  if (
    issue.repository !== repository ||
    !Number.isSafeInteger(issue.number) ||
    issue.number <= 0
  )
    throw Error("Invalid canonical issue identity");
  const result = githubLookup(cwd, `issues/${issue.number}`);
  if (result.error || result.status !== 0)
    throw Error(
      `Cannot validate ${reference(issue)} through authenticated gh API. Check gh authentication, network access and issue existence, then retry`,
    );
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(result.stdout);
  } catch {
    throw Error("GitHub returned an invalid issue response");
  }
  if (
    !data ||
    typeof data !== "object" ||
    Array.isArray(data) ||
    data.pull_request ||
    data.number !== issue.number ||
    typeof data.id !== "number" ||
    !Number.isSafeInteger(data.id) ||
    data.id <= 0 ||
    data.url !==
      `https://api.github.com/repos/${repository}/issues/${issue.number}` ||
    data.repository_url !== `https://api.github.com/repos/${repository}`
  )
    throw Error(
      `GitHub reference ${reference(issue)} must identify an issue in ${repository}, with matching canonical identity; pull requests are rejected`,
    );
  return data.id;
}

function bindingPath(cwd: string): string {
  return join(
    git(cwd, ["rev-parse", "--absolute-git-dir"]).trim(),
    "apparent-issue.json",
  );
}

export function bind(issue: Issue, cwd: string): void {
  const issueId = verifyIssue(issue, cwd);
  const file = bindingPath(cwd),
    temporary = file + "-" + randomBytes(8).toString("hex");
  try {
    writeFileSync(
      temporary,
      JSON.stringify({
        schema: 1,
        host: "github.com",
        issueId,
        ...issue,
        validatedAt: new Date().toISOString(),
      }) + "\n",
      { flag: "wx", mode: 0o600 },
    );
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
}

export function boundIssue(cwd: string): Issue {
  try {
    const file = bindingPath(cwd),
      stat = lstatSync(file);
    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      (stat.mode & 0o777) !== 0o600 ||
      stat.uid !== process.getuid!()
    )
      throw Error("unsafe binding");
    const data = JSON.parse(readFileSync(file, "utf8"));
    if (
      data.schema !== 1 ||
      data.host !== "github.com" ||
      data.repository !== repository ||
      !Number.isSafeInteger(data.issueId) ||
      data.issueId <= 0 ||
      !Number.isSafeInteger(data.number) ||
      data.number <= 0 ||
      !Number.isFinite(Date.parse(data.validatedAt))
    )
      throw Error("invalid binding");
    return { repository, number: data.number };
  } catch {
    throw Error(
      `Missing or invalid API-validated worktree issue binding. ${instructions}`,
    );
  }
}
