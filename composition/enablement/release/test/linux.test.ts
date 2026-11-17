import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { cargoVersion } from "../version.ts";

test("actual Linux compilation command selects explicit stable versus preview reporting identity", () => {
  const workflow = readFileSync(".github/workflows/release-linux.yml", "utf8");
  const step = workflow
    .split("      - name: Build with PostHog error reporting\n")[1]
    .split("      - name:")[0];
  const script = step
    .split("        run: |\n")[1]
    .split("\n")
    .map((line) => line.slice(10))
    .join("\n")
    .replace(
      'GITHUB_SHA="$CANDIDATE_SHA" cargo build --release --locked',
      'printf "%s\\n" "$APPARENT_RELEASE_VERSION" "$APPARENT_RELEASE_CHANNEL" "$APPARENT_REPORTING_ENVIRONMENT"',
    );
  const version = cargoVersion(
    execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  );
  for (const [stable, verify, expected] of [
    ["true", "false", "stable\nproduction"],
    ["false", "false", "preview\nproduction"],
    ["false", "true", "preview\nsynthetic"],
  ]) {
    const result = spawnSync("bash", ["-eu", "-c", script], {
      encoding: "utf8",
      env: {
        ...process.env,
        APPARENT_RELEASE_VERSION: version,
        REQUEST_VERSION: version,
        STABLE_CANDIDATE: stable,
        VERIFY_ONLY: verify,
        CANDIDATE_SHA: "1".repeat(40),
      },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), `${version}\n${expected}`);
  }
  const mismatch = spawnSync("bash", ["-eu", "-c", script], {
    encoding: "utf8",
    env: {
      ...process.env,
      APPARENT_RELEASE_VERSION: version,
      REQUEST_VERSION: "999.0.0",
      STABLE_CANDIDATE: "true",
      VERIFY_ONLY: "false",
    },
  });
  assert.notEqual(mismatch.status, 0);
});

test("retired independent Linux stable publication fails before any network call", () => {
  const result = spawnSync(
    "node",
    [
      "--experimental-strip-types",
      "composition/enablement/release/linux.ts",
      "admit",
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        TAG: "v1.2.3",
        GH_TOKEN: "",
        PATH: process.env.PATH,
      },
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /Independent Linux stable publication is retired/,
  );
});
