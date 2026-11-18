# Record movie metadata and keyframes

This headless package interprets movie metadata for Mac/Linux bundle ingestion,
recovery, retention observations and export. It consumes the published
`@apparent/engine-sdk`; it does not import
Engine implementation, Electron or Rust. Export chooses the video timeline over a
longer container/audio tail, and selects only audio that actually overlaps that
timeline. Native nonempty edit segments take precedence over padded track ranges.
The SDK supplies display dimensions and provider-local stream IDs. Missing audio
duration does not establish usable audio. Empty video fails before encoding.

[Metadata and phone preparation](phone-preparation/README.md) documents container clocks, native execution, package checks and rollback.

Run `npm ci`, `npm run typecheck`, `npm test`, and `npm run build` here with Node
22.18+. These policy/build commands need no Rust, Electron, native outputs or
FFmpeg. The default verification workflow also runs them in a clean Node container.

## Installed consumer

Record and Agent use the same application-owned finite-worker resource helper in
`composition/worker.rs`. Record now independently pins SDK/provider 0.3 from
`2d4686185850037424e86bb7ec34496a549d328d`. Agent retains its independently
pinned 0.2 generation.
Its existing metadata policy and wire contracts remain unchanged.

Desktop composition builds this package and explicitly stages the runtime pinned
in `engine.json` using `stage.ts --out <generated-app-directory>`. Provisioning
checks the downloaded archive SHA-256, complete file inventory, file hashes/modes,
source commit, architecture and SDK contract. A verified existing provider can be
reused offline. SDK executable/type/package bytes are also pinned independently
of npm's lock integrity. No source build, provider discovery or provisioning runs
when a person exports a movie.

The complete app stages the worker, SDK and native reader beside its existing
locked Electron runtime. On macOS the packager signs the native readers as nested
app code; producer manifest hashes describe the original artifact before that
signing, while the app's sealed inventory describes installed signed bytes.
Linux retains its existing FFmpeg/FFprobe runtime prerequisite.

`composition/media_probe.rs` is the native resource adapter: one finite headless
worker using `ELECTRON_RUN_AS_NODE=1`, explicit capability paths, bounded output
and deadline, and owned process-group cleanup before reaping. The SDK bounds and
cleans its native reader. Record errors never forward native diagnostics/private
paths. CLI and menu export use this same path by default. A missing/broken package
fails clearly before encoding; there is no second metadata-policy fallback.

After staging, `npm run test:native` exercises the real published reader through
the compiled worker with synthetic audio/video, silence, rotation and bad input.
Root export tests verify the actual production caller/encoder. Run
`node --experimental-strip-types record/media/test/package.ts --binary <packaged-cli> --settings <packaged-settings-root>`
from the repository root to check the packaged worker, locked runtime and real CLI
with rotated synthetic audio/video and unchanged source bytes. Mac platform CI
runs it after signing; Linux AppImage packaging runs it against the built image.
These checks do not prove capture, GUI, permissions or physical audio behavior.

The packaged CLI also reprocesses a synthetic phone-style file through normal
ingestion and verifies decoded, display-oriented keyframes and unchanged input
bytes. Linux decoding honors the native orientation tag before frame sampling;
the same rotated fixture is checked against FFmpeg's displayed pixels. This is
file-ingestion proof, not evidence of a live phone/camera capture session.

## Scope and rollback

`src/selection/cues.ts` owns pointing-word classification, priorities and
suppression for estimated timings. Final phone/file, screen and recovery
assembly consume its private, finite `selection/worker.js` contract through
`composition/transcript/speech.rs`. Empty-transcript predecode previews need no cue worker.
Native selection binds validated cue indices to the original transcript and
retains image comparisons, transition snapping and the remaining selection
algorithm. Those remaining ranking/coverage decisions are migration debt.
No SDK pin, bundle schema or configuration writer changes. A missing worker
fails assembly before publication; there is no duplicate classification fallback.
Rollback restores the classifier, callers and staged worker inventory together.
Policy tests/builds need no Rust; final app and signed/AppImage acceptance still
require their native/package gates. This is not whole-Record build independence.

Existing crop/camera/ink/encoding, explicit recorded/silent/narration policy,
settings and persistence remain authoritative. Phone/file ingestion, recovery and
retention consume this published provider through the bundle metadata contract.
Frame decoding executes through native Engine capabilities; audio extraction,
live sampling and retention mutation/exclusion remain native in
the root runtime. The replaced Desktop probes, Linux metadata/audio-decode probe and Swift
helper `probe` command are removed. Native audio edit checks used by the encoder
remain safety/execution mechanics. Linux export's superseded FFprobe parser is
also removed.
Revert this consumer slice and its artifact pin together for rollback. No user
config/data migration or installed experimental routing is involved. This does
not claim complete application build independence or measured CI savings.

