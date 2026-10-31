# Checked bundle publication (Engine adoption prerequisite)

The production pipeline returns an error when required persistence, validation,
recovery-marker cleanup or durability fails. This is a persistence bug fix,
not a new bundle format, Engine receipt or Engine Saved claim.

## Production entry points and caller ordering

`finalize_capture_bundle` and `build_bundle_from_parts` use
`bundle_pipeline::publication::publish_after(path, build)`. Existing tuple/result
contracts remain intact. This checks both prepared PNGs and rendered images.
`recover::write` and `speech_model::mark_pending` now return checked results;
the pipeline propagates them instead of discarding persistence failures.

The **outermost** `publish_after` must enclose all optional whiteboard mutations
and any fallback. Nested builds on that thread defer their barrier to that outer
operation. The outer return is the only success eligible for downstream effects.
An incomplete base build retains `.publication-pending` and recovery work.

The GUI integration is separately owned and is **not implemented by this slice**.
The current `src/ui.rs` screen and phone `.map(whiteboard::finish_handoff)` calls
still mutate after the core finalizer returns. Until their owner applies the
minimal wrapper below, this PR does not prove final GUI clipboard/upload/Saved
ordering or whiteboard fallback safety. Merely calling `checked` after `.map` is
insufficient: the pending transcription writer could already have started.

Minimal caller edit, at both `src/ui.rs` stop branches:

1. Enclose the existing `crate::finalize_capture_bundle(...).map(...)` expression
   in `publication::publish_after(&bundle_dir, || { existing_expression })`.
2. Do the same around the phone `session.stop().and_then(...).map(...)` expression.
   Keep `whiteboard::finish_handoff` **inside** each outer closure.
3. Preserve the returned `Result` through `receive_capture_result`; no success
   effect on an error. A restored base must pass this same final barrier.

Use `crate::bundle_pipeline::publication` as the import. No whiteboard algorithm
or output format change is required. The separately owned UI tests must exercise
both wrappers with failed final PNG/manifest/cleanup and rollback/fallback cases,
and verify no Saved, clipboard or upload effects. Core tests exercise the actual
pipeline entry points and the outer publication closure, not those UI effects.

## Engine inputs and writer lease

`coordinate(path) -> Result<Coordination>` is a non-Send, owning-thread reentrant
writer lease over a persistent `.publication.lock` flock inode. Never unlink that
file. Hold an outer lease across final mutation, `checked`, and Engine consumption.
`checked(path, &bundle, &summary) -> Result<PublicationInputs>` returns the
absolute `path`, `bundle_id`, and exact persisted `manifest` bytes. Feed those,
plus the Engine caller's own request identity, to existing
`FinalizerSuccess::validate` and `Session::finish`; this layer creates neither.
A root test exercises the existing Engine validator without calling `finish`.
Engine additionally rejects group-writable ancestors even below a private parent;
provision a path satisfying its existing contract, not the shared build scratch.

The lease serializes cooperative finalizers and pending transcript writers, not
arbitrary same-user processes or subsequent retention/reprocess work. The inputs
are not a perpetual media attestation. The future caller must not drop its outer
lease between `checked` and Engine terminal handling.

## Persistence and validation

Descriptor-relative Unix operations reject symlinks at managed ancestors/leaves,
traversal, nonregular files, hard links, untrusted owners and world-writable
artifacts. Bundle roots are private; existing group-writable owned artifacts are
made private before their validation snapshot. Inventory, relative paths, JSON,
PNG allocation and movie metadata/sample counts are bounded. Required references
include keyframes, contact sheets and both autocrop resolutions. Present retained
PNG/WAV/movie files are checked too. Image-only bundles do not require a movie or
WAV; phone/device bundles use the same reference-based rules.

PNG pixels are decoded with the existing `png` crate through stream completion.
WAV structure and every sample are checked with `hound`. MP4/MOV checks cover
completed ISO-BMFF boxes, embedded video descriptions, sample sizes, chunk extents
and timing counts. **Movie codec payload decoding is not claimed**; fragmented
MP4 and unusual sample-table variants are not supported by this validator. No
optional platform decoder, new dependency or external ffmpeg process is required
at publication. The tiny checked-in H.264 fixture is synthetic (see its README).

All inventoried files, nested directories, bundle root and parent are fsynced;
metadata, inode identity and the complete inventory are checked for replacement.
Recovery records disappear only after artifact validation and fsync. Cleanup
preflights all markers and restores the original markers if final cleanup or
identity/durability checks fail, reporting restoration errors rather than success.
No filesystem can promise recovery when it also refuses those restoration writes.

Pending transcription is marked durably without spawning an in-place writer.
A model-ready scan or successful outer publication resumes it under the same
lease. Incomplete/unsafe/journaled bundles are skipped with pending work intact.
Transcription errors retain pending work; successful updates pass the barrier
before marker removal. A failed update attempts to restore and revalidate the
previous manifest/summary so a later retry is not stranded.

## Proof limits

Offline Linux root-package build/tests use synthetic artifacts only. Native
macOS/Linux GUI, codec playback, real crash/power-loss and forced fsync-failure
proof remain separate. No capture, VM, install, deploy, live config or Engine
terminal integration is authorized or claimed by these tests.
