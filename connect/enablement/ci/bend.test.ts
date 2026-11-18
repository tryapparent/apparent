import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";

test("Bend proof follows committed source additions, renames, deletions and compiler inputs", () => {
  const cwd = mkdtempSync("/tmp/apparent-dev-connect-bend-selection-");
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  const manifest = "connect/enablement/ci/bend/modules.json";
  const original = "connect/service/src/reporting/first.bend";
  const replacement = "connect/service/src/reporting/second.bend";
  const put = (path: string, text: string) => {
    mkdirSync(join(cwd, path, ".."), { recursive: true });
    writeFileSync(join(cwd, path), text);
  };
  try {
    git("init", "-q");
    git("config", "user.name", "Synthetic");
    git("config", "user.email", "synthetic@example.invalid");
    put(
      manifest,
      JSON.stringify({
        modules: ["service/src/reporting/active.bend"],
        inputs: ["service/"],
      }),
    );
    put("connect/service/src/reporting/active.bend", "active");
    const output = join(cwd, ".git", "selected");
    const commit = () => {
      git("add", "-A");
      git("commit", "-qm", "change");
      return git("rev-parse", "HEAD");
    };
    let base = commit();
    const select = (bend: boolean) => {
      const head = commit();
      const result = spawnSync(
        "bun",
        [new URL("./select.ts", import.meta.url).pathname, "--admit"],
        {
          cwd,
          encoding: "utf8",
          env: {
            ...process.env,
            BASE_SHA: base,
            GITHUB_SHA: head,
            GITHUB_EVENT_NAME: "pull_request",
            GITHUB_OUTPUT: output,
          },
        },
      );
      assert.equal(result.status, 0, result.stderr);
      assert.match(
        readFileSync(output, "utf8"),
        new RegExp("^bend=" + bend + "$", "m"),
      );
      rmSync(output);
      base = head;
    };
    put(original, "source");
    select(true);
    git("mv", original, replacement);
    select(true);
    git("rm", replacement);
    select(true);
    put("shared/enablement/bend/toolchain.ts", "compiler");
    select(true);
    put("record/completion/src/example.bend", "record only");
    select(false);
    git("rm", manifest, "connect/service/src/reporting/active.bend");
    select(false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
