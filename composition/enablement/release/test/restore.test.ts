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
import {
  create,
  digest,
  macFallbackJob,
  macPrimaryJob,
  releaseTag,
  repository,
  targets,
  workflow,
} from "../manifest.ts";
import type { Channel } from "../manifest.ts";
import { restore } from "../candidate.ts";

async function exercisePublication(channel: Channel, historical = false) {
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
    git("update-ref", "refs/remotes/origin/main", source);
    const tag = releaseTag(channel, "1.2.3", source);
    const mode = historical ? "paired-main" : channel;
    process.env.RELEASE_CHANNEL = mode;
    process.env.FIXTURE_TAG = tag;
    symlinkSync(join(cwd, "enablement"), join(directory, "enablement"));
    const bin = join(directory, "bin");
    mkdirSync(bin);
    const realGit = execFileSync("sh", ["-c", "command -v git"], {
      encoding: "utf8",
    }).trim();
    writeFileSync(
      join(bin, "git"),
      `#!/bin/sh
set -eu
url=https://github.com/tryapparent/apparent.git
case "$1 \${2-}" in
  'ls-remote --get-url')
    test "$3" = "$url"
    printf '%s\\n' "$url"
    ;;
  "-c http.$url.followRedirects=false")
    test "$3 $4" = "-c http.$url.sslVerify=true"
    shift 4
    test "$1 $2" = "ls-remote --exit-code"
    test "$3 $4 $5" = "--refs $url refs/heads/main"
    printf '%s\\trefs/heads/main\\n' '${source}'
    ;;
  *) exec '${realGit}' "$@" ;;
esac
`,
      { mode: 0o700 },
    );
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
    process.env.GIT_ALLOW_PROTOCOL = "file";
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
        jobs: targets(channel, historical).map(({ job }) => ({
          name: !historical && job === macPrimaryJob ? macFallbackJob : job,
          run_attempt: attempt,
          status: "completed",
          conclusion: "success",
        })),
      },
    };
    for (const { platform, architecture } of targets(channel, historical)) {
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
        RELEASE_TAG: tag,
        RELEASE_CHANNEL: channel,
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
    const first = await restore(
      runId,
      attempt,
      join(directory, "good"),
      channel,
      historical,
    );
    assert.equal(first.length, targets(channel, historical).length);
    assert.deepEqual(
      await restore(
        runId,
        attempt,
        join(directory, "retry"),
        channel,
        historical,
      ),
      first,
    );
    routes[artifactRoute] = { json: { artifacts: artifacts.slice(1) } };
    save();
    await assert.rejects(
      restore(runId, attempt, join(directory, "missing"), channel, historical),
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
      restore(runId, attempt, join(directory, "expired"), channel, historical),
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
      restore(runId, attempt, join(directory, "altered"), channel, historical),
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
    save();
    process.env.GITHUB_OUTPUT = join(directory, "admission-output");
    process.env.GITHUB_REPOSITORY = repository;
    process.env.GITHUB_REF = "refs/heads/main";
    process.env.FIXTURE_STATE = join(directory, "state.json");
    writeFileSync(
      process.env.FIXTURE_STATE,
      JSON.stringify({ uploads: 0, failUpload: 2 }),
    );
    process.chdir(directory);
    await assert.rejects(
      publish(runId, attempt, join(directory, "publish-interrupted")),
    );
    assert.doesNotMatch(
      readFileSync(process.env.GITHUB_OUTPUT, "utf8"),
      /^tag=|^downloads=/m,
    );
    assert.match(
      readFileSync(process.env.GITHUB_OUTPUT, "utf8"),
      new RegExp(`^source_sha=${source}$`, "m"),
    );
    const state = () =>
      JSON.parse(readFileSync(process.env.FIXTURE_STATE!, "utf8"));
    assert.equal(state().release.draft, true);
    assert.equal(state().release.assets.length, 1);
    await publish(runId, attempt, join(directory, "publish-retry"));
    const publication = readFileSync(process.env.GITHUB_OUTPUT, "utf8").split(
      "\n",
    );
    assert.ok(publication.includes(`tag=${tag}`));
    const downloads = JSON.parse(
      publication.find((line) => line.startsWith("downloads="))!.slice(10),
    );
    assert.deepEqual(
      downloads,
      state()
        .release.assets.filter(({ name }: { name: string }) =>
          /\.(AppImage|dmg|zip)$/.test(name),
        )
        .map(({ name, size }: { name: string; size: number }) => ({
          name,
          size,
        })),
    );
    assert.equal(state().release.draft, false);
    assert.equal(state().release.prerelease, channel !== "stable");
    assert.equal(
      state().release.make_latest,
      channel === "stable" ? "true" : "false",
    );
    assert.equal(state().release.tag_name, tag);
    process.env.RELEASE_CHANNEL = channel === "stable" ? "main" : "stable";
    await assert.rejects(
      publish(runId, attempt, join(directory, "wrong-channel")),
      /Producer job not successful|Candidate identity differs/,
    );
    process.env.RELEASE_CHANNEL = mode;
    const uploads = state().uploads;
    writeFileSync(process.env.GITHUB_OUTPUT, "");
    await publish(runId, attempt, join(directory, "publish-idempotent"));
    assert.equal(state().uploads, uploads);
    const idempotent = readFileSync(process.env.GITHUB_OUTPUT, "utf8");
    assert.ok(idempotent.includes(`source_sha=${source}\n`));
    assert.ok(
      idempotent.includes(
        `tag=${tag}\ndownloads=${JSON.stringify(downloads)}\n`,
      ),
    );
    const published = state();
    for (const draft of [true, false]) {
      const missingTag = structuredClone(published);
      delete missingTag.tag;
      missingTag.release.draft = draft;
      writeFileSync(process.env.FIXTURE_STATE, JSON.stringify(missingTag));
      await assert.rejects(
        publish(runId, attempt, join(directory, `missing-tag-${draft}`)),
        /Existing release has no source tag/,
      );
      assert.deepEqual(state(), missingTag);
    }
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
    if (channel === "main") {
      git("commit", "--allow-empty", "-qm", "newer Main source");
      const newerSource = git("rev-parse", "HEAD");
      git("update-ref", "refs/remotes/origin/main", newerSource);
      newer.release.tag_name = releaseTag("main", "1.2.3", newerSource);
    }
    if (channel !== "mac-main") {
      writeFileSync(process.env.FIXTURE_STATE, JSON.stringify(newer));
      writeFileSync(process.env.GITHUB_OUTPUT, "");
      await assert.rejects(
        publish(runId, attempt, join(directory, "out-of-order")),
        /Newer (stable|Main)/,
      );
      const superseded = readFileSync(process.env.GITHUB_OUTPUT, "utf8");
      assert.ok(
        superseded.includes(`superseded_tag=${newer.release.tag_name}\n`),
      );
      assert.doesNotMatch(superseded, /^tag=|^downloads=/m);
    }
    process.chdir(cwd);
    const calls = readFileSync(process.env.FIXTURE_LOG!, "utf8");
    assert.doesNotMatch(calls, /cargo|--clobber/);
  } finally {
    process.chdir(cwd);
    process.env = saved;
    rmSync(directory, { recursive: true, force: true });
  }
}
for (const channel of ["main", "mac-main", "stable"] as const)
  test(`Exact ${channel} archives admit only a complete, immutable release`, () =>
    exercisePublication(channel));
test("a historical paired Main publication can resume only its exact artifacts", () =>
  exercisePublication("main", true));
