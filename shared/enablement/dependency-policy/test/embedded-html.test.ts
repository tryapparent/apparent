import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { checkComments } from "../comments.ts";

test("embedded HTML admits copy-only edits and rejects changes to code or markup", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "apparent-dev-embedded-html-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
  git("init", "-q");
  const file = "demo.html";
  const source =
    '<style>p{color:red}</style><p>👋 Example.<a href="/">Home</a></p><script>let x = 1; // legacy\n</script>';
  const snapshot = (text: string) => {
    writeFileSync(path.join(dir, file), text);
    git("add", file);
    return git("write-tree");
  };
  const baseline = snapshot(source);
  const check = (next: string) => checkComments(dir, baseline, snapshot(next));
  assert.deepEqual(await check(source.replace("👋 Example.", "")), []);
  for (const next of [
    source.replace("// legacy", "// changed"),
    source.replace("color:red", "color:blue"),
    source.replace('href="/"', 'href="/demo"'),
    source.replace("👋 Example.", "<!-- new -->"),
    source.replace("<script>", '<script type="module">'),
    source + "<script>let y = 2;</script>",
  ]) {
    assert.match((await check(next)).join("\n"), /embedded HTML/);
  }
  assert.match(
    (await checkComments(dir, undefined, baseline)).join("\n"),
    /embedded HTML/,
  );
});
