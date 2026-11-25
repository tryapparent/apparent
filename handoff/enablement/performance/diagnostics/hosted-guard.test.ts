import assert from "node:assert/strict";
import test from "node:test";
import { hostedInterference } from "./hosted-guard.ts";

const start = {
  atMs: 0,
  totalUs: 0,
  busyUs: 0,
  stealUs: 0,
  workBeforeUs: 0,
  workAfterUs: 0,
  throttledUs: 0,
};
const replay = {
  atMs: 1000,
  totalUs: 4_000_000,
  busyUs: 3_000_000,
  stealUs: 0,
  workBeforeUs: 2_950_000,
  workAfterUs: 2_960_000,
  throttledUs: 0,
};
test("dedicated replay work can occupy the guest without counting as outside CPU", () => {
  const result = hostedInterference(start, replay, 1, 5);
  assert.ok(result.qualified);
  assert.equal(result.outsideCpuPercent, 1.25);
});
test("unrelated work, steal, quota throttling and I/O fail independently", () => {
  for (const [end, io, failure] of [
    [{ ...replay, busyUs: 3_300_000 }, 1, "outside-cpu"],
    [{ ...replay, stealUs: 250_000 }, 1, "steal"],
    [{ ...replay, throttledUs: 100 }, 1, "throttling"],
    [replay, 6, "io"],
  ] as const) {
    const result = hostedInterference(start, end, io, 5);
    assert.equal(result.qualified, false);
    assert.deepEqual(result.failures, [failure]);
  }
});
test("observer time outside the guest counter bracket cannot mask external load", () => {
  const result = hostedInterference(
    { ...start, workAfterUs: 100_000 },
    { ...replay, workBeforeUs: 2_850_000 },
    1,
    5,
  );
  assert.deepEqual(result.failures, ["outside-cpu"]);
});
