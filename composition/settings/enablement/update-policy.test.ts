import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { needsChannelRelease, type UpdateFacts } from "../update-policy.ts";

const main = { channel: "main" as const, id: "a".repeat(40) };
const stable = { channel: "stable" as const, id: "v0.3.13" };
test("every installed branch/version converges on the chosen release", () => {
  for (const candidate of [main, stable]) {
    for (const installed of [
      null,
      { ...main, id: "fork-revision" },
      { ...stable, id: "v99.0.0" },
      { ...stable, id: "v0.1.0" },
      { ...stable, id: "unparseable" },
      candidate,
    ]) {
      const facts = {
        candidate,
        installed,
        revision: "b".repeat(40),
        modified: false,
      };
      assert.equal(needsChannelRelease(facts), installed !== candidate);
    }
  }
});
test("a clean unmarked Main package is current; a modified build is replaced", () => {
  const facts = {
    candidate: main,
    installed: null,
    revision: main.id,
    modified: false,
  };
  assert.equal(needsChannelRelease(facts), false);
  assert.equal(needsChannelRelease({ ...facts, modified: true }), true);
  assert.equal(needsChannelRelease({ ...facts, revision: null }), true);
});
test("installed identity wins over the still-running old executable after staging", () => {
  assert.equal(
    needsChannelRelease({
      candidate: stable,
      installed: stable,
      revision: main.id,
      modified: false,
    }),
    false,
  );
});
test("the packaged worker executes the same policy without repository imports", () => {
  const script = fileURLToPath(
    new URL(
      "../../../capture/desktop/ui/frontend/electron/settings/update-worker.cjs",
      import.meta.url,
    ),
  );
  for (const candidate of [main, stable]) {
    const facts: UpdateFacts = {
      candidate,
      installed: null,
      revision: main.id,
      modified: false,
    };
    const output = execFileSync(
      process.execPath,
      [script, JSON.stringify(facts)],
      { cwd: "/", encoding: "utf8" },
    );
    assert.equal(JSON.parse(output), needsChannelRelease(facts));
  }
});
