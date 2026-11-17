# Local streaming transcription

Record owns admission and the bounded live-text projection in `src/policy.ts`.
Desktop snapshots the opt-in `experiments.localStreamingTranscription` at capture
start and invokes the packaged Node worker through its private composition
adapter. No recording data or configuration secrets enter the admission worker.
Run `npm test` with Node 22; these policies need neither Rust nor Electron.

Engine owns native PCM capture, the durable WAV, Parakeet inference, cancellation
and word timings. A recording owns exactly one stream and preview. Finalization
flushes every unobserved sample from the saved PCM16 WAV before materializing the
transcript. A failed or incomplete stream returns to whole-WAV local recognition;
partial live text is never accepted as the recording's final transcript.

The Desktop Labs preference is off by default, persists through the existing
single native configuration writer, and takes effect on the next recording.
Enabling prepares the verified English Parakeet model in the background. A
download never blocks recording or Finish. A recording started before readiness
continues without live text; a later recording can use the prepared model.
macOS builds the Metal backend and automatically falls back to CPU when the
GPU lacks the required Apple7 capability. Linux uses the existing dynamic native
backends. Both routes remain local.
The experiment supersedes the older Apple live/pause worker for that recording;
turning it off restores those existing routes. CLI recording remains unchanged.

Desktop alone presents the accepted transcript layer below the controls, using
the shared theme roles. Only the newest bounded preview crosses the private
native-to-Electron pipe; diagnostics contain no transcript text. Stopping or
starting another recording removes the old preview. The complete time-aligned
transcript remains in the bundle.

The ignored native `real_stream_publishes_before_stop_and_flushes_saved_tail`
fixture checks live text, the unobserved saved-audio tail and measured word
timings. Set `APPARENT_STREAM_EXPECT_DEVICE=cpu` to require CPU execution.
The separate macOS `real_metal_stream_publishes_before_stop_and_flushes_saved_tail`
fixture requires Metal and retains all the same transcript assertions; a CPU
fallback cannot pass it. Both require the staged verified model and synthetic
`APPARENT_STREAM_WAV`. A successful build or CPU fixture is not Metal proof.
