# Engine

The ongoing application migration and remaining adoption gates are tracked in
[the migration inventory](docs/migration.md).

Engine owns native capture/media execution and resource, durability and safety
mechanisms, its TypeScript SDK, and capability delivery. Record owns workflow,
preferences, retention decisions and ordinary assembly/export policy; Desktop
owns human controls and shell presentation. Engine must not import those owners'
implementations. Linux and macOS are supported; there is no Windows provider.

## Local movie metadata

`native/` builds `apparent-engine-media probe-v1 /absolute/movie`. This finite,
read-only operation reports native track metadata as JSON, with no recording,
UI, config writes, upload, model installation or background service. On Linux it
executes FFprobe (an explicit FFmpeg runtime prerequisite), restricted to local
file protocols. On Mac it executes its packaged AVFoundation sibling, requiring
macOS 15+. Exec replaces the launcher: SDK cancellation targets the reader
itself. Direct CLI consumers must supply their own deadline.

`sdk/` normalizes those facts into a typed API without deciding export or audio
selection policy. Missing audio timing is unavailable, not proof of silence.
The native command name versions the `probe-v1` wire contract; the SDK rejects
malformed/unsafe metadata. The provider reads media supplied by a trusted local
caller; it is not a sandbox for hostile files or a cross-user service.

## Build and qualify

With Node 22.18+, Rust 1.96+, and FFmpeg installed (plus Xcode on Mac).
Linux frame decoding also requires GStreamer 1.24+ core/app/video development
libraries and the base, good and libav runtime plugins:

```sh
node --experimental-strip-types engine/tools/check.ts /tmp/apparent-dev-engine-JOB
```

Create a fresh private per-job directory first; each output path is single-use
so stale package output cannot enter a later candidate. On Clanker, run this command through
`/home/simon/.local/bin/t3-build --jobs 3 -- ...`. Output includes a native runtime
archive, SDK tarball, per-file manifest and archive digests. Qualification installs
the tarball outside the checkout, then probes real synthetic audio/video and
silent movies through the copied runtime, checks failure cases and unchanged
source bytes. Native compilation runs from a copied owner source tree outside
the checkout, using Engine's distribution config rather than ancestor/root Cargo
configuration. It does not run the installed app or prove live capture, GUI,
permissions, live capture or app/Engine integration. Rust compiles no root app,
GUI framework, transcription model, Metal or Desktop helper. The SDK itself has
no runtime dependencies and requires no Rust toolchain or cached native outputs.

## Explicit-time movie frames

`apparent-engine-frames frames-v1 MOVIE OUTPUT MAX_EDGE TIMES_CSV` decodes finite
MP4/QuickTime snapshots through GStreamer on Linux and a separate AVFoundation
helper on Mac. Mac uses exact-time image generation; a native decode failure
falls back to a serial reader from the beginning to retain open-GOP reference
pictures. That path must find the exact selected sample; it cannot substitute a
nearby frame. It can take longer and retains the same SDK deadline and limits.
`OUTPUT` must be a fresh, caller-owned `0700` directory. The public
SDK validates request identity, file ownership, dimensions and exact byte counts.
See [the SDK contract](sdk/README.md#movie-frames) for clocks, limits and cleanup.
The metadata reader stays separate and does not link GStreamer.

The extracted native package and installed SDK qualify real decoded pixels,
display rotation, forward/backward requests, duplicate identities and edit-list
offsets on each supported architecture. This producer prerequisite enables Agent
zoom adoption; it does not route an application caller or retire a root decoder.
Sampling, cropping and bundle policy remain with consumers. Producer publication
must precede checksum-pinned consumer adoption and its application package proof.
Mac qualification also runs every vector with the real sequential reader forced
by `APPARENT_ENGINE_QUALIFY_SEQUENTIAL=1`; this is an internal qualification
control, not a consumer provisioning or workflow contract.

## Delivery and adoption

Engine delivery checks Linux and Mac artifacts independently of the legacy app.
The native packages cover Linux x64 and arm64, plus Intel and Apple silicon Mac,
matching the architectures of the existing application packages. Each architecture
runs the same extracted-package and real-media qualification before publication.
Successful main builds publish a commit-addressed prerelease; consumers must pin
an exact artifact digest and compatible SDK. Producer publication does not
activate an installed app or move its compatibility gates.

Record's `record/media/` package is the first application consumer. CLI and menu
export obtain metadata through its headless worker and this published SDK, using
the native artifact pinned by that consumer. Application packaging stages those
verified bytes and signs the Mac readers as nested code. No source build or
download occurs when exporting. See `record/media/README.md` for policy, package
proof and rollback. Bundle ingestion/recovery and retention's size observation
also consume Record's container-clock metadata contract. Both platforms' replaced
Desktop probes and the Swift helper probe command are removed.

Agent zoom and Record's explicit assembly/recovery frames also consume the
published frame capability through their own headless TypeScript workers.
Application composition shares finite-process/private-pixel safety mechanisms;
the owners retain their respective bundle-clock interpretation and artifact pins.

This is bounded adoption, not completed application separation. Capture, native
rendering, phone capture, frame/audio decoding and retention mutation still use
the authoritative legacy runtime. Producer changes do not
automatically update an installed consumer: pin/contract adoption needs its own
tests and package verification. Revert the consumer slice and pin together for
rollback. Preserve historical migration branches and unrelated writers.
