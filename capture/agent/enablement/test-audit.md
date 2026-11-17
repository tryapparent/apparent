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

Copied frame policy sensitivity: sort caller times before conversion. All four
old cases pass; the independently constructed fixture fails the backward case.
Restore the owner and all four repaired cases pass. Checkout production was never
mutated. Probe sources and disposable logs are under
`/tmp/apparent-dev-engine-audit-0H13BY/` and may need regeneration.

Candidate: narrator TS 3/3, Python 15/15, Rust DSP 4/4 and worker protocol 4/4;
Agent frame policy 4/4, typecheck/build and published-provider native 4/4 pass.
The real CLI composition script also passes direct installed Node hosting, both
zoom paths, 51-frame fallback, stale-output/unrelated-file and source/temporary
checks. It uses the existing development CLI/private asset view from the Record
package audit, with unchanged product inputs; this is not a sealed release or
macOS delivery proof. No release or inference-model download was performed.

Additional copied-crate probe replaces strict UTF-8 reading with lossy decoding.
The old test passes, the input/diagnostic keeper fails the intended assertion, and
the restored owner passes. Each exact filter ran one test.

Independent preservation review found no lost checks and caught the overstated
UTF-8 claim; the consolidated diagnostic rows and sensitivity probe above resolve
that small finding. Review did not execute tests; the primary owner ran all checks.
Hook/hosted, macOS and exact-main delivery gates remain. Other Agent areas remain
pending; unchanged native app context/zoom cases have been read separately.

## Hermes setup

Read the entire setup policy, native composition transport, actual distribution
writer and owner guidance before all three setup test files. Keep synthetic
provider policy separate from real subprocess/environment, archive and native
LaunchServices boundaries. No settings, registration or capture policy changes.

C/D: retire `explicit package uses only the package writer...`. Its directory
fixture is not an archive and has no digest, so both repair attempts stop before
the writer mock. Move its useful passive-mode, zero-write, failed-repair and
not-ready assertions to `verified archive gates setup writes...`, using the real
archive already accepted by that keeper. Keep the direct checksum diagnostic,
profile/installer argv, snapshot bytes/cleanup and archive-symlink refusal.
The keeper now also executes an actual *provider refusal* through public setup,
retaining the writer count and failed-attempt snapshot cleanup. Previously the
supposed writer-failure case only exercised archive verification failure.
This is a newly effective error-result contract, not a new declaration or mock
layer. One existing real-writer boundary stub now covers both outcomes.

| Setup declarations / distinct parameter groups | Decision and credible regression |
| --- | --- |
| Empty/partial install and broken executable link | R: installed files become loaded/readiness facts, missing differs from unknown, passive diagnosis mutates |
| Verified archive keeper | C/F/R: checksum/contents admission, passive no-write, verification failure, snapshot/argv/cleanup and writer-refusal disposition |
| Stale MIME entry repair, readback/idempotence and conflicting entry | R: registration repeats, reports success before readback or overwrites a conflict |
| Failed macOS providers/no selected profile | R: unavailable lookup becomes absent or installed/loaded facts are invented |
| Live identities on both platforms: changed/equal revisions, prerelease, absent/control-byte/schema facts | R: running and installed builds falsely match or diagnosis starts/stops/registers |
| Equal unidentified/modified/nonhex/short labels; differing versions | R: unknown source identity becomes a build match; package mismatch is hidden |
| macOS handler absent/unavailable/matching/different/missing/relative targets | R: a registry declaration substitutes for the resolved executable |
| Updater restart, valid identity and four empty/partial identity controls | R: a pending replacement is ready or blank identity fields establish a match |
| Receiver passive checks on both platforms | R: receiving unnecessarily requires Desktop/capture or invokes Hermes during read-only checks |
| Receiver explicit activation, profile scope, readback and idempotence | R: activation leaks to another profile, repeats, widens grants or imports runtime implicitly |
| Receiver failed activation and four malformed metadata controls | R: failed/untrusted activation data enables the plugin or claims readiness |
| Receiver missing package/missing fetch | R: incomplete prerequisites activate |
| Receiver failed/old runtime and 180-second bound | R: runtime failure/unsupported Hermes activates or blocks without the allowed bound |
| Receiver registration gates, successful/failed doctor, unknown session | R: passive/disabled state imports a plugin or doctor establishes a live conversation |
| Receiver missing/relative profile, unsupported platform and incompatible flags | R/F: direct policy/CLI calls bypass explicit profile/platform/consent admission; use an otherwise-valid profile for the platform veto |
| Real subprocess environment | R: profile override clears unrelated process environment |
| Native-style argv | R: Apparent and Hermes executables are conflated |
| Missing versus failed config; disabled wins | R: failed reads authorize activation or explicit disablement is overridden |
| Real subprocess missing-key/failure/timeout | R: provider transport cannot distinguish documented absence and failure |
| Hosted-Mac synthetic LaunchServices scheme | R: actual selected executable/absence disagrees with policy; signature, registration status, mismatch, account gate and cleanup remain distinct |

