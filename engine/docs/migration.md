# Native application / Engine migration

Active goal: complete the owner boundaries below, delivering successive usable
PRs against current main. A verified merge advances this inventory; it does not
finish the migration. Current source baseline:
`0b88a165394006dd158aa998d83ad0dbceaaba22`.

| Boundary | Implemented evidence | Remaining adoption/removal gate |
| --- | --- | --- |
| Engine media metadata | Independently published native reader and compiled SDK; Record export, ingestion, recovery and retention observations consume checksum-pinned artifacts. #1284/#1286/#1288 passed Mac/Linux CI and Linux package delivery; #1288 exact main is `5f4be8bc93bca2df9d0d6c9223fddf88d4d8b86e`. Replaced Desktop probes are removed. | Keep the pinned provider and package compatibility gates when adding capabilities. |
| Engine capture and lifecycle | Root runtime owns actual capture, permissions, resource cleanup and durability. The separate `capture/engine` admission/lease crate has package proof, no production consumers. | Adopt one authoritative native capture/admission contract through live callers; align locks, receipts, cancellation, recovery and maintenance before retiring donors. |
| Engine media operations | #1299 landed explicit-time frames at `6c65748d4f2d32fd2dc8b966685e7e0ba33f9794`; successor `5bbe8e35e67b61703737991575860d4b1fd1ad57` requalified SDK/all four native architectures and published immutable SDK 0.2/frame artifacts. Root transcription, audio, encoders and remaining image mechanisms are authoritative. | Adopt frame capability through real consumers, then continue remaining capabilities with native/plugin/model inputs and package proof. |
| Record workflow | Headless completion, storage controllers and export metadata policy have real consumers. | Capture-to-handoff assembly, recovery decisions, preferences/defaults, retention planning, keyframe/transcript assembly and remaining export policy still cross Rust owners. |
| Desktop | Accepted React Settings, onboarding and recording controls coexist with native shell/legacy fallback paths. | Complete actual Electron workflows and shell/platform integration, then remove replaced Rust policy/UI and its build closure. Preserve one durable config writer until its accepted replacement. |
| Agent | #1305 landed zoom's published Engine frame adoption at `ceaf6fdd2dc67e90215154dc96a1282f42254753`; #1308 corrected the AppImage cache cleanup proof at `91fa763dc5039920806d949192fc2cdafc23f029`. Both full/cropped real callers use the SDK; #1308 exact-main AppImages and publication passed. | Qualify the range-fallback adoption below, then migrate remaining CLI composition. Whole-Agent independence is not established. |
| Connect / Public | Public and hosted web/service loops are TypeScript. Connect has compiled TypeScript crypto, listing/foreground/MCP consumers alongside authoritative Rust transfer/identity/queue code. | Finish native Connect caller/persistence adoption and remove repo-owned Rust from Connect build/release inputs. Preserve encryption, consent, cancellation, retry and publication semantics. |
| Composition / Shared / Enablement | One canonical hook/CI selector; independent Engine producer routing; existing app staging embeds explicit capability artifacts. | Remove obsolete source/build/package edges as consumers qualify. Shared must not absorb displaced policy. Prove each independence claim without Rust tools/cached native output. |

## Adopted: Record explicit keyframes

The bounded native `movie-frames/1` capability and SDK are published. Agent zoom
uses them through its own worker. #1309 merged Record adoption at
`5893f3607d01080fea8a5006c9396799209f30cd`. It routes capture predecode,
full-keyframe assembly and screen recovery/reprocessing through its separate
`record/media/frames-worker`. Record's TypeScript mapping preserves bundle-clock
identity when several requests clamp to movie zero. Application composition
shares finite-process/private-pixel mechanisms without importing product owners.
Four-frame resource batches respect the provider's maximum pixel budget.

