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
      console.log(JSON.stringify([
        values.flatMap(gpc => values.map(dnt => policy.may_queue(gpc, dnt))),
        values.map(completed => policy.upload_increment(completed)),
      ]));`,
      ],
      directory,
    );
    assert.deepEqual(JSON.parse(decisions), [
      [true, false, false, false],
      [0, 1],
    ]);
    const reports = run(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import policy from "./report-policy.mjs";
        const flags = [false, true];
        const bytes = [63, 64, 25165824, 25165825, 33554432, 33554433];
        console.log(JSON.stringify([
          flags.flatMap(extended => flags.map(current => Number(policy.advertised_limit(extended, current)))),
          flags.map(extended => bytes.map(size => policy.upload_size(extended, size))),
        ]));`,
      ],
      directory,
    );
    assert.deepEqual(JSON.parse(reports), [
      [25165824, 25165824, 25165824, 33554432],
      [
        [false, true, true, false, false, false],
        [false, true, true, true, true, false],
      ],
    ]);
    const account = run(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import policy from "./account-status.mjs";
        const tag = $ => ({$});
        console.log(JSON.stringify([
          ["SignedOut", false, "Idle", "NoOutcome", "NoOutcome"],
          ["Current", true, "Idle", "NoOutcome", "NoOutcome"],
          ["Renewable", false, "Idle", "NoOutcome", "NoOutcome"],
          ["Current", true, "Idle", "Waitlisted", "NoOutcome"],
          ["Current", true, "Idle", "NoOutcome", "LocalState"]
        ].map(([grant, enabled, activity, outcome, local]) => {
          const status = policy.account_status(tag(grant), enabled, tag(activity), tag(outcome), tag(local));
          return [status.$, policy.recovery(status, tag(grant), enabled).$];
        })));`,
      ],
      directory,
    );
    assert.deepEqual(JSON.parse(account), [
      ["SignedOutCard", "Connect"],
      ["UploadsOn", "NoRecovery"],
      ["Renew", "CheckAgain"],
      ["WaitlistCard", "Retry"],
      ["LocalError", "Refresh"],
    ]);
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
