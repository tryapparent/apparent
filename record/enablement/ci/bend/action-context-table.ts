import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "../../../../shared/enablement/bend/toolchain.ts";

export const actionContextTable = (compiled: string) =>
  run(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
      import policy from "./action-context.mjs";
      const table = Array.from({ length: 8 }, (_, bits) =>
        policy.admit_action_context(...[1, 2, 4].map(flag => Boolean(bits & flag))));
      console.log(JSON.stringify(table));
      `,
    ],
    compiled,
  ).trim();

export function checkActionTables(root: string, proofOutput: string) {
  assert.deepEqual(JSON.parse(actionContextTable(proofOutput)), [
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    true,
  ]);

  assert.deepEqual(
    JSON.parse(
      readFileSync(
        join(root, "record/media/src/assembly/target/browser-page.json"),
        "utf8",
      ),
    ),
    JSON.parse(
      run(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `
      import policy from "./focused-mark.mjs";
      console.log(JSON.stringify(Array.from({length: 8}, (_, bits) =>
        policy.admit_browser_page(...[1, 2, 4].map(flag => Boolean(bits & flag))))));
    `,
        ],
        proofOutput,
      ),
    ),
  );
}
