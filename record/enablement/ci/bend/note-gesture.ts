import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { run } from "../../../../shared/enablement/bend/toolchain.ts";

export const gestureTablePath = new URL(
  "../../../notes/double-shift.json",
  import.meta.url,
);

export function gestureTable(directory: string): string {
  return run(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import gesture from "./double-shift.mjs";
    console.log(JSON.stringify({
      hold: gesture.hold_limit_ms(),
      pair: gesture.pair_limit_ms(),
      pointer: gesture.pointer_limit(),
      blocksNote: Array.from({length: 4}, (_, index) =>
        gesture.blocks_note(Boolean(index & 1), Boolean(index & 2))),
      release: Array.from({length: 16}, (_, index) =>
        gesture.release(...[1, 2, 4, 8].map(bit => Boolean(index & bit))))
    }));
  `,
    ],
    directory,
  );
}

export function checkGesture(gesture: string): void {
  assert.deepEqual(JSON.parse(gesture), {
    hold: 250,
    pair: 400,
    pointer: 12,
    blocksNote: [false, true, false, false],
    release: [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 2],
  });
}

export function nativeNoteGesture(): string {
  const { hold, pair, pointer, blocksNote, release } = JSON.parse(
    readFileSync(gestureTablePath, "utf8"),
  );
  for (const limit of [hold, pair, pointer])
    assert.ok(Number.isSafeInteger(limit) && limit > 0 && limit <= 10000);
  assert.ok(
    Array.isArray(release) &&
      release.length === 16 &&
      release.every((value) => [0, 1, 2].includes(value)),
  );
  assert.ok(
    Array.isArray(blocksNote) &&
      blocksNote.length === 4 &&
      blocksNote.every((value) => typeof value === "boolean"),
  );
  return `const BLOCKS_NOTE: [bool; 4] = [${blocksNote.join(", ")}];
const HOLD_MS: u64 = ${hold};
const PAIR_MS: u64 = ${pair};
const POINTER_LIMIT: f64 = ${pointer}.0;
const RELEASE: [u8; 16] = [${release.join(", ")}];
`;
}

if (import.meta.main) process.stdout.write(nativeNoteGesture());
