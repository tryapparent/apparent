export { RecordingHost } from "../../../../../../composition/settings/recording-host.ts";

// Desktop's native presentation barrier. A DOM commit and an older first-paint
// event do not prove that Chromium has composited the committed Settings UI.
export async function committedFrame(contents: {
  capturePage(rect: undefined, options: { stayHidden: true }): Promise<{ isEmpty(): boolean }>;
}): Promise<void> {
  // Request a compositor snapshot without exposing the window or depending on
  // hidden-page animation callbacks. Pixels remain transient and are discarded.
  const frame = await contents.capturePage(undefined, { stayHidden: true });
  if (frame.isEmpty()) throw new Error('Settings has no composited frame');
}

// Desktop shell presentation, independent of the renderer and native backend.
const destinations = ['about', 'labs', 'agents', 'general', 'recording', 'storage'];
export function isSharedSettingsPane(pane: unknown): pane is string {
  return typeof pane === 'string' && destinations.includes(pane);
}

export function isSettingsDestination(pane: unknown) {
  return pane === 'permissions' || isSharedSettingsPane(pane);
}

export function initialSettingsPane(args: string[]) {
  if (args.includes('--settings-storage')) return destinations.find(pane => args.includes(`--settings-${pane}`));
}

export function settingsWindowOptions(platform: string, agents = false) {
  return {
    width: agents ? 920 : 720, height: agents ? 600 : 530, minWidth: 640, minHeight: 530,
    ...(platform === 'linux' ? {
      // A normal XWayland window is tiled, even when given initial bounds.
      type: 'dialog' as const, resizable: true, maximizable: true, fullscreenable: true,
    } : {}),
    ...(platform === 'darwin' ? {
      titleBarStyle: 'hiddenInset' as const, resizable: true, fullscreenable: true,
      acceptFirstMouse: true,
    } : {}),
  };
}
