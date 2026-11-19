import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  planQuietExport,
  quietParameters,
  type QuietFacts,
  type TimelineItem,
} from "../../src/export/policy.ts";

const facts = (extra: Partial<QuietFacts> = {}): QuietFacts => ({
  durationMs: 40000n,
  videoOffsetMs: 0n,
  frozen: [[0n, 40000n]],
  silent: [[0n, 40000n]],
  timeline: [],
  limits: { maximumIntervals: 64, supportedRate: 4 },
  ...extra,
});

test("Record supplies the existing native detector parameters", () => {
  assert.deepEqual(quietParameters(), {
    freezeNoiseDb: -60,
    freezeDurationMs: 12000,
    silenceNoiseDb: -55,
    silenceDurationMs: 1000,
  });
});
test("quiet intersections preserve reading time, minimum interior and recorded silence", () => {
  assert.deepEqual(planQuietExport(facts()), [
    { startMs: 5000n, endMs: 35000n, rate: 4 },
  ]);
  assert.deepEqual(
    planQuietExport(
      facts({
        durationMs: 19000n,
        frozen: [[0n, 19000n]],
        silent: [[0n, 19000n]],
      }),
    ),
    [],
  );
  assert.deepEqual(planQuietExport(facts({ silent: [] })), []);
  assert.deepEqual(planQuietExport(facts({ frozen: [] })), []);
  assert.deepEqual(planQuietExport(facts({ silent: [[5000n, 30000n]] })), [
    { startMs: 10000n, endMs: 25000n, rate: 4 },
  ]);
});
test("all semantic content kinds protect nearby source time across video offsets", () => {
  for (const kind of [
    "event",
    "stroke",
    "mark",
    "transcript",
    "cursor",
  ] as const) {
    assert.deepEqual(
      planQuietExport(
        facts({
          videoOffsetMs: 1000n,
          timeline: [{ kind, startMs: 28000n, endMs: 31000n }],
        }),
      ),
      [{ startMs: 5000n, endMs: 25000n, rate: 4 }],
    );
  }
  const timeline: TimelineItem[] = [
    { kind: "cursor", startMs: 5000n, endMs: 5000n },
    { kind: "cursor", startMs: 35000n, endMs: 35000n },
  ];
  assert.deepEqual(
    planQuietExport(facts({ timeline })),
    [{ startMs: 10000n, endMs: 33000n, rate: 4 }],
    "gaps between cursor samples are not motion",
  );
  assert.deepEqual(
    planQuietExport(
      facts({ timeline: [{ kind: "mark", startMs: 0n, endMs: 40000n }] }),
    ),
    [],
  );
});
test("full u64 clocks and pads saturate without number rounding", () => {
  const maximum = 0xffff_ffff_ffff_ffffn;
  assert.deepEqual(
    planQuietExport(
      facts({
        durationMs: maximum,
        frozen: [[0n, maximum]],
        silent: [[0n, maximum]],
      }),
    ),
    [{ startMs: 5000n, endMs: maximum - 5000n, rate: 4 }],
  );
  assert.deepEqual(
    planQuietExport(
      facts({
        durationMs: maximum,
        frozen: [[0n, maximum]],
        silent: [[0n, maximum]],
        timeline: [
          { kind: "event", startMs: maximum - 10000n, endMs: maximum },
        ],
      }),
    ),
    [{ startMs: 5000n, endMs: maximum - 12000n, rate: 4 }],
  );
  assert.deepEqual(
    planQuietExport(
      facts({
        videoOffsetMs: maximum,
        timeline: [{ kind: "event", startMs: 1n, endMs: 2n }],
      }),
    ),
    [{ startMs: 5000n, endMs: 35000n, rate: 4 }],
  );
});
test("native filter budget retains earliest intervals without mutating input", () => {
  const ranges = Array.from({ length: 70 }, (_, i) =>
    Object.freeze([BigInt(i) * 60000n, BigInt(i) * 60000n + 40000n] as const),
  );
  const input = facts({
    durationMs: 4200000n,
    frozen: Object.freeze(ranges),
    silent: [[0n, 4200000n]],
    timeline: Object.freeze([]),
    limits: Object.freeze({ maximumIntervals: 64, supportedRate: 4 }),
  });
  const selected = planQuietExport(Object.freeze(input));
  assert.equal(selected.length, 64);
  assert.equal(selected[63].startMs, 63n * 60000n + 5000n);
  assert.equal(ranges.length, 70);
  assert.deepEqual(ranges[0], [0n, 40000n]);
});
test("unsupported clocks, extents, content and native limits fail closed", () => {
  for (const change of [
    { durationMs: -1n },
    { videoOffsetMs: 0x1_0000_0000_0000_0000n },
    { durationMs: 40000 as unknown as bigint },
    { frozen: [[0n, 40001n]] as const },
    {
      timeline: [
        { kind: "unknown", startMs: 0n, endMs: 1n },
      ] as unknown as TimelineItem[],
    },
    { limits: { maximumIntervals: 0, supportedRate: 4 } },
    { limits: { maximumIntervals: 65, supportedRate: 4 } },
    { limits: { maximumIntervals: 64, supportedRate: 8 } },
  ])
    assert.throws(() => planQuietExport(facts(change)));
});
test("real private-file worker preserves clocks and rejects disclosure, extra fields, pipes and oversized input", () => {
  const root = mkdtempSync(join(tmpdir(), "apparent-dev-quiet-"));
  const file = join(root, "input"),
    worker = fileURLToPath(
      new URL("../../src/export/worker.ts", import.meta.url),
    );
  const maximum = "18446744073709551615";
  const request = {
    version: 1,
    durationMs: maximum,
    videoOffsetMs: "0",
    frozen: [["0", maximum]],
    silent: [["0", maximum]],
    timeline: [],
    limits: { maximumIntervals: 64, supportedRate: 4 },
  };
  const invoke = (...args: string[]) => {
    const fd = openSync(file, "r");
    try {
      return spawnSync(
        process.execPath,
        ["--experimental-strip-types", worker, ...args],
        { stdio: [fd, "pipe", "pipe"], encoding: "utf8", timeout: 5000 },
      );
    } finally {
      closeSync(fd);
    }
  };
  const run = (value: unknown, ...args: string[]) => {
    writeFileSync(file, JSON.stringify(value), { mode: 0o600 });
    chmodSync(file, 0o600);
    return invoke(...args);
  };
  const rejected = (result: ReturnType<typeof run>) => {
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "Record could not plan quiet export\n");
  };
  try {
    const result = run(request);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      version: 1,
      durationMs: maximum,
      videoOffsetMs: "0",
      intervals: [{ startMs: "5000", endMs: "18446744073709546615", rate: 4 }],
    });
    for (const value of [
      null,
      { ...request, version: 2 },
      { ...request, secret: "PRIVATE SENTINEL" },
      { ...request, durationMs: 40000 },
      { ...request, durationMs: "18446744073709551616" },
      { ...request, timeline: [{ kind: ["event"], startMs: "0", endMs: "1" }] },
      {
        ...request,
        timeline: [
          { kind: "event", startMs: "0", endMs: "1", text: "PRIVATE SENTINEL" },
        ],
      },
    ])
      rejected(run(value));
    rejected(run(request, "PRIVATE SENTINEL"));
    run(request);
    const before = readFileSync(file);
    chmodSync(file, 0o644);
    rejected(invoke());
    assert.deepEqual(readFileSync(file), before);
    chmodSync(file, 0o600);
    truncateSync(file, 16 * 1024 * 1024 + 1);
    rejected(invoke());
    rejected(
      spawnSync(process.execPath, ["--experimental-strip-types", worker], {
        input: JSON.stringify(request),
        encoding: "utf8",
        timeout: 5000,
      }),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
