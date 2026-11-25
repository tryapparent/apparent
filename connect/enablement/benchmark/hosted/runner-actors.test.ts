import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readCpuQuota } from "./quota.ts";
import { processTicks, withRunnerActors } from "./runner-actors.ts";

test("reads process identity and CPU counters without command arguments", () => {
  const stat = readFileSync("/proc/self/stat", "utf8");
  const actual = processTicks(stat);
  assert.ok(actual.startTicks > 0);
  assert.ok(actual.ticks >= 0);
  assert.deepEqual(
    processTicks(stat.replace(/\([^)]*\)/, "(replay actor (test))")),
    {
      ...actual,
      name: "replay actor (test)",
    },
  );
});

test("runner actor sampling has a joined, unscored result", async () => {
  const { groups } = await readCpuQuota();
  let report: unknown;
  const result = await withRunnerActors(
    groups[0].path,
    async () => "replayed",
    async (value) => {
      report = value;
    },
  );
  assert.equal(result, "replayed");
  assert.equal((report as { scored: boolean }).scored, false);
  assert.ok((report as { snapshots: number }).snapshots >= 2);
});
