import { join } from "node:path";
import { bendScratch, proofOptions } from "../../bend/build.ts";
import { run } from "../../bend/toolchain.ts";
import { buildSparkleOutcomes } from "./build.ts";

await bendScratch(async (scratch) => {
  await buildSparkleOutcomes(
    join(scratch, "sparkle-outcomes.mjs"),
    proofOptions(process.argv.slice(2)),
  );
  run(
    process.execPath,
    [
      "--input-type=module-typescript",
      "-e",
      `
      import assert from "node:assert/strict";
      import { sparkle_outcome } from "./sparkle-outcomes.mjs";
      for (const code of [1001, 1003, 4007, 4008]) {
        assert.equal(sparkle_outcome(true, code), "expected");
        assert.equal(sparkle_outcome(false, code), "report");
      }
      for (const code of [1000, 1002, 1004, 1005, 4005, 4006, 4009]) {
        assert.equal(sparkle_outcome(true, code), "report");
      }
      `,
    ],
    scratch,
  );
});
