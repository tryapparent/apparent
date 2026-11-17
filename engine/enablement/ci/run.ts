import { appendFileSync } from "node:fs";
import { selection, currentInputs } from "./inputs.ts";
import { sdkDigest } from "./artifacts.ts";

const [command, candidate] = process.argv.slice(2);
if (command === "sdk-digest" && candidate) {
  sdkDigest(candidate);
} else if (command === "current" && candidate) {
  if (!currentInputs(candidate))
    throw Error("Newer main changed Engine inputs");
} else if (command === "select" && !candidate) {
  const event = process.env.GITHUB_EVENT_NAME ?? "";
  const head = process.env.GITHUB_SHA ?? "HEAD";
  const base =
    event === "pull_request" ? `${head}^1` : (process.env.BASE_SHA ?? "");
  const result = selection(event, base, head);
  appendFileSync(
    process.env.GITHUB_OUTPUT!,
    `selected=${result.selected}\nrunners=${JSON.stringify(result.runners)}\n`,
  );
} else {
  throw Error(
    "Use run.ts select | current CANDIDATE_SHA | sdk-digest DIRECTORY",
  );
}
