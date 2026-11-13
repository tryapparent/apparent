# Engine

Engine owns native capture/media execution and resource, durability and safety
mechanisms, its TypeScript SDK, and capability delivery. Record owns workflow,
preferences, retention decisions and ordinary assembly/export policy; Desktop
owns human controls and shell presentation. Engine must not import those owners'
implementations. Linux and macOS are supported; there is no Windows provider.

## First capability: local movie metadata

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

With Node 22.18+, Rust 1.89+, and FFmpeg installed (plus Xcode on Mac):

```sh
node --experimental-strip-types engine/tools/check.ts /tmp/apparent-dev-engine-JOB
```

Create a private per-job directory first. On Clanker, run this command through
`/home/simon/.local/bin/t3-build --jobs 3 -- ...`. Output includes a native runtime
archive, SDK tarball, per-file manifest and archive digests. Qualification installs
the tarball outside the checkout, then probes real synthetic audio/video and
silent movies through the copied runtime, checks failure cases and unchanged
source bytes. Native compilation runs from a copied owner source tree outside
the checkout, using Engine's distribution config rather than ancestor/root Cargo
configuration. It does not run the installed app or prove live capture, GUI,
permissions, full decoding or app/Engine integration. Rust compiles no root app,
GUI framework, transcription model, Metal or Desktop helper. The SDK itself has
no runtime dependencies and requires no Rust toolchain or cached native outputs.

## Delivery and adoption

Engine delivery checks Linux and Mac artifacts independently of the legacy app.
Successful main builds publish a commit-addressed prerelease; consumers must pin
an exact artifact digest and compatible SDK. Producer publication does not
activate an installed app or move its compatibility gates.

This is a necessary producer prerequisite, not completed production migration.
The installed app still uses `capture/engine/` and Desktop's existing probes.
The next dependency-complete slice must adopt a published Engine artifact in
the real Mac/Linux callers and packaging, verify platform behavior, then remove
the replaced probe implementation. Rollback reverts that consumer slice and its
pin together. Keep historical migration branches and unrelated writers intact.
