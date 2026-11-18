import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  bendScratch,
  buildBend,
  proofOptions,
} from "../../../../shared/enablement/bend/build.ts";
import { run } from "../../../../shared/enablement/bend/toolchain.ts";
import { admissionSource, buildAdmission } from "./build.ts";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const options = proofOptions(process.argv.slice(2));
await bendScratch(async (scratch) => {
  const proofOutput = join(scratch, "proof");
  await buildBend(root, "record", proofOutput, options);
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
  writeFileSync(join(production, "package.json"), '{"type":"module"}');
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
  renameSync(
    join(production, "copy-admission.mjs"),
    join(scratch, "omitted.mjs"),
  );
  assert.throws(
    () => run(process.execPath, ["worker.ts"], production),
    /ERR_MODULE_NOT_FOUND/,
  );
  console.log(
    "The real Record worker loaded the production Bend module and handled current and stale captures",
  );
});
