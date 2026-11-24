import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  bendScratch,
  buildBend,
} from "../../../../../shared/enablement/bend/build.ts";
import { run } from "../../../../../shared/enablement/bend/toolchain.ts";

const root = fileURLToPath(new URL("../../../../../", import.meta.url));

export function finalStreamTable(directory: string): {
  allowance: number;
  allowed: boolean[];
  install: boolean[];
  pause: boolean[];
} {
  return JSON.parse(
    run(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
        import policy from "./final-stream.mjs";
        console.log(JSON.stringify({
          allowance: policy.eof_punctuation_start_allowance_ms(),
          pause: Array.from({ length: 4 }, (_, mask) =>
            policy.pause_capture(Boolean(mask & 2), Boolean(mask & 1)),
          ),
          install: Array.from({ length: 8 }, (_, mask) =>
            policy.install_resident_final(
              Boolean(mask & 4), Boolean(mask & 2), Boolean(mask & 1),
            ),
          ),
          allowed: Array.from({ length: 8 }, (_, mask) =>
            policy.resident_final(
              Boolean(mask & 4), Boolean(mask & 2), Boolean(mask & 1),
            ),
          ),
        }));
        `,
      ],
      directory,
    ),
  );
}

if (import.meta.main) {
  await bendScratch(async (scratch) => {
    await buildBend(
      root,
      "record",
      scratch,
      undefined,
      "record/transcription/",
    );
    const { allowance, allowed, install, pause } = finalStreamTable(scratch);
    assert(Number.isInteger(allowance) && allowance > 0 && allowance <= 1000);
    assert(
      allowed.length === 8 &&
        allowed.every((value, index) => value === (index === 4)),
    );
    assert(
      install.length === 8 &&
        install.every((value, index) => value === (index === 6)),
    );
    assert.deepEqual(pause, [false, false, false, true]);
    process.stdout.write(
      `pub(crate) const EOF_PUNCTUATION_START_ALLOWANCE_MS: i64 = ${allowance};
fn allows_resident_final(builtin: bool, installed: bool, preview: bool) -> bool {
    const RESIDENT_FINAL: [bool; 8] = [${allowed.join(", ")}];
    RESIDENT_FINAL[usize::from(builtin) * 4 + usize::from(installed) * 2 + usize::from(preview)]
}
fn allows_resident_install(resident: bool, configured: bool, preparing: bool) -> bool {
    const RESIDENT_INSTALL: [bool; 8] = [${install.join(", ")}];
    RESIDENT_INSTALL[usize::from(resident) * 4 + usize::from(configured) * 2 + usize::from(preparing)]
}
pub(crate) fn allows_capture_pause(local_background: bool, word_probe: bool) -> bool {
    const PAUSE_CAPTURE: [bool; 4] = [${pause.join(", ")}];
    PAUSE_CAPTURE[usize::from(local_background) * 2 + usize::from(word_probe)]
}
`,
    );
  });
}
