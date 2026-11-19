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
      if (action.action === "navigate" && action.pane === "recording")
        fixture.show();
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
