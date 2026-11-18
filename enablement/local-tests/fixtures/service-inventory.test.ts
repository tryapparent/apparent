import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { join } from "node:path";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { serviceInventory } from "../service.ts";
import { root } from "../run.ts";

test("service inventory preserves both canonical globs and executes TypeScript failures", (context) => {
  const dir = mkdtempSync("/tmp/apparent-dev-service-inventory-");
  context.after(() => rmSync(dir, { recursive: true, force: true }));
  const env = { ...process.env };
  const service = join(root, "connect/service");
  const canonical = execFileSync(
    "/bin/sh",
    ["-c", 'printf "%s\\n" test/*/*.test.mjs test/*/*.test.ts'],
    { cwd: service, env, encoding: "utf8" },
  )
    .trim()
    .split("\n");
  assert.deepEqual(serviceInventory(service), canonical);
  for (const folder of ["a", "z"])
    mkdirSync(join(dir, "test", folder), { recursive: true });
  writeFileSync(
    join(dir, "test/a/one.test.mjs"),
    "import {test} from 'node:test'; test('mjs runs',()=>{});",
  );
  writeFileSync(
    join(dir, "test/z/two.test.ts"),
    "import {test} from 'node:test'; const value: boolean = false; test('ts runs',()=>{if(!value)throw Error('TS sentinel');});",
  );
  writeFileSync(
    join(dir, "test/z/ignored.integration.ts"),
    "throw Error('separate integration gate');",
  );
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--test",
      "--test-concurrency=1",
      ...serviceInventory(dir),
    ],
    { cwd: dir, env, encoding: "utf8" },
  );
  assert.equal(result.status, 1);
  assert.match(result.stdout, /# tests 2/);
  assert.match(result.stdout, /TS sentinel/);
  rmSync(join(dir, "test/z/two.test.ts"));
  assert.throws(() => serviceInventory(dir), /inventory incomplete/);
  symlinkSync("../a/one.test.mjs", join(dir, "test/z/two.test.ts"));
  assert.throws(() => serviceInventory(dir), /unqualified test file/);
});
