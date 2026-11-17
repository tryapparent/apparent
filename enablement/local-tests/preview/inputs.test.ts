import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  rmSync,
  chmodSync,
} from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { selection, commands } from "../run.ts";

function fixture(t: any) {
  const dir = mkdtempSync("/tmp/apparent-dev-push-inputs-");
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const env = { ...process.env };
  for (const name of Object.keys(env))
    if (name.startsWith("GIT_")) delete env[name];
  env.GIT_CONFIG_GLOBAL = "/dev/null";
  env.GIT_CONFIG_NOSYSTEM = "1";
  const git = (...args: string[]) => {
    const result = spawnSync("git", args, { cwd: dir, env, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const put = (name: string, text: string) => {
    mkdirSync(join(dir, name, ".."), { recursive: true });
    writeFileSync(join(dir, name), text);
  };
  git("init", "-q");
  git("config", "user.name", "Synthetic");
  git("config", "user.email", "synthetic@example.invalid");
  put(".githooks/pre-commit", "#!/bin/sh\nexit 0\n");
  chmodSync(join(dir, ".githooks/pre-commit"), 0o755);
  git("add", ".");
  git("commit", "-qm", "base");
  return { dir, git, put, base: git("rev-parse", "HEAD") };
}

test("known executable hook and guard inputs select tooling, preserving real product consumers", (t) => {
  const f = fixture(t);
  f.put(".githooks/pre-commit", "#!/bin/sh\nexit 1\n");
  f.git("add", ".");
  f.git("commit", "-qm", "policy");
  assert.deepEqual(selection(f.base, "HEAD", f.dir).selected, ["tooling"]);
  f.put(
    "shared/enablement/dependency-policy/new.ts",
    "export const policy = true;",
  );
  f.git("add", ".");
  f.git("commit", "-qm", "new guard");
  assert.deepEqual(selection(f.base, "HEAD", f.dir).selected, ["tooling"]);
  f.put(
    "connect/service/src/consumer.ts",
    "import {policy} from '../../../shared/enablement/dependency-policy/new.ts';\n",
  );
  f.git("add", ".");
  f.git("commit", "-qm", "consumer");
  const prior = f.git("rev-parse", "HEAD");
  f.put(
    "shared/enablement/dependency-policy/new.ts",
    "export const policy = false;",
  );
  f.git("add", ".");
  f.git("commit", "-qm", "policy followup");
  assert.ok(selection(prior, "HEAD", f.dir).selected.includes("service"));
});

test("local selection preserves full Rust delta through earlier commits, deletion and moves", (t) => {
  const f = fixture(t);
  f.put("capture/engine/old.rs", "fn old() {}");
  f.git("add", ".");
  f.git("commit", "-qm", "rust base");
  const base = f.git("rev-parse", "HEAD");
  f.git("rm", "capture/engine/old.rs");
  f.git("commit", "-qm", "delete rust");
  f.put("README.md", "later prose");
  f.git("add", ".");
  f.git("commit", "-qm", "later");
  assert.equal(selection(base, "HEAD", f.dir).rustChanged, true);
  assert.equal(selection("missing", "HEAD", f.dir).rustChanged, true);
  const local = commands(["desktop"], "base", "head", "linux", false, {
    paths: ["capture/desktop/ui/frontend/src/main.tsx"],
    local: true,
  });
  assert.ok(!local.some((command) => command.argv.includes("test:electron")));
  const hosted = commands(["desktop"], "base", "head", "linux", false, {
    paths: ["capture/desktop/ui/frontend/src/main.tsx"],
  });
  assert.ok(hosted.some((command) => command.argv.includes("test:electron")));
  assert.ok(!local.some((command) => command.argv.includes("--pr")));
});