## Explicit assembly and recovery frames

`frames-worker.js` consumes the public `decodeMovieFrames` API. Record owns the
bundle/movie clock mapping and preserves request indices when several early
keyframes clamp to movie zero. Source times are safe integers; missing, reordered
or relabelled replies fail instead of changing a keyframe's identity.

Capture predecode, full-keyframe assembly, screen recovery/reprocessing and
phone/file assembly's explicit mark/full-frame callers use this provider.
Phone requests already use movie time, so their offset is zero and their
1600px long-edge limit is unchanged. Recovery's injected `Media.explicit_frames` contract is distinct
from its periodic-sampling provider, so its real caller cannot silently retain
the old explicit decoder. `composition/movie_frames.rs` supplies native process,
private-directory and pixel safety mechanisms for both Record and Agent. Record
requests are read in batches of four: four maximum-sized 64MP frames fit the
Engine 256MP job limit. This is a native resource limit, not a workflow budget.

Default keyframe selection, caching and crop/render decisions
remain migration debt. Agent's final range-fallback adoption removes the old root
`movie_frames_at` entry point. Phone ingestion still uses native audio extraction
and transcription. Linux's `decoder-check` and the decode half of `encoder-check`
also use this published reader. The native adapter produces the synthetic encoder
movie; composition supplies decoding without importing Record policy into it.
Existing decoder-availability warnings remain unchanged. The adopted routes
replace the legacy Linux file reader and Mac helper's `frames` command. Real SDK
pixel/clock checks remain; donor-only comparison and box-filter tests are removed.
Engine's extracted-package qualification retains open-GOP, backward-request,
presentation-time and edge-clamp coverage. Restore retired readers before
rolling an adopted route back to them; provider pins and persistence are unchanged.
No competing configuration writer is introduced.

Native checks exercise the actual published frame provider and private RGBA
pixels. The package proof also reprocesses a synthetic screen bundle with a
500ms movie offset, checking bundle-clock keyframes, display dimensions and
source preservation. Optional `--proof-dir <private-job-directory>` retains its
synthetic PNGs and bundle text for inspection. A second phone/file scenario
fills the six-frame budget with distinct flags, checking original timestamps,
mark associations, decoded pixels and unchanged source bytes. Together with
ordinary ingestion it exercises both explicit callers. Rollback restores those
two caller routes together; no pin, schema or package-layout changes are needed.
Signed Mac and Linux AppImage
proof remain required; file reprocessing does not establish live capture.

## Phone periodic candidates

`phone-policy.ts` owns cadence (`max(250, floor(duration / 480))` milliseconds),
the 320px candidate edge and adjacent actual-time deduplication. The approximate
budget can produce 481/482 requests; those timestamps are retained. The published
Engine executes batches of up to 480 under one overall five-minute worker
deadline. Candidates use actual movie presentation times rather than explicit
keyframes' requested bundle times. A private batch directory is consumed and
removed before the next job; final raw files are linked exclusively into the
owned job output. Native composition verifies bounded count, strictly increasing
actual-time labels, file identity, single links, dimensions and pixel totals.

Phone/file assembly's ordinary candidate path consumes this worker. Cadence and
timestamp decisions are removed from the Rust phone caller. Selection, caching,
rendering and audio/transcription remain authoritative
in the root runtime. Existing native readers/build inputs remain for those users.

Both platforms now use Engine's last-sample-at-or-before contract and integer
floor timestamps. Legacy Mac sampling allowed nearby samples and rounded times;
that platform difference is deliberately replaced by Record's shared contract.
The native test decodes a real 122-second sparse movie: 481 requests span two
jobs and deduplicate to 61 private frames, including a cross-job duplicate.
Package proof covers ordinary and six-flag assembly; source bytes stay unchanged.
Small staged-fixture timings are observations, not a controlled speedup claim.
No live phone, microphone or permission behavior is proved by these file tests.

Rollback reverts the phone routing, worker/generated inventory and Record's pin
together. No config writer, persistence schema or installed UI routing changes.

## Screen recovery and benchmark candidates

`screen-policy.ts` owns 220ms file sampling, bundle/movie offsets and the
640px recovery / 480px capture-benchmark scales. The benchmark scale preserves
the live sampler's current input size. Live capture's in-memory sampler and
resource budgets remain native; this slice changes file decoding only.

`screen-worker.js` produces at most 480 requests per page. It deduplicates actual
presentation samples across pages and returns bundle-clock labels plus an
opaque continuation token. Empty pages are valid when a sparse movie has no
new sample. Native composition runs pages under one overall deadline, refuses
repeated/invalid tokens and backwards or inconsistent labels, verifies private
pixels, then removes each page before starting the next. It retains the legacy
in-memory candidate vector; this is not a total workflow memory-bound claim.

