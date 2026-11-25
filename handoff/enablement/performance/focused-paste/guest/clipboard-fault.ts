#!/bench/node
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";

const args = process.argv.slice(2);
const fault = process.env.PASTE_CLIPBOARD_FAULT;
if (args[0] === "--list-types" && fault && existsSync(fault)) {
  unlinkSync(fault);
  execFileSync("/usr/bin/wl-copy", ["--type", "text/plain;charset=utf-8"], {
    input: "Independent clipboard change",
    stdio: ["pipe", "ignore", "ignore"],
  });
}
const result = spawnSync("/usr/bin/wl-paste", args, { stdio: "inherit" });
assert.ifError(result.error);
process.exitCode = result.status ?? 1;
