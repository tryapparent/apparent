import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { cacheRoot } from "./dependencies.ts";
import { typechecks } from "./typecheck.ts";
import { selectProjects } from "./projects.ts";
import { Snapshot } from "../snapshot.ts";
import { fixture } from "../test/fixture.ts";

function lockedCompiler(dir: string) {
  const packageDir = fileURLToPath(
    new URL("../node_modules/typescript", import.meta.url),
  );
  const metadata = JSON.parse(
    readFileSync(path.join(packageDir, "package.json"), "utf8"),
  );
  const locked = JSON.parse(
    readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"),
  );
  assert.equal(
    metadata.version,
    locked.packages["node_modules/typescript"].version,
  );
  const npm = path.join(dir, "npm-fixture");
  mkdirSync(npm);
  const cache = path.join(npm, "pack-cache");
  const [tarball] = JSON.parse(
    execFileSync(
      "npm",
      [
        "pack",
        "--json",
        "--ignore-scripts",
        "--offline",
        "--cache",
        cache,
        "--pack-destination",
        npm,
        packageDir,
      ],
      { cwd: npm, encoding: "utf8" },
    ),
  );
  const bytes = readFileSync(path.join(npm, tarball.filename));
  rmSync(npm, { recursive: true });
  return (
    f: ReturnType<typeof fixture>,
    root: string,
    extra: Record<string, unknown> = {},
  ) => {
    const put = (file: string, data: unknown) =>
      f.put(root + "/" + file, JSON.stringify(data));
    const payload = path.join(f.dir, root, tarball.filename);
    const manifest = {
      name: root.replaceAll("/", "-"),
      version: "0.0.0",
      devDependencies: { typescript: metadata.version },
      ...extra,
    };
    put("package.json", manifest);
    writeFileSync(payload, bytes);
    const lock = {
      lockfileVersion: 3,
      packages: {
        "": manifest,
        "node_modules/typescript": {
          version: metadata.version,
          resolved: "file:" + tarball.filename,
          integrity:
            "sha512-" + createHash("sha512").update(bytes).digest("base64"),
          bin: metadata.bin,
          dev: true,
        },
      },
    };
    put("package-lock.json", lock);
    f.put(root + "/.npmrc", "offline=true\ncache=./npm-cache\n");
    return lock;
  };
}

