import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { repository, sha } from "../manifest.ts";

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
    `Queued paired Main publication for ${env.GITHUB_SHA}; verification run ${env.GITHUB_RUN_ID}`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  dispatchMain(process.env);
