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
const point = (value: unknown): value is [number, number] =>
  Array.isArray(value) &&
  value.length === 2 &&
  value.every(Number.isFinite) &&
  value[0] >= 0 &&
  value[0] < 1600 &&
  value[1] >= 0 &&
  value[1] < 1100;
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
      !["granted", "denied", "not-determined"].includes(r.status)
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
  const b = v.boardView;
  const boardView =
    record(b) &&
    typeof b.id === "string" &&
    /^[a-zA-Z0-9-]{1,80}$/.test(b.id) &&
    Array.isArray(b.strokes) &&
    b.strokes.length <= 500 &&
    b.strokes.every(
      (s) => Array.isArray(s) && s.length <= 2000 && s.every(point),
    ) &&
    rgb(b.color)
      ? { id: b.id, strokes: b.strokes as [number, number][][], color: b.color }
      : null;
  const editor = v.shortcutEditor;
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
    boardView,
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
