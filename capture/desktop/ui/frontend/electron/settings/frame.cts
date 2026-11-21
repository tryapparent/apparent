export { settingsReportCapture } from "../../../../../../composition/settings/report-capture.ts";
export { settingsFeedbackHost } from "../../../../../../composition/settings/feedback-host.ts";
export { bindAbout } from "../../../../../../composition/settings/about/host.ts";

import { PermissionHost } from "../../../../../../composition/settings/permission-host.ts";
import { RecordingHost } from "../../../../../../composition/settings/recording-host.ts";

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
export { LipHost } from "../../../../../../record/settings/lip-host.ts";

const destinations = ['about', 'labs', 'agents', 'general', 'recording', 'permissions', 'storage'];
export function isSharedSettingsPane(pane: unknown): pane is string {
  return typeof pane === 'string' && destinations.includes(pane);
}

export function isSettingsDestination(pane: unknown) {
  return isSharedSettingsPane(pane);
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

type RecordingWindow = Parameters<RecordingHost["bind"]>[0];
type RecordingHooks = Parameters<RecordingHost["bind"]>[1];

export class SettingsHosts {
  private recording: RecordingHost;
  private permissions: PermissionHost;

  constructor(send: (action: object) => void) {
    this.recording = new RecordingHost(send);
    this.permissions = new PermissionHost(send);
  }

  bind(
    window: RecordingWindow,
    hooks: Omit<RecordingHooks, 'bind'> & {bind(pane: string, name: string, handle: (...args: unknown[]) => unknown): void},
  ) {
    this.recording.bind(window, {...hooks, bind: (name, handle) => hooks.bind('recording', name, handle)});
    this.permissions.bind(
      (name, handle) => hooks.bind('permissions', name, handle),
      state => window.webContents.send('apparent:permission-state', state),
    );
  }

  receive(pane: string, command: Parameters<RecordingHost["receive"]>[0] | Parameters<PermissionHost["receive"]>[0]) {
    if (pane === 'recording' && command.type.startsWith('recording-')) this.recording.receive(command as Parameters<RecordingHost["receive"]>[0]);
    if (pane === 'permissions' && command.type.startsWith('permission-')) this.permissions.receive(command as Parameters<PermissionHost["receive"]>[0]);
  }

  reset() {
    this.recording.reset();
    this.permissions.reset();
  }
}
