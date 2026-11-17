import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  symlinkSync,
  chmodSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const tool = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = path.resolve(tool, "../../..");
export function fixture(t: any) {
  const dir = mkdtempSync(path.join(tmpdir(), "apparent-dev-deps-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: dir,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  const put = (file: string, text: string) => {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    if (/\.(?:[cm]?[jt]sx?|css|jsonc?)$/.test(file)) {
      const formatted = spawnSync(
        path.join(tool, "node_modules/.bin/biome"),
        [
          "format",
          "--config-path=" + path.join(tool, "guards/biome.json"),
          "--stdin-file-path=" + file,
          "--write",
        ],
        { input: text, encoding: "utf8" },
      );
      if (formatted.status === 0) text = formatted.stdout;
    }
    writeFileSync(path.join(dir, file), text);
  };
  git("init", "-q");
  git("config", "user.name", "Synthetic");
  git("config", "user.email", "synthetic@example.invalid");
  for (const owner of [
    "onboarding",
    "record",
    "handoff",
    "connect",
    "agent",
    "public",
    "hermes",
    "engine",
  ]) {
    put(
      `.github/workflows/stream-${owner}.yml`,
      `jobs:\n  check:\n    steps:\n      - run: node ${owner}/enablement/ci/check.ts\n`,
    );
    put(`${owner}/enablement/ci/check.ts`, "export const ready = true;\n");
  }
  put(
    ".githooks/pre-commit",
    readFileSync(path.join(repo, ".githooks/pre-commit"), "utf8"),
  );
  chmodSync(path.join(dir, ".githooks/pre-commit"), 0o755);
  put(
    "enablement/directory-width/check.py",
    readFileSync(
      path.join(repo, "enablement/directory-width/check.py"),
      "utf8",
    ),
  );
  mkdirSync(path.join(dir, "shared/enablement"), { recursive: true });
  symlinkSync(
    tool,
    path.join(dir, "shared/enablement/dependency-policy"),
    "dir",
  );
  git("config", "core.hooksPath", ".githooks");
  git("add", "-A");
  git(
    "-c",
    "core.hooksPath=/dev/null",
    "commit",
    "-qm",
    "trusted tool fixture",
  );
  const stage = () => git("add", "-A");
  const commit = () =>
    git("-c", "core.hooksPath=/dev/null", "commit", "-qm", "baseline");
  const hook = () =>
    spawnSync("sh", [".githooks/pre-commit"], { cwd: dir, encoding: "utf8" });
  const pass = () => {
    const r = hook();
    assert.equal(r.status, 0, r.stdout + r.stderr);
  };
  const fail = (pattern: RegExp) => {
    const r = hook();
    assert.notEqual(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stderr + r.stdout, pattern);
  };
  return { dir, git, put, stage, commit, pass, fail };
}
