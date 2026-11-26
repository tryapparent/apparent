import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

type StopEvent = {
  hook_event_name?: string;
  permission_mode?: string;
  stop_hook_active?: boolean;
  last_assistant_message?: string | null;
  cwd?: string;
};

function shouldContinue(
  event: StopEvent | null,
  repository: string | undefined,
): boolean {
  if (
    !repository ||
    event?.hook_event_name !== "Stop" ||
    event.permission_mode === "plan" ||
    event.stop_hook_active !== false ||
    typeof event.cwd !== "string" ||
    typeof event.last_assistant_message !== "string"
  ) {
    return false;
  }

  const [opening, ...body] = event.last_assistant_message.trim().split(/\r?\n/);
  if (
    opening !== "Implementation complete." ||
    body.some((line) => /^Make It Apparent (video|blocker):\s*\S/.test(line))
  ) {
    return false;
  }

  try {
    const commonDirectory = execFileSync(
      "git",
      ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      {
        cwd: event.cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 2_000,
      },
    );
    return commonDirectory.trimEnd() === repository;
  } catch {
    return false;
  }
}

let event: StopEvent | null = null;
try {
  event = JSON.parse(readFileSync(0, "utf8"));
} catch {
  process.exit(0);
}

if (shouldContinue(event, process.argv[2])) {
  process.stdout.write(
    JSON.stringify({
      decision: "block",
      reason:
        "Before the final handoff, load and run agent/skills/make-it-apparent/SKILL.md for the completed work. Respect the user's latest scope, explicit pauses, permissions and required T3 yields. If a handoff is due, include the verified playable video or the concrete production blocker in the final reply.",
    }),
  );
}
