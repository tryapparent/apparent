import { test } from "bun:test";
import assert from "node:assert/strict";
import { requiresMac, requiresMacRust } from "../../select.ts";
import { affectsStream, routeDecision, routingProblems } from "../consumers.ts";

test("native crash diagnostics route to the desktop application and its release", () => {
  const path = "engine/diagnostics/supervisor/trace.rs";
  const decision = routeDecision([path]);
  assert.deepEqual(decision.selected, ["capture"]);
  assert.equal(decision.plan.root, true);
  assert.equal(decision.publicationStreams.capture, true);
  assert.equal(decision.plan.engineMedia, false);
  assert.equal(affectsStream("capture", path), true);
  assert.equal(affectsStream("engine", path), false);
  assert.deepEqual(
    routingProblems({ paths: [path], historyKnown: true, ...decision }),
    [],
  );
});

test("macOS picker changes verify and publish the desktop application", () => {
  const path = "engine/recording/macos_picker.rs";
  const decision = routeDecision([path]);
  assert.equal(decision.plan.root, true);
  assert.equal(requiresMac([path]), true);
  assert.equal(requiresMacRust([path], []), true);
  assert.equal(decision.installer, true);
  assert.equal(affectsStream("capture", path), true);
  assert.equal(affectsStream("engine", path), false);
});
