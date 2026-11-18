export type ShortcutPlatform = "macos" | "linux";

export function recordDefault(platform: ShortcutPlatform) {
  return platform === "macos"
    ? { key: "Fn", keyCode: 63, modifiers: 0 }
    : { key: "S", keyCode: null, modifiers: 2560 };
}

export function usesDesktopRecord(
  platform: ShortcutPlatform,
  appPreferred: boolean,
  desktopAvailable: boolean,
): boolean {
  return platform === "linux" && !appPreferred && desktopAvailable;
}
