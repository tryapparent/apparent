import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

test("release ancestry uses the live canonical tip and requires complete matching Git history", (t) => {
  const directory = mkdtempSync(
    join(tmpdir(), "apparent-dev-release-history-"),
  );
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
  };
  for (const name of execFileSync("git", ["rev-parse", "--local-env-vars"], {
    encoding: "utf8",
  })
    .trim()
    .split("\n"))
    Reflect.deleteProperty(env, name);
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: directory, env, encoding: "utf8" }).trim();
  git("init", "-qb", "main");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.invalid");
  git("commit", "-qm", "base", "--allow-empty");
  const base = git("rev-parse", "HEAD");
  git("commit", "-qm", "canonical main", "--allow-empty");
  const main = git("rev-parse", "HEAD");
  git("checkout", "-qb", "feature", base);
  git("commit", "-qm", "diverged", "--allow-empty");
  const diverged = git("rev-parse", "HEAD");
  git("update-ref", "refs/remotes/origin/main", diverged);
  const realGit = execFileSync("sh", ["-c", "command -v git"], {
    encoding: "utf8",
  }).trim();
  const bin = join(directory, "bin");
  mkdirSync(bin);
  writeFileSync(
    join(bin, "git"),
    `#!/bin/sh
set -eu
url=https://github.com/tryapparent/apparent.git
case "$1 \${2-}" in
  "ls-remote --get-url")
    test "$3" = "$url"
    printf "%s\\n" "\${FIXTURE_URL:-$url}"
    ;;
  "-c http.followRedirects=false")
    shift 2
    test "$*" = "ls-remote --exit-code --refs $url refs/heads/main"
    printf "%s\\t%s\\n" "$FIXTURE_TIP" "\${FIXTURE_REF:-refs/heads/main}"
    ;;
  *) exec '${realGit}' "$@" ;;
esac
`,
    { mode: 0o700 },
  );
  const check = (
    sha: string,
    patch: Record<string, string> = {},
    repo = "tryapparent/apparent",
  ) =>
    spawnSync(
      "python3",
      [
        "-c",
        'import runpy, sys; runpy.run_path(sys.argv[1])["require_main_ancestry"](*sys.argv[2:])',
        resolve("enablement/release_gate.py"),
        repo,
        sha,
      ],
      {
        cwd: directory,
        encoding: "utf8",
        env: {
          ...env,
          PATH: `${bin}:${env.PATH}`,
          FIXTURE_TIP: main,
          ...patch,
        },
      },
    );
  for (const sha of [base, main])
    assert.equal(check(sha).status, 0, check(sha).stderr);
  for (const [sha, patch] of [
    [diverged, {}],
    ["a".repeat(40), {}],
    [base, { FIXTURE_TIP: "f".repeat(40) }],
  ] as const)
    assert.match(check(sha, patch).stderr, /Cannot prove verified commit/);
  assert.match(
    check(base, { FIXTURE_REF: "refs/heads/feature" }).stderr,
    /exact canonical main ref/,
  );
  assert.match(
    check(base, { FIXTURE_URL: "https://github.com/fork/apparent.git" }).stderr,
    /URL is rewritten/,
  );
  assert.match(check(base, {}, "fork/apparent").stderr, /canonical repository/);
  writeFileSync(join(directory, ".git", "shallow"), main + "\n");
  assert.match(check(base).stderr, /full-history checkout/);
});