Baseline: 20 pass, one native Mac skip on Linux. Candidate: 19 pass, the same skip;
one declaration removed, 11 support lines removed. Native policy mocks do not
establish LaunchServices behavior; the unchanged synthetic OS case still runs in
the existing disposable hosted-Mac root lane. No local Mac spending was used.

Copied policy sensitivity: misreport a refused package writer as applied. All old
setup cases pass; the consolidated keeper fails applied-versus-failed. Removing
the passive install gate also fails the keeper using a valid archive. Restored
control passes all 19 Linux cases with the native skip. Source in the checkout
was never mutated. Logs: `setup-*-mutant.log`, `setup-fixed-control.log` under the
same disposable job. Fresh checkout checks pass: 19 setup cases and the same native Mac skip.
Independent preservation review found no lost assertion or parameter row in the
setup/context cutover. Hosted and exact-main gates remain.

The receiver case's title promised supported-platform admission without reaching
that guard. One added assertion calls the real policy API with a valid profile
and an unsupported platform. This is a distinct admission contract, not a new
declaration or replacement suite. Removing only the policy platform guard passes
the previous case and fails the keeper with the intended missing exception;
restoring it passes. All 19 setup cases pass with the same hosted-Mac skip.
Disposable `receiver-platform-*.log` records the copied-policy controls.

## Semantic context and zoom

Read all production context/zoom functions, mark/event/summary producers and the
real inspect/zoom consumers before judging the 13 Linux declarations. Baseline
all 13 pass in the Record current-base hook; product inputs remain unchanged.

F: make the click-frame row use a full-screen changed box. Previously its small
box independently prevented the label, masking removal of the scene-change-only
guard. Retain the separate small-region scene-change row and positive full-screen
scene-change row. No new line or declaration.

| Native Agent declarations | Decision and credible regression |
| --- | --- |
| Multiline notes with subsequent speech/click | R: note text swallows later speech/events or clause snapping moves a note's actual timestamp |
| Shared-frame marks and speech clauses | R: numbering/order/word ownership drifts or speech duplicates on the head |
| Mark number/ID lookup, ambiguous frame and unnumbered mark | R: inspect/zoom selects another mark, hides ambiguity or disagrees with JSON/text identity |
| Shortcuts, short/long/repeated drags and windows | R: jitter/repeats create noise or private titles/overlays/coordinates escape |
| Full/small scene-change and full click | F/R: whole-screen label appears on an ineligible frame or unnamed small regions gain invented labels |
| Named/unnamed marks/clicks/scrubs/point | R: semantic names disappear, scrub noise duplicates or unnamed positions become prose |
| No word timing | R: full speech is lost or spuriously split |
| Real summary experiment off/on | R: summary integration ignores consent/formatting despite formatter-unit success |
| Repeated clicks and owning click frame | R: events duplicate or move to the wrong keyframe |
| Linux unavailable/empty roles, named element and touch | R: required unavailable-element explanation hides real names or incorrectly labels touch |
| Phrase/time/no-match zoom lookup | R: timing/normalization changes the selected moment |
| Zoom quarter-before/start/end, sampling endpoints and clock | R: look-back/post-roll, bounded extraction or printed timestamps drift |
| Mark-centered short/long/start/end zoom windows | R: the requested ink interval is clipped or assigned an ordinary moment window |

Copied real-app sensitivity with the scene-change guard disabled: the original
small-click fixture passes, the full-click keeper fails its intended assertion,
and the restored candidate passes all 13. All Cargo filters were checked. Only
the disposable source archive was mutated; cached build dependencies were reused,
so this is native behavior proof, not clean-build independence or GUI acceptance.
That probe incorrectly shared the delivery target and left a Connect dependency
with a temporary manifest path. The subsequent hook rejected five Connect cases.
Invalidating that package's cache, rebuilding from the real checkout and running
all eight affected Connect controls repaired the cache; the complete Record hook
then passed at `79e00b994`. No Connect guard was changed. The probe recipe now uses
a private target; copied-source probes must never reuse the delivery target.

