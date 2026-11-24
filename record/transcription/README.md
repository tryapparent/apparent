# Local streaming transcription

Record's Bend admission policy allows the preview on Linux and macOS when
`experiments.localStreamingTranscription` is enabled. The packaged Node worker
evaluates it off the capture thread using only the preference and platform.
The settings transaction still takes effect on the next recording.

Engine captures PCM and saves the complete WAV independently of transcription.
Nemotron Speech Streaming EN 0.6B supplies provisional English captions using
its cache-aware encoder with 1.04 seconds of lookahead. The preview does not
produce the saved transcript. At Stop, the recorder cancels it without waiting
for inference. The existing Parakeet batch recognizer reads the complete WAV
and produces the timed transcript used by bundle processing and handoff.

Enabling the experiment prepares both verified GGUF artifacts in the background.
The Nemotron model lives in a preview-only subdirectory outside final-model
discovery. If Parakeet is still missing at Finish, the platform's ordinary local
transcriber can handle the saved WAV. A missing or failed preview does not
delay recording or stop the final Parakeet route. Disabling the experiment
restores the ordinary transcription preference on the next recording.
Reverting the change restores the earlier streaming provider. Neither rollback
nor disabling requires a config or bundle migration.

The existing recording pill shows only the bounded provisional text. Enabling
the experiment leaves the microphone and platform permission checks in place.
macOS uses the existing packaged Metal backend and CPU fallback. Linux uses the
existing dynamic native backend.

Run the Record Bend checks and the transcription package tests to verify policy
and adapter behavior. For native proof, stage verified Parakeet in
`APPARENT_MODELS_DIR` and Nemotron in its `preview/` subdirectory. Set
`APPARENT_STREAM_WAV` to a synthetic 16 kHz mono PCM16 fixture with “microphone”
early and “cursor” in the second half. The ignored
`real_nemotron_preview_and_parakeet_saved_transcript` fixture feeds only the
first half to Nemotron and checks the full timed Parakeet result after Stop.
Set `APPARENT_STREAM_EXPECT_DEVICE=cpu` for CPU verification. The separate macOS
`real_metal_nemotron_preview_and_parakeet_saved_transcript` fixture requires
actual Metal execution.

## OpenRouter BYOK experiment

In the installed Settings → Labs pane on Linux or macOS, save an OpenRouter
API key, select **MAI-Transcribe 2**, and enable **OpenRouter transcription**.
At Stop, an ordinary Desktop screen recording with microphone audio attempts one
file transcription using the current Labs preference. A failed request falls
back to the usual transcriber and the recording can still be saved. Removing the
key disables the experiment. An already submitted request may finish. There is
no live streaming or Connect service involved.

The key is stored in a separate owner-only `0600` file beside the active profile’s
config. The Settings bridge returns only key presence, model and enabled state.
The worker gets the WAV on private stdin. Requests use a fixed OpenRouter
endpoint, refuse redirects, and have a 15-second deadline and 16 MiB input cap.

For an attempted upload, `finish-trace.json` records
`hostedTranscription` with the result category, input size and duration, HTTP
status when available, request and worker elapsed times, provider-reported
audio duration and request cost when returned, timed-word count when
available, and local fallback elapsed time when used. Neither the key, audio,
provider body nor transcript is written to the trace. Bundle transcript metadata
identifies the model on successful hosted runs.

The Record Bend check runs credential state and synthetic HTTP cases. The Labs
Electron smoke covers the controls. A provider smoke uses a tester’s own key and
non-sensitive narration, then checks the saved word timings and the finish trace.
