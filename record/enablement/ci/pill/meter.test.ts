import { test } from "node:test";
import { bendScratch } from "../../../../shared/enablement/bend/build.ts";
import { run } from "../../../../shared/enablement/bend/toolchain.ts";
import { buildBloom, buildInk } from "../bend/build.ts";

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

test("doodle ink keeps a quiet crawl and fits speech-weight marks inside the pill", async () => {
  await bendScratch(async (scratch) => {
    await buildInk(scratch);
    run(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
    import assert from "node:assert/strict";
    import ink from "./doodle-ink.mjs";
    assert.equal(ink.doodles_enabled(false), true);
    assert.equal(ink.doodles_enabled(true), false);
    const quiet = ink.ink_level(13, true);
    const speech = ink.ink_level(60, true);
    assert.equal(quiet, 0);
    assert.equal(ink.ink_level(200, false), quiet);
    assert.equal(ink.ink_level(200, true), 100);
    assert.equal(ink.ink_speed(quiet), 16);
    assert.equal(ink.ink_speed(1), 16);
    assert.equal(ink.ink_speed(speech), 108);
    assert.equal(ink.ink_speed(100), 206);
    assert.ok(ink.ink_width(speech) > ink.ink_width(quiet));
    assert.ok(ink.ink_alpha(0, speech) > ink.ink_alpha(0, quiet));
    assert.equal(ink.ink_alpha(ink.ink_lifetime_ms(), speech), 0);
    const high = ink.ink_placement(100, 0, 54, 24);
    const low = ink.ink_placement(100, 100, 54, 24);
    const tall = ink.ink_placement(100, 100, 54, 44);
    assert.equal(high.top, 5);
    assert.ok(low.top - high.top >= 10);
    assert.ok(low.scale >= 1200);
    assert.ok(low.top + (24 * low.scale) / 1000 <= 50);
    assert.equal(tall.scale, 1000);
    assert.equal(tall.top, 5);
    `,
      ],
      scratch,
    );
  });
});
