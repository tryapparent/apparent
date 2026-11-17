import { publish } from "../publish.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  symlinkSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { create, digest, repository, workflow } from "../manifest.ts";
import { restore } from "../candidate.ts";

test("restore authenticates real archive bytes and exact producer attempt; missing/expired/tampered inputs never publish or rebuild", async () => {
  const directory = mkdtempSync(join(tmpdir(), "apparent-dev-restore-"));
  const saved = { ...process.env };
  let source = "1".repeat(40);
  const cwd = process.cwd();
  const control = "2".repeat(40),
    runId = "123",
    attempt = 2;
  const prefix = `repos/${repository}/`;
  const routes: Record<string, { file?: string; json?: unknown }> = {};
  const artifacts = [];
  try {
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: directory, encoding: "utf8" }).trim();
    git("init", "-q", "-b", "main");
    git("config", "user.name", "fixture");
    git("config", "user.email", "fixture@example.invalid");
    writeFileSync(
      join(directory, "Cargo.toml"),
      '[package]\nversion = "1.2.3"\n',
    );
    git("add", "Cargo.toml");
    git("commit", "-qm", "candidate");
    source = git("rev-parse", "HEAD");
    symlinkSync(join(cwd, "enablement"), join(directory, "enablement"));
    const bin = join(directory, "bin");
    mkdirSync(bin);
    const gh = join(bin, "gh");
    const fixture = fileURLToPath(
      new URL("./github-fixture.ts", import.meta.url),
    );
    writeFileSync(
      gh,
      `#!/bin/sh\nexec node --experimental-strip-types '${fixture}' "$@"\n`,
    );
    chmodSync(gh, 0o700);
    process.env.PATH = `${bin}:${process.env.PATH}`;
    process.env.FIXTURE_LOG = join(directory, "calls.jsonl");
    process.env.FIXTURE_ROUTES = join(directory, "routes.json");
    const run = {
      id: 123,
      repository: { full_name: repository },
      head_repository: { full_name: repository },
      path: workflow,
      head_branch: "main",
      head_sha: control,
      event: "workflow_dispatch",
      run_attempt: attempt,
    };
    routes[`${prefix}actions/runs/123`] = { json: run };
    routes[`${prefix}actions/runs/123/attempts/2/jobs?per_page=100&page=1`] = {
      json: {
        jobs: [
          "linux / Linux x86_64",
          "linux / Linux aarch64",
          "macos / Build signed Mac candidate",
        ].map((name) => ({
          name,
          run_attempt: attempt,
          status: "completed",
          conclusion: "success",
        })),
      },
    };
    for (const [platform, architecture] of [
      ["linux", "x86_64"],
      ["linux", "aarch64"],
      ["macos", "aarch64"],
    ]) {
      const name = `stable-${platform}-${architecture}-2`,
        path = join(directory, name);
      mkdirSync(path);
      const payload =
        platform === "linux"
          ? `Apparent-1.2.3-linux-${architecture}.AppImage`
          : "Apparent-Preview-1.2.3-arm64.dmg";
      writeFileSync(join(path, payload), "final checked artifact");
      writeFileSync(
        join(path, `${payload}.sha256`),
        `${await digest(join(path, payload))}  ${payload}\n`,
      );
      if (platform === "macos")
        writeFileSync(
          join(path, "Apparent-Preview-1.2.3-arm64.zip"),
          "signed zip",
        );
      await create(path, platform, architecture, {
        GITHUB_REPOSITORY: repository,
        CANDIDATE_SHA: source,
        APPARENT_VERSION: "1.2.3",
        RELEASE_TAG: "v1.2.3",
        GITHUB_RUN_ID: runId,
        GITHUB_RUN_ATTEMPT: "2",
        GITHUB_WORKFLOW_SHA: control,
        RELEASE_NATIVE_CHECKS: "true",
        RELEASE_SIGNING: "true",
        RELEASE_NOTARIZATION: "true",
      });
      const archive = join(directory, `${name}.zip`);
      execFileSync("zip", [
        "-q",
        "-j",
        archive,
        ...execFileSync("ls", [path], { encoding: "utf8" })
          .trim()
          .split("\n")
          .map((file) => join(path, file)),
      ]);
      const id = artifacts.length + 1;
      artifacts.push({
        id,
        name,
        expired: false,
        digest: `sha256:${await digest(archive)}`,
        workflow_run: { id: 123, head_sha: control },
      });
      routes[`${prefix}actions/artifacts/${id}/zip`] = { file: archive };
    }
    const artifactRoute = `${prefix}actions/runs/123/artifacts?per_page=100&page=1`;
    const save = () =>
      writeFileSync(process.env.FIXTURE_ROUTES!, JSON.stringify(routes));
    routes[artifactRoute] = { json: { artifacts } };
    save();
    const first = await restore(runId, attempt, join(directory, "good"));
    assert.equal(first.length, 3);
    assert.deepEqual(
      await restore(runId, attempt, join(directory, "retry")),
      first,
    );
    routes[artifactRoute] = { json: { artifacts: artifacts.slice(0, 2) } };
    save();
    await assert.rejects(
      restore(runId, attempt, join(directory, "missing")),
      /Missing/,
    );
    await assert.rejects(
      publish(runId, attempt, join(directory, "no-publication")),
      /Missing/,
    );
    routes[artifactRoute] = {
      json: {
        artifacts: [{ ...artifacts[0], expired: true }, ...artifacts.slice(1)],
      },
    };
    save();
    await assert.rejects(
      restore(runId, attempt, join(directory, "expired")),
      /Missing/,
    );
    routes[artifactRoute] = {
      json: {
        artifacts: [
          { ...artifacts[0], digest: `sha256:${"f".repeat(64)}` },
          ...artifacts.slice(1),
        ],
      },
    };
    save();
    await assert.rejects(
      restore(runId, attempt, join(directory, "altered")),
      /archive digest mismatch/,
    );

    assert.doesNotMatch(
      readFileSync(process.env.FIXTURE_LOG!, "utf8"),
      /release.*upload|git\/refs|--method.*POST/,
    );
    routes[artifactRoute] = { json: { artifacts } };
    routes[
      prefix +
        "actions/workflows/checks.yml/runs?head_sha=" +
        source +
        "&branch=main&event=push&per_page=100&page=1"
    ] = {
      json: {
        total_count: 1,
        workflow_runs: [
          {
            ...run,
            id: 456,
            path: ".github/workflows/checks.yml",
            event: "push",
            head_sha: source,
            status: "completed",
            conclusion: "success",
          },
        ],
      },
    };
    routes[prefix + "actions/runs/456"] = {
      json: {
        ...run,
        id: 456,
        path: ".github/workflows/checks.yml",
        event: "push",
        head_sha: source,
        status: "completed",
        conclusion: "success",
      },
    };
    routes[prefix + "actions/runs/456/attempts/2/jobs?per_page=100&page=1"] = {
      json: {
        total_count: 3,
        jobs: ["contracts", "select", "Linux verification"].map((name) => ({
          name,
          status: "completed",
          conclusion: "success",
        })),
      },
    };
    routes[prefix + "compare/" + source + "...main"] = {
      json: { status: "identical" },
    };
    save();
    process.env.GITHUB_OUTPUT = join(directory, "admission-output");
    process.env.GITHUB_REPOSITORY = repository;
    process.env.FIXTURE_STATE = join(directory, "state.json");
    writeFileSync(
      process.env.FIXTURE_STATE,
      JSON.stringify({ uploads: 0, failUpload: 2 }),
    );
    process.chdir(directory);
    await assert.rejects(
      publish(runId, attempt, join(directory, "publish-interrupted")),
    );
    const state = () =>
      JSON.parse(readFileSync(process.env.FIXTURE_STATE!, "utf8"));
    assert.equal(state().release.draft, true);
    assert.equal(state().release.assets.length, 1);
    await publish(runId, attempt, join(directory, "publish-retry"));
    assert.equal(state().release.draft, false);
    const uploads = state().uploads;
    await publish(runId, attempt, join(directory, "publish-idempotent"));
    assert.equal(state().uploads, uploads);
    const published = state();
    const altered = structuredClone(published);
    altered.release.assets[0].digest = "sha256:" + "f".repeat(64);
    writeFileSync(process.env.FIXTURE_STATE, JSON.stringify(altered));
    await assert.rejects(
      publish(runId, attempt, join(directory, "public-altered")),
      /altered bytes/,
    );
    const wrongTag = structuredClone(published);
    wrongTag.tag.object.sha = control;
    writeFileSync(process.env.FIXTURE_STATE, JSON.stringify(wrongTag));
    await assert.rejects(
      publish(runId, attempt, join(directory, "wrong-tag")),
      /tag\/source mismatch/,
    );
    const newer = structuredClone(published);
    newer.release.tag_name = "v9.0.0";
    writeFileSync(process.env.FIXTURE_STATE, JSON.stringify(newer));
    await assert.rejects(
      publish(runId, attempt, join(directory, "out-of-order")),
      /Newer stable/,
    );
    process.chdir(cwd);
    const calls = readFileSync(process.env.FIXTURE_LOG!, "utf8");
    assert.doesNotMatch(calls, /cargo|--clobber/);
  } finally {
    process.chdir(cwd);
    process.env = saved;
    rmSync(directory, { recursive: true, force: true });
  }
});
