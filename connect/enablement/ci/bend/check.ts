import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  bendScratch,
  buildBend,
  proofOptions,
} from "../../../../shared/enablement/bend/build.ts";
import { run } from "../../../../shared/enablement/bend/toolchain.ts";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const options = proofOptions(process.argv.slice(2));

await bendScratch(async (scratch) => {
  const proof = join(scratch, "proof");
  const production = join(scratch, "production");
  await buildBend(root, "connect", proof, options);
  await buildBend(root, "connect", production);
  for (const directory of [proof, production]) {
    const decisions = run(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import policy from "./activity-preference.mjs";
      const values = [false, true];
      console.log(JSON.stringify(values.flatMap(gpc => values.map(dnt => policy.may_queue(gpc, dnt)))));`,
      ],
      directory,
    );
    assert.deepEqual(JSON.parse(decisions), [true, false, false, false]);
  }
});
