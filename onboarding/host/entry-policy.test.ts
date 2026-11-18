import assert from "node:assert/strict";
import { test } from "node:test";
import { launch } from "./entry-policy.ts";

test("unfinished setup can resume, and dismissal and completion keep startup quiet", () => {
  assert.equal(launch(false, false, false, true), "tour");
  assert.equal(launch(false, true, false, true), "quiet");
  assert.equal(launch(true, false, false, true), "quiet");
  assert.equal(launch(false, false, false, false), "quiet");
});

test("an explicit permission-repair restart can continue with coaching deferred", () => {
  assert.equal(launch(false, true, true, true), "repair");
  assert.equal(launch(true, true, true, false), "repair");
});
