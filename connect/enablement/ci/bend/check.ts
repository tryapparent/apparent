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
    const style = run(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import policy from "./style-history.mjs";
      console.log(JSON.stringify([policy.scan_limit(), policy.token_budget(), policy.available(true,true,true),
        policy.available(false,true,true), policy.available(true,false,true), policy.available(true,true,false)]));`,
      ],
      directory,
    );
    assert.deepEqual(JSON.parse(style), [12, 1024, true, false, false, false]);
    const list = run(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import policy from "./recording-list.mjs";
        console.log(JSON.stringify([
          [0, 1, 50, 51].map(policy.valid_limit),
          [0, 2932896, 2932897].map(policy.valid_recording_day),
        ]));`,
      ],
      directory,
    );
    assert.deepEqual(JSON.parse(list), [
      [false, true, true, false],
      [true, true, false],
    ]);
    const polling = run(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import policy from "./pending-poll.mjs";
      console.log(JSON.stringify([
        policy.lifetime(),
        [[1, 23], [1, 24], [0, 1]].map(args => policy.can_poll(...args)),
        [
          [120000, 0, 0, true, false],
          [120000, 0, 0, false, false],
          [119000, 100, 1, true, false],
          [118000, 50, 2, true, false],
          [113000, 2200, 3, true, false],
          [113000, 2200, 3, true, true],
          [113000, 100, 3, true, true],
          [250, 100, 3, true, true],
          [250, 2200, 3, false, true]
        ].map(args => policy.wait_ms(...args))
      ]));`,
      ],
      directory,
    );
    assert.deepEqual(JSON.parse(polling), [
      120000,
      [true, false, false],
      [0, 120000, 900, 3950, 2800, 0, 900, 250, 250],
    ]);
    const reports = run(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import policy from "./report-policy.mjs";
        console.log(JSON.stringify([
          policy.part(0, 1), policy.part(5, 90000000),
          policy.part(6, 1), policy.part(0, 0),
        ]));`,
      ],
      directory,
    );
    assert.deepEqual(JSON.parse(reports), [true, true, false, false]);
    const renewal = run(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import policy from "./credential-renewal.mjs";
        console.log(JSON.stringify([
          policy.before_request(false, 31),
          policy.before_request(false, 30),
          policy.before_request(true, 4294967295),
          policy.under_renewal_lock(true, true, 0, false),
          policy.under_renewal_lock(false, false, 31, true),
          policy.under_renewal_lock(false, true, 31, false),
          policy.under_renewal_lock(false, false, 30, true),
          policy.resume_renewal(true, true),
          policy.resume_renewal(false, true),
          policy.resume_renewal(false, false),
          policy.after_transport(false, true),
          policy.after_transport(true, true),
          policy.after_transport(true, false),
        ]));`,
      ],
      directory,
    );
    assert.deepEqual(JSON.parse(renewal), [
      "send",
      "renew",
      "force",
      "reuse",
      "reuse",
      "reapprove",
      "readJournal",
      "recover",
      "reapprove",
      "exchange",
      "return",
      "renew",
      "reapprove",
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
    const startup = run(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import policy from "./account-status.mjs";
        const states = [false, true];
        console.log(JSON.stringify(
          states.flatMap(opened => states.map(available => policy.check_on_open(opened, available))),
        ));`,
      ],
      directory,
    );
    assert.deepEqual(JSON.parse(startup), [false, true, false, false]);
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
