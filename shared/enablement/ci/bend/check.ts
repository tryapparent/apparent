import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { bendScratch, proofOptions } from "../../bend/build.ts";
import { run } from "../../bend/toolchain.ts";
import { benchmarkComparison } from "../../performance/comparison.ts";
import { buildSparkleOutcomes } from "./build.ts";

await bendScratch(async (scratch) => {
  const regressions = ["toolchain.test.ts", "scaffold/test.ts"].map((path) =>
    fileURLToPath(new URL("../../bend/" + path, import.meta.url)),
  );
  console.log(
    run(process.execPath, ["--test", ...regressions], scratch).trimEnd(),
  );
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
      for (const code of [1001, 1003, 1005, 4007, 4008]) {
        assert.equal(sparkle_outcome(true, code), "expected");
        assert.equal(sparkle_outcome(false, code), "report");
      }
      for (const code of [1000, 1002, 1004, 1006, 4005, 4006, 4009]) {
        assert.equal(sparkle_outcome(true, code), "report");
      }
      `,
    ],
    scratch,
  );
});

const comparison = await benchmarkComparison(
  [
    [1000, 500, 700, 1400],
    [900.001, 900.001, 905, 905],
    [1, 3, 2, 2],
  ],
  [
    [1152, 1024, 128],
    [1152.001, 1024, 128],
  ],
  proofOptions(process.argv.slice(2)),
);
assert.deepEqual(
  comparison.timings.map(({ score }) => score),
  [50, 100, 166.67],
);
assert.deepEqual(comparison.permitted, [true, false]);
