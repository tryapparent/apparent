import { record } from "./projection.ts";
const actions = new Set([
  "resolve-copilot",
  "continue",
  "back",
  "later",
  "close",
  "settings",
  "change-shortcut",
  "use-desktop-shortcut",
  "skip",
  "watched",
  "practiced",
  "reset-shortcut",
  "cancel-shortcut",
  "practice-review",
  "practice-paste",
  "practice-locate",
  "practice-pasted",
  "practice-finish",
]);
export function parseAction(value: unknown) {
  if (typeof value === "string") {
    if (
      actions.has(value) ||
      /^pen:(coral|purple|blue|green)(:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$/.test(
        value,
      )
    )
      return { action: value };
    if (
      /^grant:(screen-recording|microphone|accessibility|camera|speech-recognition)$/.test(
        value,
      )
    )
      return { action: "grant", permission: value.slice(6) };
  } else if (record(value)) {
    const v = value;
    if (
      v.action === "board" &&
      typeof v.id === "string" &&
      /^[a-zA-Z0-9-]{1,80}$/.test(v.id) &&
      typeof v.operation === "string" &&
      ["begin", "move", "end", "cancel", "undo", "clear", "close"].includes(
        v.operation,
      )
    ) {
      const positioned = ["begin", "move"].includes(v.operation);
      if (
        !positioned ||
        (Array.isArray(v.point) &&
          v.point.length === 2 &&
          v.point.every(Number.isFinite) &&
          v.point[0] >= 0 &&
          v.point[0] < 1600 &&
          v.point[1] >= 0 &&
          v.point[1] < 1100)
      )
        return {
          action: "board",
          id: v.id,
          operation: v.operation,
          ...(positioned ? { point: v.point } : {}),
        };
    }
    if (
      Object.keys(v).sort().join(",") ===
        "action,key,keyCode,kind,modifiers,reserved" &&
      v.action === "shortcut" &&
      v.kind === "record" &&
      typeof v.keyCode === "number" &&
      Number.isInteger(v.keyCode) &&
      v.keyCode >= 0 &&
      v.keyCode <= 255 &&
      typeof v.modifiers === "number" &&
      Number.isInteger(v.modifiers) &&
      (v.modifiers & ~6912) === 0 &&
      typeof v.key === "string" &&
      v.reserved === false &&
      (((v.keyCode === 58 || v.keyCode === 61) &&
        v.key === "Option" &&
        v.modifiers === 0) ||
        (v.keyCode === 201 && v.key === "Copilot") ||
        ((v.keyCode === 63 || v.keyCode === 95) &&
          v.key === "Fn" &&
          v.modifiers === 0) ||
        /^[a-z0-9]$/.test(v.key))
    )
      return v;
  }
  throw Error("Forbidden onboarding command");
}