test("locked project checks reject unresolved Node types and ignore unstaged repairs", async (t) => {
  const f = fixture(t);
  const cache = cacheRoot(f.dir);
  t.after(() => rmSync(cache, { recursive: true, force: true }));
  const base = f.git("rev-parse", "HEAD").trim();
  const put = (file: string, data: unknown) =>
    f.put("record/types/" + file, JSON.stringify(data));
  const lock = lockedCompiler(f.dir)(f, "record/types");
  const config = (types: string[]) => ({
    compilerOptions: { strict: true, types },
    include: ["index.ts"],
  });
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

test("hosting-only changes prepare the staged recipient generator through declared dependencies", async (t) => {
  const f = fixture(t);
  const cache = cacheRoot(f.dir);
  t.after(() => rmSync(cache, { recursive: true, force: true }));
  const provision = lockedCompiler(f.dir);
  provision(f, "connect/tooling/hosting");
  provision(f, "connect/service", {
    scripts: {
      "build:recipient": "node scripts/recipient.ts",
      "build:bend": "node -e 'process.exit(1)'",
    },
  });
  f.put(
    "connect/service/scripts/recipient.ts",
    'import {mkdirSync, writeFileSync} from "node:fs"; mkdirSync(".generated", {recursive: true}); writeFileSync(".generated/recipient.ts", "export const recipient = 42;");',
  );
  f.put(
    "connect/service/tsconfig.json",
    '{"include":["src.ts"],"compilerOptions":{"strict":true,"types":[]}}',
  );
  f.put(
    "connect/service/src.ts",
    'export {recipient} from "./.generated/recipient";',
  );
  f.put(
    "connect/tooling/hosting/tsconfig.json",
    '{"include":["host.ts"],"compilerOptions":{"strict":true,"types":[]}}',
  );
  const host = "connect/tooling/hosting/host.ts";
  f.put(host, 'export {recipient} from "../../service/src";');
  f.put(
    "connect/enablement/ci/typecheck.json",
    JSON.stringify([
      { config: "connect/service/tsconfig.json", prepare: "build:recipient" },
      {
        config: "connect/tooling/hosting/tsconfig.json",
        dependencies: ["connect/service/tsconfig.json"],
      },
    ]),
  );
  f.stage();
  f.commit();
  const base = f.git("rev-parse", "HEAD").trim();
  f.put(
    host,
    'import {recipient} from "../../service/src"; export const value: number = recipient;',
  );
  f.stage();
  f.put("connect/service/scripts/recipient.ts", "process.exit(1);");
  const tree = f.git("write-tree").trim();
  const staged = new Snapshot(f.dir, tree);
  const committed = new Snapshot(f.dir, base);
  assert.deepEqual(
    selectProjects(staged, committed, [host]).map(({ config }) => config),
    ["connect/tooling/hosting/tsconfig.json"],
  );
  const input = { cwd: f.dir, tree, staged, committed, changed: [host] };
  await typechecks(input, { setup: true });
  await typechecks(input);
});

test("project inputs follow includes, extends, references and package or declared edges in both trees", (t) => {
  const f = fixture(t);
  for (const dir of [
    "public",
    "composition/app",
    "composition/app/test",
    "record/consumer",
  ]) {
    f.put(dir + "/package-lock.json", "{}");
    f.put(dir + "/package.json", "{}");
  }
  f.put(
    "shared/ui/package.json",
    '{"name":"@fixture/ui","exports":{"./switch":"./switch.ts"}}',
  );
  f.put("shared/ui/switch.ts", "export const control = true;");
  f.put(
    "public/package.json",
    '{"dependencies":{"@fixture/ui":"file:../shared/ui"}}',
  );
  f.put(
    "public/tsconfig.json",
    '{"include":["site.ts"],"compilerOptions":{"moduleResolution":"bundler"}}',
  );
  f.put("public/site.ts", 'export {control} from "@fixture/ui/switch";');
  f.put("composition/app/tsconfig.json", '{"include":["src.ts"]}');
  f.put("composition/app/src.ts", "export const app = true;");
  f.put(
    "composition/app/test/tsconfig.json",
    '{"extends":"../../../config/base.json","include":["../siblings/check.ts"]}',
  );
  f.put("composition/app/siblings/check.ts", "export const check = true;");
  f.put("config/base.json", '{"compilerOptions":{"strict":true}}');
  f.put(
    "record/consumer/tsconfig.json",
    '{"files":[],"references":[{"path":"../../composition/app/test"}]}',
  );
  f.put(
    "composition/enablement/ci/typecheck.json",
    JSON.stringify([
      {
        config: "composition/app/test/tsconfig.json",
        dependencies: ["composition/app/tsconfig.json"],
      },
    ]),
  );
  f.stage();
  f.commit();
  const base = new Snapshot(f.dir, f.git("rev-parse", "HEAD").trim());
  f.put("shared/ui/package.json", '{"name":"@fixture/ui","exports":{}}');
  f.git("rm", "config/base.json", "composition/app/siblings/check.ts");
  f.stage();
  const staged = new Snapshot(f.dir, f.git("write-tree").trim());
  const configs = (input: string) =>
    selectProjects(staged, base, [input]).map(({ config }) => config);
  assert.deepEqual(configs("shared/ui/package.json"), ["public/tsconfig.json"]);
  assert.deepEqual(configs("composition/app/siblings/check.ts"), [
    "composition/app/test/tsconfig.json",
    "record/consumer/tsconfig.json",
  ]);
  assert.deepEqual(
    configs("config/base.json"),
    configs("composition/app/siblings/check.ts"),
  );
  assert.deepEqual(configs("composition/app/package-lock.json"), [
    "composition/app/test/tsconfig.json",
    "composition/app/tsconfig.json",
    "record/consumer/tsconfig.json",
  ]);
  assert.deepEqual(configs("unrelated.md"), []);
});

test("editing a Record fast declaration exercises typed promise lint through pre-commit", async (t) => {
  const f = fixture(t);
  const cache = cacheRoot(f.dir);
  t.after(() => rmSync(cache, { recursive: true, force: true }));
  const provision = lockedCompiler(f.dir);
  const root = "record/sample";
  const declaration = "record/enablement/ci/fast.json";
  provision(f, root);
  f.put(root + "/src/async.ts", "async function work() { return 1; } work();");
  f.put(
    root + "/src/async.test.ts",
    'import {test} from "node:test"; test("sample", () => {});',
  );
  f.put(
    root + "/tsconfig.json",
    '{"compilerOptions":{"strict":true,"target":"es2022","types":[]},"include":["src/async.ts"]}',
  );
  const config = (inputs: string[]) =>
    JSON.stringify({
      projects: [
        {
          root,
          inputs,
          tests: ["src/async.test.ts"],
          typecheck: true,
        },
      ],
    });
  f.put(declaration, config([]));
  f.stage();
  f.commit();
  const base = f.git("rev-parse", "HEAD").trim();
  f.put(declaration, config([declaration]));
  f.stage();
  const tree = f.git("write-tree").trim();
  await typechecks(
    {
      cwd: f.dir,
      tree,
      staged: new Snapshot(f.dir, tree),
      committed: new Snapshot(f.dir, base),
      changed: [declaration],
    },
    { setup: true, lintConfigs: [root + "/tsconfig.json"] },
  );
  f.fail(/Typed promise lint failed for record\/sample/);
});
