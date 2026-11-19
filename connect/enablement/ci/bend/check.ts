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
    const routes = run(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import policy from "./reader-route.mjs";
      const found = index => ({$: "Found", index});
      const failed = index => ({$: "Failed", index});
      const missing = {$: "Missing"};
      const probes = entries => entries.reduceRight((tail, probe) => ({$: "Next", probe, tail}), {$: "End"});
      const cases = [
        [[failed(0), missing, found(2)], true],
        [[found(0), found(1)], false],
        [[failed(0), missing], true],
        [[failed(0), missing], false],
        [[missing], false],
      ];
      console.log(JSON.stringify(cases.map(([entries, wait]) => policy.reader_route(probes(entries), wait))));`,
      ],
      directory,
    );
    assert.deepEqual(JSON.parse(routes), [
      { $: "Use", index: 2 },
      { $: "Use", index: 0 },
      { $: "Retry" },
      { $: "Report", index: 0 },
      { $: "Unavailable" },
    ]);
  }
});
