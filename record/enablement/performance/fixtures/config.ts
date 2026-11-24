import { rename, writeFile } from "node:fs/promises";

export function recorderFixtureConfig(
  config: string,
  source: string,
  measurePicker: boolean,
) {
  return async (speech: boolean, streaming = false) => {
    const pending = config + ".benchmark";
    await writeFile(
      pending,
      JSON.stringify({
        onboarding: { seen: true },
        launchAtLogin: false,
        autoPasteDraft: false,
        errorReporting: false,
        microphoneEnabled: speech,
        experiments: {
          localStreamingTranscription: streaming,
          ...(measurePicker && { chooseScreenEachTime: true }),
        },
        microphone: {
          id: "pulse:" + source,
          name: "Synthetic English fixture",
        },
      }),
    );
    await rename(pending, config);
  };
}
