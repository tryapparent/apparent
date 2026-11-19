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