Fresh checkout context/zoom checks also pass all 13, following the copied-app
controls. The documented `scripts/agent-eval.sh` manual before/after scenario is retained
for its separate visual comparison purpose. Its repository-root lookup is broken
and its historical default capture IDs/output paths are not portable fixtures.
Its manual purpose is preserved by the completed cutover below; it is
not an obsolete regression guard to delete. No real private captures were opened.
Combined Agent test/support delta so far: -9 lines (narrator/frame +2, setup -11,
context 0). Production delta remains zero. Other delivery gates remain above.

## Manual context comparison cutover

C/F: replace the documented Bash `scripts/agent-eval.sh` with the Agent-owned
TypeScript entrypoint `enablement/context-comparison.ts` and move its operating
instructions beside it. Update both real documentation references; no wrapper or
second implementation remains. The old script resolves the repository root to
`capture/`, so a valid built CLI at `target/debug/apparent` is never found. A
controlled old invocation fails that exact gate before comparing anything.

Retain the manual scenario's independent purpose: reprocess twice for each run's
actual images, derive both summaries from the baseline transcript, rewrite paths
to the original bundle, preserve recorded context and assemble an inspectable
index. The second image run cannot be deleted merely because `agentContext` is
currently a text experiment; this scenario also accepts visual experiments.
Remove the personal default capture-ID list and home-artifact destination.
Require explicit inputs and use a private, canonical temporary job by default.
Preserve unrelated config in a private baseline copy; remove only experiments.
Literal argv/path replacement handles spaces, pipes and dollar signs. Fresh
output outside sources is required. Failed comparisons stay visible in the index
and return nonzero without retries; other explicit inputs may complete. Cleanup
removes only this job's intermediate bundles/config, retaining disposable reports
and private CLI logs. CLI stdout/stderr stream to private files, retaining large-report behavior
without adding a pipe-buffer cutoff. The binary's actual version is reported instead of assuming
that the current checkout identifies its built executable.

QA support changes from 113 Bash lines to 83 TypeScript lines (-30), with no new
retained test file or package/dependency. Removing unused private fixture defaults
does not remove access to those cases: a human can explicitly supply their bundles.
No real private capture was read, moved or deleted by this campaign.

Evidence: rebuilt the actual development CLI, generated a demo through its real
producer, and added matching-duration synthetic video. The first controlled
attempt correctly failed native publication because FFmpeg's file mode was too
open; fixing the input to the producer's 0600 contract made the full scenario
pass. Native safety code and tests were not weakened. Both summaries/contact
sheets were inspected: marks/numbering survive, the experiment changes semantic
text, paths refer to the original input and all source/config bytes are preserved.
Existing output is refused without overwrite; missing inputs never select personal
captures. This is Linux development composition, not sealed-package, audio
inference, live-capture or native-Mac proof.

A controlled external CLI using real producer PNGs additionally varies each
reprocess's transcript. Both resulting summaries must use the first transcript;
a wrong-inspect-source control fails that same artifact oracle. Exact argv,
two reprocesses/one inspect, experiment removal/unrelated-config preservation,
owned cleanup and nonzero/no-retry child failure are checked. These protocol
controls supplement rather than replace the real native run. Disposable recipes,
logs and identity receipts are under the existing private audit job.

Independent manual cutover preservation review found no lost contract or unsafe
cleanup/config/source mutation. It reviewed the complete new files and supplied
real/protocol evidence without rerunning checks. Normal hook/hosted/exact-main
gates remain; no macOS, sealed-package or live-capture acceptance is claimed.
Current Agent total: -9 executable-test/support lines and -30 manual QA-tool lines
(-39 combined), one declaration and one duplicate suite invocation removed. App
product code is unchanged; the QA tooling implementation is migrated and repaired.
Incoming main `559f1433c241` changes only unrelated Settings CSS/smokes; all Agent,
Record, Engine, composition/shared and native manifest/build inputs match the
pre-rebase proof. Required combined-tree hook/CI still runs before publication.

## Current-main and range-policy reconciliation

The 13-path contextual port applies without conflicts on main `3a60e5bbe`.
Every changed Agent source/support byte initially matches reviewed `89cb5bc35`;
only this ledger is updated. Contextual documentation hunks preserve incoming
Record speech-cue guidance instead of copying an old complete document. No
Record ancestor history or obsolete central-ledger snapshot is imported.

