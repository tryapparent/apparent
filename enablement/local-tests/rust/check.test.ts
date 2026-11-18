import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { checkRust } from "./check.ts";
import { diagnosticsPlan, rustAffected } from "./targets.ts";

test("native manifests, shared inputs and producer feature builds select their real targets", () => {
  const packages = (files: string[]) =>
    diagnosticsPlan(files).selected.map((item) => item.package);
  assert.deepEqual(packages(["Cargo.lock"]), ["apparent"]);
  assert.deepEqual(packages(["capture/engine/runtime.rs"]), [
    "apparent",
    "apparent-capture-engine",
  ]);
  assert.deepEqual(packages(["connect/client/Cargo.lock"]), [
    "apparent",
    "apparent-connect-client",
  ]);
  assert.deepEqual(packages(["engine/native/src/frames_main.rs"]), [
    "apparent-engine-media",
  ]);
  assert.deepEqual(packages(["capture/agent/narrator/src/main.rs"]), [
    "apparent-narrator",
  ]);
  assert.deepEqual(packages(["connect/web/src/main.ts"]), []);
  assert(rustAffected(["record/enablement/permissions/native.ts"]));
  assert(diagnosticsPlan(["public/site/video-demo/main.rs"]).demo);
  assert(
    diagnosticsPlan(["engine/native/Cargo.lock"]).selected[0].args.includes(
      "frames",
    ),
  );
});

test("real Cargo diagnostics compare complete pinned trees and tolerate line shifts", async (t) => {
  const cwd = mkdtempSync("/tmp/apparent-dev-rust-hook-test-");
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  const put = (file: string, data: string) =>
    writeFileSync(path.join(cwd, file), data);
  git("init", "-q");
  const repo = fileURLToPath(new URL("../../../", import.meta.url));
  const install = (file: string, body?: string) => {
    mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
    if (body === undefined)
      copyFileSync(path.join(repo, file), path.join(cwd, file));
    else put(file, body);
  };
  for (const file of ["check", "messages", "targets"])
    install(`enablement/local-tests/rust/${file}.ts`);
  install("shared/enablement/dependency-policy/fast/materialize.ts");
  install("shared/enablement/issues/run.ts", "process.stdin.resume();\n");
  install("enablement/local-tests/run.ts", "process.exit(0);\n");
  put(".gitignore", "/target/\n");
  git("add", "enablement", "shared", ".gitignore");
  const commit = () => {
    git("add", "main.rs", "Cargo.toml", "Cargo.lock");
    git(
      "-c",
      "user.name=Compiler Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "--no-gpg-sign",
      "-qm",
      "Compiler fixture",
    );
    return git("rev-parse", "HEAD");
  };
  put(
    "Cargo.toml",
    '[package]\nname="apparent"\nversion="0.1.0"\nedition="2024"\n[[bin]]\nname="apparent"\npath="main.rs"\n',
  );
  put(
    "Cargo.lock",
    'version = 4\n[[package]]\nname = "apparent"\nversion = "0.1.0"\n',
  );
  put("main.rs", "struct Existing;\nfn main() {}\n");
  const base = commit();
  git("update-ref", "refs/remotes/origin/main", base);
  const push = (head: string) =>
    spawnSync(
      "sh",
      [path.join(repo, ".githooks/pre-push"), "origin", "example.invalid"],
      {
        cwd,
        encoding: "utf8",
        input: `refs/heads/test ${head} refs/heads/test ${"0".repeat(40)}\n`,
      },
    );
  put("main.rs", "\nstruct Existing;\nfn main() {}\n");
  const accepted = push(commit());
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.match(accepted.stderr, /main .*apparent, 1 dead_code warning/);
  put("main.rs", "\nstruct Existing;\nstruct NewWarning;\nfn main() {}\n");
  const head = commit();
  put("main.rs", "fn main() {}\n");
  await assert.rejects(
    checkRust(cwd, base, head),
    /New Rust dead_code diagnostics:[\s\S]*NewWarning/,
  );
  git("restore", "main.rs");
  const rejected = push(head);
  assert.equal(rejected.status, 1, rejected.stderr);
  assert.match(
    rejected.stderr,
    /New Rust dead_code diagnostics:[\s\S]*NewWarning/,
  );
  await assert.rejects(checkRust(cwd, "missing", head), /Fetch origin\/main/);
  put("main.rs", "fn main() { missing(); }\n");
  const broken = commit();
  put("main.rs", "struct NewWarning;\nfn main() {}\n");
  await assert.rejects(
    checkRust(cwd, broken, commit()),
    /main .*Rust diagnostic check failed/,
  );
});
