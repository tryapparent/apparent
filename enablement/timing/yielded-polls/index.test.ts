import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readRollout, summarize } from "../census.ts";

test("links a yielded single-target poll only through its own structured terminal receipt", async () => {
  const dir = await mkdtemp(join(tmpdir(), "apparent-dev-census-"));
  const file = join(dir, "yielded.jsonl");
  const row = (ms: number, type: string, call_id: string, fields: object) =>
    JSON.stringify({
      type: "response_item",
      timestamp: new Date(ms).toISOString(),
      payload: { type, call_id, ...fields },
    });
  const exec = (ms: number, id: string, input: string) =>
    row(ms, "custom_tool_call", id, { name: "exec", input });
  const output = (ms: number, id: string, output: unknown) =>
    row(ms, "custom_tool_call_output", id, { output });
  const wait = (ms: number, id: string, cell_id = "g1:2", terminate = false) =>
    row(ms, "function_call", id, {
      name: "wait",
      arguments: JSON.stringify({
        cell_id,
        yield_time_ms: 55000,
        ...(terminate ? { terminate } : {}),
      }),
    });
  const reply = (ms: number, id: string, output: unknown) =>
    row(ms, "function_call_output", id, { output });
  const poll =
    'await tools.write_stdin({session_id:123,chars:"",yield_time_ms:55000,max_output_tokens:400})';
  const wrapper =
    '// @exec: {"yield_time_ms": 1000}\nlet result;\ndo {\n  result = ' +
    poll +
    ";\n} while (result.session_id);\ntext(result)";
  const block = (text: string) => ({ type: "input_text", text });
  const completed = (...values: unknown[]) => [
    block("Script completed\nWall time 1.2 seconds\nOutput:\n"),
    ...values.map((value) => block(JSON.stringify(value))),
  ];
  const receipt = {
    chunk_id: "abcdef",
    wall_time_seconds: 1.23,
    original_token_count: 4,
    output: "fixture output\n",
  };
  const launching = completed({ ...receipt, session_id: 123 });
  const terminal = completed({ ...receipt, exit_code: 0 });
  const running =
    "Script running with cell ID g1:2\nWall time 1.0 seconds\nOutput:\n";
  const launch =
    'text(await tools.exec_command({cmd:"set -e\\nprelude=$(probe)\\ngit push",yield_time_ms:1000}));';
  const start = [
    JSON.stringify({
      type: "session_meta",
      payload: { id: "s", cwd: "/fixture" },
    }),
    exec(1000, "launch", launch),
    output(2000, "launch", launching),
  ];
  const run = async (
    source = wrapper,
    end = [reply(9000, "last", terminal)],
    before: string[] = [],
    last = wait(7000, "last"),
  ) => {
    await writeFile(
      file,
      [
        ...start,
        exec(3000, "poll", source),
        output(4000, "poll", running),
        wait(4100, "more"),
        reply(6000, "more", running),
        ...before,
        last,
        ...end,
      ].join("\n"),
    );
    return (await readRollout(file, () => true)).calls;
  };
  try {
    const calls = await run();
    assert.deepEqual(
      calls.map((c) => [c.id, c.start, c.end, c.processObservedEnd]),
      [
        ["launch", 1000, 2000, 9000],
        ["poll", 3000, 4000, undefined],
        ["more", 4100, 6000, undefined],
        ["last", 7000, 9000, undefined],
      ],
    );
    const report = summarize([...calls, ...calls], 0, 12_000);
    assert.equal(report.calls, 4);
    assert.equal(report.observedToolUnionSeconds, 5.9);
    const { envelopes, processes } = report.actionRanking;
    const waits = envelopes.ranked.find(
      (group) => group.label === "process wait",
    );
    assert.deepEqual(
      [waits?.count, waits?.meanSeconds, waits?.totalSeconds],
      [3, 4.9 / 3, 4.9],
    );
    assert.deepEqual(
      processes.ranked.map((g) => [
        g.label,
        g.count,
        g.meanSeconds,
        g.totalSeconds,
        g.unresolved,
      ]),
      [["unknown", 1, 8, 8, true]],
    );

    for (const [label, source] of [
      [
        "distinct targets",
        "text(await Promise.allSettled([tools.write_stdin({session_id:123}), tools.write_stdin({session_id:321})]))",
      ],
      [
        "mixed queries",
        "text(" + poll + '); text(await tools.exec_command({cmd:"tail log"}))',
      ],
      ["dynamic target", wrapper.replace("123", "target")],
      [
        "duplicate target property",
        wrapper.replace("123", "123,session_id:321"),
      ],
      [
        "scalar printing",
        wrapper.replace("text(result)", "text(result.exit_code)"),
      ],
    ])
      assert.equal((await run(source))[0].processObservedEnd, undefined, label);

    for (const [label, value] of [
      ["scalar", completed(0)],
      [
        "stdout with an exit code",
        completed(JSON.stringify({ ...receipt, exit_code: 0 })),
      ],
      [
        "embedded exit code",
        completed({ ...receipt, output: "Process exited with code 0" }),
      ],
      [
        "still running",
        completed({ ...receipt, session_id: 123, exit_code: 0 }),
      ],
      [
        "multiple receipts",
        completed({ ...receipt, exit_code: 0 }, { ...receipt, exit_code: 1 }),
      ],
    ] as const)
      assert.equal(
        (await run(wrapper, [reply(9000, "last", value)]))[0]
          .processObservedEnd,
        undefined,
        label,
      );

    assert.equal(
      (await run(wrapper, []))[0].processObservedEnd,
      undefined,
      "missing reply",
    );
    assert.equal(
      (await run(wrapper, undefined, [], wait(7000, "last", "g1:3")))[0]
        .processObservedEnd,
      undefined,
      "unrelated cell",
    );
    assert.equal(
      (await run(wrapper, undefined, [], wait(7000, "last", "g1:2", true)))[0]
        .processObservedEnd,
      undefined,
      "terminated cell",
    );
    for (const before of [
      [exec(6200, "other", launch), output(6300, "other", launching)],
      [exec(6200, "other", wrapper), output(6300, "other", running)],
    ])
      assert.ok(
        (await run(wrapper, undefined, before)).every(
          (call) => call.processObservedEnd === undefined,
        ),
      );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
