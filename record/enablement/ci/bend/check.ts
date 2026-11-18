import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
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
import { admissionSource, buildAdmission } from "./build.ts";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const admission = "record/completion/src/copy-admission.bend";
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
assert.ok(files.includes(admission), "Record copy admission source is missing");
const scratch = mkdtempSync(
  join(process.env.RUNNER_TEMP ?? "/tmp", "apparent-dev-bend-"),
);
try {
  const leanDirectory = provision ? await provisionLean(scratch) : leanBin;
  const compile = await prepareBend(scratch, { runtime: "bun", leanDirectory });
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
  const proofOutput = dirname(join(scratch, "stage", admission));
  const production = join(scratch, "production");
  await buildAdmission(production);
  const decisions = (directory: string) =>
    JSON.parse(
      run(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `
      import bend from "./copy-admission.mjs";
      const bool = [true, false];
      console.log(JSON.stringify(bool.flatMap(saved => bool.flatMap(current =>
        bool.map(connected => bend.may_copy(saved, current, connected))))));
    `,
        ],
        directory,
      ),
    );
  const expected = [true, false, false, false, false, false, false, false];
  assert.deepEqual(decisions(proofOutput), expected);
  assert.deepEqual(decisions(production), expected);
  console.log(
    "The build and proof paths agree on all eight copy-admission decisions",
  );

  for (const name of ["worker.ts", "session.ts", "policy.ts"])
    copyFileSync(join(dirname(admissionSource), name), join(production, name));
  const context = {
    capture: { generation: "1", captureId: "synthetic", requestId: null },
    platform: "linux",
    source: "screen",
    agentRequested: false,
    automaticTrialEnabled: false,
    lab: false,
    hyprland: true,
    wayland: true,
  };
  for (const current of [true, false]) {
    const invocation = spawnSync(
      process.execPath,
      ["--experimental-strip-types", "worker.ts"],
      {
        cwd: production,
        encoding: "utf8",
        timeout: 15_000,
        input:
          JSON.stringify({
            version: 1,
            context,
            current,
            outcome: {
              kind: "saved",
              bundlePath: "/synthetic/record.apparent",
            },
          }) + '\n{"result":"copied"}\n',
      },
    );
    assert.equal(
      invocation.status,
      0,
      invocation.error?.message ?? invocation.stderr,
    );
    const replies = invocation.stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(
      replies[0].effects,
      current
        ? [{ type: "copy", capture: context.capture, mode: "bundle" }]
        : [],
    );
    assert.equal(replies.length, current ? 2 : 1);
    assert.equal(
      replies.at(-1).state.observation.clipboard,
      current ? "copied" : "notRequested",
    );
  }
  console.log(
    "The real Record worker loaded the production Bend module and handled current and stale captures",
  );
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
