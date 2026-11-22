import { test } from "node:test";
import assert from "node:assert/strict";
import { summarize, readRollout } from "../census.ts";
import { operations } from "../operations.ts";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const configuredPush =
  "git -c url.https://example.invalid/.insteadOf=https://example.test/ push -u origin HEAD";

test("literal Git configuration prefixes retain the actual subcommand and envelope", () => {
  const command = (cmd: string) =>
    operations("exec_command", JSON.stringify({ cmd })).operations;
  assert.deepEqual(command("git push -u origin HEAD"), ["verification/push"]);
  assert.deepEqual(command(configuredPush), ["verification/push"]);
  assert.deepEqual(command("git -c color.ui= -c core.quotepath=false push"), [
    "verification/push",
  ]);
  assert.deepEqual(command('git -c "core.pager=echo push" status'), [
    "Git inspection",
  ]);
  assert.deepEqual(command("git -c core.editor=push commit"), [
    "Git integration/editing",
  ]);
  assert.deepEqual(command(`git -c 'core.editor=$EDITOR' status`), [
    "Git inspection",
  ]);
  const prepared = `test -z "$(git status --porcelain)"\n${configuredPush}`;
  assert.deepEqual(command(prepared), ["Git inspection", "verification/push"]);
  assert.deepEqual(command(`${prepared}\ncargo test`), [
    "Git inspection",
    "Rust build/test",
    "verification/push",
  ]);

  for (const unsupported of [
    "git -c",
    "git -c push",
    "git -c core.editor push",
    "git -c =push push",
    "git -c editor=vim push",
    'git -c "" core.editor=vim push',
    "git -c core.editor=vim -c missing push",
    "git -c core.editor=vim",
    "git -c core.editor=vim -C repo push",
    'git -c "$setting" push',
    'git -c core.editor="$editor" push',
    "git -c core.editor=* push",
    "git -c core.editor=$(cat editor) push",
    "git -c core.editor=vim $verb push",
    'git -c core.editor=vim "p\\ush"',
  ])
    assert.deepEqual(command(unsupported), ["unknown"], unsupported);
});

test("configured push attribution follows the launcher through its linked polls and terminal result", async () => {
  const dir = mkdtempSync(join(tmpdir(), "apparent-dev-configured-push-"));
  try {
    const file = join(dir, "rollout.jsonl");
    const row = (time: number, payload: object) =>
      JSON.stringify({
        type: "response_item",
        timestamp: new Date(time).toISOString(),
        payload,
      });
    const poll = 'text(await tools.write_stdin({session_id: 123, chars: ""}));';
    writeFileSync(
      file,
      [
        JSON.stringify({
          type: "session_meta",
          payload: { id: "s", cwd: "/fixture" },
        }),
        row(1_000, {
          type: "custom_tool_call",
          name: "exec",
          call_id: "launch",
          input: `text(await tools.exec_command({cmd:${JSON.stringify(configuredPush)}, yield_time_ms:1000}));`,
        }),
        row(2_000, {
          type: "custom_tool_call_output",
          call_id: "launch",
          output: "Process running with session ID 123",
        }),
        row(4_000, {
          type: "custom_tool_call",
          name: "exec",
          call_id: "poll",
          input: poll,
        }),
        row(5_000, {
          type: "custom_tool_call_output",
          call_id: "poll",
          output: "Script running with cell ID cell:1",
        }),
        row(6_000, {
          type: "function_call",
          namespace: "functions",
          name: "wait",
          call_id: "cell",
          arguments: '{"cell_id":"cell:1"}',
        }),
        row(8_000, {
          type: "function_call_output",
          call_id: "cell",
          output: "Process running with session ID 123",
        }),
        row(10_000, {
          type: "custom_tool_call",
          name: "exec",
          call_id: "terminal",
          input: poll,
        }),
        row(13_000, {
          type: "custom_tool_call_output",
          call_id: "terminal",
          output: "Process exited with code 0",
        }),
        row(13_000, {
          type: "custom_tool_call",
          name: "exec",
          call_id: "read",
          input: 'tools.exec_command({cmd:"git -c color.ui=false status"})',
        }),
        row(14_000, {
          type: "custom_tool_call_output",
          call_id: "read",
          output: "Process exited with code 0",
        }),
      ].join("\n"),
    );
    const { calls } = await readRollout(file, () => true);
    const report = summarize(calls, 0, 15_000);
    const totals = ({
      label,
      count,
      meanSeconds,
      totalSeconds,
    }: {
      label: string;
      count: number;
      meanSeconds: number;
      totalSeconds: number;
    }) => [label, count, meanSeconds, totalSeconds];
    assert.equal(report.calls, 5);
    assert.equal(report.observedToolUnionSeconds, 8);
    assert.deepEqual(
      calls.filter((c) => c.waitedOperations).map((c) => c.id),
      ["poll", "cell", "terminal"],
    );
    assert.deepEqual(
      calls
        .filter((c) => c.processObservedEnd !== undefined)
        .map((c) => [c.id, c.processObservedEnd]),
      [["launch", 13_000]],
    );
    assert.deepEqual(report.actionRanking.envelopes.ranked.map(totals), [
      ["waiting/status for verification/push", 3, 2, 6],
      ["verification/push", 1, 1, 1],
      ["Git inspection", 1, 1, 1],
    ]);
    assert.deepEqual(report.actionRanking.processes.ranked.map(totals), [
      ["verification/push", 1, 12, 12],
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