Read incoming Agent range policy/worker, actual native composition and all
package/range cases before reconciliation. Retain all four new headless cases:
omitted/explicit rate and saved-frame margins; zero/full-u64 saturation; invalid
range/rate refusal; and the real worker's exact clocks, bounded policy errors and
redacted malformed-input disposition. Keep the separate native version/identity
decoder and actual packaged CLI checks: default cadence on FFmpeg and native
routes, saved-frame boundaries, unchanged outputs after invalid requests and
complete source/temporary preservation. These are upstream additions, not new
campaign coverage or a reason to discard old pixel/crop/clock guards.

Current baseline hook `294bf049e` passed all eight Agent headless cases (four
original plus four range cases), including the native range schema in the full
app suite. Existing narrator/setup/context faults are reused for identical
owner/candidate bytes with the source identities recorded in the private job.
Fresh current-main checks pass four narrator DSP plus four worker-protocol cases
and all four published-provider Agent native cases. A separate private target
compiled the actual locked narrator dependency; no model/inference substitution.
Source hashes remained unchanged through execution. Ordinary policy/setup/tooling
checks will run through the mandatory hook. Real development CLI composition and
manual comparison follow that hook's executable rebuild, without claiming an
old binary represents the new build. Preservation review/hook/delivery remain.
No existing result is relabeled as new Mac, native capture, model inference,
permission, installed or sealed-package acceptance.

The central inventory now distinguishes audited candidates, merged Record work
and still-pending areas, and includes known upstream tests missing from its
initial inclusive snapshot. Record merged at `3a60e5bbe`, but its exact-landed
Capture CI has a pre-test Ubuntu transport failure and pending platform work;
its three other workflows passed. SDK/staged-core PR #1422 has the same
pre-test hosted transport failure. Both declined rerun requests remain gates;
tests and admission checks are not weakened to clear them.

Current preservation follow-up makes the existing failure contract explicit in
the operating README: retain partial reports/logs, return nonzero, and retry
into a fresh destination. A fresh protocol control confirms the failed index is
preserved, reusing that output refuses before launching another CLI child, and
a fresh-destination retry succeeds without modifying the failed report or source
config. The helper's 83 executable lines are unchanged. Its private
`/tmp/apparent-dev-agent-eval-*` job is the direct-child location required by
the Clanker artifact policy; no public publication or durable retention is added.

Current-main Luna re-review approved the full 15-file candidate with no blocking
security or logic findings, including preserved incoming range consumers/guards.
It verified the frozen base, empty unstaged diff and staged SHA-256
`77dd663b9ad7606b38ab37c1a7b31cd53170f72528eaf0c5ea52a0ef13b11af6`.
It reviewed source and supplied evidence without executing checks. The original
round's report-retention concern is resolved by the explicit existing contract,
README clarification and protocol control above; the helper code is unchanged.
Only this review metadata is appended afterward. Fresh hook/composition and
hosted/exact-landed delivery remain mandatory.

### Executable-retirement admission prerequisite

The first normal push stopped before tests: the selector treated the retired
`scripts/agent-eval.sh` executable deletion as unproven and selected an Engine
producer whose automatic paths do not include that donor. The replacement was
already mapped to its real consumers; no new directory exemption is needed.
`enablement/ci/select.ts` now admits only deletion of that exact executable path
from mode 100755, with the reviewed regular-file replacement blob
`46e38fd8bc49d0cd808c0bc955941397d8143784` present in the candidate. Normal
Agent/native/Mac consumers and workflow filters remain intact. A changed or
missing replacement, symlink, executable modification or neighboring deletion
retains conservative admission. This historical retirement proof matters only
for ranges containing the donor deletion; later replacement edits have ordinary
consumer routing.

One new 40-line routing test is justified by this distinct admission contract:
it exercises committed Git modes/content through both actual local and hosted
selectors. It covers the accepted retirement and five unsafe nearby cases.
Removing retirement support fails the accepted case; granting all file changes
proof fails the missing-replacement case. Restoring the source passes all cases.
This is new safety coverage, separate from the -9 test/support consolidation and
-30 manual-QA migration: aggregate test/support is now +31, manual QA -30.
No independent guard was deleted to finance the admission coverage. Application
production remains unchanged; the prerequisite changes CI selection only.
Private receipts: `agent-retirement-{original-red,broad-red,restored-green}.log`.
Broader hook checks, prerequisite delta review and delivery still remain.

Independent read-only Luna review approved this prerequisite at staged diff
SHA-256 `d5784634127fca8b7efde7e23bce05a55b1cece74d14578835ee1a94d561853d`,
HEAD `dd030b5c6a0fb004ea1621f758ff0eb297c3ede2`, with no unstaged delta. It
confirmed the narrow retirement, unsafe controls and separate coverage-cost
justification, without rerunning tests or claiming pending delivery checks.
