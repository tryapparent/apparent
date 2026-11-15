# Native application / Engine migration

Active goal: complete the owner boundaries below, delivering successive usable
PRs against current main. A verified merge advances this inventory; it does not
finish the migration. Current source baseline:
`5bbe8e35e67b61703737991575860d4b1fd1ad57`.

| Boundary | Implemented evidence | Remaining adoption/removal gate |
| --- | --- | --- |
| Engine media metadata | Independently published native reader and compiled SDK; Record export, ingestion, recovery and retention observations consume checksum-pinned artifacts. #1284/#1286/#1288 passed Mac/Linux CI and Linux package delivery; #1288 exact main is `5f4be8bc93bca2df9d0d6c9223fddf88d4d8b86e`. Replaced Desktop probes are removed. | Keep the pinned provider and package compatibility gates when adding capabilities. |
| Engine capture and lifecycle | Root runtime owns actual capture, permissions, resource cleanup and durability. The separate `capture/engine` admission/lease crate has package proof, no production consumers. | Adopt one authoritative native capture/admission contract through live callers; align locks, receipts, cancellation, recovery and maintenance before retiring donors. |
| Engine media operations | #1299 landed explicit-time frames at `6c65748d4f2d32fd2dc8b966685e7e0ba33f9794`; successor `5bbe8e35e67b61703737991575860d4b1fd1ad57` requalified SDK/all four native architectures and published immutable SDK 0.2/frame artifacts. Root transcription, audio, encoders and remaining image mechanisms are authoritative. | Adopt frame capability through real consumers, then continue remaining capabilities with native/plugin/model inputs and package proof. |
| Record workflow | Headless completion, storage controllers and export metadata policy have real consumers. | Capture-to-handoff assembly, recovery decisions, preferences/defaults, retention planning, keyframe/transcript assembly and remaining export policy still cross Rust owners. |
| Desktop | Accepted React Settings, onboarding and recording controls coexist with native shell/legacy fallback paths. | Complete actual Electron workflows and shell/platform integration, then remove replaced Rust policy/UI and its build closure. Preserve one durable config writer until its accepted replacement. |
| Agent | CLI inspection/proof and bundle consumers still compose the root native app. | Consume published Record/Engine contracts with compatible bundle/text/image output and independent packaging. |
| Connect / Public | Public and hosted web/service loops are TypeScript. Connect has compiled TypeScript crypto, listing/foreground/MCP consumers alongside authoritative Rust transfer/identity/queue code. | Finish native Connect caller/persistence adoption and remove repo-owned Rust from Connect build/release inputs. Preserve encryption, consent, cancellation, retry and publication semantics. |
| Composition / Shared / Enablement | One canonical hook/CI selector; independent Engine producer routing; existing app staging embeds explicit capability artifacts. | Remove obsolete source/build/package edges as consumers qualify. Shared must not absorb displaced policy. Prove each independence claim without Rust tools/cached native output. |

## Current slice: Agent zoom adoption

The bounded native `movie-frames/1` capability and SDK are published. Agent zoom
now routes its cropped and full-frame callers through `capture/agent/media/` and
the checksum-pinned artifact. Its TypeScript clock mapping preserves request
identity when several bundle times clamp to movie zero. Application composition
owns process/resources; sampling, crop decisions and rendering retain their
existing owners. Consumer platform/package acceptance remains required before
this slice merges. The root decoder remains for Record's other real callers.

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
