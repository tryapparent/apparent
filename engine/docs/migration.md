# Native application / Engine migration

Active goal: complete the owner boundaries below, delivering successive usable
PRs against current main. A verified merge advances this inventory; it does not
finish the migration. Evidence baseline: `b89a74fecf628067d3fe1ed63aaeb9d16b44f711`.

| Boundary | Implemented evidence | Remaining adoption/removal gate |
| --- | --- | --- |
| Engine media metadata | Independently published native reader and compiled SDK; Record export consumes checksum-pinned artifacts. #1284/#1286 passed exact-main Mac/Linux and Linux package delivery. | Replace the remaining Desktop movie probes in ingestion, recovery and retention. |
| Engine capture and lifecycle | Root runtime owns actual capture, permissions, resource cleanup and durability. The separate `capture/engine` admission/lease crate has package proof, no production consumers. | Adopt one authoritative native capture/admission contract through live callers; align locks, receipts, cancellation, recovery and maintenance before retiring donors. |
| Engine media operations | Root native decoders, transcription, audio, encoders and image mechanisms remain authoritative. | Independently deliver/adopt each capability with native/plugin/model inputs, safety contracts and real package proof. |
| Record workflow | Headless completion, storage controllers and export metadata policy have real consumers. | Capture-to-handoff assembly, recovery decisions, preferences/defaults, retention planning, keyframe/transcript assembly and remaining export policy still cross Rust owners. |
| Desktop | Accepted React Settings, onboarding and recording controls coexist with native shell/legacy fallback paths. | Complete actual Electron workflows and shell/platform integration, then remove replaced Rust policy/UI and its build closure. Preserve one durable config writer until its accepted replacement. |
| Agent | CLI inspection/proof and bundle consumers still compose the root native app. | Consume published Record/Engine contracts with compatible bundle/text/image output and independent packaging. |
| Connect / Public | Public and hosted web/service loops are TypeScript. Connect has compiled TypeScript crypto, listing/foreground/MCP consumers alongside authoritative Rust transfer/identity/queue code. | Finish native Connect caller/persistence adoption and remove repo-owned Rust from Connect build/release inputs. Preserve encryption, consent, cancellation, retry and publication semantics. |
| Composition / Shared / Enablement | One canonical hook/CI selector; independent Engine producer routing; existing app staging embeds explicit capability artifacts. | Remove obsolete source/build/package edges as consumers qualify. Shared must not absorb displaced policy. Prove each independence claim without Rust tools/cached native output. |

## Current slice: remaining movie probes

Record media will interpret bundle-ingestion metadata using the published SDK.
Phone/file ingestion, orphan recovery and retention's size observation will use
that contract on Mac/Linux. Preserve the container timeline used by assembly,
including audio tails; export retains its separate video-clock policy. Retention
mutation/exclusion, decoding, transcription and live phone capture stay unchanged.
Remove both Desktop probe contracts, Linux's metadata/audio-decode probe, and the
unused Swift helper probe command only after all callers/tests adopt the contract.

Required proof: pure policy and Rust-free build, real published-provider fixtures
(rotation, silent/audio/multiple tracks, video versus container clock, malformed
inputs), actual ingestion/recovery and retention observations, unchanged sources,
Mac/Linux bridge and signed/package consumers, ordinary hooks and exact-main CI.
No physical-phone capture proof is inferred from imported synthetic movies.
Rollback reverts this whole consumer slice; it introduces no config writer.

Candidate findings: a rotated fixture exposed Linux decoding ignoring display
orientation. The native frame adapter now applies that tag; the real ingestion
test checks dimensions and red/blue orientation against independent FFmpeg output.
The non-UTF-8 path alias also creates its directory with explicit `0700`, rather
than inheriting permissions from a caller's umask. CLI reprocessing also creates
its new bundle with explicit `0700`; its packaged test exercises a group-writable
caller umask without weakening publication's ownership checks. These are bounded native
correctness/safety prerequisites for the shared metadata contract.

## Following slices and completion

After each merge, trace current callers again and select the next smallest usable
boundary above. Publish producer prerequisites only when they enable a named real
consumer; package-only work is not completed application adoption. Keep the
working native authority until replacement consumers, persistence and tests pass.
Delete verified donors rather than keeping parallel policy implementations.

Historical references remain read-only sources for bounded ports:
`migration/main-preserved-2026-11-08` at `bf7671b1d72b1a71168627407fe51da32fda5e1a`
and `migration/omarchy-first-recording-package` at
`f054afa7bdc86382f1b8df7da909c02908299e1a`. Their media worker and composition
shell are not current-main production adoption or interchangeable package inputs.
Never merge the umbrella or discard another writer's history.

Full completion requires every remaining gate above to close through real callers,
single-writer persistence, headless/owner build independence, installed/package
proof and passing exact-main delivery. A file move, mocked provider, green package
test or one merged PR does not close those gates. Honor coordination, review,
native-session spending and separate activation restrictions throughout.
