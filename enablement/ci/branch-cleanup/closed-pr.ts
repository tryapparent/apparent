import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

type PullRequest = {
  number: number;
  state: string;
  merged?: boolean;
  labels: { name: string }[];
  head: { ref: string; sha: string; repo: { id: number } | null };
  base: { ref: string };
};

type CloseEvent = {
  action: string;
  repository: { id: number; full_name: string; default_branch: string };
  pull_request: PullRequest;
};

type Command = (program: string, args: string[]) => string;

export function cleanupClosedBranch(
  event: CloseEvent,
  command: Command,
): string {
  const { repository, pull_request: closed } = event;
  const { ref, sha, repo } = closed.head;
  if (
    event.action !== "closed" ||
    closed.merged ||
    repo?.id !== repository.id
  ) {
    return "Skip merged PRs and branches outside this repository.";
  }
  if (
    ref === repository.default_branch ||
    ref === closed.base.ref ||
    /^(?:migration|preview|release)\//.test(ref) ||
    [
      "linux-main-feed",
      "preview-mac-feed",
      "t3/onboarding-mac-release-baseline",
    ].includes(ref)
  ) {
    return "Keep the base or reserved branch.";
  }

  const pullsPath = `repos/${repository.full_name}/pulls`;
  const read = (...args: string[]) =>
    JSON.parse(command("gh", ["api", ...args]));
  const current: PullRequest = read(`${pullsPath}/${closed.number}`);
  if (
    current.state !== "closed" ||
    current.merged ||
    current.head.sha !== sha ||
    current.head.ref !== ref ||
    current.head.repo?.id !== repository.id
  ) {
    return "Skip a PR that changed after the close event.";
  }
  if (current.labels.some(({ name }) => name.toLowerCase() === "keep-branch")) {
    return "Keep the branch by request.";
  }

  const fullRef = `refs/heads/${ref}`;
  const pullRef = `refs/pull/${closed.number}/head`;
  const refs = new Map<string, string>(
    command("git", ["ls-remote", "--refs", "origin", fullRef, pullRef])
      .trim()
      .split("\n")
      .map((line) => {
        const [oid, name] = line.split("\t");
        return [name, oid];
      }),
  );
  if (refs.get(fullRef) !== sha || refs.get(pullRef) !== sha) {
    return "Skip a missing or changed branch, or a head without a matching recovery ref.";
  }
  const branch: { protected: boolean } = read(
    `repos/${repository.full_name}/branches/${encodeURIComponent(ref)}`,
  );
  if (branch.protected) {
    return "Keep the protected branch.";
  }

  const open: PullRequest[][] = read(
    "--paginate",
    "--slurp",
    `${pullsPath}?state=open&per_page=100`,
  );
  if (
    open
      .flat()
      .some(
        (pr) =>
          pr.base.ref === ref ||
          (pr.head.repo?.id === repository.id && pr.head.ref === ref),
      )
  ) {
    return "Keep the branch because an open PR uses it.";
  }

  command("git", [
    "-c",
    "credential.helper=",
    "-c",
    "credential.https://github.com.helper=!gh auth git-credential",
    "push",
    `--force-with-lease=${fullRef}:${sha}`,
    "origin",
    `:${fullRef}`,
  ]);
  return "Deleted the branch. The closed PR retains its head commit.";
}

if (import.meta.main) {
  const event = JSON.parse(
    readFileSync(process.env.GITHUB_EVENT_PATH!, "utf8"),
  ) as CloseEvent;
  console.log(
    cleanupClosedBranch(event, (program, args) =>
      execFileSync(program, args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "inherit"],
      }),
    ),
  );
}
