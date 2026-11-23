import assert from "node:assert/strict";
import { test } from "node:test";
import { commands } from "../run.ts";

const workflow = ".github/workflows/stream-record.yml";
const fixture = "enablement/ci/routing/test-only/workflow-triggers.test.ts";
const triggerContract = { argv: ["bun", "test", fixture], cwd: "." };

test("local workflow edits select the hosted trigger fixture before owner suites", () => {
  for (const paths of [
    [workflow],
    [workflow, "record/media/src/assembly/frame-label.bend"],
    [fixture],
    null,
  ]) {
    assert.deepEqual(
      commands(["tooling"], "base", "head", "linux", false, {
        paths,
        local: true,
      })[0],
      triggerContract,
    );
  }
  assert.deepEqual(
    commands(["tooling"], "base", "head", "darwin", false, {
      paths: [workflow],
      workflowControls: [workflow],
      local: true,
    })[0],
    triggerContract,
  );
});

test("ordinary local edits and hosted owner plans do not add the trigger command", () => {
  for (const scope of [
    { paths: ["record/media/src/assembly/frame-label.bend"], local: true },
    { paths: [workflow], local: false },
  ]) {
    assert.ok(
      !commands(["capture"], "base", "head", "linux", false, scope).some(
        (command) => command.argv.includes(fixture),
      ),
    );
  }
});
