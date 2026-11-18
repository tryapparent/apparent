import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { test } from "node:test";
import { cacheRoot } from "./dependencies.ts";
import { typechecks } from "./typecheck.ts";
import { selectProjects } from "./projects.ts";
import { Snapshot } from "../snapshot.ts";
import { fixture } from "../test/fixture.ts";

test("locked project checks reject unresolved Node types and ignore unstaged repairs", async (t) => {
  const f = fixture(t);
  const cache = cacheRoot(f.dir);
  t.after(() => rmSync(cache, { recursive: true, force: true }));
  const toolLock = JSON.parse(
    readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"),
  );
  const base = f.git("rev-parse", "HEAD").trim();
  const put = (file: string, data: unknown) =>
    f.put("record/types/" + file, JSON.stringify(data));
  const manifest = {
    name: "staged-types",
    version: "0.0.0",
    devDependencies: { typescript: "5.9.3" },
  };
  const lock = {
    lockfileVersion: 3,
    packages: {
      "": manifest,
      "node_modules/typescript": toolLock.packages["node_modules/typescript"],
    },
  };
  const config = (types: string[]) => ({
    compilerOptions: { strict: true, types },
    include: ["index.ts"],
  });
  put("package.json", manifest);
  put("package-lock.json", lock);
  f.put("record/types/.npmrc", "offline=true\n");
  put("tsconfig.json", config([]));
  f.put("record/types/index.ts", 'export const n: number = "invalid";');
  f.stage();
  const state = (changed: string[]) => {
    const tree = f.git("write-tree").trim();
    return {
      cwd: f.dir,
      tree,
      staged: new Snapshot(f.dir, tree),
      committed: new Snapshot(f.dir, base),
      changed,
    };
  };
  const source = "record/types/index.ts";
  await assert.rejects(
    typechecks(state([source])),
    /locked TypeScript dependencies are missing/,
  );
  await typechecks(state([source]), { setup: true });
  f.put(source, "export const n: number = 1;");
  await assert.rejects(typechecks(state([source])), /TS2322/);
  f.stage();
  await typechecks(state([source]));
  put("tsconfig.json", config(["node"]));
  f.stage();
  await assert.rejects(
    typechecks(state(["record/types/tsconfig.json"])),
    /TS2688.*node/,
  );
  put("package-lock.json", { ...lock, name: "changed-lock" });
  f.stage();
  await assert.rejects(
    typechecks(state(["record/types/package-lock.json"])),
    /locked TypeScript dependencies are missing/,
  );
});

test("a shared producer selects its consumer from both staged and old import graphs", (t) => {
  const f = fixture(t);
  f.put("record/types/tsconfig.json", '{"include":["src.ts"]}');
  f.put("record/types/package-lock.json", "{}");
  f.put(
    "record/types/src.ts",
    'import {value} from "../../shared/value.ts"; export {value};',
  );
  f.put("shared/value.ts", "export const value = 1;");
  f.stage();
  f.commit();
  const base = f.git("rev-parse", "HEAD").trim();
  f.put("record/types/src.ts", "export const value = 2;");
  f.stage();
  const tree = f.git("write-tree").trim();
  const selected = selectProjects(
    new Snapshot(f.dir, tree),
    new Snapshot(f.dir, base),
    ["shared/value.ts"],
  );
  assert.deepEqual(
    selected.map((project) => project.config),
    ["record/types/tsconfig.json"],
  );
});
