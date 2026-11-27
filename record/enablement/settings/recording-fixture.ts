import type { RecordingState } from "../../settings/recording-contract.ts";

export type RecordingFixtureMessage =
  | { type: "recording-state"; state: RecordingState }
  | { type: "recording-result"; request: unknown; ok: boolean }
  | { type: "recording-level"; level: number };

export function recordingFixture(
  send: (message: RecordingFixtureMessage) => void,
) {
  const linuxState: RecordingState = {
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
    playback: null,
    context: { enabled: true, access: "disabled" },
    mediaWarnings: [],
  };
  const state = structuredClone(linuxState);

  const fixture = {
    refuse: false,
    show() {
      send({ type: "recording-state", state });
    },
    linux() {
      Object.assign(state, structuredClone(linuxState));
      fixture.show();
    },
    mac() {
      state.platform = "macos";
      state.context = { enabled: true, access: "approval_required" };
      state.playback = { enabled: true, level: 20 };
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
      if (action.action === "recording-preference") {
        if (!fixture.refuse && action.key === "agentContext") {
          state.context.enabled = Boolean(action.value);
          fixture.show();
        }
        if (!fixture.refuse && action.key === "contextAccessibility") {
          state.context.access = "enabled";
          fixture.show();
        }
        if (
          !fixture.refuse &&
          action.key === "lowerPlayback" &&
          state.playback
        ) {
          state.playback.enabled = Boolean(action.value);
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
