import assert from "node:assert/strict";
import { test } from "node:test";
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
import { sceneTransitions } from "../../src/selection/scene.ts";

test("changing runs select their final measured frame, including terminal transitions", () => {
  assert.deepEqual(sceneTransitions([], [], []), []);
  assert.deepEqual(sceneTransitions([0n], [], []), []);
  assert.deepEqual(
    sceneTransitions([0n, 1000n, 1250n, 1500n, 1750n], [0.3, 0.3, 0.4, 0], []),
    [
      {
        startFrame: 0,
        frame: 3,
        diff: Math.fround(0.4),
        score: 56,
        ordinary: true,
        event: "scene changed",
      },
    ],
  );
  const terminal = sceneTransitions(
    [0n, 1000n, 2000n, 3000n],
    [0.5, 0, 0.25],
    [],
  );
  assert.deepEqual(
    terminal.map((t) => [t.startFrame, t.frame, t.score]),
    [
      [0, 1, 60],
      [2, 3, 50],
    ],
  );
});
test("threshold, maxima and scores preserve native f32 behavior", () => {
  const threshold = Math.fround(0.08),
    bits = new Uint32Array(new Float32Array([threshold]).buffer);
  const above = new Float32Array(new Uint32Array([bits[0] + 1]).buffer)[0];
  assert.deepEqual(sceneTransitions([0n, 1n], [threshold], []), []);
  assert.equal(sceneTransitions([0n, 1n], [above], []).length, 1);
  assert.equal(
    sceneTransitions([0n, 1n], [0.5184401869773865], [])[0].score,
    60.73760986328125,
    "compiled donor score; a single final f32 cast produces60.737606048583984",
  );
});
test("drawing spans suppress only ordinary scene candidates and retain runs for speech snapping", () => {
  const result = sceneTransitions(
    [0n, 10n, 20n, 30n],
    [0.5, 0, 0.5],
    [[10n, 10n]],
  );
  assert.deepEqual(
    result.map((t) => [t.frame, t.ordinary]),
    [
      [1, false],
      [3, true],
    ],
  );
  const maximum = 0xffffffffffffffffn;
  assert.equal(
    sceneTransitions(
      [maximum - 2n, maximum - 1n, maximum],
      [0, 0.5],
      [[maximum, maximum]],
    )[0].ordinary,
    false,
  );
  assert.equal(
    sceneTransitions([maximum, maximum], [0.5], [])[0].frame,
    1,
    "stable duplicate clocks preserve frame identity",
  );
});
test("bad clocks, ordering, cardinality and nonfinite image measurements fail closed", () => {
  for (const [times, deltas] of [
    [[-1n], []],
    [[0x1_0000_0000_0000_0000n], []],
    [[2n, 1n], [0.5]],
    [[0n, 1n], []],
    [[0n, 1n], [NaN]],
    [[0n, 1n], [Infinity]],
    [[0n, 1n], [-0.1]],
    [[0n, 1n], [1.1]],
  ] as Array<[bigint[], number[]]>)
    assert.throws(() => sceneTransitions(times, deltas, []));
});
test("actual private-file worker handles whole recovery-sized snapshots beyond one page and rejects disclosure", () => {
  const root = mkdtempSync(join(tmpdir(), "apparent-dev-scenes-")),
    file = join(root, "input"),
    worker = fileURLToPath(
      new URL("../../src/selection/scene-worker.ts", import.meta.url),
    );
  const request = {
    version: 1,
    times: Array.from({ length: 10001 }, (_, i) => String(BigInt(i) * 220n)),
    deltas: Array.from({ length: 10000 }, (_, i) => (i % 2 ? 0 : 0.5)),
    drawing: [],
  };
  const invoke = (...args: string[]) => {
    const fd = openSync(file, "r");
    try {
      return spawnSync(
        process.execPath,
        ["--experimental-strip-types", worker, ...args],
        {
          stdio: [fd, "pipe", "pipe"],
          encoding: "utf8",
          timeout: 10000,
          maxBuffer: 4 * 1024 * 1024,
        },
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
  const reject = (result: ReturnType<typeof run>) => {
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.equal(
      result.stderr,
      "Record could not classify scene transitions\n",
    );
  };
  try {
    const result = run(request);
    assert.equal(result.status, 0, result.stderr);
    assert(Buffer.byteLength(result.stdout) > 128 * 1024);
    const plan = JSON.parse(result.stdout);
    assert.equal(plan.frameCount, 10001);
    assert.equal(plan.transitions.length, 5000);
    assert.equal(plan.transitions.at(-1).frame, 9999);
    for (const value of [
      null,
      { ...request, version: 2 },
      { ...request, times: ["01", "2"], deltas: [0.5] },
      { ...request, times: ["0", 2], deltas: [0.5] },
      { ...request, privateText: "PRIVATE SENTINEL" },
      { ...request, drawing: [["0", "1", "PRIVATE SENTINEL"]] },
    ])
      reject(run(value));
    reject(run(request, "PRIVATE SENTINEL"));
    run(request);
    const before = readFileSync(file);
    chmodSync(file, 0o644);
    reject(invoke());
    assert.deepEqual(readFileSync(file), before);
    chmodSync(file, 0o600);
    truncateSync(file, 16 * 1024 * 1024 + 1);
    reject(invoke());
    reject(
      spawnSync(process.execPath, ["--experimental-strip-types", worker], {
        input: JSON.stringify(request),
        encoding: "utf8",
        timeout: 10000,
      }),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
