import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, realpathSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  performanceVerificationInputs,
  recordPerformanceTests,
  recordPerformanceVerifierTest,
  recordVerificationManifest,
  settingsVerificationInputs,
} from "../../../../shared/enablement/ci/record-inputs.ts";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const workflow = ".github/workflows/stream-record.yml";
const inventory = "shared/enablement/ci/record-inputs.ts";

export function recordChecks(paths: string[] | null) {
  if (!paths?.length || paths.includes(workflow) || paths.includes(inventory)) {
    return { bend: true, performance: true };
  }
  return {
    bend: paths.some((path) => !performanceVerificationInputs.has(path)),
    performance: paths.some((path) => performanceVerificationInputs.has(path)),
  };
}

function changedPaths(base: string | undefined): string[] | null {
  if (!base || (base !== "HEAD^1" && !/^[a-f0-9]{40}$/.test(base))) return null;
  const git = (args: string[]) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  try {
    git(["merge-base", "--is-ancestor", base, "HEAD"]);
    return git([
      "diff",
      "--no-renames",
      "--name-only",
      "-z",
      base,
      "HEAD",
      "--",
    ])
      .split("\0")
      .filter(Boolean);
  } catch {
    return null;
  }
}

function text(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function list(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0 && value.every(text);
}

function verifyReference(reference: string, field: string) {
  const path = reference.split("#", 1)[0];
  assert.ok(
    /^[\w.-]+(?:\/[\w.-]+)*$/.test(path) &&
      !path.split("/").some((part) => part === "." || part === ".."),
    `${field}: expected a repository-relative file, got ${reference}`,
  );
  const file = resolve(root, path);
  assert.ok(
    statSync(file, { throwIfNoEntry: false })?.isFile(),
    `${field}: missing repository file ${path}`,
  );
  assert.ok(
    realpathSync(file).startsWith(realpathSync(root) + sep),
    `${field}: repository file resolves outside checkout: ${path}`,
  );
}

export function verifyManifest(contents: string) {
  const manifest = JSON.parse(contents);
  assert.ok(
    Array.isArray(manifest?.scenarios) && manifest.scenarios.length,
    "Expected verification scenarios",
  );
  const ids = new Set<string>();
  for (const scenario of manifest.scenarios) {
    const id = scenario?.id;
    assert.ok(text(id), "Expected a scenario ID");
    assert.ok(!ids.has(id), `duplicate scenario ID: ${id}`);
    ids.add(id);
    for (const field of ["description", "userEntryPoint"]) {
      assert.ok(text(scenario[field]), `${id}: expected ${field}`);
    }
    for (const field of [
      "platforms",
      "prerequisites",
      "expectedEvidence",
      "limits",
    ]) {
      if (field === "limits" && scenario[field] === undefined) continue;
      assert.ok(
        list(scenario[field]),
        `${id}: expected a nonempty ${field} list`,
      );
    }
    const runner = scenario.runner;
    assert.ok(
      text(runner?.path) && text(runner.instructions),
      `${id}: expected runner path and instructions`,
    );
    verifyReference(runner.path, `${id}: runner.path`);
    for (const field of ["scenario", "preflight", "evidenceInspection"]) {
      if (runner[field] === undefined) continue;
      assert.ok(text(runner[field]), `${id}: expected runner.${field}`);
      verifyReference(runner[field], `${id}: runner.${field}`);
    }
    if (/^[\w./-]+\.md(?:#[\w-]+)?$/.test(runner.instructions)) {
      verifyReference(runner.instructions, `${id}: runner.instructions`);
    }
  }
}

if (import.meta.main) {
  const [mode, base] = process.argv.slice(2);
  if (mode === "--select") {
    const paths = changedPaths(base);
    const { bend, performance } = recordChecks(paths);
    const settings =
      !paths?.length ||
      paths.includes(workflow) ||
      paths.includes(inventory) ||
      paths.some((path) => settingsVerificationInputs.has(path));
    appendFileSync(
      process.env.GITHUB_OUTPUT!,
      `bend=${bend}\nperformance=${performance}\nsettings=${settings}\n`,
    );
  } else {
    assert.equal(mode, undefined, "Usage: verify.ts [--select BASE]");
    verifyReference(recordVerificationManifest, "Record verification manifest");
    verifyManifest(
      readFileSync(resolve(root, recordVerificationManifest), "utf8"),
    );
    console.log("Record verification manifest passed");
    execFileSync(
      process.execPath,
      [
        "--experimental-strip-types",
        "--test",
        ...recordPerformanceTests,
        recordPerformanceVerifierTest,
      ],
      {
        cwd: root,
        stdio: "inherit",
      },
    );
  }
}
