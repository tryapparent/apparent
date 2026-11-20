import { strict as assert } from "node:assert";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readRollout, summarize } from "../census.ts";

test("links literal stored sessions only through a verified sequence of structured receipts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "apparent-dev-stored-session-"));
  const file = join(dir, "rollout.jsonl");
  const meta = (id: string) => ({
    type: "session_meta",
    payload: { id, cwd: "/fixture" },
  });
  const row = (ms: number, type: string, call_id: string, fields: object) => ({
    type: "response_item",
    timestamp: new Date(ms).toISOString(),
    payload: { type, call_id, ...fields },
  });
  const exec = (ms: number, id: string, input: string) =>
    row(ms, "custom_tool_call", id, { name: "exec", input });
  const reply = (ms: number, id: string, output: unknown) =>
    row(ms, "custom_tool_call_output", id, { output });
  const receipt = {
    chunk_id: "abcdef",
    wall_time_seconds: 1.23,
    original_token_count: 1,
    output: "/tmp/apparent-dev-fixture-run\n",
  };
  const structured = (fields: object) => [
    {
      type: "input_text",
      text: "Script completed\nWall time 1.2 seconds\nOutput:\n",
    },
    { type: "input_text", text: JSON.stringify({ ...receipt, ...fields }) },
  ];
  const running = structured({ session_id: 123 });
  const done = structured({ exit_code: 0 });
  const duplicated = [
    done[0],
    {
      ...done[1],
      text: done[1].text.replace(
        '"exit_code":0',
        '"exit_code":1,"exit_code":0',
      ),
    },
  ];
  const launch =
    'const r=await tools.exec_command({cmd:`d=$(mktemp -d /tmp/apparent-dev-fixture-XXXXXX)\nprintf "%s" "$d"\ntimeout 30m gh run watch 1234 -R example/project --exit-status --compact --interval 60 > "$d/watch.log" 2>&1`,yield_time_ms:1000});store("delivery",r.session_id);store("deliverdir",r.output.trim());text(r)';
  const poll =
    '// @exec: {"yield_time_ms": 60000}\ntext(await tools.write_stdin({session_id:load("delivery"),chars:"",yield_time_ms:59000}))';
  const initial = [
    meta("s"),
    exec(1000, "launch", launch),
    reply(2000, "launch", running),
  ];
  const progress = [
    exec(3000, "one", poll),
    reply(4000, "one", running),
    exec(5000, "two", poll),
    reply(7000, "two", running),
  ];
  const terminal = [exec(8000, "last", poll), reply(11_000, "last", done)];
  const run = async (rows: object[], extraRollout: object[] = []) => {
    await writeFile(
      file,
      rows.map((entry) => JSON.stringify(entry)).join("\n"),
    );
    const { calls } = await readRollout(file, () => true);
    if (extraRollout.length) {
      await writeFile(
        file,
        extraRollout.map((entry) => JSON.stringify(entry)).join("\n"),
      );
      calls.push(...(await readRollout(file, () => true)).calls);
    }
    return calls;
  };
  try {
    const calls = await run([
      ...initial,
      ...progress,
      ...terminal,
      exec(12_000, "stale", poll),
      reply(13_000, "stale", done),
    ]);
    assert.deepEqual(
      calls.map((c) => [c.id, c.start, c.end, c.processObservedEnd]),
      [
        ["launch", 1000, 2000, 11_000],
        ["one", 3000, 4000, undefined],
        ["two", 5000, 7000, undefined],
        ["last", 8000, 11_000, undefined],
        ["stale", 12_000, 13_000, undefined],
      ],
    );
    const [producer, ...polls] = calls;
    assert.ok(producer.operations!.length > 1);
    for (const observation of polls.slice(0, 3))
      assert.deepEqual(observation.waitedOperations, producer.operations);
    assert.equal(polls[3].waitedOperations, undefined);
    const report = summarize(calls.slice(0, 4), 0, 11_000);
    const waits = report.actionRanking.envelopes.ranked.find(
      (group) => group.label === "process wait",
    );
    assert.deepEqual(
      [
        waits?.count,
        waits?.meanSeconds,
        waits?.totalSeconds,
        waits?.unresolved,
      ],
      [3, 2, 6, true],
    );
    assert.equal(report.observedToolUnionSeconds, 7);
    assert.deepEqual(
      report.actionRanking.processes.ranked.map((group) => [
        group.count,
        group.meanSeconds,
        group.totalSeconds,
        group.unresolved,
      ]),
      [[1, 10, 10, true]],
    );

    const withoutMetadata = launch.replace(
      'store("deliverdir",r.output.trim());',
      "",
    );
    assert.equal(
      (
        await run([
          meta("s"),
          exec(1000, "launch", withoutMetadata),
          initial[2],
          ...terminal,
        ])
      )[0].processObservedEnd,
      11_000,
    );

    for (const [label, suffix] of [
      [
        "receipt mismatch",
        [
          exec(3000, "one", poll),
          reply(4000, "one", structured({ session_id: 321 })),
          ...terminal,
        ],
      ],
      [
        "alias overwritten",
        [
          exec(4200, "write", 'store("delivery", 321)'),
          reply(4400, "write", ""),
          ...terminal,
        ],
      ],
      [
        "ambiguous write",
        [
          exec(4200, "write", 'store(load("key"), 123)'),
          reply(4400, "write", ""),
          ...terminal,
        ],
      ],
      [
        "colliding launch receipt",
        [
          exec(4200, "other", launch.replaceAll("delivery", "other")),
          reply(4400, "other", running),
          ...terminal,
        ],
      ],
      [
        "overlapping scripts",
        [
          exec(1200, "write", 'store("delivery", 321)'),
          reply(4200, "write", ""),
          ...terminal,
        ],
      ],
      ["batched poll", [exec(8000, "last", poll + "\n" + poll), terminal[1]]],
      [
        "dynamic target",
        [exec(8000, "last", poll.replace('"delivery"', "key")), terminal[1]],
      ],
      [
        "write to process",
        [
          exec(8000, "last", poll.replace('chars:""', 'chars:"input"')),
          terminal[1],
        ],
      ],
      ["missing terminal call", [terminal[1]]],
      ["missing terminal receipt", [terminal[0]]],
      [
        "conflicting terminal fields",
        [
          terminal[0],
          reply(11_000, "last", structured({ session_id: 123, exit_code: 0 })),
        ],
      ],
      [
        "duplicate terminal field",
        [terminal[0], reply(11_000, "last", duplicated)],
      ],
      [
        "exit code in stdout",
        [
          terminal[0],
          reply(
            11_000,
            "last",
            structured({ output: "Process exited with code 0" }),
          ),
        ],
      ],
      [
        "multiple terminal receipts",
        [terminal[0], reply(11_000, "last", [...done, done[1]])],
      ],
      ["new session", [meta("new"), ...terminal]],
    ] as const) {
      const result = await run([...initial, ...suffix]);
      assert.ok(
        result.every((c) => c.processObservedEnd === undefined),
        label,
      );
      assert.equal(
        result.find((c) => c.id === "last")?.waitedOperations,
        undefined,
        label,
      );
    }

    for (const [label, rows] of [
      ["missing launch output", initial.slice(0, 2)],
      [
        "outstanding yielded writer",
        [
          initial[0],
          exec(500, "writer", 'store("delivery", await unresolved())'),
          reply(
            800,
            "writer",
            "Script running with cell ID g1:2\nWall time 0.3 seconds\nOutput:\n",
          ),
          ...initial.slice(1),
        ],
      ],
      [
        "malformed launch receipt",
        [
          initial[0],
          initial[1],
          reply(2000, "launch", structured({ session_id: "123" })),
        ],
      ],
      [
        "metadata overwrites handle",
        [
          initial[0],
          exec(1000, "launch", launch.replace('"deliverdir"', '"delivery"')),
          initial[2],
        ],
      ],
      [
        "different result printed",
        [
          initial[0],
          exec(1000, "launch", launch.replace("text(r)", "text(other)")),
          initial[2],
        ],
      ],
      [
        "dynamic producer",
        [
          initial[0],
          exec(
            1000,
            "launch",
            launch.replace("d=$(mktemp", "d=${other}$(mktemp"),
          ),
          initial[2],
        ],
      ],
    ] as const)
      assert.equal(
        (await run([...rows, ...terminal]))[0].processObservedEnd,
        undefined,
        label,
      );

    const separate = await run(initial, [meta("s"), ...terminal]);
    assert.equal(separate[0].processObservedEnd, undefined, "separate rollout");
    assert.equal(
      separate.at(-1)?.waitedOperations,
      undefined,
      "separate rollout",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
