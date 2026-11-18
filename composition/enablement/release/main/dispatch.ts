import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { pages } from "../github.ts";
import type { Run } from "../github.ts";
import { repository, sha, workflow } from "../manifest.ts";

const activeStatuses = [
  "queued",
  "in_progress",
  "requested",
  "waiting",
  "pending",
];

function ancestor(older: string, newer: string): boolean {
  const result = spawnSync(
    "git",
    ["merge-base", "--is-ancestor", older, newer],
    {
      encoding: "utf8",
    },
  );
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  throw Error(`Could not compare verified Main candidates: ${result.stderr}`);
}

export function competingMain(
  source: string,
  runs: Run[],
  ownRun?: string,
  isAncestor = ancestor,
): string | undefined {
  for (const run of runs) {
    if (
      String(run.id) === ownRun ||
      run.repository?.full_name !== repository ||
      run.head_repository?.full_name !== repository ||
      run.head_branch !== "main" ||
      run.path !== workflow ||
      run.event !== "workflow_dispatch" ||
      run.actor?.login !== "github-actions[bot]" ||
      !activeStatuses.includes(run.status)
    )
      continue;
    const match =
      /^main · source ([a-f0-9]{40}) · candidate run ([1-9]\d*) · Main CI [1-9]\d*$/.exec(
        run.display_title ?? "",
      );
    if (!match || match[2] !== String(run.id)) continue;
    const queued = match[1];
    if (queued === source ? ownRun === undefined : isAncestor(source, queued))
      return queued;
  }
}

function activeMainRuns(): Run[] {
  return activeStatuses.flatMap((status) =>
    pages<Run>(
      `actions/workflows/verification.yml/runs?branch=main&event=workflow_dispatch&status=${status}`,
      "workflow_runs",
    ),
  );
}

export function dispatchMain(
  env: NodeJS.ProcessEnv,
  send = (body: string) => {
    execFileSync(
      "gh",
      [
        "api",
        `repos/${repository}/actions/workflows/verification.yml/dispatches`,
        "--method",
        "POST",
        "--input",
        "-",
      ],
      {
        input: body,
        stdio: ["pipe", "inherit", "inherit"],
        timeout: 60_000,
      },
    );
  },
  lookup = activeMainRuns,
): void {
  if (
    env.GITHUB_REPOSITORY !== repository ||
    env.GITHUB_REF !== "refs/heads/main" ||
    env.GITHUB_EVENT_NAME !== "push" ||
    !sha.test(env.GITHUB_SHA ?? "") ||
    !/^[1-9]\d*$/.test(env.GITHUB_RUN_ID ?? "")
  )
    throw Error(
      "Main release dispatch requires an exact canonical main verification run",
    );
  const queued = competingMain(env.GITHUB_SHA!, lookup());
  if (queued) {
    console.log(
      `Linux Main already has a queued or active candidate at ${queued}`,
    );
    return;
  }
  send(
    JSON.stringify({
      ref: "main",
      inputs: {
        source_sha: env.GITHUB_SHA,
        verification_run_id: env.GITHUB_RUN_ID,
        mode: "main",
      },
    }),
  );
  console.log(
    `Queued Linux Main publication for ${env.GITHUB_SHA}; verification run ${env.GITHUB_RUN_ID}`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (process.argv[2] === "admission") {
    const source = process.argv[3] ?? "";
    if (!sha.test(source) || !process.env.GITHUB_RUN_ID)
      throw Error("Exact Main release source and run required");
    const queued = competingMain(
      source,
      activeMainRuns(),
      process.env.GITHUB_RUN_ID,
    );
    if (queued)
      appendFileSync(process.env.GITHUB_OUTPUT!, `superseded_by=${queued}\n`);
  } else {
    dispatchMain(process.env);
  }
}
