import { rename, writeFile } from "node:fs/promises";

export function recorderFixtureConfig(
  config: string,
  source: string,
  measurePicker: boolean | undefined,
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
        ...(measurePicker === false && {
          recordingPerformanceGeneration: "isolated-record-startup",
        }),
        experiments: {
          localStreamingTranscription: streaming,
          ...(measurePicker !== undefined && {
            chooseScreenEachTime: measurePicker,
          }),
          ...(measurePicker === false && { recordingPerformance: true }),
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
