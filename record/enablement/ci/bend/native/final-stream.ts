import assert from "node:assert/strict";
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
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

export function checkCaptionPolicies(proofOutput: string) {
  run(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import assert from "node:assert/strict";
    import recording from "./recording-policy.mjs";
    import captions from "./caption-admission.mjs";
    assert.equal(captions.openrouter_allowed(true, "microsoft/mai-transcribe-2"), true);
    assert.equal(captions.openrouter_allowed(false, "microsoft/mai-transcribe-2"), false);
    assert.equal(captions.openrouter_allowed(true, "arbitrary"), false);
    assert.equal(captions.openrouter_cli_alt_model_allowed("openai/whisper-large-v3"), true);
    assert.equal(captions.openrouter_speech_format("google"), "wav");
    assert.equal(captions.openrouter_speech_format("speechify"), "mp3");
    for (const available of [false, true]) {
      for (const saved of [false, true]) {
        assert.equal(captions.preview_allowed(saved, available), saved && available);
        assert.equal(recording.volume_level_disabled(available, saved), available || !saved);
        assert.equal(recording.transcription_detail(false, saved, available), available || saved ? 1 : 0);
        assert.equal(recording.transcription_detail(true, saved, available), 2);
      }
    }
  `,
    ],
    proofOutput,
  );
  mkdirSync(join(proofOutput, "src"), { recursive: true });
  mkdirSync(join(proofOutput, "test"), { recursive: true });
  copyFileSync(
    join(proofOutput, "caption-admission.mjs"),
    join(proofOutput, "src/caption-admission.mjs"),
  );
  copyFileSync(
    join(root, "record/transcription/src/openrouter.ts"),
    join(proofOutput, "src/openrouter.ts"),
  );
  copyFileSync(
    join(root, "record/transcription/test/openrouter-cases.ts"),
    join(proofOutput, "test/openrouter-cases.ts"),
  );
  run(process.execPath, ["test/openrouter-cases.ts"], proofOutput);
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
