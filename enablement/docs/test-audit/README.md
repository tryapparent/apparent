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
| Record capture-request | Audited; candidate below | Land and reconcile upstream |
| Record completion | Audited; candidate below | Land and reconcile upstream |
| Record storage | Audited; PR #1400 candidate | [Contracts/evidence](../../../record/storage/enablement/test-audit.md); hook/CI gates pending |
| Record media | Audited; PR #1400 candidate | [Contracts/evidence](../../../record/media/enablement/test-audit.md); delivery gates pending |
| Engine SDK | Pending | Published probe/frame contracts and real provider inputs |
| Engine legacy/native | Pending | Capture, audio, cursor/ink, keyframes/text, exports, recovery |
| Desktop | Pending | Settings/onboarding, capture/pill, native adapters, packaging/VM |
| Agent | Pending | CLI/setup, extraction and media, bundle inspection/proof |
| Connect | Pending | Service/auth/storage, clients/transfers, web, hosting tooling |
| Public | Pending | Site behavior, assets/build/publication contracts |
| Hermes | Pending | Desktop integration, installation/distribution |
| Shared | Pending | UI/theme, analytics, native utilities/handoff |
| Composition | Pending | Real consumer assembly and CLI wiring |
| Repository Enablement | Pending | Selection/admission, runners, hooks, prerequisites, timing |

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
