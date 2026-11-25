import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  bendScratch,
  proofOptions,
} from "../../../../shared/enablement/bend/build.ts";
import { run } from "../../../../shared/enablement/bend/toolchain.ts";
import { buildTraversal, host } from "./build.ts";
import { type Table, traversalTable } from "./table.ts";

import { frogTable, frogTablePath } from "./frog-nudge.ts";
import { desktopFrogTable, desktopFrogTablePath } from "./desktop-frog.ts";
import { tipTable, tipTablePath } from "./note-tip.ts";

const args = process.argv.slice(2);
const update = args.length === 1 && args[0] === "--write-native";
const tablePath = join(host, "tour-traversal.json");
const dictationPath = new URL(
  "../../../settings/dictation-preference.json",
  import.meta.url,
);

function dictationTable(directory: string): string {
  return run(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import policy from "./dictation-preference.mjs";
    console.log(JSON.stringify(
      [0, 1, 2].map(canonical =>
        [false, true].map(legacy => policy.preference_enabled(canonical, legacy))
      )
    ).replaceAll(",", ", "));
  `,
    ],
    directory,
  );
}

await bendScratch(async (scratch) => {
  const production = join(scratch, "production");
  await buildTraversal(production);
  const generated = traversalTable(production);
  const tips = tipTable(production);
  assert.deepEqual(JSON.parse(tips), {
    duration: 8000,
    starts: [
      [1, false],
      [2, false],
      [3, true],
      [3, false],
    ],
  });
  const frog = frogTable(production);
  const desktopFrog = desktopFrogTable(production);
  assert.deepEqual(JSON.parse(desktopFrog), {
    naming: [0, 0, 0, 0, 1, 2, 0, 0],
    name: [false, false, true, false, true, false, true, false, false, false],
    visible: [false, false, true, false],
    pauseMs: 3600000,
  });
  const dictation = dictationTable(production);
  assert.deepEqual(JSON.parse(dictation), [
    [false, true],
    [false, false],
    [true, true],
  ]);
  assert.deepEqual(JSON.parse(frog), {
    delay: 350,
    eligible: [false, false, true, false],
    cycle: [
      [1, true],
      [0, false],
    ],
    ended: [
      [false, false, false],
      [false, false, false],
      [false, true, false],
    ],
  });
  if (update) {
    writeFileSync(desktopFrogTablePath, desktopFrog);
    writeFileSync(dictationPath, dictation);
    writeFileSync(frogTablePath, frog);
    writeFileSync(tipTablePath, tips);
    writeFileSync(tablePath, generated);
  } else {
    const proof = join(scratch, "proof");
    await buildTraversal(proof, proofOptions(args));
    assert.equal(traversalTable(proof), generated);
    assert.equal(tipTable(proof), tips);
    assert.equal(frogTable(proof), frog);
    assert.equal(desktopFrogTable(proof), desktopFrog);
    assert.deepEqual(
      JSON.parse(readFileSync(desktopFrogTablePath, "utf8")),
      JSON.parse(desktopFrog),
    );
    assert.equal(dictationTable(proof), dictation);
    assert.deepEqual(
      JSON.parse(readFileSync(dictationPath, "utf8")),
      JSON.parse(dictation),
    );
    assert.deepEqual(
      JSON.parse(readFileSync(frogTablePath, "utf8")),
      JSON.parse(frog),
    );
    assert.deepEqual(
      JSON.parse(readFileSync(tipTablePath, "utf8")),
      JSON.parse(tips),
    );
    assert.deepEqual(
      JSON.parse(readFileSync(tablePath, "utf8")),
      JSON.parse(generated),
      "Run node onboarding/enablement/ci/bend/check.ts --write-native",
    );
  }

  const table: Table = JSON.parse(generated);
  assert.deepEqual(table.advance, [
    "2636",
    "2636",
    "3636",
    "4646",
    "5656",
    "5656",
  ]);
  assert.deepEqual(table.enter, ["00", "23", "23", "33", "44", "55"]);
  assert.deepEqual(table.visible, ["11", "00", "10", "11", "11", "11"]);
  assert.deepEqual(table.back, [
    "0000",
    "0101",
    "0202",
    "2303",
    "3434",
    "4545",
  ]);
  assert.deepEqual(table.practice_control, [
    "0000",
    "0000",
    "0000",
    "0000",
    "0001",
    "0000",
  ]);
  assert.deepEqual(table.resume_capture, [
    "0000",
    "1111",
    "2222",
    "3335",
    "4445",
    "5455",
  ]);
  assert.equal(table.primary[2], "01".repeat(16));
  assert.equal(table.primary[3], "11001100110011111100110011001100");
  assert.equal(table.primary[4], "2200".repeat(8));
  assert.equal(table.primary[5], "2".repeat(32));
  assert.equal(table.primary[0], "1".repeat(32));
  assert.equal(table.primary[1], "1".repeat(32));
});
