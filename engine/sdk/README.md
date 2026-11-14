# Engine SDK

`@apparent/engine-sdk` provides `probeMovie({executable, movie, timeoutMs?, signal?})`.
Both paths must be absolute. Provision the matching native artifact explicitly;
the SDK does not search for Engine, compile, install or download anything.

The result contains container duration, the first video track's display dimensions/rate
and timing, and every audio track's provider-local stream index and timing. Indices
do not identify tracks across different decoders. Missing
facts are `null`. Mac additionally supplies actual nonempty audio edit segments;
Linux reports segment detail unavailable. Audio selection, overlap decisions,
export and workflow policy stay with the consumer. The SDK normalizes native
affine display matrices on both platforms; projective matrices are unsupported.

The deadline defaults to 30 seconds (maximum 60). Cancellation and deadline
failure wait for the launched reader to exit; they do not return a partial
result. Native diagnostics and private paths are not included in SDK errors.
Source policy tests/typechecking require only Node 22.18+ and the locked compiler.
See `engine/README.md` for the complete package check and native prerequisites.

## Movie frames

`decodeMovieFrames({executable, movie, outputDirectory, timesMs, maxEdge?, timeoutMs?, signal?})`
uses the matching `apparent-engine-frames` artifact. All paths are absolute. The
input is a trusted local MP4/QuickTime movie; this is not a hostile-codec sandbox.
No tool discovery, installation, source compilation or network input is supplied.

Supply 1–48 nonnegative safe-integer movie times in milliseconds. Order and
duplicates are preserved. Each result has `requestIndex`, `requestedMs`,
`actualMs`, display-oriented `width`/`height` and an absolute `file` path. The
native provider selects the last presentation sample at or before the requested
movie time, clamping to the first/last sample outside the video. Edit-list offsets
are included in this movie clock; audio selection and workflow sampling are not
part of the operation. `actualMs` rounds down to integer milliseconds.

Files are dense row-major straight-alpha RGBA8, four bytes per pixel. `maxEdge`
defaults to zero (native dimensions), otherwise limits the longest edge without
upscaling. Native dimensions must be at most 16,384 per edge and 64 Mi pixels per
frame; total output is limited to 256 Mi pixels (1 GiB). Native codec internals
can allocate before these output checks; they are not a general memory sandbox.

Create a new empty current-user-owned `0700` directory for each operation. Native
output is descriptor anchored and written exclusively as private `0600` files;
the SDK verifies the complete response and output inventory. The caller owns the
directory and must remove it after consumption **and after errors**, which can
leave partial files. This ephemeral output has no durable publication contract.

The deadline defaults to five minutes (also the maximum). Cancellation or deadline
failure kills the owned native reader and waits for exit. No partial result is
returned. `EngineFrameError.code` distinguishes invalid requests, unsafe output,
unavailable runtime, cancellation, timeout, resource limits, decode failure and
invalid responses; diagnostics and private paths are redacted. Direct native CLI
callers must provide their own deadline and the same cleanup.
