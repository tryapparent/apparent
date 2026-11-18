import { readFileSync } from "node:fs";
import ts from "node:module";
import path from "node:path";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

type RunnerOptions = {
  budget: (cap: number) => number;
  environment: () => NodeJS.ProcessEnv;
  redact: (value: unknown) => string;
};
type CommandOptions = {
  env?: NodeJS.ProcessEnv;
  timeout?: number;
  input?: string;
  ownedGroup?: boolean;
};
type Command = (
  executable: string,
  args: string[],
  options?: CommandOptions,
) => Promise<string>;

const control = readFileSync(
  new URL(
    "../../../capture/desktop/ui/frontend/tests/foreground/control.ts",
    import.meta.url,
  ),
  "utf8",
);
const start = control.indexOf("export function commandRunner(");
const end =
  control.indexOf("return command;\n}", start) + "return command;".length;
assert.ok(start >= 0 && end > start);
const source = control.slice(start, end + 2).replace(/^export /, "");
const javascript = ts.stripTypeScriptTypes(source);
export const commandRunner: (options: RunnerOptions) => Command = Function(
  "assert",
  "path",
  "spawn",
  javascript + "\nreturn commandRunner;",
)(assert, path, spawn);
