import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { architectureErrors } from "../guards/architecture.ts";

function repository(t: TestContext) {
  const cwd = mkdtempSync("/tmp/apparent-dev-architecture-test-");
  t.after(() => rmSync(cwd, { force: true, recursive: true }));
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
      cwd,
      encoding: "utf8",
    }).trim();
  const put = (file: string, text: string) => {
    const destination = path.join(cwd, file);
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, text);
  };
  const stage = () => {
    git("add", "-A");
    return git("write-tree");
  };
  const commit = () => {
    stage();
    git("commit", "-qm", "fixture");
    return git("rev-parse", "HEAD");
  };
  git("init", "-q");
  git("config", "user.name", "Synthetic");
  git("config", "user.email", "synthetic@example.invalid");
  git("config", "commit.gpgsign", "false");
  return { cwd, git, put, stage, commit };
}

test("legacy source growth is checked per file from the index", (t) => {
  const repo = repository(t);
  repo.put("capture/a.rs", "fn before() {}\n");
  repo.put("capture/retire.rs", "fn retire() {}\nfn extra() {}\n");
  repo.put("capture/tool", "#!/bin/sh\ntrue\n");
  repo.put("capture/README.md", "Legacy docs\n");
  const base = repo.commit();
  repo.put("capture/a.rs", "fn repaired() {}\n\n");
  repo.put("capture/README.md", "Legacy docs\nNew instructions\n");
  assert.deepEqual(architectureErrors(repo.cwd, base, repo.stage()), []);
  repo.put("capture/a.rs", "fn repaired() {}\nfn feature() {}\n");
  repo.put("capture/tool", "#!/bin/sh\ntrue\ntrue\n");
  repo.git("rm", "capture/retire.rs");
  const staged = repo.stage();
  repo.put("capture/a.rs", "fn repaired() {}\n");
  assert.deepEqual(
    architectureErrors(repo.cwd, base, staged).map(
      (error) => error.split(":")[0],
    ),
    ["capture/a.rs", "capture/tool"],
  );
});

test("new paths reject on an unborn branch and move destinations are checked", (t) => {
  const repo = repository(t);
  repo.put("capture/old.rs", "fn native() {}\n");
  repo.put("record/provider.ts", "export {};\n");
  assert.match(
    architectureErrors(repo.cwd, undefined, repo.stage()).join("\n"),
    /capture\/old.rs: capture\/ is frozen/,
  );
  const base = repo.commit();
  mkdirSync(path.join(repo.cwd, "engine"));
  repo.git("mv", "capture/old.rs", "engine/native.rs");
  assert.deepEqual(architectureErrors(repo.cwd, base, repo.stage()), []);
  repo.git("mv", "record/provider.ts", "capture/provider.ts");
  assert.match(
    architectureErrors(repo.cwd, base, repo.stage()).join("\n"),
    /capture\/provider.ts: capture\/ is frozen/,
  );
});

test("the committed range catches an aggregate increase and new product Rust", (t) => {
  const repo = repository(t);
  repo.put("capture/a.rs", "fn before() {}\n");
  const base = repo.commit();
  repo.put("capture/a.rs", "fn first() {}\nfn second() {}\n");
  repo.commit();
  repo.put("capture/a.rs", "fn third() {}\nfn second() {}\n");
  repo.put("connect/client/src/list.rs", "fn list() {}\n");
  repo.commit();
  const command = fileURLToPath(
    new URL("../guards/architecture.ts", import.meta.url),
  );
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", command, base, "HEAD"],
    { cwd: repo.cwd, encoding: "utf8" },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /capture\/a.rs: frozen capture\/ source grew/);
  assert.match(result.stderr, /connect\/client\/src\/list.rs: new Rust/);
});
