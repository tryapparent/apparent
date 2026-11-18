import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { cargoVersion } from "../version.ts";
import { competingMain, dispatchMain } from "../main/dispatch.ts";
import { repository, workflow } from "../manifest.ts";

test("Main CI dispatches Linux Main with exact source and verification identity", () => {
  const env = {
    GITHUB_REPOSITORY: "tryapparent/apparent",
    GITHUB_REF: "refs/heads/main",
    GITHUB_EVENT_NAME: "push",
    GITHUB_SHA: "a".repeat(40),
    GITHUB_RUN_ID: "123",
  };
  const sent: string[] = [];
  dispatchMain(
    env,
    (body) => {
      sent.push(body);
    },
    () => [],
  );
  assert.deepEqual(
    sent.map((body) => JSON.parse(body)),
    [
      {
        ref: "main",
        inputs: {
          source_sha: env.GITHUB_SHA,
          verification_run_id: "123",
          mode: "main",
        },
      },
    ],
  );
  for (const patch of [
    { GITHUB_REPOSITORY: "fork/apparent" },
    { GITHUB_REF: "refs/heads/topic" },
    { GITHUB_EVENT_NAME: "pull_request" },
    { GITHUB_SHA: "main" },
    { GITHUB_RUN_ID: "0" },
    { GITHUB_RUN_ID: "" },
  ])
    assert.throws(
      () =>
        dispatchMain(
          { ...env, ...patch },
          (body) => {
            sent.push(body);
          },
          () => [],
        ),
      /canonical main/,
    );
  assert.equal(sent.length, 1);
  assert.throws(
    () =>
      dispatchMain(
        env,
        () => {
          throw Error("dispatch rejected");
        },
        () => [],
      ),
    /dispatch rejected/,
  );
});

test("Main coalesces duplicate or older requests and ignores other channels and completed runs", () => {
  const source = "1".repeat(40);
  const newer = "2".repeat(40);
  const run = {
    id: 123,
    repository: { full_name: repository },
    head_repository: { full_name: repository },
    head_branch: "main",
    head_sha: newer,
    path: workflow,
    actor: { login: "github-actions[bot]" },
    event: "workflow_dispatch",
    run_attempt: 1,
    status: "pending",
    conclusion: null,
    display_title: `main · source ${newer} · candidate run 123 · Main CI 456`,
  };
  const compare = (current: string, queued: string) =>
    current === source && queued === newer;
  assert.equal(competingMain(newer, [run], undefined, compare), newer);
  assert.equal(competingMain(source, [run], undefined, compare), newer);
  assert.equal(competingMain(source, [run], "123", compare), undefined);
  assert.equal(competingMain(newer, [run], "999", compare), undefined);
  assert.equal(
    competingMain(
      source,
      [
        { ...run, status: "completed" },
        { ...run, actor: { login: "human" } },
        {
          ...run,
          display_title: run.display_title.replace("main ·", "stable ·"),
        },
        {
          ...run,
          display_title: run.display_title.replace(
            "Main CI 456",
            "Main CI manual",
          ),
        },
      ],
      undefined,
      compare,
    ),
    undefined,
  );
});

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
  for (const [channel, verify, expected] of [
    ["stable", "false", "stable\nproduction"],
    ["main", "false", "preview\nproduction"],
    ["", "true", "preview\nsynthetic"],
  ]) {
    const result = spawnSync("bash", ["-eu", "-c", script], {
      encoding: "utf8",
      env: {
        ...process.env,
        APPARENT_RELEASE_VERSION: version,
        REQUEST_VERSION: version,
        RELEASE_CHANNEL: channel,
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
      RELEASE_CHANNEL: "stable",
      VERIFY_ONLY: "false",
    },
  });
  assert.notEqual(mismatch.status, 0);
});

test("standalone Linux publication fails before any network call", () => {
  const result = spawnSync(
    "node",
    ["--experimental-strip-types", "composition/enablement/release/linux.ts"],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        RELEASE_CHANNEL: "",
        VERIFY_ONLY: "false",
        BRIDGE_COMMIT: "",
        GH_TOKEN: "",
        PATH: process.env.PATH,
      },
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Use Release for Linux and Mac publication/);
});
