import assert from "node:assert/strict";
import { lstatSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  bendPilotPath,
  bendSource,
} from "../../../../shared/enablement/bend/source.ts";
import {
  prepareBend,
  provisionLean,
  run,
} from "../../../../shared/enablement/bend/toolchain.ts";
import { begin, reduce, type Context } from "../../../completion/src/policy.ts";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const fixture = "record/enablement/ci/bend/completion.bend";
const args = process.argv.slice(2);
const provision = args.length === 1 && args[0] === "--proof";
const leanBin =
  args.length === 2 && args[0] === "--lean-bin" && isAbsolute(args[1])
    ? args[1]
    : undefined;
if (args.length && !provision && !leanBin)
  throw new Error(
    "Usage: node record/enablement/ci/bend/check.ts [--proof | --lean-bin /absolute/path/to/lean/bin]",
  );

const files = run("git", ["ls-files", "-z", "--", "record/"], root)
  .split("\0")
  .filter((file) => bendSource.test(file));
assert.ok(files.includes(fixture), "Record Bend fixture is missing");
const scratch = mkdtempSync(
  join(process.env.RUNNER_TEMP ?? "/tmp", "apparent-dev-bend-"),
);
try {
  const leanDirectory = provision ? await provisionLean(scratch) : leanBin;
  const compile = await prepareBend(scratch, leanDirectory);
  for (const file of files) {
    const input = join(root, file);
    assert.ok(
      bendPilotPath(file) && lstatSync(input).isFile(),
      `Unsupported Bend source: ${file}`,
    );
    const output = join(scratch, "stage", file.replace(/\.bend$/, ".mjs"));
    mkdirSync(dirname(output), { recursive: true });
    compile(input, output);
    run(process.execPath, ["--check", output], scratch);
    console.log(
      `Bend ${leanDirectory ? "kernel verdict" : "type and law check"} and module build passed for ${file}`,
    );
  }
  const staged = dirname(join(scratch, "stage", fixture));
  const decisions = JSON.parse(
    run(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
    import bend from "./completion.mjs";
    const bool = [true, false];
    console.log(JSON.stringify(bool.flatMap(saved => bool.flatMap(current =>
      bool.map(connected => bend.may_copy(saved, current, connected))))));
  `,
      ],
      staged,
    ),
  );
  const capture = { generation: "1", captureId: "synthetic", requestId: null };
  const context: Context = {
    capture,
    platform: "linux",
    source: "screen",
    agentRequested: false,
    automaticTrialEnabled: false,
    lab: false,
    hyprland: true,
    wayland: true,
  };
  const expected: boolean[] = [];
  for (const saved of [true, false]) {
    for (const current of [true, false]) {
      for (const connected of [true, false]) {
        const decision = reduce(
          { ...begin(context, current), connected },
          {
            type: "finalized",
            capture,
            outcome: saved
              ? { kind: "saved", bundlePath: "/synthetic/record.apparent" }
              : { kind: "failed", message: "synthetic finalizer failure" },
          },
        );
        expected.push(decision.effects.length === 1);
      }
    }
  }
  assert.deepEqual(decisions, expected);
  console.log(
    "Node loaded the staged Bend module and matched all eight Record copy-admission decisions",
  );
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
