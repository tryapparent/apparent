import { test } from "node:test";
import assert from "node:assert/strict";
import { comments, checkComments } from "../../comments.ts";
import { fixture } from "../fixture.ts";

test("Rust raw identifiers and raw pointers preserve lexical comment classification", async () => {
  const source = `fn sample() {
    let mut raw = 1;
    consume(&raw, raw);
    let r#type = br###"// bytes /* literal */"###;
    let text = r###"/* literal */"###;
    /* outer /* nested */ end */
}
/// doc
fn documented() {} // trailing
`;
  assert.deepEqual(await comments("engine/sample.rs", source), [
    "/* outer /* nested */ end */",
    "/// doc",
    "// trailing",
  ]);
  assert.deepEqual(
    await comments(
      "engine/pointer.rs",
      "fn sample() { let p = &raw const value; let q = &raw mut value; /* actual */ }",
    ),
    ["/* actual */"],
  );
  for (const invalid of [
    "fn broken( {",
    "fn sample() { /* unterminated",
    'fn sample() { let text = r###"unterminated; }',
    "fn sample() { let raw = 1; consume(&raw, raw); let p = &raw const value; }",
  ])
    await assert.rejects(
      comments("engine/sample.rs", invalid),
      /syntax parser/,
    );
});

test("Rust raw syntax keeps staged comment changes fail closed", async (t) => {
  const f = fixture(t);
  const source = "fn sample() { let raw = 1; consume(&raw, raw); }\n";
  f.put("engine/sample.rs", source + "// legacy\n");
  f.stage();
  f.commit();
  const head = f.git("rev-parse", "HEAD").trim();
  const check = async (text: string) => {
    f.put("engine/sample.rs", text);
    f.stage();
    return checkComments(f.dir, head, f.git("write-tree").trim());
  };
  assert.deepEqual(
    await check(source.replace("= 1", "= 2") + "// legacy\n"),
    [],
  );
  assert.deepEqual(await check(source), []);
  for (const suffix of [
    "// changed\n",
    "// legacy\n// new\n",
    "// legacy\n// legacy\n",
  ])
    assert.match(
      (await check(source + suffix)).join("\n"),
      /added\/changed code comment/,
    );
  assert.match((await check("fn broken( { ")).join("\n"), /syntax parser/);
});
