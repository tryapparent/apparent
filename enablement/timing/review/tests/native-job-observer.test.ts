import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readRollout } from "../../census.ts";
import type { summarize } from "../../census.ts";
import { operations } from "../../operations.ts";
import { main as timingReview } from "../index.ts";

const nativeObserver =
  "npx -y @nomac/cli job job_a0123456789abcdef0123456789abcdef0123456 --wait 480";
const nativeLabel = "native job observation";
const unresolvedScript = "script execution (purpose unresolved)";

test("native job observation requires a standalone literal bounded viewer", () => {
  const command = (cmd: string) =>
    operations("exec_command", JSON.stringify({ cmd })).operations;
  const redirected =
    nativeObserver + " > /tmp/apparent-dev-example-run/status.log 2>&1";
  assert.deepEqual(command(nativeObserver), [nativeLabel]);
  assert.deepEqual(command(redirected), [nativeLabel]);
  for (const unsupported of [
    "npx -y @nomac/cli exec vm_example -- echo test",
    redirected.replace("@nomac/cli", "@other/cli"),
    redirected.replace("@nomac/cli", "@nomac/cli@latest"),
    nativeObserver.replace(/job_[a-f0-9]+/, "$job"),
    nativeObserver.replace("480", "0"),
    nativeObserver.replace("480", "-1"),
    nativeObserver.replace("480", "1m"),
    nativeObserver.replace("480", '"$seconds"'),
    nativeObserver.replace(" --wait 480", ""),
    redirected.replace("/tmp/apparent-dev-example-run/status.log", '"$log"'),
    redirected + " &",
    `"${nativeObserver}"`,
  ])
    assert.ok(!command(unsupported).includes(nativeLabel), unsupported);
  assert.deepEqual(command(`printf '%s' '${redirected}'`), [
    "file/artifact management",
  ]);
  assert.deepEqual(command(`${redirected}\ngit status`), [
    "Git inspection",
    unresolvedScript,
  ]);
  assert.deepEqual(
    command(`${redirected.replace("status.log", "$(choose_log)")}`),
    ["unknown"],
  );
  assert.deepEqual(
    operations(
      "exec",
      "tools.exec_command({cmd: prefix + " + JSON.stringify(redirected) + "})",
    ).operations,
    ["unknown"],
  );
  assert.deepEqual(
    operations(
      "exec",
      `tools.exec_command({cmd:${JSON.stringify(redirected)}});tools.exec_command({cmd:"git status"});`,
    ),
    { operations: ["Git inspection", nativeLabel], batched: true },
  );
});

