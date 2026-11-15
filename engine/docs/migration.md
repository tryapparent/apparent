# Native application / Engine migration

Active goal: complete the owner boundaries below, delivering successive usable
PRs against current main. A verified merge advances this inventory; it does not
finish the migration. Current source baseline:
`91fa763dc5039920806d949192fc2cdafc23f029`.

| Boundary | Implemented evidence | Remaining adoption/removal gate |
| --- | --- | --- |
| Engine media metadata | Independently published native reader and compiled SDK; Record export, ingestion, recovery and retention observations consume checksum-pinned artifacts. #1284/#1286/#1288 passed Mac/Linux CI and Linux package delivery; #1288 exact main is `5f4be8bc93bca2df9d0d6c9223fddf88d4d8b86e`. Replaced Desktop probes are removed. | Keep the pinned provider and package compatibility gates when adding capabilities. |
| Engine capture and lifecycle | Root runtime owns actual capture, permissions, resource cleanup and durability. The separate `capture/engine` admission/lease crate has package proof, no production consumers. | Adopt one authoritative native capture/admission contract through live callers; align locks, receipts, cancellation, recovery and maintenance before retiring donors. |
| Engine media operations | #1299 landed explicit-time frames at `6c65748d4f2d32fd2dc8b966685e7e0ba33f9794`; successor `5bbe8e35e67b61703737991575860d4b1fd1ad57` requalified SDK/all four native architectures and published immutable SDK 0.2/frame artifacts. Root transcription, audio, encoders and remaining image mechanisms are authoritative. | Adopt frame capability through real consumers, then continue remaining capabilities with native/plugin/model inputs and package proof. |
| Record workflow | Headless completion, storage controllers and export metadata policy have real consumers. | Capture-to-handoff assembly, recovery decisions, preferences/defaults, retention planning, keyframe/transcript assembly and remaining export policy still cross Rust owners. |
| Desktop | Accepted React Settings, onboarding and recording controls coexist with native shell/legacy fallback paths. | Complete actual Electron workflows and shell/platform integration, then remove replaced Rust policy/UI and its build closure. Preserve one durable config writer until its accepted replacement. |
| Agent | #1305 landed zoom's published Engine frame adoption at `ceaf6fdd2dc67e90215154dc96a1282f42254753`; #1308 corrected the AppImage cache cleanup proof at `91fa763dc5039920806d949192fc2cdafc23f029`. Both full/cropped real callers use the SDK. | Finish exact-main AppImage acceptance; migrate range-extraction fallback and remaining CLI composition. Whole-Agent independence is not established. |
| Connect / Public | Public and hosted web/service loops are TypeScript. Connect has compiled TypeScript crypto, listing/foreground/MCP consumers alongside authoritative Rust transfer/identity/queue code. | Finish native Connect caller/persistence adoption and remove repo-owned Rust from Connect build/release inputs. Preserve encryption, consent, cancellation, retry and publication semantics. |
| Composition / Shared / Enablement | One canonical hook/CI selector; independent Engine producer routing; existing app staging embeds explicit capability artifacts. | Remove obsolete source/build/package edges as consumers qualify. Shared must not absorb displaced policy. Prove each independence claim without Rust tools/cached native output. |

## Current slice: Record explicit keyframe adoption

The bounded native `movie-frames/1` capability and SDK are published. Agent zoom
uses them through its own worker. Record now routes capture predecode,
full-keyframe assembly and screen recovery/reprocessing through its separate
`record/media/frames-worker`. Record's TypeScript mapping preserves bundle-clock
identity when several requests clamp to movie zero. Application composition
shares finite-process/private-pixel mechanisms without importing product owners.
Four-frame resource batches respect the provider's maximum pixel budget.

Recovery's explicit-frame injection and real callers move together; periodic
sampling remains separate. The root `movie_frames_at` function is retained for
Agent's real range-extraction fallback in Shared. Phone periodic/explicit frame
paths, selection, caching and rendering remain native debt. Do not remove these
donors until their remaining consumers are adopted. Record's metadata policy is
unchanged while its provider/SDK pin moves from 0.1 to the published 0.2 generation.
No persistence schema or configuration writer changes.

The contract preserves request identity, duplicates, display orientation and
actual presentation time in the edited movie timeline. Private caller-owned
ephemeral output has explicit pixel/count/deadline limits and no bundle or
publication policy. Linux uses GStreamer; Mac uses a separate AVFoundation helper.
The existing metadata executable remains free of GStreamer linkage.

Required producer proof: clean Rust-free SDK consumption, independent native
builds outside the app source, extracted-package real pixels and timing,
rotation, edit-list offsets, first/last clamps, backward and duplicate requests,
source preservation and private-output/error/cancellation checks on all four
supported architectures. Linux local execution establishes only its own platform;
Mac qualification remains a platform gate. No capture, permissions or physical
phone proof is inferred from decoded synthetic movies.

Verify real callers and output images on Linux/Mac, stage/sign all native inputs,
compare affected latency, and remove only the replaced call path. Rollback reverts the consumer routing and pin
together; the producer alone changes no config writer or installed app behavior.
Record periodic assembly, audio, transcription, encoders, lifecycle and UI remain
separate inventory items. No precise build savings are claimed.

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
