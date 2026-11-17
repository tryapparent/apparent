import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("actual preview adapter admits a source before checkout and preserves exact source/version handoff", () => {
  const workflow = readFileSync(
    ".github/workflows/release-mac-preview.yml",
    "utf8",
  );
  const gate = workflow.indexOf(
    "composition/enablement/release/mac/workflow.ts preview-admit",
  );
  const checkout = workflow.indexOf("ref: ${{ env.RELEASE_SOURCE_SHA }}");
  const version = workflow.indexOf(
    "name: Resolve version from the admitted source",
  );
  assert(
    gate > 0 &&
      gate < checkout &&
      checkout < version &&
      version < workflow.indexOf("name: Prepare Developer ID credentials"),
  );
  for (const output of [
    "RELEASE_SOURCE_SHA: ${{ inputs.source_sha || github.sha }}",
    "tag: ${{ steps.release.outputs.tag }}",
    "sha: ${{ steps.release.outputs.sha }}",
    "RELEASE_SHA: ${{ needs.preview.outputs.sha }}",
  ])
    assert(workflow.includes(output));
  const script = resolve("composition/enablement/release/mac/workflow.ts");
  const directory = mkdtempSync(
    join(tmpdir(), "apparent-dev-preview-admission-"),
  );
  const sha = "a".repeat(40);
  try {
    mkdirSync(join(directory, "bin"));
    writeFileSync(
      join(directory, "bin/python3"),
      '#!/bin/sh\nprintf "%s\\n" "$@" > "$TRACE"\nexit "$ADMISSION_EXIT"\n',
      { mode: 0o700 },
    );
    const invoke = (ref: string, source: string, admission: string) =>
      spawnSync(
        process.execPath,
        ["--experimental-strip-types", script, "preview-admit"],
        {
          cwd: directory,
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: join(directory, "bin") + ":" + process.env.PATH,
            GITHUB_REF: ref,
            GITHUB_SHA: "b".repeat(40),
            RELEASE_SOURCE_SHA: source,
            APPARENT_PREVIEW_NOTARIZE: "true",
            ADMISSION_EXIT: admission,
            TRACE: join(directory, "trace"),
            GITHUB_ENV: join(directory, "env"),
            GITHUB_RUN_ID: "123456",
            GITHUB_RUN_ATTEMPT: "1",
          },
        },
      );
    assert.equal(invoke("refs/heads/main", sha, "0").status, 0);
    assert.deepEqual(
      readFileSync(join(directory, "trace"), "utf8").trim().split("\n"),
      ["enablement/release_gate.py", "--platform", "macos", "--sha", sha],
    );
    assert.match(
      readFileSync(join(directory, "env"), "utf8"),
      /APPARENT_PREVIEW_BUILD_NUMBER=123456.1/,
    );
    assert.notEqual(invoke("refs/heads/main", sha, "19").status, 0);
    assert.equal(
      invoke(
        "refs/heads/t3/onboarding-mac-release-baseline",
        "b".repeat(40),
        "0",
      ).status,
      0,
    );
    assert.notEqual(
      invoke("refs/heads/t3/onboarding-mac-release-baseline", sha, "0").status,
      0,
    );
    writeFileSync(
      join(directory, "bin/node"),
      '#!/bin/sh\nprintf "APPARENT_PREVIEW_TAG=preview-mac-22-3\\n" >> "$GITHUB_ENV"\n',
      { mode: 0o700 },
    );
    const step = workflow
      .slice(version)
      .split("      - name:")[0]
      .split("        run: |\n")[1]
      .split("\n")
      .map((line) => line.slice(10))
      .join("\n");
    const output = join(directory, "release-output");
    const result = spawnSync("bash", ["-e", "-c", step], {
      cwd: directory,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: join(directory, "bin") + ":" + process.env.PATH,
        GITHUB_REF: "refs/heads/main",
        RELEASE_SOURCE_SHA: sha,
        GITHUB_ENV: join(directory, "env"),
        GITHUB_OUTPUT: output,
      },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      readFileSync(output, "utf8"),
      `tag=preview-mac-22-3\nsha=${sha}\n`,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