test("native observer timing flows from rollout receipts through collect and format", async () => {
  const dir = mkdtempSync(join(tmpdir(), "apparent-dev-native-observer-"));
  const file = join(dir, "rollout.jsonl");
  const origin = Date.parse("2026-01-01T00:00:00Z");
  const iso = (ms: number) => new Date(origin + ms).toISOString();
  const row = (ms: number, type: string, call_id: string, fields: object) =>
    JSON.stringify({
      type: "response_item",
      timestamp: iso(ms),
      payload: { type, call_id, ...fields },
    });
  const launch = (ms: number, id: string, cmd: string) =>
    row(ms, "custom_tool_call", id, {
      name: "exec",
      input: `const ws="/fixture/native";\ntext(await tools.exec_command({cmd:${JSON.stringify(cmd)},workdir:ws,yield_time_ms:1000,max_output_tokens:300}));\n`,
    });
  const poll = (ms: number, id: string, session_id: number) =>
    row(ms, "custom_tool_call", id, {
      name: "exec",
      input: `text(await tools.write_stdin({session_id:${session_id},chars:""}));`,
    });
  const result = (ms: number, id: string, output: unknown) =>
    row(ms, "custom_tool_call_output", id, { output });
  const receipt = (status: object) =>
    [
      "Script completed\nWall time: 1 seconds\nOutput:\n",
      JSON.stringify({
        chunk_id: "fixture",
        wall_time_seconds: 1,
        original_token_count: 0,
        output: "",
        ...status,
      }),
    ].map((text) => ({ type: "input_text", text }));
  const collect = async (variant: string, observer: string) => {
    writeFileSync(
      file,
      [
        JSON.stringify({
          type: "session_meta",
          payload: { id: "fixture-session", cwd: "/fixture" },
        }),
        launch(
          1000,
          "first",
          observer + " > /tmp/apparent-dev-example-run/first.log 2>&1",
        ),
        launch(
          1000,
          "remote",
          "npx -y @nomac/cli exec vm_example -- echo fixture",
        ),
        result(2000, "first", receipt({ session_id: 111 })),
        result(2500, "remote", receipt({ exit_code: 0 })),
        poll(3000, "yielded", 111),
        result(4000, "yielded", "Script running with cell ID cell:1"),
        row(4000, "function_call", "cell", {
          namespace: "functions",
          name: "wait",
          arguments: '{"cell_id":"cell:1"}',
        }),
        poll(5000, "unrelated", 999),
        result(6000, "unrelated", receipt({ exit_code: 0 })),
        row(7000, "function_call_output", "cell", {
          output: receipt({ session_id: 111 }),
        }),
        poll(8000, "first-end", 111),
        result(10000, "first-end", receipt({ exit_code: 1 })),
        launch(
          11000,
          "second",
          observer.replace("480", "360") +
            " > /tmp/apparent-dev-example-run/second.log 2>&1",
        ),
        result(12000, "second", receipt({ session_id: 222 })),
        poll(13000, "second-end", 222),
        result(22000, "second-end", receipt({ exit_code: 0 })),
      ].join("\n"),
    );
    const { calls } = await readRollout(file, () => true);
    const json = join(dir, variant + ".json");
    const md = join(dir, variant + ".md");
    await timingReview([
      "collect",
      "--input",
      file,
      "--workspace",
      "/fixture",
      "--from",
      iso(0),
      "--to",
      iso(24000),
      "--out",
      json,
    ]);
    await timingReview(["format", "--input", json, "--out", md]);
    return {
      calls,
      census: JSON.parse(readFileSync(json, "utf8")).census as ReturnType<
        typeof summarize
      >,
      formatted: readFileSync(md, "utf8"),
    };
  };
  try {
    const baseline = await collect(
      "baseline",
      nativeObserver.replace("@nomac/cli", "@other/cli"),
    );
    const actual = await collect("actual", nativeObserver);
    const clocks = (calls: typeof actual.calls) =>
      calls.map(({ id, start, end, processObservedEnd, asynchronous }) => [
        id,
        start,
        end,
        processObservedEnd,
        asynchronous,
      ]);
    assert.deepEqual(clocks(actual.calls), clocks(baseline.calls));
    assert.deepEqual(
      actual.calls
        .filter((c) => c.processObservedEnd !== undefined)
        .map((c) => [c.id, c.processObservedEnd]),
      [
        ["first", origin + 10000],
        ["second", origin + 22000],
      ],
    );
    assert.deepEqual(
      actual.calls
        .filter((c) => c.waitedOperations?.includes(nativeLabel))
        .map((c) => c.id),
      ["yielded", "cell", "first-end", "second-end"],
    );
    assert.equal(
      actual.calls.find((c) => c.id === "unrelated")?.waitedOperations,
      undefined,
    );
    assert.deepEqual(actual.calls.find((c) => c.id === "remote")?.operations, [
      unresolvedScript,
    ]);
    assert.equal(actual.census.calls, 8);
    assert.equal(actual.census.calls, baseline.census.calls);
    assert.deepEqual(actual.census.tools, baseline.census.tools);
    assert.equal(actual.census.observedToolUnionSeconds, 17.5);
    assert.equal(
      actual.census.observedToolUnionSeconds,
      baseline.census.observedToolUnionSeconds,
    );
    assert.deepEqual(
      actual.census.correlatedProcesses.map((p) => [
        p.category,
        p.observedSpanSeconds,
      ]),
      [
        [nativeLabel, 9],
        [nativeLabel, 11],
      ],
    );
    assert.match(
      baseline.formatted,
      /\| script execution \(purpose unresolved\) \| 2 \| 10 \| 20 \| mixed\/unresolved \|/,
    );
    for (const line of [
      "| native job observation | 2 | 10 | 20 | identified |",
      "| waiting/status for native job observation | 4 | 3.75 | 15 | identified |",
      "| process wait | 1 | 1 | 1 | mixed/unresolved |",
      "| script execution (purpose unresolved) | 1 | 1.5 | 1.5 | mixed/unresolved |",
    ])
      assert.ok(actual.formatted.includes(line), line);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
