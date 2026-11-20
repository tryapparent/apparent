import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { run } from "../../../../shared/enablement/bend/toolchain.ts";

export const frogTablePath = new URL(
  "../../../host/tips/frog-nudge.json",
  import.meta.url,
);

export function frogTable(directory: string): string {
  return run(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import frog from "./frog-nudge.mjs";
    const flags = [false, true];
    console.log(JSON.stringify({
      delay: frog.settle_ms(),
      eligible: flags.flatMap(enabled => flags.map(blocked => frog.eligible(enabled, blocked))),
      cycle: [0, 1].map(previous => [frog.next_count(previous), frog.wave_due(previous)]),
      ended: [0, 1, 2].map(previous => [0, 1, 2].map(current => frog.ended(previous, current)))
    }));
  `,
    ],
    directory,
  );
}

if (import.meta.main) {
  const { delay, eligible, ended, cycle } = JSON.parse(
    readFileSync(frogTablePath, "utf8"),
  );
  assert.ok(Number.isSafeInteger(delay) && delay > 0);
  assert.ok(
    eligible.length === 4 &&
      eligible.every((value) => typeof value === "boolean"),
  );
  assert.ok(
    ended.length === 3 &&
      ended.every(
        (row) =>
          row.length === 3 && row.every((value) => typeof value === "boolean"),
      ),
  );
  assert.deepEqual(cycle, [
    [1, true],
    [0, false],
  ]);
  process.stdout.write(
    `const SETTLE_MS: u64 = ${delay};\nconst ELIGIBLE: [bool; 4] = [${eligible.join(", ")}];\nconst CYCLE: [(u64, bool); ${cycle.length}] = [${cycle.map((row) => "(" + row.join(", ") + ")").join(", ")}];\nconst ENDED: [[bool; 3]; 3] = [${ended.map((row) => "[" + row.join(", ") + "]").join(", ")}];\n`,
  );
}
