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
    const counts = Array.from({length: policy.threshold(2) + 1}, (_, n) => n);
    const flags = [false, true];
    const itemTable = project => items.flatMap(item => counts.flatMap(count =>
      [0, 1, 2].map(state => project(item, count, state))));
    console.log(JSON.stringify({
      thresholds: items.map(item => policy.threshold(item)),
      credit: flags.flatMap(enabled => flags.flatMap(eligible => flags.flatMap(duplicate =>
        counts.map(count => policy.adds_credit(enabled, eligible, duplicate, count) ? 1 : 0)))).join(""),
      earned: itemTable(policy.earned_state).join(""),
      actions: itemTable(policy.available_action).join(""),
      changes: itemTable((item, count, state) =>
        [1, 2].map(action => policy.apply_action(item, count, state, action))).flat().join("")
    }));
    `,
    ],
    directory,
  );
}

export function verifyWardrobe(table: string) {
  const data = JSON.parse(table);
  assert.deepEqual(data.thresholds, [10, 30, 60]);
  assert.equal(data.credit, "0".repeat(366) + "1".repeat(60) + "0".repeat(62));
  const width = 61;
  for (const [item, threshold] of data.thresholds.entries()) {
    const slice = (name: string, states: number) =>
      data[name].slice(item * width * states, (item + 1) * width * states);
    assert.equal(
      slice("earned", 3),
      "012".repeat(threshold) + "212".repeat(width - threshold),
    );
    assert.equal(
      slice("actions", 3),
      "012".repeat(threshold) + "212".repeat(width - threshold),
    );
    assert.equal(
      slice("changes", 6),
      "002001".repeat(threshold) + "012001".repeat(width - threshold),
    );
  }
}

if (import.meta.main) {
  const table = readFileSync(wardrobeTablePath, "utf8");
  verifyWardrobe(table);
  const { thresholds, ...matrices } = JSON.parse(table);
  process.stdout.write(
    `const THRESHOLDS: [usize; 3] = [${thresholds.join(", ")}];\n`,
  );
  for (const [key, value] of Object.entries(matrices)) {
    const bytes = String(value);
    process.stdout.write(
      `const ${key.toUpperCase()}: &[u8; ${bytes.length}] = b"${bytes}";\n`,
    );
  }
}
