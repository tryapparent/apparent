# Repository test cleanup campaign

Baseline: `8cd7ce43ffd825ffe7a90fa27b6c7d1806cbe8e9` (origin/main).
Scope: all retained tests, inline native tests, fixtures, mocks and QA scenarios in
this repository; macOS/Linux boundaries remain distinct. No manual releases; the user explicitly
authorized existing automatic CI publication.

`inventory.md` is the initial candidate inventory, assigned once to a production
owner by path. It includes support/configuration/scenario files under test roots
and source candidates matching possible inline test declarations (including regex `.test()` calls). Discovery is deliberately
inclusive, not a claim that each file is a test. Each owner audit must reconcile
its whole source tree, test declarations and runner inputs, including files the
heuristic missed. Baseline line counts include mixed production/test files in
full; they are not a test-line metric. Upstream additions must be reconciled
before marking a lane complete. Pending entries have not been read or run.

Read production, callers and provider contracts before tests. Classify each
assertion/parameter row R (retain), F (fix), C (consolidate into named keeper) or
D (delete with remaining proof or no live contract). Delete uncertain coverage
only after resolving the contract. Track test/support and production deltas
separately; no independent safety contract can fund growth elsewhere. No numeric
test-line allowance was found in checked-in instructions at this baseline; use
no net test/support growth unless a distinct new contract justifies it.

## Owner queue