Recovery's `Media.screen_candidates` injection, production caller and real CLI
benchmark use the same worker. Their Rust cadence and clock addition are removed.
The package proof checks screen recovery and the actual benchmark with a 500ms
offset, preserving input bytes. A native sparse-video test spans four pages and
three empty continuations. Clean Node tests need no Rust/Electron; real-provider,
Mac and final AppImage gates remain distinct. Small staged-fixture timing shows
Node/probe startup overhead, not a controlled performance improvement.

Frame replies have a separate bounded 128 KiB transport envelope: 480 distinct
samples produce more than metadata's unchanged 32 KiB limit. A two-minute moving
movie checks full phone and screen pages through the real native bridge; the
packaged CLI benchmark also crosses that boundary. Frame counts, clocks, private
pixels, process cleanup and overall deadlines retain their existing checks.

During qualification GStreamer 1.24 classified a 2-second video inside a
400-second audio container as a preview and skipped it. That existing decoder
limitation is not paging evidence; the accepted test uses a real 400-second
held-frame video. Mac behavior for that skipped-track case is not established.

Rollback restores the recovery/benchmark routing, injected contract and generated
inventory together. The published pin, bundle schema and config writer do not
change. No live capture or permissions proof is inferred here. GStreamer still
executes live capture and audio extraction; retiring file readers does not remove
the root application's native build dependencies.

## Transcript allocation

`src/transcript/policy.ts` partitions recognizer words (or segments/full text when
timings are absent) across keyframes, preserving clause starts, punctuation and
the original unsigned 64-bit clocks. Assembly supplies the selected action
anchors; in-place re-transcription retains its existing frame-time anchors.
Both production routes consume this same finite Record worker. Native selection,
speech recognition and transactional bundle publication remain authoritative.

Composition passes a held private file as stdin; speech never enters worker argv
or diagnostics. Requests/replies are capped at 16 MiB, with a ten-second process
deadline and the existing process-group cleanup. This includes serialization
overhead above the command transcriber's existing 8 MiB response limit. Oversized
or failed requests fail before publication; no words are silently truncated.
Existing small-reply workers retain their original 128 KiB ceiling.

Compatibility checks compare the donor allocator, producer-normalized CLI
phone/screen/recovery output, and real re-transcription publication/rollback.
Stage both worker modules; signed Mac and both Linux AppImages remain acceptance
gates. Restore the native allocator and both callers together when reverting;
there is no config writer, SDK pin or persisted schema migration.

## Default assembly allocation

`assembly-policy.ts` owns the duration-based total keyframe limit and the ordinary
event allocation. A finite provider-free Node worker returns one plan per bundle;
screen predecode and phone direct-mark preparation reuse that same plan at final
selection. Recovery obtains a plan for its retained bundle duration. Decimal
durations preserve the native unsigned 64-bit clock without JavaScript rounding.

Native composition validates the response and exact duration, bounds subprocess
output/time and retains cleanup. Native selection still owns grouping, scoring,
coverage and image mechanics; those product decisions remain migration debt.
The unchanged native 13-tile rendering bound protects combinatorial layout work,
including a possible whiteboard tile. It is not a second default allocator.

Stage both assembly outputs with the application and require them in native
prerequisites. Missing/broken plans fail assembly with its existing durable
recovery data; no parallel native default or config writer is retained. Rollback
reverts worker staging, caller routing and default removal together. Headless
policy/worker checks need only Node; actual Mac/Linux CLI and package acceptance
remain gates. This slice does not establish whole-Record build independence.

## Native audio prerequisite

Phone/file audio extraction still uses the root native runtime, ahead of a
published Engine audio capability. It writes into a held private temporary WAV,
validates that WAV, then publishes it for transcription and bundle assembly.
Failures discard the owned temporary. File privacy does not depend on the
caller's umask. Linux maps the first decoded sample through its GStreamer
segment so a leading movie edit remains silence on the transcription clock.

The package check uses a producer-generated bundle, real delayed AAC input and
the actual reprocess caller under umask `002`. A deterministic local command
checks the extracted WAV handoff without a model, service or playback. It checks
private publication, leading silence, the source-timeline end and unchanged
input/config bytes. #1335 landed at `25ef94fd97efe8ddb3f04753a12538aa900414e6`;
its exact-main CI, signed Mac packaged check, both Linux AppImages and preview
publication passed. This proves file ingestion and handoff, not recognition or
live capture. The separate SDK audio candidate retains its own acceptance gates.

This is a native correctness prerequisite, not SDK audio adoption or owner build
independence. Existing track selection, in-memory audio, transcription engines,
pins, bundle schema and config writer remain authoritative. A later capability
must align the current Mac all-track mix and Linux first-track behavior explicitly.
Rollback reverts the private staging and Linux clock mapping together; it has no
data or settings migration.
