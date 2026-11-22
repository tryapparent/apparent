import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { checkStaged, tokens } from "../guards/staged.ts";
import { checkStyle } from "../guards/style.ts";
function fixture(t: any) {
  const cwd = mkdtempSync("/tmp/apparent-dev-staged-policy-");
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  git("init", "-q");
  git("config", "user.name", "Synthetic");
  git("config", "user.email", "synthetic@example.invalid");
  const put = (file: string, text: string) => {
    mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
    writeFileSync(path.join(cwd, file), text);
  };
  let head: string | undefined;
  const stage = () => git("add", "-A");
  const check = () => checkStaged(cwd, head, git("write-tree"));
  const commit = () => {
    git("-c", "core.hooksPath=/dev/null", "commit", "-qm", "baseline");
    head = git("rev-parse", "HEAD");
  };
  return { cwd, git, put, stage, check, commit };
}
test("Markdown exact caps count entire staged blob and ordinary special text", async (t) => {
  const f = fixture(t);
  assert.equal(tokens("x ".repeat(1999)), 2000);
  f.put("README.md", "x ".repeat(1999));
  f.stage();
  assert.deepEqual(await f.check(), []);
  f.put("README.md", "x ".repeat(2000));
  f.stage();
  f.put("README.md", "short");
  assert.match((await f.check()).join(), /2001 Markdown tokens/);
  f.put("README.md", "\n".repeat(2500));
  f.put("SKILL.md", "x ".repeat(2999));
  f.stage();
  assert.deepEqual(await f.check(), []);
  f.put("SKILL.md", "x ".repeat(3000));
  f.stage();
  assert.match((await f.check()).join(), /3001 Markdown tokens/);
  f.put("SKILL.md", "<|endoftext|>");
  f.put(
    "AGENTS.md",
    "---\nmetadata: " + "x ".repeat(1999) + "\n---\n```ts\nconst x = 1;\n```",
  );
  f.stage();
  assert.match((await f.check()).join(), /AGENTS.md/);
});
test("inherited debt cannot grow; names, case, copies and renames have no allowance", async (t) => {
  const f = fixture(t);
  f.put("README.md", "x ".repeat(2500));
  f.put("old.MD", "legacy");
  f.stage();
  f.commit();
  assert.deepEqual(await f.check(), []);
  f.put("old.MD", "legacy plus");
  f.stage();
  assert.match((await f.check()).join(), /other-name no-growth/);
  f.put("old.MD", "");
  f.put("README.md", "x ".repeat(2400));
  f.stage();
  assert.deepEqual(await f.check(), []);
  f.git("mv", "README.md", "AGENTS.md");
  assert.match((await f.check()).join(), /AGENTS.md/);
  f.put("AGENTS.md", "short");
  f.put("copy.md", "short");
  f.stage();
  assert.match((await f.check()).join(), /new Markdown/);
  f.git("rm", "-f", "copy.md");
  f.put("readme.Md", "short");
  f.stage();
  assert.match((await f.check()).join(), /canonical case/);
  f.git("rm", "-f", "readme.Md");
  assert.deepEqual(await f.check(), []);
});
test("language additions use destination path; existing repairs remain permitted", async (t) => {
  const f = fixture(t);
  for (const name of ["legacy.py", "legacy.rs", "old.js", "old.sh"])
    f.put(name, "");
  f.stage();
  f.commit();
  f.put("legacy.py", "value = 1\n");
  f.stage();
  assert.deepEqual(await f.check(), []);
  for (const [name, text] of [
    ["a.PY", ""],
    ["record/a.rs", ""],
    ["a.js", ""],
    ["tool", "#!/usr/bin/env python3\n"],
    ["tool2", "#!/usr/bin/env bash\n"],
  ])
    f.put(name, text);
  f.stage();
  assert.equal((await f.check()).length, 5);
  for (const name of ["a.PY", "record/a.rs", "a.js", "tool", "tool2"])
    f.git("rm", "-f", name);
  f.put("hermes/a.py", "");
  f.put("hermes/tool", "#!/usr/bin/env python3\nvalue = 1\n");
  f.put("engine/a.rs", "");
  f.put("record/a.ts", "export {};\n");
  f.stage();
  assert.deepEqual(await f.check(), []);
  f.git("mv", "legacy.py", "new.py");
  assert.match((await f.check()).join(), /new Python/);
});
test("Connect can relocate the two exact Rust modules without admitting edits or other moves", async (t) => {
  const f = fixture(t);
  const src = "connect/client/src";
  const moved = ["renewal", "test_support"];
  for (const name of [...moved, "other"])
    f.put(`${src}/${name}.rs`, `fn ${name}() {}\n`);
  f.stage();
  f.commit();
  for (const name of moved) {
    f.put(`${src}/${name}/mod.rs`, `fn ${name}() {}\n`);
    f.git("rm", `${src}/${name}.rs`);
  }
  f.stage();
  assert.deepEqual(await f.check(), []);
  f.put(`${src}/renewal/mod.rs`, "fn edited() {}\n");
  f.put(`${src}/other/mod.rs`, "fn other() {}\n");
  f.git("rm", `${src}/other.rs`);
  f.stage();
  const errors = (await f.check()).join("\n");
  assert.match(errors, /renewal\/mod\.rs: new Rust/);
  assert.match(errors, /other\/mod\.rs: new Rust/);
});
test("Biome checks real blobs; lint ratchet and formatting scope are explicit", () => {
  assert.deepEqual(checkStyle("a.ts", "export const x = 1;\n"), []);
  assert.match(checkStyle("a.ts", "export const x=1;").join(), /format/);
  assert.match(
    checkStyle("a.ts", "export const x = 1 == 2;\n").join(),
    /noDoubleEquals/,
  );
  assert.deepEqual(
    checkStyle("a.ts", "export const x=2;", "export const x=1;"),
    [],
  );
  assert.match(
    checkStyle(
      "a.ts",
      "export const x = 1 == 2;\n",
      "export const x=1;",
    ).join(),
    /noDoubleEquals/,
  );
  assert.match(checkStyle("a.css", "a{color:red}").join(), /format/);
  assert.match(checkStyle("a.json", '{"x":1}').join(), /format/);
  assert.match(checkStyle("a.ts", "const = ;").join(), /parse/);
});
test("missing installed Biome produces actionable failure", async (t) => {
  const f = fixture(t);
  const { readFileSync } = await import("node:fs");
  const { spawnSync } = await import("node:child_process");
  f.put(
    "style.ts",
    readFileSync(new URL("../guards/style.ts", import.meta.url), "utf8"),
  );
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--input-type=module",
      "-e",
      `import {checkStyle} from ${JSON.stringify("file://" + path.join(f.cwd, "style.ts"))}; checkStyle('a.ts', 'export {};');`,
    ],
    { encoding: "utf8" },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Biome 2.6.8 missing\/unusable; run npm ci/);
});
