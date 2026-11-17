import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { YAML } from "bun";

const workflow = (name: string) =>
  YAML.parse(readFileSync(`.github/workflows/${name}`, "utf8"));

test("automatic PR and main never allocate general Mac runners, including unknown selection", () => {
  const jobs = workflow("checks.yml").jobs;
  const needs = {
    contracts: { result: "success" },
    "record-media": { result: "success" },
    portable: { result: "success" },
    select: {
      result: "success",
      outputs: {
        platform: "true",
        macos: "true",
        mac_rust: "true",
        fixtureMac: "true",
      },
    },
    reuse: { result: "success", outputs: {} },
  };
  const enabled = (expression: string, event: string) =>
    Function(
      "needs",
      "github",
      "cancelled",
      "always",
      `return (${expression})`,
    )(
      needs,
      { event_name: event, event: { pull_request: { draft: false } } },
      () => false,
      () => true,
    );
  for (const event of ["pull_request", "push"])
    for (const result of ["success", "failure", "skipped", "cancelled"]) {
      needs.select.result = result;
      for (const name of ["macos", "fixture-mac", "macos-admission"]) {
        assert.equal(
          enabled(jobs[name].if, event),
          false,
          `${event}:${result}:${name}`,
        );
      }
    }
  needs.select.result = "success";
  for (const name of ["macos", "fixture-mac"])
    assert.equal(enabled(jobs[name].if, "workflow_dispatch"), true);
  const platform = workflow("verification-platform.yml");
  assert.equal(platform.jobs["native-acceptance"]["runs-on"], "macos-15-intel");
  const release = workflow("release-mac-preview.yml");
  assert.deepEqual(Object.keys(release.on), [
    "workflow_call",
    "workflow_dispatch",
  ]);
  const names = release.jobs.preview.steps.map(
    (step: { name?: string }) => step.name,
  );
  for (const name of [
    "Prepare Developer ID credentials",
    "Build and verify the preview app",
    "Sign the Sparkle archive",
  ]) {
    assert.ok(names.includes(name), name);
  }
});

test("Linux admission excludes Mac and queues publication independently", () => {
  const ci = () => workflow("checks.yml");
  const job = ci().jobs["release-linux"];
  assert.deepEqual(job.needs, ["linux-admission", "select"]);
  assert.equal(job.uses, undefined);
  assert.equal(job["runs-on"], "ubuntu-24.04");
  assert.equal(job.permissions.actions, "write");
  assert.equal(job.permissions.contents, "read");
  assert.ok(
    job.steps.some((step: { run?: string }) =>
      step.run?.includes("composition/enablement/release/linux/dispatch.ts"),
    ),
  );
  assert.ok(
    !Object.values(ci().jobs).some(
      (job: { uses?: string }) =>
        job.uses === "./.github/workflows/release-linux.yml",
    ),
  );
  assert.match(ci().jobs["linux-admission"].if, /github.event_name == 'push'/);
  assert.ok(
    !ci().jobs["linux-admission"].needs.some((name: string) =>
      name.startsWith("mac"),
    ),
  );
  assert.equal(
    workflow("release-linux.yml").concurrency["cancel-in-progress"],
    false,
  );
  assert.match(
    workflow("release-linux.yml").jobs.admit.steps.find(
      (s: { id: string }) => s.id === "gate",
    ).run,
    /composition\/enablement\/release\/linux.ts admit/,
  );
});
