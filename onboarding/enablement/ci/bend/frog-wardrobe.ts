import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { run } from "../../../../shared/enablement/bend/toolchain.ts";

export const wardrobeTablePath = new URL(
  "../../../host/traversal/frog-wardrobe.json",
  import.meta.url,
);

export function wardrobeTable(directory: string) {
  return run(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import policy from "./frog-wardrobe.mjs";
    const items = [0, 1, 2];
    const counts = Array.from({length: 31}, (_, n) => n);
    const flags = [false, true];
    console.log(JSON.stringify({
      thresholds: items.map(item => policy.threshold(item)),
      credit: flags.flatMap(enabled => flags.flatMap(eligible => flags.flatMap(duplicate =>
        counts.map(count => policy.adds_credit(enabled, eligible, duplicate, count) ? 1 : 0)))).join(""),
      actions: items.flatMap(item => counts.flatMap(count =>
        [0, 1, 2].map(state => policy.available_action(item, count, state)))).join(""),
      changes: items.flatMap(item => counts.flatMap(count => [0, 1, 2].flatMap(state =>
        [1, 2, 3].map(action => policy.apply_action(item, count, state, action))))).join("")
    }));
    `,
    ],
    directory,
  );
}

export function verifyWardrobe(table: string) {
  const data = JSON.parse(table);
  assert.deepEqual(data.thresholds, [10, 20, 30]);
  assert.equal(data.credit, "0".repeat(186) + "1".repeat(30) + "0".repeat(32));
  for (const [item, threshold] of data.thresholds.entries()) {
    const actions = "000".repeat(threshold) + "123".repeat(31 - threshold);
    const changes =
      "000000000".repeat(threshold) + "100020001".repeat(31 - threshold);
    assert.equal(data.actions.slice(item * 93, (item + 1) * 93), actions);
    assert.equal(data.changes.slice(item * 279, (item + 1) * 279), changes);
  }
}

if (import.meta.main) {
  const table = readFileSync(wardrobeTablePath, "utf8");
  verifyWardrobe(table);
  const { thresholds, credit, actions, changes } = JSON.parse(table);
  process.stdout.write(
    `const THRESHOLDS: [usize; 3] = [${thresholds.join(", ")}];\nconst CREDIT: &[u8; 248] = b"${credit}";\nconst ACTIONS: &[u8; 279] = b"${actions}";\nconst CHANGES: &[u8; 837] = b"${changes}";\n`,
  );
}
