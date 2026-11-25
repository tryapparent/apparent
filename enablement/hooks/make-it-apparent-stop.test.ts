import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const cwd = fileURLToPath(new URL(".", import.meta.url));
const hook = fileURLToPath(
  new URL("./make-it-apparent-stop.ts", import.meta.url),
);
const repository = execFileSync(
  "git",
  ["rev-parse", "--path-format=absolute", "--git-common-dir"],
  {
    cwd,
    encoding: "utf8",
  },
).trimEnd();
const handoff = "Implementation complete.\n\nThe change passed verification.";
const event = {
  hook_event_name: "Stop",
  cwd,
  permission_mode: "default",
  stop_hook_active: false,
  last_assistant_message: handoff,
};

function invoke(input: string): string {
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", hook, repository],
    {
      cwd,
      input,
      encoding: "utf8",
      timeout: 5_000,
    },
  );
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

test("continues a completed handoff without a video or concrete blocker", () => {
  const response = JSON.parse(invoke(JSON.stringify(event)));
  assert.equal(response.decision, "block");
  assert.match(response.reason, /agent\/skills\/make-it-apparent\/SKILL\.md/);
  const emptyReceipt = {
    ...event,
    last_assistant_message: `${handoff}\nMake It Apparent video:  `,
  };
  assert.equal(
    JSON.parse(invoke(JSON.stringify(emptyReceipt))).decision,
    "block",
  );
});

test("allows verified evidence, blockers, discussion, pauses and CI yields", () => {
  for (const last_assistant_message of [
    `${handoff}\nMake It Apparent video: [Demo](/private/review.mp4)`,
    `${handoff}\nMake It Apparent blocker: The approved local narrator failed to synthesize.`,
    "The Stop hook uses the implementation completion line.",
    "Paused as requested.",
    "The PR is waiting for CI. T3 will resume on completion.",
    null,
  ]) {
    assert.equal(
      invoke(JSON.stringify({ ...event, last_assistant_message })),
      "",
    );
  }
});

test("allows plan mode, the continuation, and unsupported input to finish", () => {
  for (const input of [
    JSON.stringify({ ...event, permission_mode: "plan" }),
    JSON.stringify({ ...event, stop_hook_active: true }),
    JSON.stringify({ ...event, hook_event_name: "SubagentStop" }),
    JSON.stringify({ ...event, cwd: "/" }),
    "{}",
    "null",
    "invalid",
  ]) {
    assert.equal(invoke(input), "");
  }
});