Recovery's explicit-frame injection and real callers move together; periodic
sampling remains separate. Phone periodic frame paths, selection,
caching and rendering remain native debt. Do not remove these
donors until their remaining consumers are adopted. Record's metadata policy is
unchanged while its provider/SDK pin moves from 0.1 to the published 0.2 generation.
No persistence schema or configuration writer changes.

## Adopted: Agent native range fallback

Merged #1311 at `8f398bee6bea8e1c50d6de09e9ada5da145c7132`.
When FFmpeg is unavailable, the real `apparent frames` caller uses Agent's
published-SDK worker. The final root `movie_frames_at` bundle-clock wrapper is
removed; periodic/phone native decoders remain. Range/FPS policy, preferred
FFmpeg execution, PNG writing and existing-keyframe fallback stay authoritative
in the root CLI. This does not establish whole-Agent build independence.

Native composition sizes jobs from observed pixels within published limits and
backs off only on typed resource failures, preserving cleanup before retry.
Linux staged-CLI proof exercises 51 frames, decoded pixels, repeated lower-FPS
extraction, unrelated-file preservation and unchanged source bytes. Mac and
actual Linux AppImage proof remain delivery gates for this slice. Rollback
reverts the routing, wrapper removal and worker-status contract together; no
provider pin, package layout, config writer or persistence format changes.

## Adopted: phone/file explicit frames

Merged #1312 at `6d89b149fbd6257ef2a78a5b6ecb83ab4479c7cb`;
exact-main delivery remains its acceptance gate.

Phone/file assembly's dense-mark fast path and selected full-frame callback now
consume Record's existing frame worker with movie-clock requests (zero offset)
and the unchanged 1600px edge. Periodic sampling, audio/transcription, mark
selection, assembly policy and device capture remain on their existing paths.
No provider publication or packaging-layout change is needed. Remove neither
the old periodic decoder nor its native build inputs while they have callers.

Real file-reprocessing proof must cover ordinary selection and a full flag
budget, timestamps, mark associations, decoded pixels and source preservation.
Signed Mac and both Linux AppImage checks remain gates, separate from live
physical-device proof. Rollback restores the two explicit native caller routes;
there is no persistence migration or second configuration writer.

## Published prerequisite: bounded Engine candidate batches

Merged #1313 at `2d4686185850037424e86bb7ec34496a549d328d`; exact-main
SDK/four-platform qualification and immutable 0.3 publication passed. #1312's
exact-main Mac/Linux checks, both AppImages and preview publication also passed.

SDK/native 0.3 raises the explicit request count from 48 to 480, retaining the
same per-frame/total pixel limits, private files, deadline and cancellation.
The named consumer is periodic phone/screen candidate assembly. Producer
publication alone leaves installed pins unchanged and adopts no caller; the
Record phone slice below owns cadence, actual-time interpretation and adjacent
duplicate selection. No root runtime or package inputs are removed.

Qualification exercises all 480 indexed replies through the packed SDK and
extracted native artifact, including actual timestamps, duplicates, tail clamps,
pixels and source preservation, plus direct 481-request refusal. Both Linux and
Mac architectures remain publication gates. A usable adopted periodic workflow,
latency comparison and package proof must follow publication before donor removal;
package qualification alone is not completed owner independence.

## Adopted: Record phone periodic adoption

Merged #1314 at `71b0d7423087a7daebabae877a3785fbc4cf53ad`;
its product platform suites passed, but main admission incorrectly required an
unselected portable suite. #1315 repaired the shared-native plan at
`d81e8eed8a5dfa818cefbbbc32896b5c10d96478`; successor-main CI and package
publication are the acceptance checkpoint. Its Capture platform checks, both
AppImages and preview publication passed; separate Connect hosted publication
failed before activation. The old failed admission run remains historical.

Record pins the published 0.3 generation and owns phone candidate cadence,
320px scale and actual-time deduplication in TypeScript. Its real phone/file
assembly caller no longer computes cadence or calls the native periodic reader.
The approximate legacy budget can exceed 480; multiple jobs preserve all times,
one overall deadline and cross-job deduplication. A held native directory
descriptor and existing finite-worker mechanisms verify final private pixels.

