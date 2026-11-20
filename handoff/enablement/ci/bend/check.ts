import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  bendScratch,
  buildBend,
  proofOptions,
} from "../../../../shared/enablement/bend/build.ts";
import { run } from "../../../../shared/enablement/bend/toolchain.ts";
import { buildOrdering } from "./build.ts";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
await bendScratch(async (scratch) => {
  await buildBend(
    root,
    "handoff",
    scratch,
    proofOptions(process.argv.slice(2)),
  );
  run(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
      import assert from "node:assert/strict";
      import policy from "./auto-paste-preference.mjs";
      assert.deepEqual(
        [[false, false], [false, true], [true, false], [true, true]]
          .map(([supported, saved]) => policy.can_toggle(supported, saved)),
        [false, true, true, true],
      );
    `,
    ],
    scratch,
  );
  assert.deepEqual(
    JSON.parse(
      readFileSync(join(root, "handoff/pure/transcript-only.json"), "utf8"),
    ),
    JSON.parse(
      run(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `
      import policy from "./transcript-only.mjs";
      console.log(JSON.stringify(Array.from({length: 8}, (_, bits) =>
        policy.transcript_only(...[1, 2, 4].map(flag => Boolean(bits & flag))))));
    `,
        ],
        scratch,
      ),
    ),
  );
});
await buildOrdering();
console.log(
  run(
    process.execPath,
    [
      "--experimental-strip-types",
      "--test",
      ...["chooser", "controller", "delivery", "destinations"].map(
        (name) => `handoff/enablement/tests/${name}.test.ts`,
      ),
    ],
    root,
  ),
);
