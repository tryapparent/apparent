import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { YAML } from "bun";

type Job = { result: string; outputs?: Record<string, string> };
type Needs = Record<string, Job>;
const ci = () =>
  YAML.parse(readFileSync(".github/workflows/checks.yml", "utf8")) as {
    jobs: Record<string, { if: string }>;
  };
function parents(outputs: Record<string, string>): Needs {
  return {
    select: { result: "success", outputs },
    contracts: { result: "success" },
    reuse: { result: "success", outputs: {} },
    portable: { result: "success" },
    "record-media": { result: "success" },
  };
}
function admitted(
  expression: string,
  needs: Needs,
  event = "pull_request",
  draft = false,
  cancelled = false,
  context: { ref?: string; ancestors?: string[] } = {},
) {
  if (
    !/\b(?:always|cancelled|success|failure)\s*\(/.test(expression) &&
    [
      ...Object.values(needs).map((job) => job.result),
      ...(context.ancestors ?? []),
    ].some((result) => result !== "success")
  )
    return false;
  return Function(
    "github",
    "needs",
    "cancelled",
    "always",
    `return (${expression});`,
  )(
    {
      event_name: event,
      repository: "tryapparent/apparent",
      ref:
        context.ref ??
        (event === "push" ? "refs/heads/main" : "refs/pull/1/merge"),
      event: { pull_request: { draft } },
    },
    needs,
    () => cancelled,
    () => true,
  );
}

test("main-only evidence lookup skips PR allocation without skipping fresh verification", () => {
  const jobs = ci().jobs;
  for (const result of ["success", "failure", "skipped", "cancelled"]) {
    const needs = parents({
      platform: "true",
      macos: "true",
      mac_rust: "true",
      portable: "true",
    });
    needs.select.result = result;
    assert.equal(admitted(jobs.reuse.if, needs), false);
    assert.equal(admitted(jobs.reuse.if, needs, "push"), true);
    assert.equal(admitted(jobs.reuse.if, needs, "push", false, true), false);
    assert.equal(
      admitted(jobs.reuse.if, needs, "push", false, false, {
        ref: "refs/heads/feature",
      }),
      false,
    );
    needs.reuse = { result: "skipped", outputs: {} };
    for (const name of ["linux", "portable"]) {
      assert.equal(
        admitted(jobs[name].if, needs, "pull_request", false, false, {
          ancestors: ["skipped"],
        }),
        true,
        `${name}: ${result}`,
      );
      assert.equal(
        admitted(jobs[name].if, needs, "pull_request", true),
        false,
        name,
      );
      assert.equal(
        admitted(jobs[name].if, needs, "pull_request", false, true),
        false,
        name,
      );
    }
    assert.equal(admitted(jobs.macos.if, needs, "pull_request"), false);
    needs.contracts.result = "failure";
    for (const name of ["linux", "macos", "portable"])
      assert.equal(admitted(jobs[name].if, needs), name === "linux", name);
  }
});
