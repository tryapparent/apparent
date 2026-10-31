# Saved device files and browser SDK routing

Live iPhone discovery, recording and mirroring are retired. No connected-phone setup, Camera
permission, helper devices/mirror/shrink mode, CLI flag or acquisition experiment remains.
This historical filename is kept for existing links; it is not a support claim.

## Saved device-file compatibility (`src/saved_movie.rs`)

Keep `CaptureMode::Device`, `DeviceInfo`, `source`, `device`, context and `videoOffsetMs`
readable for old mirror and ApparentKit `.apparent` bundles. `MovieCapture` and
`build_movie_bundle` are file-only: inspect, copy, reprocess, frames, zoom and export must
not discover a device, request permission or launch a mirror. Reprocessing writes a new
bundle; export writes a new movie. Original source files remain byte-for-byte unchanged.

The existing movie pipeline decodes 320 px candidates and re-decodes selected frames at a
1600 px long edge. Extract audio from the movie's asset timeline before transcription;
never hand `.mov` directly to SpeechAnalyzer. Reprocessing retains the archive's bundle
clock and offsets its decoded frames/audio accordingly. Export uses the saved movie's
own audio track. Shared Swift AVFoundation Media/Export and Settings microphone metering stay.
There is no background phone-video re-encoding; ordinary pin/retention safety still applies.

On Linux, run `python3 scripts/test-saved-device-bundles.py target/debug/apparent
/absolute/fresh-evidence-dir` (one command) for synthetic mirror/ApparentKit metadata, audio
clock, real decode, zoom, export and source-hash proof. It needs FFmpeg plus the repository's
GStreamer movie decoder. This does not prove native Mac helper or either OS's live GUI.

## Browser SDK routing (`src/routing.rs`, `src/web.rs`, `src/sdk.js`)

Screen and Window captures are saved and copied, without looking up an OpenCode session or
sending anywhere. Old routing code and `/sdk.js` remain for local dev-page registration,
but nothing calls the capture-routing entry point. The SDK server binds to
`127.0.0.1:47777`, retains its Host/Origin protections, and rejects `/ingest` phone uploads.
Old session metadata is archive evidence, never authorization to send a capture.
The old `smartRouting` experiment has no effect on capture delivery.
