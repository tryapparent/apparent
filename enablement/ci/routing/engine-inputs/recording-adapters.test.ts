import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { selection as engineSelection } from "../../../../engine/enablement/ci/inputs.ts";
import { selection as localSelection } from "../../../local-tests/run.ts";
import { currentStream } from "../streams.ts";

test("a Mac screen-picker edit selects Desktop verification and installer publication", (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "picker-routing-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd, env, encoding: "utf8" }).trim();
  const path = "engine/recording/macos_picker.rs";
  git("init", "-q");
  git("config", "commit.gpgsign", "false");
  git("config", "user.name", "Synthetic");
  git("config", "user.email", "synthetic@example.invalid");
  mkdirSync(join(cwd, "engine/recording"), { recursive: true });
  writeFileSync(join(cwd, path), "fn baseline() {}\n");
  git("add", path);
  git("commit", "-qm", "baseline");
  const base = git("rev-parse", "HEAD");
  writeFileSync(join(cwd, path), "fn candidate() {}\n");
  git("commit", "-qam", "picker-only change");
  const head = git("rev-parse", "HEAD");
  const selector = fileURLToPath(new URL("../../select.ts", import.meta.url));
  const hosted = JSON.parse(
    execFileSync("bun", [selector, "--admit"], {
      cwd,
      encoding: "utf8",
      env: {
        ...env,
        BASE_SHA: base,
        GITHUB_SHA: head,
        GITHUB_OUTPUT: join(cwd, "outputs"),
        GITHUB_EVENT_NAME: "push",
        GITHUB_REF: "refs/heads/main",
      },
    }),
  );

  assert.deepEqual(hosted.paths, [path]);
  assert.deepEqual(hosted.selected, ["capture", "engine", "desktop"]);
  assert.deepEqual(localSelection(base, head, cwd).plan, hosted.plan);
  assert.equal(hosted.macos, true);
  assert.equal(hosted.mac_rust, true);
  assert.equal(hosted.installer, true);
  assert.equal(currentStream("capture", base, head, cwd), false);
  assert.equal(currentStream("engine", base, head, cwd), true);
  for (const event of ["pull_request", "push"]) {
    assert.equal(engineSelection(event, base, head, cwd).selected, false);
  }
});
