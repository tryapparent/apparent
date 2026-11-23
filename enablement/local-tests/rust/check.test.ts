import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
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
  for (const input of [
    "record/capture-request/src/capture-admission.bend",
    "record/enablement/ci/bend/capture-request/capture-admission.ts",
  ]) {
    assert(rustAffected([input]));
    assert.deepEqual(packages([input]), ["apparent"]);
  }
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
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );
  delete env.CARGO_BUILD_TARGET;
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd, env, encoding: "utf8" }).trim();
  const put = (file: string, data: string) =>
    writeFileSync(path.join(cwd, file), data);
  git("init", "-q");
  git("config", "core.hooksPath", ".git/hooks");
  const repo = fileURLToPath(new URL("../../../", import.meta.url));
  const install = (file: string, body?: string) => {
    mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
    if (body === undefined)
      copyFileSync(path.join(repo, file), path.join(cwd, file));
    else put(file, body);
  };
  for (const file of ["check", "messages", "scopes", "targets"])
    install(`enablement/local-tests/rust/${file}.ts`);
  install("shared/enablement/dependency-policy/fast/materialize.ts");
  const tools = "shared/enablement/dependency-policy/node_modules";
  symlinkSync(path.join(repo, tools), path.join(cwd, tools), "dir");
  install("shared/enablement/issues/run.ts", "process.stdin.resume();\n");
  install("enablement/local-tests/run.ts", "process.exit(0);\n");
  put(".gitignore", "/target/\n/cargo-home/\n");
  install(
    "build.rs",
    `
    use std::{env, fs, path::PathBuf};
    fn main() {
      let out = PathBuf::from(env::var_os("OUT_DIR").unwrap());
      let profile = out.ancestors().nth(3).unwrap();
      let source = fs::read_to_string("main.rs").unwrap();
      fs::write(profile.join("apparent-helper"), source).unwrap();
      let native = env::var("FIXTURE_NATIVE_CONFIG").unwrap();
      assert!(["preserved", "changed"].contains(&native.as_str()));
      println!("cargo:warning=fixture output {}", profile.display());
    }
  `,
  );
  install(".cargo/config.toml", '[env]\nFIXTURE_NATIVE_CONFIG = "preserved"\n');
  const cargoHome = path.join(cwd, "cargo-home");
  const cross =
    process.platform === "linux"
      ? "aarch64-apple-darwin"
      : "x86_64-unknown-linux-gnu";
  install("cargo-home/config.toml", `[build]\ntarget = "${cross}"\n`);
  git("add", "enablement", "shared", ".gitignore", ".cargo", "build.rs");
  const commit = () => {
    git("add", "main.rs", "Cargo.toml", "Cargo.lock", ".cargo");
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
  put(
    "main.rs",
    "mod previously_unused {\n    struct Same;\n}\nfn main() {}\n",
  );
  const base = commit();
  git("update-ref", "refs/remotes/origin/main", base);
  const push = (head: string, cargoEnv = {}) =>
    spawnSync(
      "sh",
      [path.join(repo, ".githooks/pre-push"), "origin", "example.invalid"],
      {
        cwd,
        env: { ...env, ...cargoEnv },
        encoding: "utf8",
        input: `refs/heads/test ${head} refs/heads/test ${"0".repeat(40)}\n`,
      },
    );
  put(
    "main.rs",
    "\nmod previously_unused {\n    struct Same;\n}\nfn main() {}\n",
  );
  const accepted = push(commit());
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.match(accepted.stderr, /main .*apparent, 1 dead_code warning/);
  const hostOS = process.platform === "linux" ? "linux" : "macos";
  put(
    "main.rs",
    `mod newly_unused {
    #[cfg(target_os = "${hostOS}")]
    struct Same;
}\nfn main() {}\n`,
  );
  install(".cargo/config.toml", '[env]\nFIXTURE_NATIVE_CONFIG = "changed"\n');
  const head = commit();
  put("main.rs", "fn main() {}\n");
  await assert.rejects(
    checkRust(cwd, base, head),
    /New Rust dead_code diagnostics:[\s\S]*Same/,
  );
  git("restore", "main.rs");
  const normalTarget = path.join(cwd, "target");
  const original = "developer companion";
  install("target/debug/apparent-helper", original);
  const rejected = push(head, {
    CARGO_HOME: cargoHome,
    CARGO_TARGET_DIR: normalTarget,
    CARGO_BUILD_BUILD_DIR: normalTarget,
  });
  assert.equal(rejected.status, 1, rejected.stderr);
  const outputs = [...rejected.stderr.matchAll(/fixture output (\S+)/g)].map(
    (match) => match[1],
  );
  assert.equal(new Set(outputs).size, 2, rejected.stderr);
  assert.match(rejected.stderr, /New Rust dead_code diagnostics:[\s\S]*Same/);
  assert.equal(
    readFileSync(path.join(normalTarget, "debug/apparent-helper"), "utf8"),
    original,
  );
  assert.deepEqual(readdirSync(normalTarget), ["debug"]);
  assert.match(
    rejected.stderr,
    new RegExp(
      `Rust diagnostics: .*-${process.platform === "linux" ? "linux" : "apple-darwin"}`,
    ),
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
