import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readRollout, summarize } from "../../census.ts";
import { operations } from "../../operations.ts";

const launch = (cmd: string) =>
  "text(await tools.exec_command({cmd:" +
  JSON.stringify(cmd) +
  ",yield_time_ms:1000}))";
const label = (cmd: string) => operations("exec", launch(cmd)).operations;
const ciArgs =
  "python3 /home/fixture/.hermes/scripts/gh_owned_wait.py 123 --repo example/repo --head " +
  "a".repeat(40) +
  " --attempt 1 --timeout 1800 --interval 60";
const ciSubshell = [
  "j=/tmp/apparent-dev-ci-fixture",
  "(umask 077; " + ciArgs + ' > "$j/main-ci.log" 2>&1)',
].join("\n");
const ciWithLogRead = [
  "set -eu",
  "umask 077",
  "job=/tmp/apparent-dev-ci-fixture",
  'cat "$job/landed-wait.log"',
  ciArgs + ' > "$job/observer.log" 2>&1',
].join("\n");
const vmBash = 'bash record/enablement/performance/run.sh "$PWD"';
const vmTs = "node enablement/timing/journey/native/run.ts";
const vmGuard =
  "test -z \"$(rg --files --hidden \"$job/vm\" -g '*.ppm' -g '*-desktop.png' -g 'desktop.png')\"";
const vmProof = (driver: string, guard = false) =>
  [
    "set -eu",
    "job=$(mktemp -d /tmp/apparent-dev-vm-fixture-XXXXXX)",
    "printf '%s\\n' \"$job\"",
    "APPARENT_BENCH_SURFACE=1 " +
      driver +
      " /home/fixture/VMs/template guest " +
      "/tmp/apparent-dev-image-fixture/Apparent.AppImage " +
      "b".repeat(64) +
      ' /tmp/apparent-dev-model-fixture/model.gguf "$job"',
    'node record/enablement/performance/start-report.ts "$job/vm" > "$job/start.json"',
    'cat "$job/start.json"',
    ...(guard ? [vmGuard] : []),
  ].join("\n");

test("only complete observed VM Start proof shapes receive the same envelope label", () => {
  for (const cmd of [
    vmProof(vmBash),
    vmProof(vmBash, true),
    vmProof(vmTs, true),
  ])
    assert.deepEqual(label(cmd), ["isolated VM Start proof"]);
  const cmd = vmProof(vmTs, true);
  for (const unsupported of [
    vmProof("node unknown/native/run.ts", true),
    cmd.replace("SURFACE=1", "SURFACE=0"),
    cmd.replace("b".repeat(64), "$sha"),
    cmd.replace(' "$job"\nnode', ' "$other"\nnode'),
    cmd.replace(' "$job/vm"', ' "$other/vm"'),
    cmd.replace("start-report.ts", "other-report.ts"),
    cmd.replace("Apparent.AppImage", "../Apparent.AppImage"),
    cmd.replace(" -g 'desktop.png'", "; git push"),
    cmd + "\ncargo test",
    "cat <<'EOF'\n" + cmd + "\nEOF",
  ])
    assert.ok(
      !label(unsupported).includes("isolated VM Start proof"),
      unsupported,
    );
});

test("only exact-run observer envelopes with bounded same-job setup are collapsed", () => {
  for (const cmd of [ciSubshell, ciWithLogRead + "\n"])
    assert.deepEqual(label(cmd), ["CI observation"]);
  for (const unsupported of [
    ciSubshell.replace("$j/", "$job/"),
    ciSubshell.replace("gh_owned_wait.py", "other.py"),
    ciSubshell.replace("--attempt 1", "--attempt $attempt"),
    ciSubshell.replace("--interval 60", "--interval 0"),
    ciSubshell.replace(
      "--head " + "a".repeat(40),
      "--head $(git rev-parse HEAD)",
    ),
    ciSubshell.replace("umask 077; ", "git push; "),
    ciWithLogRead.replace('cat "$job/', 'cat "$elsewhere/'),
    ciWithLogRead.replace("cat ", "rm "),
    ciWithLogRead.replace("2>&1", "&"),
    ciWithLogRead + "\ngh pr merge 32",
    "cat <<'EOF'\n" + ciSubshell + "\nEOF",
  ])
    assert.notDeepEqual(label(unsupported), ["CI observation"], unsupported);

  assert.deepEqual(
    label(
      [
        "set -euo pipefail",
        "job=$(mktemp -d /tmp/apparent-dev-connect-smoke-XXXXXX)",
        '(cd "$job" && "$image" --appimage-extract > "$job/extract.log")',
        "asset=$(jq -r .short /tmp/apparent-dev-fixture/assets.json)",
        'node --input-type=module - "$job" "$asset" <<\'EOF\'',
        'await import("node:fs");',
        "EOF",
        "t3-build --jobs 3 --min-jobs 3 -- cargo test --locked --bin apparent benchmark_connect_cli -- --ignored --nocapture",
      ].join("\n"),
    ),
    ["unknown"],
  );
});

