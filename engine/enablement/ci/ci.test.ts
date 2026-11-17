import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const { YAML, Glob } = Bun;
import {
  automaticPaths,
  linuxRunners,
  nativeRunners,
  selection,
  currentInputs,
} from "./inputs.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
);
const workflow = YAML.parse(
  readFileSync(join(root, ".github/workflows/stream-engine.yml"), "utf8"),
);
function fixture(t: TestContext) {
  const cwd = mkdtempSync("/tmp/apparent-dev-engine-ci-");
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  const put = (path: string, text: string) => {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), text);
  };
  git("init", "-q");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.invalid");
  const commit = () => {
    git("add", ".");
    git("commit", "-qm", "fixture");
    return git("rev-parse", "HEAD");
  };
  put("baseline", "fixture");
  return { cwd, git, put, commit, base: commit() };
}

test("automatic workflow admission matches owner inputs and rejects global fanout", () => {
  for (const event of ["pull_request", "push"])
    assert.deepEqual(workflow.on[event].paths, automaticPaths);
  for (const [path, expected] of [
    ["engine/native/src/main.rs", true],
    ["engine/enablement/ci/run.ts", true],
    ["engine/README.md", false],
    ["engine/docs/migration.md", false],
    [".githooks/pre-push", false],
    ["enablement/ci/select.ts", false],
    ["shared/enablement/ci/inputs.ts", false],
    [".github/workflows/stream-engine.yml", false],
    [".github/actions/ubuntu-apt/action.yml", false],
    [".github/workflows/hermes.yml", false],
    ["unknown/input.ts", false],
  ] as const) {
    const admitted = automaticPaths.reduce(
      (value, pattern) =>
        new Glob(pattern.replace(/^!/, "")).match(path)
          ? !pattern.startsWith("!")
          : value,
      false,
    );
    assert.equal(admitted, expected, path);
  }
  assert.equal(
    workflow.jobs.native.strategy.matrix.runner,
    "${{ fromJSON(needs.select.outputs.runners) }}",
  );
  assert.deepEqual(workflow.jobs.publish.needs, ["select", "sdk", "native"]);
  assert.match(
    workflow.jobs.publish.if,
    /github.event_name == 'push'.*refs\/heads\/main/,
  );
  const steps = workflow.jobs.publish.steps;
  const guard = steps.findIndex((step: { run?: string; uses?: string }) =>
    step.run?.includes("ci/artifacts.ts"),
  );
  assert.ok(
    guard >
      steps.findIndex(
        (step: { run?: string; uses?: string }) =>
          step.uses === "actions/download-artifact@v4",
      ),
  );
  assert.ok(
    guard <
      steps.findIndex((step: { run?: string; uses?: string }) =>
        step.run?.includes("gh release create"),
      ),
  );
  assert.ok(
    steps.some((step: { run?: string; uses?: string }) =>
      step.run?.includes('ci/run.ts current "$GITHUB_SHA"'),
    ),
  );
  assert.ok(!JSON.stringify(workflow).includes("routing/streams.ts"));
});

test("committed owner changes run Linux on PRs and all supported native targets on main/manual", (t) => {
  const f = fixture(t);
  f.put("engine/native/src/main.rs", "fixture");
  const head = f.commit();
  assert.deepEqual(selection("pull_request", f.base, head, f.cwd), {
    selected: true,
    runners: linuxRunners,
  });
  assert.deepEqual(selection("push", f.base, head, f.cwd), {
    selected: true,
    runners: nativeRunners,
  });
  assert.deepEqual(selection("workflow_dispatch", "missing", head, f.cwd), {
    selected: true,
    runners: nativeRunners,
  });
  assert.throws(() => selection("push", "missing", head, f.cwd));
  f.git("mv", "engine/native/src/main.rs", "outside.rs");
  const renamed = f.commit();
  assert.equal(selection("push", head, renamed, f.cwd).selected, true);
  assert.equal(currentInputs(head, renamed, f.cwd), false);
});

test("publication continuation and selector CLI ignore unrelated, hooks, prose and workflow changes", (t) => {
  const f = fixture(t);
  for (const path of [
    "engine/docs/guide.md",
    ".githooks/pre-push",
    "shared/enablement/test.ts",
    "enablement/ci/select.ts",
    ".github/workflows/stream-engine.yml",
    ".github/workflows/stream-connect.yml",
    "unknown/input.ts",
  ])
    f.put(path, "fixture");
  const head = f.commit();
  assert.equal(selection("push", f.base, head, f.cwd).selected, false);
  assert.equal(currentInputs(f.base, head, f.cwd), true);
  f.git("update-ref", "refs/remotes/origin/main", head);
  execFileSync(
    "bun",
    [join(root, "engine/enablement/ci/run.ts"), "current", f.base],
    { cwd: f.cwd, env },
  );
  f.put("engine/sdk/src/index.ts", "fixture");
  const changed = f.commit();
  assert.equal(currentInputs(f.base, changed, f.cwd), false);
  assert.throws(() => currentInputs(changed, head, f.cwd));
});

test("actual hosted CLI uses the checked merge first parent instead of stale PR base", (t) => {
  const f = fixture(t);
  f.git("checkout", "-qb", "feature");
  f.put("unrelated.ts", "fixture");
  f.commit();
  f.git("checkout", "-qb", "main", f.base);
  f.put("engine/sdk/src/index.ts", "new main");
  f.commit();
  f.git("merge", "--no-ff", "feature", "-m", "fixture merge");
  const head = f.git("rev-parse", "HEAD");
  const output = join(f.cwd, "output");
  execFileSync("bun", [join(root, "engine/enablement/ci/run.ts"), "select"], {
    cwd: f.cwd,
    env: {
      ...env,
      GITHUB_EVENT_NAME: "pull_request",
      BASE_SHA: f.base,
      GITHUB_SHA: head,
      GITHUB_OUTPUT: output,
    },
  });
  assert.equal(
    readFileSync(output, "utf8"),
    `selected=false\nrunners=${JSON.stringify(linuxRunners)}\n`,
  );
});
