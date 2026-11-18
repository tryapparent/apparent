import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
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
  Object.assign(env, { GIT_ALLOW_PROTOCOL: "file" });
  const checkout = join(directory, "checkout");
  const publisher = join(directory, "publisher");
  const remoteUrl = pathToFileURL(publisher).href;
  mkdirSync(checkout);
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: checkout, env, encoding: "utf8" }).trim();
  git("init", "-qb", "main");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.invalid");
  git("commit", "-qm", "base", "--allow-empty");
  const base = git("rev-parse", "HEAD");
  git("commit", "-qm", "canonical main", "--allow-empty");
  const main = git("rev-parse", "HEAD");
  git("clone", "-q", checkout, publisher);
  const remote = (...args: string[]) => git("-C", publisher, ...args);
  remote("config", "user.name", "Publisher");
  remote("config", "user.email", "publisher@example.invalid");
  git("checkout", "-qb", "feature", base);
  git("commit", "-qm", "diverged", "--allow-empty");
  const diverged = git("rev-parse", "HEAD");
  git("update-ref", "refs/remotes/origin/main", diverged);
  const realGit = execFileSync("sh", ["-c", "command -v git"], {
    encoding: "utf8",
  }).trim();
  const bin = join(directory, "bin");
  const log = join(directory, "fetch.log");
  mkdirSync(bin);
  writeFileSync(log, "");
  writeFileSync(
    join(bin, "git"),
    `#!/bin/sh
set -eu
canonical=https://github.com/tryapparent/apparent.git
if [ "$1" = -c ] && [ "$2" = "http.$canonical.followRedirects=false" ]; then
  test -z "\${GIT_SSL_NO_VERIFY+x}"
  test "$3 $4" = "-c http.$canonical.sslVerify=true"
  shift 4
  case "$1" in
    ls-remote)
      test "$*" = "ls-remote --exit-code --refs $canonical refs/heads/main"
      ref=$('${realGit}' ls-remote --exit-code --refs '${remoteUrl}' refs/heads/main)
      if [ -n "\${FIXTURE_TIP-}\${FIXTURE_REF-}" ]; then
        printf '%s\\t%s\\n' "\${FIXTURE_TIP:-${main}}" "\${FIXTURE_REF:-refs/heads/main}"
      else
        printf '%s\\n' "$ref"
      fi
      exit
      ;;
    fetch)
      shift
      test "$1 $2 $3 $4 $5 $6 $7 $8" = "--no-tags --no-prune --no-prune-tags --refmap= --no-recurse-submodules --no-write-fetch-head --no-auto-maintenance --no-write-commit-graph"
      shift 8
      repair=
      if [ "$1" = --refetch ]; then repair="$1 "; shift; fi
      test "$1" = "$canonical"
      test "$#" = 2
      printf '%s%s\\n' "$repair" "$2" >> '${log}'
      exec '${realGit}' fetch --no-tags --no-prune --no-prune-tags --refmap= --no-recurse-submodules --no-write-fetch-head --no-auto-maintenance --no-write-commit-graph \${repair:+--refetch} '${remoteUrl}' "$2"
      ;;
  esac
fi
exec '${realGit}' "$@"
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
        cwd: checkout,
        encoding: "utf8",
        env: {
          ...env,
          PATH: `${bin}:${env.PATH}`,
          GIT_SSL_NO_VERIFY: "1",
          ...patch,
        },
      },
    );
  for (const sha of [base, main]) assert.equal(check(sha).status, 0);
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
  git(
    "config",
    `url.${remoteUrl}.insteadOf`,
    "https://github.com/tryapparent/apparent.git",
  );
  assert.match(check(base).stderr, /URL is rewritten/);
  git("config", "--unset", `url.${remoteUrl}.insteadOf`);
  assert.match(check(base, {}, "fork/apparent").stderr, /canonical repository/);
  assert.equal(
    readFileSync(log, "utf8"),
    `--refetch ${main}\n${"f".repeat(40)}\n`,
  );
  writeFileSync(log, "");

  const refs = git("show-ref");
  const index = readFileSync(join(checkout, ".git", "index"));
  const fetchHead = join(checkout, ".git", "FETCH_HEAD");
  writeFileSync(fetchHead, "prior fetch\n");
  remote("commit", "-qm", "publisher advanced", "--allow-empty");
  const advanced = remote("rev-parse", "HEAD");
  assert.equal(
    git("cat-file", "--batch-check", "--batch-all-objects").includes(advanced),
    false,
  );
  const accepted = check(main);
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.equal(git("cat-file", "-t", advanced), "commit");
  const rejected = check(diverged);
  assert.match(rejected.stderr, /Cannot prove verified commit/);
  assert.equal(readFileSync(log, "utf8"), advanced + "\n");

  remote("commit", "-qm", "missing parent", "--allow-empty");
  remote("commit", "-qm", "known tip with missing parent", "--allow-empty");
  const tip = remote("rev-parse", "HEAD");
  const object = join(tip.slice(0, 2), tip.slice(2));
  const objects = join(checkout, ".git", "objects");
  mkdirSync(join(objects, tip.slice(0, 2)), { recursive: true });
  copyFileSync(
    join(publisher, ".git", "objects", object),
    join(objects, object),
  );
  const repaired = check(main);
  assert.equal(repaired.status, 0, repaired.stderr);
  const fetches = `${advanced}\n--refetch ${tip}\n`;
  assert.equal(readFileSync(log, "utf8"), fetches);
  assert.equal(git("show-ref"), refs);
  assert.equal(git("rev-parse", "HEAD"), diverged);
  assert.deepEqual(readFileSync(join(checkout, ".git", "index")), index);
  assert.equal(readFileSync(fetchHead, "utf8"), "prior fetch\n");

  writeFileSync(join(checkout, ".git", "shallow"), main + "\n");
  assert.match(check(base).stderr, /full-history checkout/);
  assert.equal(readFileSync(log, "utf8"), fetches);
});