test("same producer clocks, process endpoints and overlaps survive relabeling", async () => {
  const dir = mkdtempSync(join(tmpdir(), "apparent-dev-operation-batch-"));
  try {
    const file = join(dir, "rollout.jsonl");
    const read = async (vm: string, ci: string) => {
      const row = (time: number, payload: object) =>
        JSON.stringify({
          type: "response_item",
          timestamp: new Date(time).toISOString(),
          payload,
        });
      const start = (time: number, call_id: string, input: string) =>
        row(time, { type: "custom_tool_call", name: "exec", call_id, input });
      const end = (time: number, call_id: string, text: string) =>
        row(time, {
          type: "custom_tool_call_output",
          call_id,
          output: [{ type: "text", text }],
        });
      const poll = (id: number) =>
        "text(await tools.write_stdin({session_id:" + id + ',chars:""}));';
      writeFileSync(
        file,
        [
          JSON.stringify({
            type: "session_meta",
            payload: { id: "fixture", cwd: "/fixture" },
          }),
          start(1_000, "vm", launch(vm)),
          end(2_000, "vm", '{"session_id":123}'),
          start(2_500, "ci", launch(ci)),
          end(3_000, "ci", '{"session_id":456}'),
          start(4_000, "ci-wait", poll(456)),
          start(5_000, "unrelated", poll(654)),
          end(6_000, "unrelated", '{"exit_code":0}'),
          start(7_000, "vm-wait", poll(123)),
          end(8_000, "ci-wait", '{"exit_code":0}'),
          end(9_000, "vm-wait", '{"exit_code":0}'),
        ].join("\n"),
      );
      return (await readRollout(file, () => true)).calls;
    };
    const vm = vmProof(vmTs, true);
    const before = await read(vm + "\nls", ciWithLogRead + "\nls");
    const after = await read(vm, ciWithLogRead);
    const clocks = (calls: typeof after) =>
      calls.map(({ id, start, end, processObservedEnd }) => [
        id,
        start,
        end,
        processObservedEnd,
      ]);
    assert.deepEqual(clocks(after), clocks(before));
    assert.deepEqual(
      after.map((c) => c.waitedOperations),
      [
        undefined,
        undefined,
        ["CI observation"],
        undefined,
        ["isolated VM Start proof"],
      ],
    );
    const baseline = summarize(before, 0, 10_000);
    const report = summarize(after, 0, 10_000);
    assert.equal(report.calls, 5);
    assert.deepEqual(report.tools, baseline.tools);
    assert.equal(report.tools[0].arithmetic.totalSeconds, 8.5);
    assert.equal(
      report.observedToolUnionSeconds,
      baseline.observedToolUnionSeconds,
    );
    assert.equal(report.observedToolUnionSeconds, 6.5);
    assert.deepEqual(
      report.actionRanking.processes.ranked.map((g) => [
        g.label,
        g.count,
        g.totalSeconds,
      ]),
      [
        ["isolated VM Start proof", 1, 8],
        ["CI observation", 1, 5.5],
      ],
    );
    assert.equal(report.actionRanking.envelopes.coverage.completeRows, 5);
    assert.equal(report.actionRanking.envelopes.unresolvedSeconds, 1);
    assert.equal(report.actionRanking.processes.unresolvedSeconds, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
