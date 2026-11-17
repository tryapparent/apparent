# Agent test cleanup ledger

Current candidate base: main `3a60e5bbe6231cb346e5d165f86d0f21e3eee707`.
Port only the reviewed Agent changes through `89cb5bc35`; app production remains
unchanged. QA tooling is migrated below. Narrator provisioning/DSP/protocol and Agent frame-policy
sources were read before their tests, together with owner guidance, actual
`captureToolTests()` selection, export narration and movie-worker consumers.
Agent production/test declarations are read through setup and semantic context.
The documented manual QA helper is migrated, repaired and preservation-reviewed
below; platform and delivery gates remain.

## Narrator cutover

D: remove `test_typescript_policy_contracts`, which invokes the same three
TypeScript tests already selected directly by the tooling runner. No assertion
is removed from that suite. The documented standalone verification recipe now
runs Node explicitly as well as Python. Direct runner enumeration confirms one
narrator TypeScript entry. Remove `create=True` from two URL-opener patches: the
attribute exists, and a renamed/missing dependency should fail fixture setup.
Keep the fake external response; it bounds download tests without network or
modifying the internal cache implementation.

F: require the symlink-output case to report `output already exists`, retaining
its unsuccessful exit and unchanged-target checks. Its absent model previously
made a bypassed symlink guard fail later and pass the test. The regular-file case
already requires this same refusal. Keep missing-model failure independently.

| Narrator declarations / parameter rows | Decision and credible regression |
| --- | --- |
| TS installed worker/assets plan; explicit rebuild; missing assets | R: reuse unexpectedly builds/downloads, explicit rebuild is ignored, or assets are omitted |
| TS missing worker without consent; explicit first setup | R: setup silently builds or begins download before exposing the prerequisite; wrong asset/build order |
| TS WAV positive, truncation, wrong rate, empty | R: readiness trusts incomplete or incompatible synthetic output; native synthesis success alone does not validate its bytes |
| Python missing-cache CLI check | R: read-only diagnosis creates a cache or reports ready despite missing inputs |
| Python interrupted partial ignored and retained | R: partial bytes become trusted assets or another attempt's partial is removed |
| Python download, byte identity, reuse without request, corrupt existing file | R: reuse fetches again or bypasses verification of existing bytes |
| Python bad downloads: short, equal-length wrong hash, oversized | R: incomplete, corrupt or unbounded newly downloaded bytes are published; own partial survives failure |
| Python asset symlink and preserved target | R: cache acquisition follows an outside asset |
| Python symlink ancestor/source-tree refusal | R: cache creation traverses an alias or mutates this source tree |
| Python held directory across rename/replacement | R: descriptor-based writes follow a replacement pathname |
| Python initial HTTP and HTTPS redirect downgrade | R: either independent network entry admits plaintext transport |
| Python foreign source repository: root/descendant | R: another checkout becomes a cache or is mutated before refusal |
| Python elapsed download deadline | R: trickling reads evade the total deadline or leave a partial |
| Python interrupted response, cleanup, successful retry | R: a reset leaks own bytes or poisons the next attempt |
| Python existing same-size corrupt bytes | R: an existing-file size-only shortcut bypasses the hash; distinct from verifying a new download |
| Python worker symlink replacement, target, mode, partial cleanup | R: installation follows a planted link or publishes unsafe/incomplete executable bytes |
| Python failed source open and old worker/partial preservation | R: failed preparation removes the working executable; this is refusal proof, not a late-rename rollback claim |
| Rust DSP impulse | R: startup phase/state reset changes while steady-state frequency checks still pass |
| Rust DSP empty/NaN/positive and negative infinity | R: invalid inference output reaches PCM conversion |
| Rust DSP center/near-center rejection and four speech-band controls | R: whine remains or filtering damages the wanted band |
| Rust DSP positive/negative saturation | R: large samples wrap or lose symmetric limits |
| Rust worker empty/invalid UTF-8 before model loading | R: rejected input loads a model or produces output |
| Rust worker existing regular output and symlink target | F/R: output refusal is bypassed or prior bytes change; symlink refusal must be the observed reason |
| Rust worker missing assets | R: synthesis succeeds or leaves an output without a model |
| Rust worker argument count | R: incomplete invocation is admitted instead of receiving usage failure |

The DSP, native worker, descriptor-based cache and TypeScript readiness layers
protect different boundaries. Keep all of them. Only the nested rerun is retired.
F/C after preservation review: consolidate empty and invalid-UTF-8 input checks
into explicit input/diagnostic rows. Invalid UTF-8 previously had only an exit
check, so a missing-model error could hide lossy decoding. Require its own UTF-8
refusal as well as the unsuccessful exit and absent output.

Net test/support delta: +2 lines (Python -3, Rust protocol +5). This buys a newly
effective, independent UTF-8 rejection guard; it adds no declaration, fixture,
production seam or dependency. Only duplicate execution funds the consolidation;
no independent contract is removed. Documentation is separate.

## Agent frames

F: construct the backward/duplicate movie-frame fixture from independently
calculated `[2150, 200, 200, 1200]`, for bundle times `[2500, 550, 550, 1550]` and
offset 350. Previously both the fixture and verifier used `movieTimes`, so sorting
caller requests could pass the round trip. No added test line or declaration.

| Frame checks | Decision and credible regression |
| --- | --- |
| Headless offset-clamped identities, exact movie clocks | R: early requests lose their distinct bundle labels |
| Headless backward/duplicate requests and zero | F/R: conversion sorts/deduplicates caller order or changes the zero boundary |
| Headless empty/49/negative/nonfinite/fraction/unsafe integer times; invalid offsets | R: invalid requests reach the provider; each parameter row retained |
| Headless missing/reversed/reindexed/relabeled reply rows | R: pixel/crop associations silently change |
| Native actual fractional clocks/clamps, modes, source identity | R: the pinned provider/worker disagrees with the real movie or writes unsafe output |
| Native rotation, pixel colors and staged capability/mode inventory | R: display orientation or installed frame-only runtime composition changes |
| Native failure statuses 1 and 72, empty stdout/redacted stderr | R: a generic failure becomes resource backoff or private diagnostics escape |
| CLI package direct installed Node host, cropped and full zoom, labels/pixels | R: packaged assets are unused or crop/time association changes in either real caller |
| CLI package 51-frame fallback with FFmpeg excluded; lower-FPS repeat | R: range batching truncates output, stale PNGs survive or unrelated files are removed |
| CLI package source bytes and owned-temp cleanup | R: extraction changes source media/manifest or leaks private pixels |

Keep native, installed-host and CLI checks alongside headless policy: those
protect provider, packaging and actual caller behavior. They do not prove live
capture, permissions, GUI rendering or physical-device behavior. Frame package
and native cases are read and retained; Linux execution is recorded below.
Composition's finite-worker/readback tests belong to its separate owner audit.

## Evidence and remaining gates

Linux baseline: narrator TS 3, Python 16 (including the nested TS rerun), native
DSP 4 and worker protocol 4 pass. Headless Agent media baseline 4 passed in the
Record hook at the candidate base. Direct tooling inventory retains exactly one
TypeScript suite entry after removing the nested rerun.

Copied real native crate sensitivity: change the existing-output check to admit
symlinks while still refusing regular files. The original keeper passes; the
repaired keeper fails its intended diagnostic assertion. Restore production and
the repaired keeper passes. The actual locked Kokoro dependency is compiled;
no inference model is supplied, and no synthesis/listening acceptance is claimed.

[Continued audit](part-2/README.md)
