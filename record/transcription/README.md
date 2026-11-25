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

For whole-file Parakeet on the Linux CPU backend, Record's Bend policy leaves
one logical CPU available for concurrent work when the process has more than
one. It keeps the provider's eight-thread ceiling and uses automatic sizing
when the OS cannot report capacity. The Engine adapter reads the effective
capacity and passes the compiled policy result to the native session.

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
