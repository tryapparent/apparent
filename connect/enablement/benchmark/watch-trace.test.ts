import assert from "node:assert/strict";
import test from "node:test";
import { coverage, observe } from "./watch-trace.ts";

test("coverage counts overlapping player requests once and clips to the endpoint", () => {
  assert.deepEqual(
    coverage(10, 30, [
      { name: "early", parent: "play", startMs: 4, endMs: 8 },
      { name: "document", parent: "play", startMs: 5, endMs: 16 },
      { name: "media", parent: "play", startMs: 14, endMs: 19 },
      { name: "script", parent: "play", startMs: 26, endMs: 34 },
      { name: "late", parent: "play", startMs: 36, endMs: 40 },
    ]),
    { coveredMs: 13, overlapMs: 2, unattributedMs: 7 },
  );
});

test("trace collection preserves effects and records the boundaries of failed effects", async () => {
  const disabled = observe(false);
  assert.equal(await disabled.measure("read", "share", async () => 7), 7);
  assert.deepEqual(disabled.spans, []);
  const enabled = observe(true);
  await assert.rejects(
    enabled.measure("read", "share", async () => {
      throw Error("failed");
    }),
    /failed/,
  );
  const [span] = enabled.spans;
  assert.equal(span.name, "read");
  assert.equal(span.parent, "share");
  assert.ok(span.endMs >= span.startMs);
});