Linux/Mac now use the same published sample-selection/floor-time contract;
legacy Mac nearby-frame tolerance is deliberately removed. Real sparse-file
native proof and ordinary/flag-filled package scenarios qualify the new route;
live device/permission behavior remains separate. Screen periodic assembly,
audio/transcription, selection, rendering, lifecycle, UI and root build closure
remain debt. No shared decoder/build input is removed while those callers remain.
Rollback restores the phone route, generated-worker inventory and consumer pin
together; no config writer or persistence schema changes.

## Adopted: Record screen file sampling

#1316 merged at `a7bd8461a3c32d3e1e0f81c842070404a37d6b7e`; its Mac/Linux
platform checks, both AppImages and preview publication passed. Qualification
then found a real transport gap: a two-minute moving movie's 480-frame reply was
52,728 bytes, exceeding the shared metadata helper's 32 KiB output cap.
The bounded repair gives frame replies 128 KiB while retaining metadata's 32 KiB,
the overall deadline and private-pixel admission. Full phone/screen pages and a
real packaged CLI benchmark now cover this boundary. Keep donor retirement and
further diagnostic adoption behind the repair's platform/package acceptance;
restoring the smaller cap alone would reintroduce the failure with these callers.
#1320 merged the repair at `511fa5cabe0f61e9d951c202e648bfe40dbbe39f`;
its exact-main Mac/Linux checks, both full-page AppImages and publication passed.

Recovery/reprocessing and its capture benchmark now consume Record's paged
TypeScript sampling workflow. Record owns 220ms cadence, the existing 640/480px
scales, offsets and actual-time deduplication. Native composition supplies one
overall deadline, bounded page output, cursor/clock admission and private pixel
validation. Each page is cleaned before the next; the legacy total in-memory
candidate vector remains a separate limit/debt. No whole-owner independence or
live-capture sampler migration is claimed.

Injected recovery providers and real callers move together. Native proof covers
a held-frame movie across four pages, including empty continuations. Package
proof covers actual recovery/benchmark callers and offsets; Mac/AppImage gates
remain required. At that checkpoint the legacy reader still served diagnostics
and comparison tests; the adopted diagnostic route and retirement below close
those consumers. Rollback
restores caller routing, injected contract and generated worker inventory; no
pin, config writer or schema changes.

## Adopted: published decoder diagnostics

#1317 merged at `0b88a165394006dd158aa998d83ad0dbceaaba22` after passing
platform CI. Exact-main package delivery remains required before merging the
reader retirement below.

Linux `decoder-check` and the decode half of `encoder-check` use Record's existing
explicit-frame worker with movie time zero and native dimensions. Capture's
encoder still produces the synthetic movie in its native adapter; application
composition checks the published decoder's 160x90 result. AppImage packaging's
existing encoder/decoder gates therefore exercise the same provider used by
real assembly, rather than a second reader. The package proof also runs both
commands and independently validates the H.264 output.

Keep native decoder warnings, live capture, audio, provider pins, generated
inventory and persistence unchanged. The retirement below removes the old reader
and its comparison tests, with merge held for diagnostic package acceptance.
Restore those internal readers before rolling diagnostic routes back to them;
restore the native encoder/decode composition together. This closes a consumer gap; it does not
remove the application's GStreamer or Rust build dependency.

## Published frame contract

Current retirement candidate removes the replaced Linux reader, Mac helper's
`frames` implementation/dispatcher and test-only `FrameTimes` coupling. Recovery
fixtures now supply explicit timestamps; real SDK pixel/offset tests remain.
The native capture sampler, audio extraction, encoder and decoder availability
guards remain. No native framework or root Rust build dependency is removed.
Merge waits for diagnostic exact-main acceptance; retirement then needs its own
Mac/Linux package checks. Reverting this retirement restores the internal reader
surfaces and fixture types together, without changing the published SDK routes.

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
