import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fixture } from "../fixture.ts";
import { checkStyle } from "../../guards/style.ts";

test("new effect use, aliases and path laundering fail the real staged hook", (t) => {
  const f = fixture(t);
  f.put(
    "record/package.json",
    JSON.stringify({ dependencies: { react: "19.0.0" } }),
  );
  f.put("record/adapter.ts", 'export {useEffect as run} from "react";');
  f.stage();
  f.commit();
  f.pass();
  f.put("record/app.ts", 'import {run} from "./adapter.ts"; run(() => {});');
  f.stage();
  writeFileSync(
    path.join(f.dir, "record/app.ts"),
    "export const repaired = true;",
  );
  f.fail(/new React useEffect/);
  f.git("rm", "-f", "record/app.ts");
  f.git("mv", "record/adapter.ts", "record/moved.ts");
  f.fail(/new React useEffect/);
});
test("same-owner renderer indirect escapes are rechecked on staged alias config changes", (t) => {
  const f = fixture(t);
  f.put(
    "record/tsconfig.json",
    JSON.stringify({
      compilerOptions: { baseUrl: ".", paths: { "@bridge": ["safe.ts"] } },
    }),
  );
  f.put("record/renderer/view.ts", 'import {read} from "@bridge"; read();');
  f.put("record/safe.ts", "export const read = () => 1;");
  f.put("record/helper.ts", 'export {readFileSync as read} from "node:fs";');
  f.stage();
  f.commit();
  f.pass();
  f.put(
    "record/tsconfig.json",
    JSON.stringify({
      compilerOptions: { baseUrl: ".", paths: { "@bridge": ["helper.ts"] } },
    }),
  );
  f.stage();
  f.fail(/renderer reaches/);
});
test("maintained syntactic rules reject focused tests, duplicate branches and any without matching fixture strings", () => {
  for (const [text, rule] of [
    ['test.only("focused", () => {});', "noFocusedTests"],
    ["export const x: any = 1;", "noExplicitAny"],
    [
      "export function f(x: number) {if (x === 1) return 1; else if (x === 1) return 2;}",
      "noDuplicateElseIf",
    ],
    [
      "export function f(x: number) {switch (x) {case 1: return 1; case 1: return 2;}}",
      "noDuplicateCase",
    ],
  ])
    assert.match(checkStyle("test.ts", text).join(), new RegExp(rule));
  assert.ok(
    !checkStyle(
      "fixture.ts",
      'export const fixture = "test.only and any";\n',
    ).some((error) => error.includes("lint/")),
  );
  assert.ok(
    checkStyle(
      "file.ts",
      "export const changed: any = 2;\n",
      "export const old: any = 1;\n",
    ).some((error) => error.includes("noExplicitAny")),
  );
});
test("real hook refuses a concurrently changed caller index", async (t) => {
  const f = fixture(t);
  f.put("record/a.ts", "export const a = 1;");
  f.stage();
  const { spawn } = await import("node:child_process");
  const child = spawn("sh", [".githooks/pre-commit"], {
    cwd: f.dir,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "",
    changed = false;
  child.stderr.on("data", (data) => {
    output += data;
    if (!changed && output.includes("Pre-commit width:")) {
      changed = true;
      f.put("record/b.ts", "export const b = 1;");
      f.stage();
    }
  });
  const status = await new Promise<number | null>((resolve, reject) => {
    child.on("exit", resolve);
    child.on("error", reject);
  });
  assert.equal(changed, true);
  assert.notEqual(status, 0);
  assert.match(output, /Index changed during checks/);
});
test("real hook redacts credential-bearing filenames before all other diagnostics", async (t) => {
  const f = fixture(t);
  const credential = "gh" + "p_" + "z".repeat(36);
  f.put("record/" + credential + ".ts", "const = ;");
  f.stage();
  const { spawnSync } = await import("node:child_process");
  const { status, stderr, stdout } = spawnSync("sh", [".githooks/pre-commit"], {
    cwd: f.dir,
    encoding: "utf8",
  });
  assert.notEqual(status, 0);
  assert.match(stderr, /path-id/);
  assert.ok(!(stderr + stdout).includes(credential));
});
test("staged Biome configuration governs admission despite an unstaged relaxation", async (t) => {
  const f = fixture(t);
  const { readFileSync, unlinkSync } = await import("node:fs");
  const { checkStaged } = await import("../../guards/staged.ts");
  unlinkSync(path.join(f.dir, "shared/enablement/dependency-policy"));
  const configuration = "shared/enablement/dependency-policy/guards/biome.json";
  const strict = readFileSync(
    new URL("../../guards/biome.json", import.meta.url),
    "utf8",
  );
  f.put(configuration, strict);
  f.put("record/a.ts", "export const x = 1 == 2;");
  f.stage();
  const tree = f.git("write-tree").trim();
  const relaxed = JSON.parse(strict);
  relaxed.linter.rules.suspicious.noDoubleEquals = "off";
  f.put(configuration, JSON.stringify(relaxed));
  assert.match(
    (await checkStaged(f.dir, f.git("rev-parse", "HEAD").trim(), tree)).join(),
    /noDoubleEquals/,
  );
});
