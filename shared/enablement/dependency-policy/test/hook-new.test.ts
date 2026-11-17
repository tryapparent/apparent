import { test } from "node:test";
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
import { fixture } from "./fixture.ts";
test("real commit enforces staged style, Markdown and languages; unstaged bytes do not rescue it", (t) => {
  const f = fixture(t);
  f.put("record/good.ts", "export const x = 1;\n");
  f.stage();
  f.git("commit", "-qm", "formatted staged source");
  writeFileSync(
    path.join(f.dir, "record/good.ts"),
    "export const x = 1 == 2;\n",
  );
  f.stage();
  writeFileSync(path.join(f.dir, "record/good.ts"), "export const x = 1;\n");
  assert.throws(
    () => f.git("commit", "-qm", "reject staged lint"),
    /noDoubleEquals/,
  );
  f.git("reset", "--hard", "HEAD");
  writeFileSync(path.join(f.dir, "record/bad.ts"), "export const x=1;");
  f.stage();
  assert.throws(
    () => f.git("commit", "-qm", "reject staged format"),
    /staged style format/,
  );
  f.git("rm", "-f", "record/bad.ts");
  f.put("readme.MD", "short");
  f.stage();
  assert.throws(
    () => f.git("commit", "-qm", "reject Markdown spelling"),
    /canonical case/,
  );
  f.git("rm", "-f", "readme.MD");
  f.put("record/new.py", "x = 1\n");
  f.stage();
  assert.throws(
    () => f.git("commit", "-qm", "reject new Python"),
    /new Python/,
  );
});
test("real hook source token boundary, partial staging, debt rename, copy and removal", async (t) => {
  const { tokens } = await import("../guards/budgets.ts");
  const f = fixture(t);
  function source(count: number) {
    let text = 'pub const TEXT: &str = "' + "x ".repeat(count - 30) + '";\n';
    while (tokens(text) < count) text = text.replace('";\n', 'x ";\n');
    assert.equal(tokens(text), count);
    return text;
  }
  f.put("engine/boundary.rs", source(4000));
  f.stage();
  f.git("commit", "-qm", "exact boundary");
  f.put("engine/boundary.rs", source(4001));
  f.stage();
  f.put("engine/boundary.rs", source(4000));
  f.fail(/4001 source tokens/);
  f.put("engine/boundary.rs", source(5000));
  f.stage();
  f.commit();
  f.put("engine/boundary.rs", source(4999));
  f.stage();
  f.pass();
  f.git("reset", "--hard", "HEAD");
  f.git("mv", "engine/boundary.rs", "engine/moved.rs");
  f.pass();
  f.commit();
  f.put("engine/copied.rs", source(5000));
  f.stage();
  f.fail(/5000 source tokens/);
  f.git("rm", "-f", "engine/copied.rs");
  f.git("rm", "-f", "engine/moved.rs");
  f.pass();
});
