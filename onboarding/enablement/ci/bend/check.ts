import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  bendScratch,
  proofOptions,
} from "../../../../shared/enablement/bend/build.ts";
import { buildTraversal, host } from "./build.ts";
import { type Table, traversalTable } from "./table.ts";

const args = process.argv.slice(2);
const update = args.length === 1 && args[0] === "--write-native";
const tablePath = join(host, "tour-traversal.json");

await bendScratch(async (scratch) => {
  const production = join(scratch, "production");
  await buildTraversal(production);
  const generated = traversalTable(production);
  if (update) {
    writeFileSync(tablePath, generated);
  } else {
    const proof = join(scratch, "proof");
    await buildTraversal(proof, proofOptions(args));
    assert.equal(traversalTable(proof), generated);
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
