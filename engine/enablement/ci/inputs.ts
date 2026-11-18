import { execFileSync } from "node:child_process";

import rule from "./inputs.json" with { type: "json" };

export const automaticPaths = [
  rule.root + "/**",
  "!" + rule.desktopPermissions + "**",
  ...rule.excludedSuffixes.map((suffix) => "!" + rule.root + "/**/*" + suffix),
];
export const affectsEngine = (path: string) =>
  path.startsWith(rule.root + "/") &&
  !path.startsWith(rule.desktopPermissions) &&
  !rule.excludedSuffixes.some((suffix) => path.endsWith(suffix));
export const linuxRunners = ["ubuntu-24.04", "ubuntu-24.04-arm"];
export const nativeRunners = [...linuxRunners, "macos-15", "macos-15-intel"];

export function changedInputs(
  base: string,
  head: string,
  cwd = process.cwd(),
): string[] {
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    }).trim();
  const before = git("rev-parse", "--verify", `${base}^{commit}`);
  const after = git("rev-parse", "--verify", `${head}^{commit}`);
  return git("diff", "--no-renames", "--name-only", "-z", before, after, "--")
    .split("\0")
    .filter(Boolean)
    .filter(affectsEngine);
}

export function selection(
  event: string,
  base: string,
  head: string,
  cwd = process.cwd(),
) {
  if (!["pull_request", "push", "workflow_dispatch"].includes(event))
    throw Error("Unsupported Engine event");
  const selected =
    event === "workflow_dispatch" || changedInputs(base, head, cwd).length > 0;
  return {
    selected,
    runners: event === "pull_request" ? linuxRunners : nativeRunners,
  };
}

export function currentInputs(
  candidate: string,
  main = "origin/main",
  cwd = process.cwd(),
): boolean {
  if (!/^[a-f0-9]{40}$/.test(candidate))
    throw Error("Invalid Engine candidate SHA");
  execFileSync("git", ["merge-base", "--is-ancestor", candidate, main], {
    cwd,
  });
  return changedInputs(candidate, main, cwd).length === 0;
}
