import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  bendScratch,
  buildBend,
} from "../../../../shared/enablement/bend/build.ts";
import { run } from "../../../../shared/enablement/bend/toolchain.ts";

export function pushToTalkTable(directory: string): {
  hold: number;
  actions: number[];
} {
  return JSON.parse(
    run(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
    import policy from "./push-to-talk.mjs";
    console.log(JSON.stringify({
      hold: policy.hold_ms(),
      actions: Array.from({length: 16}, (_, index) =>
        policy.action(...[1, 2, 4, 8].map(bit => Boolean(index & bit))))
    }));
    `,
      ],
      directory,
    ),
  );
}

if (import.meta.main) {
  const root = fileURLToPath(new URL("../../../../", import.meta.url));
  await bendScratch(async (scratch) => {
    await buildBend(root, "record", scratch, undefined, "record/shortcuts/");
    const { hold, actions } = pushToTalkTable(scratch);
    assert.ok(Number.isSafeInteger(hold) && hold > 0);
    assert.ok(
      actions.length === 16 &&
        actions.every((action) => [0, 1, 2, 3, 4].includes(action)),
    );
    const names = ["Wait", "Tap", "Start", "Finish", "Cancel"];
    process.stdout.write(`const PUSH_TO_TALK_MS: u128 = ${hold};
const PUSH_TO_TALK_ACTIONS: [HoldAction; 16] = [${actions.map((action) => `HoldAction::${names[action]}`).join(", ")}];
`);
  });
}
