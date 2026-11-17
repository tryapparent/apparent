import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { admit } from "../admit.ts";
import { repository } from "../manifest.ts";

test("a later unrelated failed main receipt cannot discard a pending version; published stable inputs skip without allocating builds", async () => {
  const directory = mkdtempSync(join(tmpdir(), "apparent-dev-admit-"));
  const saved = { ...process.env },
    cwd = process.cwd();
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: directory, encoding: "utf8" }).trim();
  try {
    git("init", "-q", "-b", "main");
    git("config", "user.name", "fixture");
    git("config", "user.email", "fixture@example.invalid");
    writeFileSync(
      join(directory, "Cargo.toml"),
      '[package]\nversion = "1.2.2"\n',
    );
    git("add", "Cargo.toml");
    git("commit", "-qm", "previous stable");
    writeFileSync(
      join(directory, "Cargo.toml"),
      '[package]\nversion = "1.2.3"\n',
    );
    git("add", "Cargo.toml");
    git("commit", "-qm", "pending version");
    const source = git("rev-parse", "HEAD");
    writeFileSync(join(directory, "README.md"), "unrelated prose");
    git("add", "README.md");
    git("commit", "-qm", "docs");
    const docs = git("rev-parse", "HEAD");
    git("update-ref", "refs/remotes/origin/main", docs);
    const bin = join(directory, "bin");
    mkdirSync(bin);
    const fixture = fileURLToPath(
      new URL("./github-fixture.ts", import.meta.url),
    );
    writeFileSync(
      join(bin, "gh"),
      `#!/bin/sh\nexec node --experimental-strip-types '${fixture}' "$@"\n`,
    );
    chmodSync(join(bin, "gh"), 0o700);
    process.env.PATH = `${bin}:${process.env.PATH}`;
    process.env.FIXTURE_LOG = join(directory, "log");
    process.env.FIXTURE_ROUTES = join(directory, "routes.json");
    process.env.GITHUB_RUN_ATTEMPT = "2";
    process.env.GITHUB_REPOSITORY = repository;
    process.env.GITHUB_REF = "refs/heads/main";
    process.env.GITHUB_OUTPUT = join(directory, "outputs");
    const base = `repos/${repository}/`,
      suffix = "?per_page=100&page=1";
    const runs = [docs, source].map((head_sha, index) => ({
      id: 10 - index,
      head_sha,
      path: ".github/workflows/checks.yml",
      repository: { full_name: repository },
      head_repository: { full_name: repository },
      head_branch: "main",
      event: "push",
      status: "completed",
      conclusion: "failure",
      run_attempt: 1,
    }));
    const routes: Record<string, { json: unknown }> = {
      [`${base}releases${suffix}`]: {
        json: [{ tag_name: "v1.2.2", draft: false, prerelease: false }],
      },
      [`${base}actions/workflows/checks.yml/runs?branch=main&event=push&per_page=100&page=1`]:
        { json: { workflow_runs: runs } },
    };
    for (const run of runs) {
      routes[
        `${base}actions/workflows/checks.yml/runs?head_sha=${run.head_sha}&branch=main&event=push&per_page=100&page=1`
      ] = { json: { workflow_runs: [run] } };
      routes[`${base}actions/runs/${run.id}/attempts/1/jobs${suffix}`] = {
        json: {
          jobs:
            run.head_sha === docs
              ? []
              : ["contracts", "select", "Linux verification"].map((name) => ({
                  name,
                  status: "completed",
                  conclusion: "success",
                })),
        },
      };
    }
    writeFileSync(process.env.FIXTURE_ROUTES, JSON.stringify(routes));
    process.chdir(directory);
    await admit();
    assert.match(
      readFileSync(process.env.GITHUB_OUTPUT, "utf8"),
      new RegExp(`sha=${source}\\nversion=1.2.3`),
    );
    assert.match(
      readFileSync(process.env.GITHUB_OUTPUT, "utf8"),
      /producer_attempt=2/,
    );
    rmSync(process.env.GITHUB_OUTPUT);
    routes[`${base}releases${suffix}`] = {
      json: [{ tag_name: "v1.2.3", draft: false, prerelease: false }],
    };
    writeFileSync(process.env.FIXTURE_ROUTES, JSON.stringify(routes));
    await admit();
    assert.equal(existsSync(process.env.GITHUB_OUTPUT), false);
    await assert.rejects(admit(source), /new numeric version/);
  } finally {
    process.chdir(cwd);
    process.env = saved;
    rmSync(directory, { recursive: true, force: true });
  }
});
