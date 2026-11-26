import assert from "node:assert/strict";
import { test } from "node:test";
import { frogRendererRange } from "../../../../shared/enablement/ci/desktop/frog-renderer.ts";
import { routeDecision } from "../consumers.ts";

test("frog renderer edits keep Linux Electron and installer admission", () => {
  const path = "onboarding/renderer/frog/desktop.css";
  const update = { path, status: "M", oldMode: "100644", newMode: "100644" };
  const read = (): [string, string] => [
    ".frog { color: blue; }",
    ".frog { color: green; }",
  ];
  assert.equal(frogRendererRange([path], [update], read), true);
  assert.equal(
    frogRendererRange([path], [update], () => [
      "a {}",
      "a { background: url(art.png) }",
    ]),
    false,
  );
  assert.equal(frogRendererRange(null, null, read), false);
  const host = "onboarding/electron/desktop-frog/host.ts";
  assert.equal(
    frogRendererRange([path, host], [update, { ...update, path: host }], read),
    false,
  );
  const decision = routeDecision([path]);
  assert.equal(decision.plan.desktop, true);
  assert.equal(decision.installer, true);
});
