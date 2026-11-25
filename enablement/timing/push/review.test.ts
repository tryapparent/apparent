import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { recordPushLaunch } from "./receipt.ts";
import { readRollout } from "../census.ts";
import { reviewPushReceipts } from "./review.ts";

test("joins private producer receipts and exact tool results, rejecting ambiguous or foreign IDs", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "apparent-dev-push-receipt-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = () => join(directory, randomUUID() + ".jsonl");
  const accepted = file(),
    interrupted = file(),
    foreign = file(),
    missing = file(),
    mixed = file();
  const from = Date.now() - 1000;
  for (const path of [accepted, interrupted, mixed]) {
    assert.equal(recordPushLaunch(path), true);
    assert.equal(recordPushLaunch(path), false);
  }
  writeFileSync(foreign, readFileSync(accepted), { mode: 0o600 });
  const moduleURL = new URL("./receipt.ts", import.meta.url).href;
  const verify = (path: string) =>
    spawn(
      process.execPath,
      [
        "--experimental-strip-types",
        "--input-type=module",
        "-e",
        `import {recordPushVerification} from ${JSON.stringify(moduleURL)};
    recordPushVerification();
    process.stdout.write("ready");
    setTimeout(() => process.exit(7), 150);`,
      ],
      {
        env: { ...process.env, APPARENT_PUSH_TIMING: path },
        stdio: ["ignore", "pipe", "inherit"],
      },
    );
  const successful = verify(accepted),
    stopped = verify(interrupted);
  const completed = once(successful, "exit"),
    terminated = once(stopped, "exit");
  await once(stopped.stdout, "data");
  stopped.kill("SIGTERM");
  assert.deepEqual(await terminated, [null, "SIGTERM"]);
  assert.deepEqual(await completed, [7, null]);
  const to = Date.now() + 1000;

  const launch = (path: string) =>
    `node --experimental-strip-types enablement/local-tests/execution/push.ts --runner-timing ${path} -- origin HEAD`;
  const command = (cmd: string) =>
    `text(await tools.exec_command({cmd:${JSON.stringify(cmd)},yield_time_ms:1000}))`;
  const output = (status: object) => [
    {
      type: "input_text",
      text: "Script completed\nWall time 0.1 seconds\nOutput:\n",
    },
    {
      type: "input_text",
      text: JSON.stringify({
        chunk_id: "x",
        wall_time_seconds: 0.1,
        original_token_count: 0,
        output: "",
        ...status,
      }),
    },
  ];
  const row = (timestamp: number, payload: object) => ({
    type: "response_item",
    timestamp: new Date(timestamp).toISOString(),
    payload,
  });
  const exec = (at: number, call_id: string, input: string) =>
    row(at, { type: "custom_tool_call", name: "exec", call_id, input });
  const reply = (at: number, call_id: string, result: object) =>
    row(at, {
      type: "custom_tool_call_output",
      call_id,
      output: output(result),
    });
  const rollout = join(directory, "rollout.jsonl");
  writeFileSync(
    rollout,
    [
      { type: "session_meta", payload: { id: "fixture", cwd: directory } },
      exec(from + 1, "accepted", command(launch(accepted))),
      exec(from + 1, "interrupted", command(launch(interrupted))),
      reply(from + 1100, "accepted", { session_id: 42 }),
      reply(to - 500, "interrupted", { exit_code: 143 }),
      exec(
        to - 490,
        "accepted-wait",
        'text(await tools.write_stdin({session_id:42,chars:"",yield_time_ms:1000}))',
      ),
      reply(to - 480, "accepted-wait", { exit_code: 1 }),
      ...[foreign, missing, mixed].flatMap((path, i) => [
        exec(
          from + 1,
          String(i),
          command(launch(path) + (path === mixed ? " && date" : "")),
        ),
        reply(to - 400, String(i), { exit_code: 0 }),
      ]),
    ]
      .map((value) => JSON.stringify(value))
      .join("\n"),
    { mode: 0o600 },
  );
  const { calls } = await readRollout(rollout, () => true);
  const result = reviewPushReceipts(calls, directory, from, to);
  assert.deepEqual(result.coverage, {
    candidates: 4,
    unlinked: 2,
    launchOnly: 0,
    openVerification: 1,
    observedResults: 2,
  });
  assert.equal(result.verification.count, 1);
  assert.ok(result.verification.totalSeconds > 0);
  assert.deepEqual(result.toolWaits, {
    count: 1,
    meanSeconds: 0.01,
    totalSeconds: 0.01,
  });
  assert.deepEqual(result.operations[0].waits, ["accepted-wait"]);
  assert.equal(result.operations[0].result?.code, 1);
  assert.equal(result.operations[1].result?.code, 143);
  const duplicate = { ...calls[0], id: "duplicate" };
  assert.equal(
    reviewPushReceipts([...calls, duplicate], directory, from, to).coverage
      .unlinked,
    3,
  );
});
