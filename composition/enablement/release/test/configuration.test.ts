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
    linux: string,
    mac: boolean,
    admit = "success",
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
          admit: { result: admit },
          linux: { result: linux },
          macos: { outputs: { ready: mac ? "true" : "" } },
          publish: { result: linux },
          "publish-nightly": { result: mac ? "success" : "skipped" },
        },
        { repository: "tryapparent/apparent", ref: "refs/heads/main" },
        () => cancelled,
      ),
    );
  };
  for (const result of ["success", "failure", "skipped", "cancelled"])
    for (const retry of [false, true]) {
      for (const mac of [false, true]) {
        assert.equal(
          enabled("publish", "distribution", retry, result, mac),
          false,
        );
        assert.equal(enabled("publish", "verify", retry, result, mac), false);
        assert.equal(
          enabled("publish", "stable", retry, result, mac),
          retry || (mac && result === "success"),
        );
        assert.equal(
          enabled("publish", "stable", retry, result, mac, "success", true),
          false,
        );
        assert.equal(enabled("publish", "main", retry, result, mac), false);
        assert.equal(
          enabled("publish-linux", "main", retry, result, mac),
          result === "success",
        );
        assert.equal(
          enabled("publish-nightly", "main", retry, result, mac),
          mac,
        );
        assert.equal(
          enabled("publish", "mac-main", retry, result, mac),
          retry || mac,
        );
        assert.equal(
          enabled("publish", "paired-main", retry, result, mac),
          retry,
        );
        assert.equal(
          enabled("publish", "stable", retry, result, mac, "failure"),
          retry,
        );
      }
      for (const job of ["feed", "cask"])
        for (const mode of [
          "main",
          "mac-main",
          "paired-main",
          "linux-main",
          "distribution",
        ])
          assert.equal(
            enabled(job, mode, retry, result, true),
            (mode === "distribution" && retry) ||
              (job === "feed" && mode === "main"),
          );
    }
});

test("actual Linux readiness command rejects invalid signing configuration before Mac allocation", () => {
  const workflow = readFileSync(".github/workflows/verification.yml", "utf8");
  const block = workflow
    .split(
      "      - name: Check signing configuration before scarce allocation",
    )[1]
    .split("\n  macos:")[0];
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
    RELEASE_CHANNEL: "stable",
  };
  const run = (patch: Record<string, string>) =>
    spawnSync("bash", ["-eu", "-c", script], {
      encoding: "utf8",
      env: { ...process.env, ...configured, ...patch },
    });
  assert.equal(run({}).status, 0);
  assert.equal(run({ RELEASE_CHANNEL: "mac-main", TAP_KEY: "" }).status, 0);
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

test("Latest Main and Stable admit both platform jobs", () => {
  const workflow = readFileSync(".github/workflows/verification.yml", "utf8");
  for (const platform of ["linux", "macos"]) {
    const job = workflow.split(`\n  ${platform}:\n`)[1].split(/\n  [a-z]+:/)[0];
    assert.match(
      job,
      platform === "linux"
        ? /^    needs: admit$/m
        : /^    needs: \[admit, mac-signing\]$/m,
    );
    assert.ok(
      job.includes(
        platform === "linux"
          ? "(inputs.mode == 'main' || inputs.mode == 'stable')"
          : "(inputs.mode == 'main' || inputs.mode == 'mac-main' || inputs.mode == 'stable')",
      ),
    );
  }
  assert.match(workflow, /publish:\n    needs: \[admit, linux, macos\]/);
  assert.match(workflow, /publish-linux:\n    needs: \[admit, linux\]/);
  assert.match(workflow, /publish-nightly:\n    needs: \[admit, macos\]/);
  assert.match(workflow, /name: Release\n/);
  assert.match(workflow, /default: main/);
  assert.match(workflow, /mac-signing:\n    needs: admit/);
  assert.match(workflow, /cancel-in-progress: false/);
});
