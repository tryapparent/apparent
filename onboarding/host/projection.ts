import type { Rect } from "./presentation.ts";

const steps = new Set([
  "welcome",
  "how-it-works",
  "permissions",
  "shortcut",
  "try-it",
  "done",
]);
const phases = new Set([
  "start",
  "screen",
  "whiteboard",
  "board-ink",
  "screen-ink",
  "note",
  "stop",
  "preparing",
  "copied",
  "paste",
  "locate",
  "complete",
  "retry",
  "copy-failed",
]);
const permissions = new Set([
  "screen-recording",
  "microphone",
  "accessibility",
  "speech-recognition",
  "camera",
]);
export const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const rgb = (value: unknown): value is [number, number, number] =>
  Array.isArray(value) &&
  value.length === 3 &&
  value.every((n) => Number.isInteger(n) && n >= 0 && n <= 255);
const rect = (value: unknown): value is Rect =>
  Array.isArray(value) && value.length === 4 && value.every(Number.isFinite);
export function project(value: unknown) {
  if (!record(value)) return null;
  const v = value;
  if (
    v.type !== "state" ||
    typeof v.step !== "string" ||
    !steps.has(v.step) ||
    !Array.isArray(v.rows) ||
    v.rows.length > 5 ||
    typeof v.ready !== "boolean"
  )
    return null;
  const rows = [];
  for (const r of v.rows) {
    if (
      !record(r) ||
      typeof r.permission !== "string" ||
      !permissions.has(r.permission) ||
      typeof r.status !== "string" ||
      !["granted", "denied", "not-determined", "unavailable"].includes(r.status)
    )
      return null;
    rows.push({
      permission: r.permission,
      status: r.status,
      required: r.required === true,
      reopening: r.reopening === true,
      relaunch: r.relaunch === true,
    });
  }
  const editor = v.shortcutEditor;
  const suggestedFn = record(editor) ? editor.suggestedFn : null;
  return {
    tutorial:
      typeof v.tutorial === "string" &&
      ["skipped", "watched", "practiced"].includes(v.tutorial)
        ? v.tutorial
        : null,
    step: v.step,
    ready: v.ready,
    fix: v.fix === true,
    rows,
    index: v.index,
    count: v.count,
    shortcut: typeof v.shortcut === "string" ? v.shortcut.slice(0, 80) : "",
    shortcutEditing: v.shortcutEditing === true,
    shortcutChosen: v.shortcutChosen === true,
    shortcutTested: v.shortcutTested === true,
    shortcutSelectionReleased: v.shortcutSelectionReleased === true,
    penSaveId: typeof v.penSaveId === "string" ? v.penSaveId : undefined,
    penPicker: v.penPicker === true,
    penSelected: v.penSelected === true,
    penError: v.penError === true,
    penRgb: rgb(v.penRgb) ? v.penRgb : [255, 59, 48],
    wisprFlowEnabled: v.platform === "macos" && v.wisprFlowEnabled === true,
    platform: v.platform === "linux" ? "linux" : "macos",
    shortcutEditor: record(editor)
      ? {
          recording: editor.recording === true,
          externallyManaged: editor.externallyManaged === true,
          suggestedFn:
            v.platform === "macos" &&
            record(suggestedFn) &&
            typeof suggestedFn.keyCode === "number" &&
            Number.isInteger(suggestedFn.keyCode) &&
            suggestedFn.keyCode >= 0 &&
            suggestedFn.keyCode <= 255 &&
            suggestedFn.modifiers === 0 &&
            suggestedFn.key === "Fn"
              ? { keyCode: suggestedFn.keyCode, modifiers: 0, key: "Fn" }
              : null,
          error:
            typeof editor.error === "string"
              ? editor.error.slice(0, 240)
              : null,
        }
      : null,
    testInstance: v.testInstance === true,
    practice:
      typeof v.practice === "string" && phases.has(v.practice)
        ? v.practice
        : null,
    firstCaptureRequired: v.firstCaptureRequired === true,
    practiceBoard:
      rect(v.practiceBoard) && v.practiceBoard[2] > 0 && v.practiceBoard[3] > 0
        ? v.practiceBoard
        : undefined,
    anchor: rect(v.anchor) ? v.anchor : undefined,
    coachArrow: undefined as number | undefined,
    coachPointsUp: undefined as boolean | undefined,
  };
}
export type Projection = NonNullable<ReturnType<typeof project>>;
