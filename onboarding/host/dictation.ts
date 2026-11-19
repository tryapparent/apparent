export const dictationApps = ["wisprFlow", "superwhisper"] as const;
export type DictationApp = (typeof dictationApps)[number];
export type WisprResult =
  | { status: "running"; apps: readonly DictationApp[] }
  | { status: "disabled" | "closed" | "refused" | "unknown" };
