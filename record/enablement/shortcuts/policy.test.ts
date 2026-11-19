import assert from "node:assert/strict";
import { test } from "node:test";
import {
  START_DISPLAY_PREFERENCE,
  recordDefault,
  usesDesktopRecord,
} from "../../shortcuts/policy.ts";

test("a keyboard-started recording follows the frontmost window before the pointer", () => {
  assert.deepEqual(START_DISPLAY_PREFERENCE, ["focused", "pointer", "first"]);
});

test("defaults preserve the Mac Fn press and Linux layout-resolved Alt+Shift+S", () => {
  assert.deepEqual(recordDefault("macos"), {
    key: "Fn",
    keyCode: 63,
    modifiers: 0,
  });
  assert.deepEqual(recordDefault("linux"), {
    key: "S",
    keyCode: null,
    modifiers: 2560,
  });
});

test("only a verified Linux desktop binding may take precedence over an ordinary saved shortcut", () => {
  for (const platform of ["macos", "linux"] as const) {
    const cases = [
      usesDesktopRecord(platform, false, false),
      usesDesktopRecord(platform, false, true),
      usesDesktopRecord(platform, true, false),
      usesDesktopRecord(platform, true, true),
    ];
    assert.deepEqual(cases, [false, platform === "linux", false, false]);
  }
});
