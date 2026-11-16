# Media test audit

Campaign baseline `8cd7ce43f`; this local slice is based on `8762967dc`.
Read all media policy/worker production sources, provisioning/staging, owner
README and package commands, the published SDK/provider implementation, and the
native metadata/assembly/frame/retention bridge before deciding this cut. Read
all six headless files, the separate native suite and all four CLI package
checks. Package decisions also trace the actual export, phone ingestion, screen
finalization/recovery, command-transcriber and native audio callers, plus
Storage dry-run planning. The lane is audited; delivery gates remain open.

## Phone cadence consolidation

C: `phone cadence preserves legacy thresholds and overflow rather than truncating
timestamps` keeps all seven existing duration/count/last fixture rows. Replace
separate count/last assertions and a copied production cadence formula with one
exact array assertion derived from those explicit fixture endpoints. Every
expected array starts at zero, has the exact count and uniform accepted spacing,
and ends at the fixture's last timestamp. This subsumes the old range/formula
check for every retained row without recomputing the owner's floor/max policy.
Keep candidate scale, malformed/unsafe durations and the maximum-safe-integer
check. Net test/support delta: -1 line; no declarations, fixtures, mocks or
production changes.

R: the adjacent actual-presentation-time test checks source request identity,
within/across-batch deduplication, backward/negative/fractional time and malformed
request index. Those are different contracts from requested sampling cadence.
R: the native sparse-phone movie check must remain: the pure suite cannot prove
SDK batch execution, actual presentation samples, private pixel bytes or cleanup.

## Headless contracts retained

| File / declarations | Decision and realistic regression |
| --- | --- |
| policy: export clock; bundle container clock/audio presence | R: export selects an audio tail or ingestion loses it; presence is mistaken for playable overlap |
| policy: missing/empty clock and SDK bounds | R: explicit zero silently falls back, no video is accepted, or display orientation is lost |
| policy: overlapping audio/stream IDs | R: a filtered ordinal replaces the original stream ID or non-overlap becomes selected audio |
| policy: native nonempty edits | R: padded Mac track intervals are treated as audible data |
| policy: silent/unknown-length audio; empty video/display bounds | R: unavailable audio grants selection or invalid video reaches encoding |
| frames: clamped identities; requested order/duplicates | R: several bundle requests at movie zero collapse or recovered frames change bundle timestamps |
| frames: incomplete/malformed identity replies | R: missing/reordered/relabelled native frames silently receive another keyframe's identity |
| frames: unsafe times/sparse arrays | R: malformed request reaches a native decoder |
| phone: all cadence rows | C as above: threshold/overflow/request sequence drifts; do not truncate to 480 |
| phone: actual-time deduplication | R as above: batches repeat or relabel native samples |
| screen: paging/offset/scale | R: long input loses pages, labels use movie rather than bundle clock, or benchmark/recovery scales change |
| screen: invalid request/cursor | R: malformed or exhausted cursor loops or reaches native execution |
| assembly: default/ordinary allocation and u64 limits | R: duration thresholds, cap or reserved ordinary budget change; unsigned duration overflows |
| assembly: real Node worker | R: decimal/native wire input, finite CLI arity or private rejection behavior fails independently of pure policy |
| transcript: punctuation/mark-anchor clauses | R: text disappears, repeats or moves to the wrong keyframe |
| transcript: segment-only/untimed/Unicode whitespace | R: recognizer fallback or non-ASCII text is lost/trimmed incorrectly |
| transcript: full unsigned clocks | R: Number rounding corrupts alignment or invalid times pass |
| transcript: real private-stdin worker | R: malformed/wrong-version/extra fields or private transcript diagnostics cross the transport boundary |

## Native/integration boundaries retained

The five native tests remain distinct: sparse screen paging and empty
continuations; phone cross-batch dedup/private pixels; explicit frame identities
and decoded pixels; provisioning refusal preserving an unowned destination; and
real metadata/audio/rotation/source-preservation through the staged provider.
These five standalone native tests were read, not replayed for the cadence
assertion change. Separate development-CLI composition evidence is recorded
below; the headless suite does not establish packaged or native acceptance.
The shared worker resource harness remains in the Composition audit queue.
No headless flakiness/retry repair was indicated by this source/fixture review.

## Evidence and delivery gates

`npm --prefix record/media test`: 21/21 pass, zero skips. Source/worker typecheck
inputs are unchanged from slice 1's successful normal hook. Phone sensitivity
runs use a copied source package and the actual retained test outside the
checkout in `/tmp/apparent-dev-media-audit-XlDjeT/package`. Each of six independent
mutants fails the cadence test: shifted start, corrupted middle timestamp,
480-request cap, rounding instead of floor, wrong minimum interval and wrong
candidate scale. Unmutated and restored controls pass; production was not edited.
Private helper/log files in the same disposable job root may need regeneration.

Independent preservation review found no lost guard, checked every matrix row
and independently passed both phone tests. Hook/PR and exact-main delivery
remain pending.
Continue delivery gates and then the other owner lanes; these bounded
consolidations are not a campaign completion boundary.

## Package-check follow-up

| Check | Decision and independent contract |
| --- | --- |
| package.ts | R: real CLI export/decoder/encoder, rotated playback and audio, source preservation, ordinary/flagged ingestion, screen offset/recovery/benchmark and full transport page |
| assembly-package.ts | R: actual default-plan consumer retains twelve marked frames with decoded pixels and unchanged source; six-flag coverage does not establish the maximum allocation |
| audio-package.ts | R: producer-derived bundle, actual native audio extraction, private WAV publication under umask 002, exact transcriber input and leading-gap/end clocks; this proves handoff, not recognition |
| transcript/package.ts | R: actual phone, screen-finalization and recovery callers preserve exact words/summary allocation and source/config hashes |

D: remove the first of two consecutive manifest writes in transcript fixture
preparation. It has no reader; route-specific mark adjustment and the final
private write still precede hashes and CLI execution. Independent preservation
review confirmed identical final manifest content/options and unchanged route,
text and preservation assertions. This removes one fixture-support line; Media
now removes two test/support lines in total, without adding/removing declarations.

The entire `record/media/test/package.ts` entrypoint passed on the changed
fixture using the existing development binary built at `c02f57337` and its
matching generated worker/runtime assets. Rust and media-worker production inputs
are unchanged. All four package modules and the nested Storage qualification ran.
The first relocated-binary attempt failed before checks because its `$ORIGIN`
shared libraries were absent; adding the existing matching sibling libraries to
the private prefix repaired the setup. No source, assertion or timeout changed.

Evidence: `/tmp/apparent-dev-media-package-audit-jbRFze/package-runtime.log` and
`identity.json`. The prefix presents existing development assets through owned
symlinks; this is Linux development composition proof, not a sealed AppImage,
signed Mac package, live capture, permission or physical-device verdict. Existing
packaged/platform gates remain. Synthetic media only; no destructive cleanup,
release or live recognition was executed.
