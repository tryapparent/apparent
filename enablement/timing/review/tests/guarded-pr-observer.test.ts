import { test } from "node:test";
import assert from "node:assert/strict";
import { summarize, readRollout } from "../../census.ts";
import { operations } from "../../operations.ts";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const headGuard =
  'test "$(gh pr view 42 -R example/repo --json headRefOid --jq .headRefOid)" = "$expected"';
const prObserver = `set -e
job=/tmp/apparent-dev-fixture-001
expected=${"a".repeat(40)}
${headGuard}
timeout 300 gh pr checks 42 -R example/repo --watch --interval 30 --fail-fast > "$job/pr-42-checks.log" 2>&1
${headGuard}`;

test("only the complete guarded PR observer can identify a PR checks wait", () => {
  const command = (cmd: string) =>
    operations("exec_command", JSON.stringify({ cmd })).operations;
  assert.deepEqual(command(prObserver), ["CI observation"]);
  assert.deepEqual(command("gh pr checks 42 -R example/repo"), [
    "CI/PR operations",
  ]);
  for (const unsupported of [
    prObserver
      .replace("pr checks 42", "pr checks 43")
      .replace("pr-42-checks.log", "pr-43-checks.log"),
    prObserver.replace(
      "pr checks 42 -R example/repo",
      "pr checks 42 -R example/other",
    ),
    prObserver.replace("pr-42-checks.log", "pr-43-checks.log"),
    prObserver.replace("fixture-001", "fixture/../elsewhere"),
    prObserver.replace('> "$job', '>> "$job'),
    prObserver.replace(' > "$job/pr-42-checks.log" 2>&1', ""),
    prObserver.replace("timeout 300", 'timeout "$limit"'),
    prObserver.replace("--interval 30", "--interval 0"),
    prObserver.replace(" --watch --interval 30 --fail-fast", ""),
    prObserver.replace("a".repeat(40), "$(cat head)"),
    prObserver.replace(headGuard, headGuard.replace("$expected", "$other")),
    prObserver.replace(
      headGuard,
      headGuard.replace(".headRefOid)", ".headRefOid; git push)"),
    ),
    prObserver.slice(0, prObserver.lastIndexOf("\n")),
    `${prObserver}\ngit push`,
    `cat <<'EOF'\n${prObserver}\nEOF`,
  ])
    assert.ok(!command(unsupported).includes("CI observation"), unsupported);
});

test("a guarded PR observer relabels only its rollout launch and linked wait", async () => {
  const dir = mkdtempSync(join(tmpdir(), "apparent-dev-pr-observer-"));
  try {
    const file = join(dir, "rollout.jsonl");
    const read = async (cmd: string) => {
      const row = (time: number, payload: object) =>
        JSON.stringify({
          type: "response_item",
          timestamp: new Date(time).toISOString(),
          payload,
        });
      const launch =
        "const result = await tools.exec_command({cmd:`" +
        cmd +
        "`, yield_time_ms:1000}); text(result);";
      const poll = (id: number) =>
        `text(await tools.write_stdin({session_id:${id}, chars:""}));`;
      const receipt = (value: object) => [
        { type: "text", text: JSON.stringify(value) },
      ];
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
            input: launch,
          }),
          row(2_000, {
            type: "custom_tool_call_output",
            call_id: "launch",
            output: receipt({ session_id: 123 }),
          }),
          row(3_000, {
            type: "custom_tool_call",
            name: "exec",
            call_id: "poll",
            input: poll(123),
          }),
          row(4_000, {
            type: "custom_tool_call",
            name: "exec",
            call_id: "unlinked",
            input: poll(456),
          }),
          row(6_000, {
            type: "custom_tool_call_output",
            call_id: "unlinked",
            output: receipt({ exit_code: 0 }),
          }),
          row(8_000, {
            type: "custom_tool_call_output",
            call_id: "poll",
            output: receipt({ exit_code: 0 }),
          }),
        ].join("\n"),
      );
      return (await readRollout(file, () => true)).calls;
    };
    const before = await read(
      prObserver.replace(
        headGuard,
        headGuard.replace("pr view 42", "pr view 43"),
      ),
    );
    const after = await read(prObserver);
    const baseline = summarize(before, 0, 10_000);
    const report = summarize(after, 0, 10_000);
    const endpoints = (calls: typeof after) =>
      calls.map(({ id, start, end, processObservedEnd }) => ({
        id,
        start,
        end,
        processObservedEnd,
      }));
    assert.deepEqual(endpoints(after), endpoints(before));
    assert.equal(after[0].processObservedEnd, 8_000);
    assert.equal(report.calls, 3);
    assert.equal(report.calls, baseline.calls);
    assert.deepEqual(report.tools, baseline.tools);
    assert.equal(report.tools[0].arithmetic.totalSeconds, 8);
    assert.equal(report.observedToolUnionSeconds, 6);
    assert.equal(
      report.observedToolUnionSeconds,
      baseline.observedToolUnionSeconds,
    );
    assert.deepEqual(
      after.map((call) => call.waitedOperations),
      [undefined, ["CI observation"], undefined],
    );
    assert.equal(baseline.actionRanking.processes.unresolvedSeconds, 7);
    assert.equal(report.actionRanking.processes.unresolvedSeconds, 0);
    assert.deepEqual(
      report.actionRanking.processes.ranked.map(({ label, totalSeconds }) => [
        label,
        totalSeconds,
      ]),
      [["CI observation", 7]],
    );
    assert.equal(
      report.actionRanking.envelopes.ranked.find(
        (g) => g.label === "waiting/status for CI observation",
      )?.totalSeconds,
      5,
    );
    assert.equal(report.actionRanking.envelopes.unresolvedSeconds, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
