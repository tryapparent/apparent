import { test } from "node:test";
import assert from "node:assert/strict";
import { Snapshot } from "../../snapshot.ts";
import { ciPolicy } from "../../runtime/ci.ts";

function problems(files: Record<string, string>): string {
  const snapshot = new Snapshot("");
  for (const [file, text] of Object.entries(files)) {
    snapshot.files.set(file, text);
    snapshot.modes.set(file, "100644");
  }
  return [...ciPolicy(snapshot)].join("\n");
}

test("canonical CI wrappers cannot move policy into root scripts or imported root modules", () => {
  for (const content of [
    'export {run} from "../../../enablement/build.ts";',
    "export const run = () => 1;",
  ]) {
    const command = content.includes("from")
      ? "node record/enablement/ci/run.ts"
      : "node enablement/build.ts";
    assert.match(
      problems({
        ".github/workflows/stream-record.yml": `jobs:\n  checks:\n    steps:\n      - run: ${command}\n`,
        "record/enablement/ci/run.ts": content,
        "enablement/build.ts": "export const run = () => 1;",
      }),
      /stream CI cannot forward policy to an unowned root/,
    );
  }
});

test("new workflow names cannot hide inline product build policy", () => {
  assert.match(
    problems({
      ".github/workflows/surprise.yml":
        "jobs:\n  check:\n    steps:\n      - run: cargo build\n",
    }),
    /workflow must name its owner/,
  );
  assert.match(
    problems({
      ".github/workflows/checks.yml":
        "jobs:\n  check:\n    steps:\n      - working-directory: record\n        run: npm run build\n",
      "record/package.json": '{"scripts":{"build":"tsc"}}',
    }),
    /canonical CI entrypoint/,
  );
});

test("workflow directory globs reject while exact owner filters and entrypoints remain allowed", () => {
  for (const filter of [
    ".github/**",
    ".github/**/*",
    ".github/workflows/*",
    ".github/workflows/*.yml",
  ]) {
    assert.match(
      problems({
        ".github/workflows/stream-record.yml": `on:\n  push:\n    paths: ["${filter}"]\n`,
      }),
      /blanket workflow selector/,
    );
  }
  assert.equal(
    problems({
      ".github/workflows/stream-record.yml":
        'on:\n  push:\n    paths: ["record/**", ".github/workflows/stream-record.yml"]\njobs:\n  check:\n    steps:\n      - run: node record/enablement/ci/run.ts\n',
      "record/enablement/ci/run.ts": "export const run = () => 1;",
    }),
    "",
  );
});

test("shell directory changes cannot conceal an unresolved stream entrypoint", () => {
  assert.match(
    problems({
      ".github/workflows/stream-record.yml":
        "jobs:\n  check:\n    steps:\n      - run: cd record && npm run build\n",
    }),
    /unsupported dynamic CI command/,
  );
});

test("new active streams need an owned workflow while prospective documentation does not", () => {
  assert.equal(
    problems({ "onboarding/README.md": "Future onboarding owner" }),
    "",
  );
  assert.match(
    problems({ "onboarding/src/start.ts": "export const start = () => 1;" }),
    /active stream requires its own/,
  );
  assert.equal(
    problems({
      "onboarding/src/start.ts": "export const start = () => 1;",
      "onboarding/enablement/ci/check.ts": "export const check = () => 1;",
      ".github/workflows/stream-onboarding.yml":
        "jobs:\n  check:\n    steps:\n      - run: node onboarding/enablement/ci/check.ts\n",
    }),
    "",
  );
});
