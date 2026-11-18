# Record media preparation

The `bundle-v1` operation serves orphan recovery and retention's size
observation. It preserves the container timeline (including
audio tails), using the video clock only when container timing is absent. Its
audio count reports native track presence, not successful audio decoding. Export
keeps its separate video-clock/overlap policy through `export-v1` (the default).

`phone-v1` owns phone/file preparation: it returns the same container metadata
and an audio action before native frame/audio work starts in parallel. Only
actual track absence skips extraction. Unknown timing, empty edits and multiple
tracks retain the existing native attempt, default track selection and optional
transcription. Device reprocessing continues to ignore external screen WAVs;
screen recovery's separate audio path is unchanged. Native code retains held
temporary WAV validation/publication and media execution. A missing/broken worker
fails before execution and bundle publication, with no legacy policy fallback.
SDK/provider pins, configuration mutation and persisted schemas are unchanged.
Rollback restores the old phone metadata/caller routing and worker operation
together. The package check uses real silent/marked/external-WAV and one/multiple
track movies; Mac and Linux AppImage gates remain required. File ingestion does
not establish physical-device or permission behavior.
