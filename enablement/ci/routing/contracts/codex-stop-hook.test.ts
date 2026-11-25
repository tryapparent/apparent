import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { selectRange } from "../../select.ts";
import { codexStopHookTests } from "../../../local-tests/contracts.ts";
import { codexStopHookTest } from "../../../../shared/enablement/ci/inputs.ts";

function repository(
  action: (git: (...args: string[]) => string, dir: string) => void,
) {
  const dir = mkdtempSync(join(tmpdir(), "apparent-dev-codex-route-"));
  const git = (...args: string[]) =>
    execFileSync(
      "git",
      [
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "commit.gpgsign=false",
        "-c",
        "user.name=CI fixture",
        "-c",
        "user.email=ci@example.invalid",
        ...args,
      ],
      { cwd: dir, encoding: "utf8" },
    ).trim();
  try {
    git("init", "-qb", "main");
    action(git, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("Codex Stop hook changes qualify separately from product admission tooling", () =>
  repository((git, dir) => {
    const hook = "enablement/hooks/make-it-apparent-stop.ts";
    const product = "engine/diagnostics/build.rs";
    mkdirSync(join(dir, "enablement/hooks"), { recursive: true });
    mkdirSync(join(dir, "engine/diagnostics"), { recursive: true });
    writeFileSync(join(dir, product), "shared/enablement/ci/inputs.ts");
    writeFileSync(join(dir, "AGENTS.md"), "Original handoff guidance");
    git("add", ".");
    git("commit", "-qm", "baseline");
    const base = git("rev-parse", "HEAD");
    writeFileSync(join(dir, hook), "export const enabled = true;");
    writeFileSync(join(dir, codexStopHookTest), "export const source = true;");
    git("add", ".");
    git("commit", "-qm", "standalone hook");
    const helperHead = git("rev-parse", "HEAD");
    const helper = selectRange(base, helperHead, dir);
    assert.equal(helper.inputProofKnown, true);
    assert.deepEqual(helper.selected, ["tooling"]);
    assert.deepEqual(
      codexStopHookTests(helperHead, helper.paths, dir)
        .flatMap((command) => command.argv)
        .slice(-1),
      [codexStopHookTest],
    );
    assert.deepEqual(
      codexStopHookTests(helperHead, [".github/workflows/checks.yml"], dir),
      [],
    );

    writeFileSync(join(dir, "AGENTS.md"), "Updated handoff guidance");
    git("add", ".");
    git("commit", "-qm", "mixed guidance");
    const mixed = selectRange(base, git("rev-parse", "HEAD"), dir);
    assert.deepEqual(mixed.selected, ["tooling"]);
    assert.ok(mixed.paths.includes("AGENTS.md"));

    writeFileSync(
      join(dir, product),
      "shared/enablement/ci/inputs.ts\nChanged native build input",
    );
    git("add", ".");
    git("commit", "-qm", "independent product change");
    assert.equal(
      selectRange(base, git("rev-parse", "HEAD"), dir).plan.root,
      true,
    );

    writeFileSync(
      join(dir, product),
      "enablement/hooks/make-it-apparent-stop.ts",
    );
    git("add", ".");
    git("commit", "-qm", "product consumer");
    const coupled = selectRange(base, git("rev-parse", "HEAD"), dir);
    assert.equal(coupled.inputProofKnown, false);
    assert.ok(coupled.reasons.includes("fallback:admission-product-consumer"));
  }));
