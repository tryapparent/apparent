import { test } from "node:test";
import assert from "node:assert/strict";
import { sourceBudget, tokens, lockfiles } from "../guards/budgets.ts";
test("source exact boundary, strings/comments/fixtures, debt and lockfile names", () => {
  const exact = "x ".repeat(3999);
  assert.equal(tokens(exact), 4000);
  assert.deepEqual(sourceBudget("test/fixture.ts", exact), []);
  assert.match(
    sourceBudget("test/fixture.ts", exact + "x ").join(),
    /4001 source tokens/,
  );
  assert.match(
    sourceBudget("test/generated.ts", exact + "x ").join(),
    /source tokens/,
  );
  const debt = "x ".repeat(4999);
  assert.deepEqual(sourceBudget("a.rs", exact, debt), []);
  assert.deepEqual(sourceBudget("a.rs", debt, debt), []);
  assert.match(
    sourceBudget("a.rs", debt + "x ", debt).join(),
    /5001 source tokens/,
  );
  for (const name of lockfiles)
    assert.deepEqual(sourceBudget("nested/" + name, debt), []);
  for (const name of [
    "not-a-dependency.lock",
    "Cargo.lock.rs",
    "package-lock.json.ts",
    "YARN.LOCK",
    "bun-other.lockb",
  ])
    assert.match(sourceBudget(name, debt).join(), /source tokens/);
  assert.deepEqual(sourceBudget("config.json", debt), []);
  for (const name of [
    "a.ts",
    "a.tsx",
    "a.js",
    "a.mts",
    "a.cts",
    "a.rs",
    "a.py",
    "a.swift",
    "a.sh",
    "a.css",
    "a.html",
    "a.cpp",
    "a.hpp",
    "a.m",
    "a.mm",
    "a.metal",
  ])
    assert.match(sourceBudget(name, debt).join(), /source tokens/);
  assert.match(
    sourceBudget("tool", "#!/usr/bin/env bash\n" + debt).join(),
    /source tokens/,
  );
  assert.deepEqual(sourceBudget("vendor/a.ts", debt), []);
  assert.deepEqual(sourceBudget("connect/web/dist/a.ts", debt), []);
});
