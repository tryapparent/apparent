import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import {
  bendScratch,
  proofOptions,
} from "../../../../shared/enablement/bend/build.ts";
import { stageZoom } from "./build.ts";

await bendScratch(async (directory) => {
  await stageZoom(directory, proofOptions(process.argv.slice(2)));
  function run(overrides: object) {
    const request = {
      moment: "10000",
      phrase: null,
      mark: null,
      span: "2000",
      duration: "25000",
      count: "3",
      words: [],
      segments: [],
      keyframes: [],
      ...overrides,
    };
    return JSON.parse(
      execFileSync(process.execPath, [join(directory, "zoom-worker.mjs")], {
        input: JSON.stringify(request),
        encoding: "utf8",
      }),
    );
  }
  assert.deepEqual(run({ keyframes: ["8000", "11000", "11000"] }), {
    status: "plan",
    from: "9500",
    to: "11500",
    times: ["9500", "10500", "11500"],
    nearest: [1, 2, 2],
  });
  assert.deepEqual(run({ moment: "24800" }).times, ["23000", "24000", "25000"]);
  assert.deepEqual(run({ moment: "200", count: "0" }).times, ["0"]);
  assert.deepEqual(run({ moment: "0", duration: "0" }).times, ["0"]);
  assert.deepEqual(
    run({ moment: "1", duration: "2", count: "18446744073709551615" }).times
      .length,
    48,
  );
  assert.deepEqual(
    run({ moment: "9007199254740993", duration: "9007199254740994" }).times,
    ["9007199254738994", "9007199254739994", "9007199254740994"],
  );
  assert.deepEqual(run({ mark: ["9322", "10908"] }).times, [
    "8822",
    "10115",
    "11408",
  ]);
  assert.deepEqual(run({ mark: ["6661", "7182"] }).times, [
    "5921",
    "6921",
    "7921",
  ]);
  assert.equal(run({ mark: ["200", "400"] }).from, "0");
  assert.equal(
    run({ mark: ["13000", "13300"], duration: "13400" }).from,
    "11400",
  );
  assert.deepEqual(run({ moment: "25001" }), { status: "past", at: "25001" });
  const decomposed = { words: [["e\u0301", "9000"]] };
  assert.equal(run({ ...decomposed, phrase: "E" }).from, "8500");
  assert.deepEqual(run({ ...decomposed, phrase: "É" }), { status: "missing" });
  const words = [
    ["𐐀,", "9000"],
    ["Été", "9500"],
    ["𐐨", "10000"],
    ["été!", "10500"],
  ];
  const segments = [["A𐐀\tÉtéZ", "2000"]];
  const phrase = "𐐨\u0085ÉTÉ";
  assert.equal(run({ words, segments, phrase }).from, "8500");
  assert.equal(run({ segments, phrase }).from, "1500");
  for (const query of ["...", "", "missing", "été été"])
    assert.deepEqual(run({ phrase: query, words, segments }), {
      status: "missing",
    });
});
