import { PermissionHost } from "../../record/settings/permissions/permission-host.ts";
import { RecordingHost } from "./recording-host.ts";
import { AutoPasteHost } from "../../handoff/settings/auto-paste-host.ts";

type RecordingWindow = Parameters<RecordingHost["bind"]>[0];
type RecordingHooks = Parameters<RecordingHost["bind"]>[1];

export class SettingsHosts {
  private recording: RecordingHost;
  private permissions: PermissionHost;
  private autoPaste: AutoPasteHost;
  private publishAutoPaste?: (enabled: boolean | null) => void;

  constructor(send: (action: object) => void) {
    this.recording = new RecordingHost(send);
    this.permissions = new PermissionHost(send);
    this.autoPaste = new AutoPasteHost(send);
  }

  bind(
    window: RecordingWindow,
    hooks: Omit<RecordingHooks, "bind"> & {
      bind(
        pane: string,
        name: string,
        handle: (...args: unknown[]) => unknown,
      ): void;
    },
  ) {
    this.recording.bind(window, {
      ...hooks,
      bind: (name, handle) => hooks.bind("recording", name, handle),
    });
    this.autoPaste.bind((name, handle) => hooks.bind("handoff", name, handle));
    this.publishAutoPaste = (enabled) =>
      window.webContents.send("apparent:handoff-state", enabled);
    this.permissions.bind(
      (name, handle) => hooks.bind("permissions", name, handle),
      (state) => window.webContents.send("apparent:permission-state", state),
    );
  }

  receive(
    pane: string,
    command:
      | Parameters<RecordingHost["receive"]>[0]
      | Parameters<PermissionHost["receive"]>[0]
      | Parameters<AutoPasteHost["receive"]>[0],
  ) {
    if (pane === "recording" && command.type.startsWith("recording-"))
      this.recording.receive(
        command as Parameters<RecordingHost["receive"]>[0],
      );
    if (pane === "permissions" && command.type.startsWith("permission-"))
      this.permissions.receive(
        command as Parameters<PermissionHost["receive"]>[0],
      );
    if (
      pane === "handoff" &&
      this.publishAutoPaste &&
      (command.type === "handoff-auto-paste-state" ||
        command.type === "handoff-auto-paste-result")
    )
      this.autoPaste.receive(command, this.publishAutoPaste);
  }

  reset() {
    this.recording.reset();
    this.permissions.reset();
    this.autoPaste.reset();
  }
}