| Area | State | Next boundary |
| --- | --- | --- |
| Record capture-request | Audited; merged #1400 | Exact-landed Capture CI pending; see checkpoint below |
| Record completion | Audited; merged #1400 | Exact-landed Capture CI pending |
| Record storage | Audited; merged #1400 | [Contracts/evidence](../../../record/storage/enablement/test-audit.md); landed CI pending |
| Record media | Audited; merged #1400; incoming cues retained | [Contracts/evidence](../../../record/media/enablement/test-audit.md); landed CI pending |
| Record transcription | Two headless policy cases read/retained | Worker/native/Desktop consumer audit remains separate |
| Engine SDK | Audited; [PR #1422](https://github.com/tryapparent/apparent/pull/1422) | 13 SDK cases and real Linux package qualification pass; hosted gates pending |
| Engine staged capture-core | Audited; PR #1422 | 21 contract cases retained; worker entrypoints execute through parents; hosted gates pending |
| Engine legacy/native | Export, retention, recovery/publication and selection audited; PRs open | Remaining capture, audio, cursor/ink, rendering and helpers remain pending |
| Desktop | Pending | Settings/onboarding, capture/pill, native adapters, packaging/VM |
| Agent | Narrator, media, setup, context and manual comparison audited; current candidate | [Contracts/evidence](../../../capture/agent/enablement/test-audit.md); preserve incoming range policy/package guards; current hook/delivery pending |
| Connect | Pending | Service/auth/storage, clients/transfers, web, hosting tooling |
| Public | Pending | Site behavior, assets/build/publication contracts |
| Hermes | Pending | Desktop integration, installation/distribution |
| Shared | Hex and analytics read; repairs/owner routing pending | UI/theme, remaining native utilities/handoff still pending |
| Composition | Selected media/Agent-range boundaries read; rest pending | Candidate-count fixture is masked by duplicate IDs; repair separately; preserve real consumers |
| Repository Enablement | Reporting-read merged; CI qualification candidate #1411 | [Contracts/evidence](reporting-read.md); CI duplication follow-up, remaining admission/runners/hooks/timing pending |

Platform/environment prerequisites are not yet assessed for pending areas. An
unrun area is pending, not blocked or complete. No deletion target applies.

## Slice 1: Record capture-request and completion

Production read: capture-request lifecycle; completion reducer and real worker;
Desktop Hermes main/protocol consumer; Record owner README and CI consumer routing.
Baseline: all 19 declarations/parameterized cases pass under Node's real runner.

| File / declarations | Decision and retained regression contract |
| --- | --- |
| capture-request/test/lifecycle.test.ts: one admitted request | R: timeout reconciliation, exact saved path/source, single start and no rerun |
| same: occupied/mismatched admission | F: separate owned-ID/occupied and foreign-ID/no-error controls; foreign/error receipt stops polling/handoff |
| same: native cancellation | R: terminal cancel never hands off |
| same: unusable/unassociated facts, all six rows | F/C: provide start, saved inspection, then malformed handoff; combine loops and demand the handoff error and actual handoff call. Keep empty/relative/control-character/oversize paths and path-like/uppercase remote tokens. Oversize path now otherwise satisfies absolute/suffix rules. |
| same: fixture | D: unused published-view accumulator/accessor and View import; retain ports and call trace |
| completion/test/policy.test.ts: successful publication/receipt, copy failure | R: actual acknowledgement, exact saved artifact, idempotence/no replay |
| same: image warning | R: exact warning, successful save/copy, manual notice coexistence, Linux/current/connected gating and failure exclusion |
| same: finalization failures, both messages | R: no copy/saved result, terminal receipt cannot be overwritten |
| same: dismiss/cancel/revoke, all three | R: preserve facts and suppress pending clipboard replies |
| same: out-of-order/generation/capture/request IDs | R: no cross-capture overwrite; no premature clipboard receipt |
| same: disconnect/reconnect | R: ambiguous copy never replays; disconnected finalization cannot copy |
| same: auto paste and all six exclusions | C: exact singleton copy capability replaces separate first-mode and every-type checks; retain status and platform/consent/source gates |
| completion/test/worker.test.ts: copied/failed/revoked | R: real subprocess JSON exchange and exit, receipt/current-state semantics; independent transport boundary |
| same: EOF, failed finalizer | R: preserve initial saved facts on worker failure; failed publication requests no capability |

Test/support delta: 0 lines (16 added, 16 removed), no new declarations,
fixtures, mocks or production changes. This is a small first slice, not campaign
completion. Keep native clipboard, Electron and cross-language boundary tests for
their later owner audits; these headless tests do not replace them.

Sensitivity: removing both lifecycle handoff validators passed the original
four tests (false green), then failed the repaired malformed-handoff case with
an unexpected saved result. Path and remote validators disabled independently each fail the repaired test. A duplicate auto-paste capability fails the consolidated assertion. Production source was restored byte-for-byte.
Focused candidate: 19/19 pass. Disposable logs and probe are under
`/tmp/apparent-dev-test-audit-OzLAH1/`; regenerate after cleanup.
Independent preservation review found no lost guards; its combined admission-control finding is repaired above. Initial c02f57337 checkpoint hook passed: 332 Desktop unit/contract passes with one skip, 59 Electron
passes, 1,066 native passes with 18 ignored. [PR #1400](https://github.com/tryapparent/apparent/pull/1400)
contains the combined Record audit; its latest hook, hosted and exact-main CI
gates remain under this owner.

## Slice 2: Record Storage

[Owner ledger](../../../record/storage/enablement/test-audit.md) records all six
files and retained behavior contracts. One duplicate direct validator declaration
is consolidated into the policy keeper; the malformed saved-path case now reaches
its length contract. Test/support delta: -3 lines, 49 → 48 declarations.
Independent review found a nullable/unknown-field combination that must remain;
it is preserved and its shortcut mutant fails. Locked owner install, typecheck
and all 48 tests pass. No production changes. Hook/PR and exact-main gates remain.

## Slice 3: Record media phone cadence

[Owner ledger](../../../record/media/enablement/test-audit.md) records the retained
headless contracts and the separate native/package boundaries. Consolidating
count/end-point and implementation-mirroring cadence assertions into an exact
sequence oracle removes one test line. All 21 headless tests pass; six independent
mutants fail the cadence keeper. Preservation review found no lost guard.
The native suite and all four CLI package checks are read and retained. The full
Linux development-CLI proof passed, including nested Storage dry-run cases.
Removing a redundant transcript-fixture manifest write removes one further
support line (Media total -2). This is development composition, not sealed package
or Mac proof. Hook/PR and exact-main gates remain.

Deliver the combined Record slices through PR #1400, verify exact-main CI, then
continue the remaining owner audits. Update this
ledger and inventory statuses with each landed slice; do not stop after slice 1.

All three Record slices share one bounded owner PR. Combined test/support delta:
-5 lines and one duplicate declaration removed; production delta zero. Per-slice
reviews, negative controls and development-composition evidence remain above.

## Reporting-read prerequisite repair

The combined Record hook exposed a 110-byte fixture socket path under a valid
long `TMPDIR`: Node bound the truncated `capture.so`, then chmod failed before
transport verification. [Audit/evidence](reporting-read.md) records the short
private fixture repair and removal of unreachable set/click mocks/counters.
All 21 cases pass; independent review and three negative controls preserve the
read-only/deadline contracts. Net -5 further support lines, no new declarations;
combined campaign candidate is -10 test/support lines and zero production changes.
Normal hook/PR and exact-main gates remain pending.

## Current-main completion reconciliation

Main `eae9408abba4` changes the opt-in completion capability to
`autoPasteAndSubmit` and adds stopped/failure/no-replay assertions. Read the new
Record policy and Desktop transport/native consumers before resolving the test
conflict. Keep the exact singleton effect with the new mode and every upstream
status/notification/replay and platform/source exclusion check. No production
code is changed by the campaign. Refresh the duplicate-effect sensitivity and
normal combined-tree hook/hosted checks; the prior head
`d302cc07cef4af2c49994b174a4c8640f90632d7` passed its hosted checks before main moved.

## Copied-native probe cache repair

The reconciled push at `3bfb2b14b` was rejected: 1,061 native cases passed and five
Connect guards failed. A copied-source context probe had incorrectly shared this
worktree's Cargo target. The reused Connect dependency baked in that temporary
`CARGO_MANIFEST_DIR`, hiding its TypeScript package; the same failed lookup also
removed pointer/presentation results. The `.d` metadata identifies the wrong path.
Invalidating only `apparent-connect-client`, rebuilding in the actual worktree
and checking the corrected metadata restores all eight selected sharing/pointer/
inspect cases. No Connect production code or assertion changed. Copied-source
probe recipes now use a private target; never share path-baked local artifacts
with the delivery checkout. Preserve the rejected-hook log at the existing private
audit job and rerun the complete normal hook before publishing.

## Delivery and upstream checkpoint: main `3a60e5bbe`

[PR #1400](https://github.com/tryapparent/apparent/pull/1400) merged as
`3a60e5bbe6231cb346e5d165f86d0f21e3eee707`. Its actual merge tree matches the
preflight against main `7eb349abb`, and all 13 owned blobs match reviewed head
`984226d209`. Record capture-request, completion, storage/media and reporting-read
changes are merged; their exact-landed delivery is **not complete** yet.
Connect, Hermes and Public workflows passed at that SHA. Capture run
`44058510174` has a pre-test Ubuntu package-transport failure and pending platform
work. GitHub declined its failed-job rerun while the run remained active. Retain
the failure and complete that exact run/retry; a green PR is not landed CI proof.

Open independently reviewed slices, each with its own ledger and mandatory hook:

| PR | Audited boundary / retained proof | Remaining gate |
|---|---|---|
| [#1408](https://github.com/tryapparent/apparent/pull/1408) | Export; 40 retained cases, crop/layer/audio controls; -43 support lines | Hosted Mac/native and exact-landed CI |
| [#1409](https://github.com/tryapparent/apparent/pull/1409) | Retention; all 19 declarations retained, owned fixtures and unmasked refusals; -19 support lines | Mac tests passed, artifact upload failed; accepted bounded job rerun and remaining gates |
| [#1411](https://github.com/tryapparent/apparent/pull/1411) | CI qualification; +11 support lines buy actual discovery/missing-owner/product guards instead of a command-shape replay; independent no-flags guard retained | Hosted Mac and exact-landed CI |
| [#1419](https://github.com/tryapparent/apparent/pull/1419) | Recovery/publication; 53→50 cases, real rollback/cleanup keepers; -68 support and -50 dead native/import lines | Hosted Mac/native and exact-landed CI |
| [#1420](https://github.com/tryapparent/apparent/pull/1420) | Keyframes; 25→24 cases, native mechanics versus real text/cue composition; -10 support lines, actual worker execs 45→27 | Hosted Mac/native and exact-landed CI |
| [#1422](https://github.com/tryapparent/apparent/pull/1422) | SDK/staged-core; 13 SDK +21 contract cases, two helpers explicitly launched; -16 support lines | Pre-test hosted Ubuntu transport failure, Mac and exact-landed CI |

The Agent candidate ports only its owner changes onto this main: narrator/frame
oracles, archive/setup keeper, context scene guard and the TypeScript manual
comparison. It removes nine executable-test/support lines and 30 manual-tool
lines, one declaration and one duplicate suite invocation. Its owner ledger
records prior evidence; fresh current-main hook/composition and delivery remain.

Incoming contracts are not campaign-added coverage. Record's three speech-cue
cases and native validated-plan/schema/assembly/package boundaries remain;
all 24 headless media cases passed current hooks. Agent's four new range-policy
cases, exact-u64 worker/schema, default cadence, saved-frame margins and packaged
FFmpeg/native fallbacks remain intact. Eight Agent headless cases passed the
current baseline. Record transcription's two opt-in/Unicode policy cases were
read and retained; native model/Metal and Desktop integration stay separate.
The inventory adds these previously unlisted files without changing historical
baseline counts or declaring their entire parent owners complete.

Read-only follow-ups: Hex's permanent-refusal retry assertion and HTTP fixture
thread lifetime need repair; its other contracts remain. Both analytics config
cases are retained; move their execution from Public to the actual Connect
consumer before removing the old invocation. Bare Bun CI paths execute six
Connect cases twice; a real canary probe shows explicit `./` owner paths run
each once. Preserve independent owner invocations, no-flags and product exclusion.
Reconcile concurrent CI PR #1421 and qualification PR #1411 before editing that
boundary. These are pending repairs, not delivered deletion claims.
