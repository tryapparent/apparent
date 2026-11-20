import type { RecordingState } from "../../../record/settings/recording-contract";

export function recordingFixture(send: (message: object) => void) {
  const state: RecordingState = {
    platform: "linux",
    microphone: {
      selected: "default",
      value: "System default",
      options: [{ id: "default", title: "System default", enabled: true }],
      note: null,
      meter: "fixture-input",
    },
    transcriber: {
      engine: "apple",
      hexTitle: "Hex (not running)",
      hexEnabled: false,
      language: "en",
      appleLocale: "auto",
      models: [],
      command: null,
    },
    speech: { state: "ready", progress: 1 },
    lowerPlayback: false,
    playbackLevel: 20,
    playbackAvailable: false,
    videoExport: false,
    mediaWarnings: [],
  };

  const fixture = {
    refuse: false,
    pickerSupported: false,
    show() {
      send({ type: "recording-state", state });
    },
    mac() {
      state.platform = "macos";
      state.playbackAvailable = true;
      state.lowerPlayback = true;
      state.speech = {
        state: "downloading",
        locale: "en_US",
        locales: ["en_US", "nl_NL"],
        progress: 0.4,
      };
      fixture.show();
    },
    hex() {
      state.microphone.meter = null;
      state.transcriber.engine = "hex";
      state.transcriber.hexTitle = "Hex";
      state.transcriber.hexEnabled = true;
      state.transcriber.models = [
        { id: "fixture-model", title: "Test model", chosen: true },
      ];
      fixture.show();
    },
    receive(action: Record<string, unknown>) {
      if (action.action === "navigate") {
        send({ type: "show", pane: action.pane });
        if (action.pane === "recording") fixture.show();
        if (action.pane === "general")
          send({
            type: "general-state",
            platform: "linux",
            login: { on: false, available: true, needsApproval: false },
            shortcuts: [
              {
                kind: "record",
                title: "Record",
                label: "F1",
                recording: false,
                externallyManaged: false,
                isDefault: true,
                clearable: false,
              },
            ],
            errorReporting: true,
          });
        if (action.pane === "permissions")
          send({
            type: "permission-state",
            state: {
              platform: "wayland",
              rows: [
                {
                  permission: "accessibility",
                  status: "denied",
                  required: false,
                  relaunch: false,
                  repair: "copy-input",
                },
              ],
            },
          });
      }
      if (action.action === "labs-preference")
        send({
          type: "labs-result",
          request: action.request,
          facts: {
            saved: false,
            screenPickerSaved: false,
            screenPickerSupported: fixture.pickerSupported,
            doubleShiftSaved: false,
            autoPasteSupported: false,
            autoPasteSaved: false,
            sharingSaved: false,
            wisprSupported: false,
          },
        });
      if (action.action === "recording-preference") {
        if (!fixture.refuse && action.key === "videoExport") {
          state.videoExport = Boolean(action.value);
          fixture.show();
        }
        send({
          type: "recording-result",
          request: action.request,
          ok: !fixture.refuse,
        });
      }
      if (action.action === "recording-meter" && action.visible) {
        send({ type: "recording-level", level: 0.45 });
      }
    },
  };
  return fixture;
}
