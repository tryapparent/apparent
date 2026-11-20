import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  bendScratch,
  buildBend,
  proofOptions,
} from "../../../../shared/enablement/bend/build.ts";
import { run } from "../../../../shared/enablement/bend/toolchain.ts";
import { repairTable } from "./permission-table.ts";
import { admissionSource, buildAdmission } from "./build.ts";
import { assemblePill } from "./pill.ts";

import { gestureTable, gestureTablePath } from "./note-gesture.ts";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const args = process.argv.slice(2);
const update = args.length === 1 && args[0] === "--write-native-gesture";
const options = proofOptions(update ? [] : args);
await bendScratch(async (scratch) => {
  const gestureOutput = join(scratch, "gesture");
  await buildBend(root, "record", gestureOutput, undefined, "record/notes/");
  const gesture = gestureTable(gestureOutput);
  assert.deepEqual(JSON.parse(gesture), {
    enabledByDefault: true,
    hold: 250,
    pair: 400,
    pointer: 12,
    release: [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 2],
  });
  if (update) {
    writeFileSync(gestureTablePath, gesture);
    return;
  }
  assert.deepEqual(
    JSON.parse(readFileSync(gestureTablePath, "utf8")),
    JSON.parse(gesture),
  );
  const proofOutput = join(scratch, "proof");
  await buildBend(root, "record", proofOutput, options);
  assert.deepEqual(
    JSON.parse(
      run(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `
    import retention from "./feedback.mjs";
    console.log(JSON.stringify([
      retention.submission_phase(false, true, true),
      retention.submission_phase(true, true, false),
      retention.submission_phase(true, true, true),
      retention.submission_phase(true, false, true),
      retention.reset_available(true, false),
      retention.reset_available(true, true),
      retention.keep_submission(true, false),
      retention.keep_submission(true, true),
      retention.show_readback_difference(true, true, true, false, true),
      retention.show_readback_difference(true, true, true, true, false),
      retention.show_readback_difference(true, true, true, true, true),
      retention.show_readback_difference(true, true, false, false, false),
      retention.show_readback_difference(false, true, true, false, false),
      retention.has_draft(false, false),
      retention.has_draft(true, true),
      retention.has_draft(true, false),
    ]));
  `,
        ],
        proofOutput,
      ),
    ),
    [
      0,
      1,
      2,
      3,
      false,
      true,
      true,
      false,
      true,
      true,
      false,
      false,
      false,
      false,
      false,
      true,
    ],
  );
  assert.deepEqual(
    JSON.parse(
      readFileSync(
        join(root, "record/media/src/assembly/frame-label.json"),
        "utf8",
      ),
    ),
    JSON.parse(
      run(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `
      import labels from "./frame-label.mjs";
      console.log(JSON.stringify(Array.from({length: 4}, (_, bits) =>
        labels.precision(Boolean(bits & 1), Boolean(bits & 2)))));
    `,
        ],
        proofOutput,
      ),
    ),
  );
  assert.equal(gestureTable(proofOutput), gesture);
  const repair = JSON.parse(
    readFileSync(
      join(root, "record/settings/permissions/permission-policy.json"),
      "utf8",
    ),
  );
  assert.deepEqual(repairTable(proofOutput), repair);
  run(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import assert from "node:assert/strict";
    import recording from "./recording-policy.mjs";
    import captions from "./caption-admission.mjs";
    for (const available of [false, true]) {
      for (const saved of [false, true]) {
        assert.equal(captions.preview_allowed(saved, available), saved && available);
        assert.equal(recording.volume_switch_enabled(available, saved), available || saved);
        assert.equal(recording.volume_level_enabled(available, saved), available && saved);
        assert.equal(recording.transcription_detail(false, saved, available), available || saved ? 1 : 0);
        assert.equal(recording.transcription_detail(true, saved, available), 2);
      }
    }
  `,
    ],
    proofOutput,
  );
  const pill = join(scratch, "record-pill.mjs");
  assemblePill(proofOutput, pill);
  const stateTest = join(scratch, "state-cases.ts");
  copyFileSync(
    join(root, "record/enablement/ci/pill/state-cases.ts"),
    stateTest,
  );
  console.log(run(process.execPath, [stateTest], scratch).trim());
  console.log(
    run(
      process.execPath,
      ["record/enablement/ci/pill/meter.test.ts"],
      root,
    ).trim(),
  );

  const quiet = (directory: string) =>
    JSON.parse(
      run(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `
      import bend from "./quiet-export.mjs";
      const clock = (hi, lo) => ({ $: "Clock", hi, lo });
      const span = { $: "Span", start: clock(0,0), end: clock(1,12000) };
      const nil = { $: "Nil" };
      const observed = { $: "Con", head: span, tail: nil };
      console.log(JSON.stringify(bend.plan_quiet_export(observed, observed, nil, clock(0,0), 64)));
    `,
        ],
        directory,
      ),
    );
  assert.deepEqual(quiet(proofOutput), {
    $: "Con",
    head: {
      $: "Span",
      start: { $: "Clock", hi: 0, lo: 5000 },
      end: { $: "Clock", hi: 1, lo: 7000 },
    },
    tail: { $: "Nil" },
  });
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
