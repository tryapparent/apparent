import { test } from "node:test";
import assert from "node:assert/strict";
import { Snapshot } from "../snapshot.ts";
import { analyze } from "../policy.ts";
import { effects } from "../runtime/effects.ts";
import { secretCheck } from "../runtime/secrets.ts";
import { ciPolicy } from "../runtime/ci.ts";
import { plan, fastChecks, lintPromises } from "../fast/run.ts";
import { fixture } from "./fixture.ts";
function snapshot(files: Record<string, string>) {
  const snapshot = new Snapshot("");
  for (const [file, text] of Object.entries(files)) {
    snapshot.files.set(file, text);
    snapshot.modes.set(file, "100644");
  }
  return snapshot;
}
test("renderer graph follows same-owner helpers, aliases and reexports; bridge contracts remain allowed", () => {
  const s = snapshot({
    "record/app/renderer/view.ts": 'import {read} from "@helper"; read();',
    "record/app/tsconfig.json":
      '{"compilerOptions":{"baseUrl":".","paths":{"@helper":["helper.ts"]}}}',
    "record/app/helper.ts": 'export {readFileSync as read} from "node:fs";',
  });
  assert.ok(
    [...analyze(s)].some((issue) =>
      issue.includes("renderer reaches record/app/helper.ts -> node:fs"),
    ),
  );
  s.files.set(
    "record/app/helper.ts",
    "export interface Bridge { read(): string }; export const read = () => 'ok';",
  );
  assert.equal(
    [...analyze(s)].filter((issue) => issue.includes("renderer reaches"))
      .length,
    0,
  );
  s.files.set(
    "record/app/helper.ts",
    'export {read} from "./main/private.ts";',
  );
  s.files.set("record/app/main/private.ts", "export const read = () => 1;");
  assert.ok(
    [...analyze(s)].some((issue) => issue.includes("renderer reaches")),
  );
});
test("React named, namespace, bracket, destructured and reexport aliases retain provenance", () => {
  for (const text of [
    'import {useEffect as effect} from "react"; const run = effect; run(() => {});',
    'import * as React from "react"; React["useEffect"](() => {});',
    'import React from "react"; const {useEffect: run} = React; run(() => {});',
    'import {run} from "./adapter.ts"; run(() => {});',
  ]) {
    const s = snapshot({
      "record/app.ts": text,
      "record/adapter.ts": 'export {useEffect as run} from "react";',
    });
    assert.ok(effects(s).size, text);
  }
  assert.equal(
    effects(
      snapshot({
        "record/app.ts":
          'const useEffect = "useEffect"; function run() {return useEffect;}',
      }),
    ).size,
    0,
  );
});
test("secrets reject staged lockfile credentials without printing values or paths", (t) => {
  const f = fixture(t);
  const value = "gh" + "p_" + "a".repeat(36);
  f.put("record/package-lock.json", JSON.stringify({ value }));
  f.stage();
  const errors = secretCheck(
    f.dir,
    f.git("rev-parse", "HEAD").trim(),
    f.git("write-tree").trim(),
  );
  assert.equal(errors.length, 1);
  assert.ok(!errors.join().includes(value));
  assert.ok(!errors.join().includes("package-lock"));
});
test("CI rejects new cross-owner commands, noncanonical entrypoints and broad workflow filters", () => {
  const s = snapshot({
    ".github/workflows/stream-public.yml":
      'on:\n  push:\n    paths: [".github/**"]\njobs:\n  build:\n    steps:\n      - run: node record/enablement/run.ts\n',
    "record/enablement/run.ts": "export {};",
  });
  const issues = [...ciPolicy(s)].join("\n");
  assert.match(issues, /crosses owners/);
  assert.match(issues, /entrypoints belong/);
  assert.match(issues, /blanket workflow/);
});
test("fast checks run immutable staged test bytes and propagate actual failure", async (t) => {
  const f = fixture(t);
  f.put(
    "record/enablement/ci/fast.json",
    JSON.stringify({
      projects: [
        {
          root: "record/example",
          inputs: [],
          tests: ["test.ts"],
          typecheck: false,
        },
      ],
    }),
  );
  f.put(
    "record/example/test.ts",
    'import assert from "node:assert/strict"; assert.equal(1, 2);',
  );
  f.stage();
  const tree = f.git("write-tree").trim();
  f.put("record/example/test.ts", "export const repaired = true;");
  const s = new Snapshot(f.dir, tree);
  assert.equal(plan(s, ["record/example/test.ts"]).length, 1);
  await assert.rejects(
    fastChecks(f.dir, f.git("rev-parse", "HEAD").trim(), tree, s),
    /Fast checks failed/,
  );
});
test("effect uses through existing reexports, casts and object aliases cannot borrow another path allowance", () => {
  const s = snapshot({
    "record/adapter.ts": 'export {useEffect as run} from "react";',
    "record/app.ts": 'import {run} from "./adapter.ts"; (run)(() => {});',
  });
  assert.ok(
    [...effects(s).keys()].some((key) => key.startsWith("record/app.ts:")),
  );
  s.files.set(
    "record/app.ts",
    'import React from "react"; const R = React; const run = (R["useEffect"]); run(() => {});',
  );
  assert.ok(
    [...effects(s).keys()].some((key) => key.includes("run(() => {})")),
  );
});
test("fast plan retains changed tests, reverse consumers, configuration and unknown data fallback", () => {
  const declaration = {
    projects: [
      {
        root: "record/a",
        inputs: ["record/extra.bin"],
        tests: ["test/base.test.ts"],
        typecheck: false,
      },
      {
        root: "record/b",
        inputs: [],
        tests: ["test/base.test.ts"],
        typecheck: false,
      },
    ],
  };
  const s = snapshot({
    "record/enablement/ci/fast.json": JSON.stringify(declaration),
    "record/a/source.ts": "export const x = 1;",
    "record/b/source.ts": 'export {x} from "../a/source.ts";',
    "record/a/test/new.test.ts": "export {};",
  });
  for (const changed of [
    ["record/a/source.ts"],
    ["shared/unknown.bin"],
    ["record/enablement/ci/fast.json"],
    ["record/a/tsconfig.json"],
  ])
    assert.equal(plan(s, changed).length, 2);
  const selected = plan(s, ["record/a/test/new.test.ts"]);
  assert.ok(selected[0].tests.includes("test/new.test.ts"));
});
test("new references cannot hide effects in arguments or CommonJS aliases", () => {
  for (const text of [
    'import {useEffect} from "react"; accept([useEffect]);',
    'const {useEffect: run} = require("react"); run(() => {});',
    'import {default as R} from "react"; R.useEffect(() => {});',
  ])
    assert.ok(effects(snapshot({ "record/app.ts": text })).size);
});
test("typed promise lint propagates a real project-type failure with the project configuration", async (t) => {
  const f = fixture(t);
  f.put(
    "record/enablement/ci/fast.json",
    JSON.stringify({
      projects: [
        {
          root: "record/typed",
          inputs: [],
          tests: ["test.ts"],
          typecheck: true,
        },
      ],
    }),
  );
  f.put(
    "record/typed/tsconfig.json",
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        noEmit: true,
        strict: true,
        types: [],
      },
      include: ["src/**/*.ts"],
    }),
  );
  f.put(
    "record/typed/src/work.ts",
    "export async function work() { return 1; } work();",
  );
  f.put("record/typed/test.ts", "export const pass = true;");
  await assert.rejects(
    lintPromises(f.dir + "/record/typed", "record/typed"),
    /Typed promise lint failed/,
  );
});
test("CI traces transitive TypeScript imports from a canonical stream entrypoint", () => {
  const s = snapshot({
    ".github/workflows/stream-record.yml":
      "jobs:\n  checks:\n    steps:\n      - run: node record/enablement/ci/run.ts\n",
    "record/enablement/ci/run.ts":
      'export {go} from "../../../enablement/ci/helper.ts";',
    "enablement/ci/helper.ts":
      'export {go} from "../../connect/enablement/ci/private.ts";',
    "connect/enablement/ci/private.ts": "export const go = () => 1;",
  });
  assert.match([...ciPolicy(s)].join("\n"), /CI import crosses owners/);
});
test("pure source rejects DOM globals while permitting locally declared names and bridge shapes", () => {
  const errors = new Set<string>();
  effects(
    snapshot({
      "record/pure/policy.ts": "export const read = () => document.title;",
    }),
    errors,
  );
  assert.match([...errors].join(), /pure logic uses DOM global document/);
  errors.clear();
  effects(
    snapshot({
      "record/pure/policy.ts":
        "export const read = (document: {title: string}) => document.title;",
    }),
    errors,
  );
  assert.equal(errors.size, 0);
});
