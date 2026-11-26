export { settingsReportCapture } from "../../../../../../composition/settings/report-capture.ts";
export { settingsFeedbackHost } from "../../../../../../composition/settings/feedback-host.ts";
export { bindAbout } from "../../../../../../composition/settings/about/host.ts";


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

const destinations = ['about', 'labs', 'agents', 'general', 'recording', 'handoff', 'permissions', 'storage'];
export function isSharedSettingsPane(pane: unknown): pane is string {
  return typeof pane === 'string' && destinations.includes(pane);
}

export function isSettingsDestination(pane: unknown) {
  return isSharedSettingsPane(pane);
}

export function initialSettingsPane(args: string[]) {
  if (args.includes('--settings-storage')) return destinations.find(pane => args.includes(`--settings-${pane}`));
}

export function settingsWindowOptions(platform: string) {
  return {
    width: 740, height: 580, useContentSize: true,
    resizable: false, maximizable: false, fullscreenable: false,
    ...(platform === 'linux' ? {
      // A normal XWayland window is tiled, even when given initial bounds.
      type: 'dialog' as const,
    } : {}),
    ...(platform === 'darwin' ? {
      titleBarStyle: 'hiddenInset' as const,
      acceptFirstMouse: true,
    } : {}),
  };
}

export { SettingsHosts } from "../../../../../../composition/settings/hosts.ts";
