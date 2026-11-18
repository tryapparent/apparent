import { spawnSync } from "node:child_process";

export const repository = "tryapparent/apparent";
export const baseline = "d559dbbd2a3fbf9428593931b526e13b626c8ab9";
export const acceptedMain = "8bd1c2669a62c41014791a6dd3e85da809f4d446";
export const referencePattern =
  /^Issue:[ \t]+([A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+)#([1-9][0-9]*)[ \t]*$/i;
export type Issue = { repository: string; number: number };
export const reference = (issue: Issue) =>
  `${issue.repository}#${issue.number}`;

export function parseReference(line: string): Issue {
  const match = referencePattern.exec(line);
  if (!match || !Number.isSafeInteger(Number(match[2])))
    throw Error(
      "Use the final trailer Issue: tryapparent/apparent#123 with a positive GitHub issue number",
    );
  if (match[1].toLowerCase() !== repository)
    throw Error(`Issue repository must be ${repository}`);
  return { repository, number: Number(match[2]) };
}

export function runGit(
  cwd: string,
  args: string[],
  input?: string,
  timeout?: number,
) {
  const env = { ...process.env };
  delete env.GIT_SSL_NO_VERIFY;
  return spawnSync("git", args, {
    cwd,
    input,
    timeout,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    env: {
      ...env,
      GIT_NO_REPLACE_OBJECTS: "1",
      GIT_GRAFT_FILE: "",
      GIT_NO_LAZY_FETCH: "1",
      GIT_TERMINAL_PROMPT: "0",
    },
  });
}

export function git(
  cwd: string,
  args: string[],
  input?: string,
  timeout?: number,
): string {
  const result = runGit(cwd, args, input, timeout);
  if (result.error || result.status !== 0)
    throw Error(`Issue traceability cannot read Git metadata (${args[0]})`);
  return result.stdout;
}

export function primaryIssue(message: string, cwd: string): Issue | undefined {
  const cleaned = git(
    cwd,
    ["stripspace", "--strip-comments"],
    message,
  ).trimEnd();
  const parsed = git(cwd, ["interpret-trailers", "--parse"], cleaned);
  const issues = parsed.split("\n").filter((line) => /^Issue:/i.test(line));
  if (issues.length > 1)
    throw Error(
      "Exactly one primary Issue trailer is required; remove duplicate or conflicting trailers",
    );
  const blocks = cleaned.split(/\n[ \t]*\n/);
  const final = blocks.at(-1)!.split("\n");
  const raw = final.filter((line) => /^Issue[ \t]*:/i.test(line));
  if (!issues.length && !raw.length) return undefined;
  if (
    blocks.length < 2 ||
    issues.length !== 1 ||
    raw.length !== 1 ||
    final.some(
      (line) => !/^(?:[A-Za-z0-9-]+:[ \t]*\S.*|[ \t]+\S.*)$/.test(line),
    )
  )
    throw Error(
      "Put exactly one Issue trailer in the final Git trailer block after a blank line",
    );
  const issue = parseReference(raw[0]);
  if (reference(parseReference(issues[0])) !== reference(issue))
    throw Error("Issue trailer continuations are unsupported");
  return issue;
}
