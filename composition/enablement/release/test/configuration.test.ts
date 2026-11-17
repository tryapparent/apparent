import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

test("distribution recovery cannot publish while stable publication retains producer gates", () => {
  const workflow = readFileSync(".github/workflows/verification.yml", "utf8");
  const enabled = (
    job: string,
    mode: string,
    retry: boolean,
    result: string,
    cancelled = false,
  ) => {
    const expression = workflow
      .split(`\n  ${job}:\n`)[1]
      .split("    if: >-\n")[1]
      .split("\n    runs-on:")[0]
      .trim();
    return Boolean(
      Function(
        "inputs",
        "needs",
        "github",
        "cancelled",
        `return (${expression})`,
      )(
        {
          mode,
          source_sha: "",
          candidate_run_id: retry ? "123" : "",
          candidate_attempt: retry ? "1" : "",
        },
        {
          linux: { result },
          macos: { result },
          publish: { result: "skipped" },
        },
        { repository: "tryapparent/apparent", ref: "refs/heads/main" },
        () => cancelled,
      ),
    );
  };
  for (const result of ["success", "failure", "skipped", "cancelled"])
    for (const retry of [false, true]) {
      assert.equal(enabled("publish", "distribution", retry, result), false);
      assert.equal(enabled("publish", "verify", retry, result), false);
      assert.equal(
        enabled("publish", "stable", retry, result),
        retry || result === "success",
      );
      assert.equal(enabled("publish", "stable", retry, result, true), false);
      for (const job of ["feed", "cask"])
        assert.equal(enabled(job, "distribution", retry, result), retry);
    }
});

test("actual Linux readiness command rejects invalid signing configuration before Mac allocation", () => {
  const workflow = readFileSync(".github/workflows/verification.yml", "utf8");
  const block = workflow
    .split(
      "      - name: Check signing configuration before scarce allocation",
    )[1]
    .split("\n  linux:")[0];
  const script = block
    .split("        run: |\n")[1]
    .split("\n")
    .map((line) => line.slice(10))
    .join("\n");
  const configured = {
    APPLE_ENABLED: "true",
    APPLE_TEAM: "AAAAAAAAAA",
    SPARKLE_PUBLIC: Buffer.alloc(32).toString("base64"),
    SIGNING_IDENTITY: "Developer ID Application: Fixture (AAAAAAAAAA)",
    NOTARY_ID: "BBBBBBBBBB",
    NOTARY_ISSUER: "11111111-1111-1111-1111-111111111111",
    SIGNING_PASSWORD: "synthetic",
    SIGNING_CERT: "synthetic",
    NOTARY_KEY: "synthetic",
    SPARKLE_KEY: "synthetic",
    TAP_KEY: "synthetic",
  };
  const run = (patch: Record<string, string>) =>
    spawnSync("bash", ["-eu", "-c", script], {
      encoding: "utf8",
      env: { ...process.env, ...configured, ...patch },
    });
  assert.equal(run({}).status, 0);
  for (const patch of [
    { APPLE_ENABLED: "false" },
    { APPLE_TEAM: "wrong" },
    { NOTARY_ID: "wrong" },
    { NOTARY_ISSUER: "wrong" },
    { SIGNING_IDENTITY: "Developer ID Application: Fixture (BBBBBBBBBB)" },
    { SPARKLE_PUBLIC: Buffer.alloc(31).toString("base64") },
    { SIGNING_CERT: "" },
    { TAP_KEY: "" },
  ])
    assert.notEqual(run(patch).status, 0);
});
