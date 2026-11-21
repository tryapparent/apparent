import { test } from "node:test";
import { bendScratch } from "../../../../shared/enablement/bend/build.ts";
import { run } from "../../../../shared/enablement/bend/toolchain.ts";
import { buildBloom } from "../bend/build.ts";

test("recording bloom holds its size through quiet and dropped samples", async () => {
  await bendScratch(async (scratch) => {
    await buildBloom(scratch);
    run(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
    import assert from "node:assert/strict";
    import policy from "./soft-bloom.mjs";
    const initial = policy.bloom(0, 0, true);
    assert.deepEqual(initial, { $: "Reading", level: 0, active: false, fresh: true });
    const quiet = policy.bloom(initial.level, 20, true);
    const loud = policy.bloom(quiet.level, 180, true);
    assert.equal(quiet.active, true);
    assert.equal(loud.active, true);
    assert.ok(loud.level > quiet.level);
    assert.ok(policy.bloom(100, 1000, true).level <= 100);
    for (const sample of [0, 4, 13]) {
      assert.deepEqual(policy.bloom(loud.level, sample, true), {
        ...loud, active: false,
      });
    }
    assert.deepEqual(policy.bloom(loud.level, 180, false), {
      ...loud, active: false, fresh: false,
    });
    assert.equal(policy.bloom(loud.level, 50, true).active, true);
    assert.equal(policy.freshness_ms(), 300);
    `,
      ],
      scratch,
    );
  });
});
