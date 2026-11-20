import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { run } from "../../../../shared/enablement/bend/toolchain.ts";

export const tipTablePath = new URL(
  "../../../host/tips/note-tip.json",
  import.meta.url,
);

export function tipTable(directory: string): string {
  return run(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import tip from "./note-tip.mjs";
    console.log(JSON.stringify({
      duration: tip.duration_ms(),
      starts: [0, 1, 2, 3].map(previous =>
        [tip.recording_started(previous), tip.tip_due(previous)])
    }));
  `,
    ],
    directory,
  );
}

export function nativeNoteTip(): string {
  const { duration, starts } = JSON.parse(readFileSync(tipTablePath, "utf8"));
  assert.ok(
    Number.isSafeInteger(duration) && duration > 0 && duration <= 60000,
  );
  assert.ok(
    Array.isArray(starts) &&
      starts.length === 4 &&
      starts.every(
        ([next, due]) =>
          [0, 1, 2, 3].includes(next) && typeof due === "boolean",
      ),
  );
  return `pub(super) const DURATION_MS: u64 = ${duration};
const STARTS: [(u64, bool); 4] = [${starts.map(([next, due]) => `(${next}, ${due})`).join(", ")}];
`;
}

if (import.meta.main) process.stdout.write(nativeNoteTip());
