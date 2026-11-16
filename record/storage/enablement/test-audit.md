# Storage test audit

Baseline: `c02f573379c6aa03d33d18073794b2208910fea8`; Storage sources/tests
are unchanged from campaign baseline `8cd7ce43f`. All six headless owner test files and
their parameter rows were read after their production implementations. Read the
published types/index, policy, location policy/controller/workflow, retention
controller/workflow/planner/worker, build entrypoint, Desktop Storage/Retention
components and transport, Electron workflow adapters, and native retention bridge.

Native config transactions, OS dialogs, resource admission and destructive
cleanup are separate boundaries; their integration tests remain for the owning
Desktop/Engine/Composition audits. A policy/controller test is not GUI, native
permission or deletion acceptance. No flaky timing/retry tax was found in this
headless lane: asynchronous tests use deferred replies, not sleep-based retries.

## Consolidation

C: remove `retention intent accepts only own bounded known fields` from
`test/retention-workflow.test.ts` and its unused helper import. The keeper is
`storage preference schemas fail closed on malformed or unbounded values` in
`test/policy.test.ts`. Move the full stronger matrix there: ordinary positive,
zero/u32-max positive, nullable positive, null/array/negative/fraction/overflow/
missing/extra/inherited-field refusals. The old overflow row is the same value. Both numeric and nullable unknown-field
rows survive: a nullable shortcut can bypass whole-policy validation even when
the numeric unknown-field row still fails closed.

R: keep `invalid policy and operation cannot dispatch a mutation` in the workflow
suite. Unlike the moved helper matrix, it checks the real mutation consumer,
no native write, and preservation of readiness after refusal.

F: the oversized saved-path fixture in `location-policy.test.ts` was relative,
so absoluteness could mask the size contract. Make it absolute while retaining
its 4,097-byte length; the same case must still use the built-in location with
no custom preference. No new test declaration or production seam is added.

## Retained contracts

Each row covers the named declarations and all existing parameter rows. R means
retain; regressions below explain why these executions remain worth their cost.

| File / declaration(s) | Decision and credible regression |
| --- | --- |
| policy: retention defaults, choices and month policy | R: default/preset drift changes cleanup retention and displayed choices |
| policy: partial custom values; malformed stored-policy override | R: absent and explicit null collapse, custom state disappears, or default recovery displays a false value |
| policy: storage preference schemas | C keeper: malformed stored fields or save intent crosses the trust boundary |
| policy: capture-location readback | R: saved/effective location or environment/configured/builtin/fallback meaning is falsely trusted; NUL path passes |
| location-policy: tilde-expanded paths/native availability | R: requested path differs from the native probe, unavailable custom path stops falling back |
| location-policy: environment presence, including empty/relative | R: empty override incorrectly falls through to saved/builtin preferences |
| location-policy: dot segments; root/trailing-slash home | R: normalization changes path identity or displayed home-relative spelling |
| location-policy: absent/null/non-string/invalid saved preferences | R: malformed config becomes a custom path instead of using native-compatible defaults |
| location-policy: byte bounds/NUL/trimming/absolute paths | F/R: invalid chooser or saved input becomes trusted; keep direct chooser and saved-config cases distinct |
| controller: superseded location reads | R: old read overwrites newer location or clears its busy flag |
| controller: chooser cancellation/serialized mutation | R: cancelled chooser discards trusted readback, or concurrent read/reset/change dispatches |
| controller: unknown location outcome | R: a lost write reply automatically permits another mutation before Refresh |
| controller: close during chooser | R: retired consumers receive late updates; does not claim OS chooser cancellation |
| controller: invalid location reply/stale Show failure | R: invalid storage remains trusted or an old OS error replaces fresh facts |
| controller: retention read interpretation | R: raw provider policy is not validated/projected before renderer use |
| controller: retention save bounds/unknown publication | R: wrong preset is written, concurrent writes enter, or unknown outcome permits another write |
| controller: stale usage and superseded measurements | R: pre-save or earlier scans overwrite current-directory usage |
| controller: wrong usage directory/disposal | R: another directory's bytes are shown or retired scans update state |
| controller: close during write | R: disposed renderer starts a new scan or receives completion notifications |
| controller: unknown JavaScript operations | R: runtime callers bypass the TypeScript union and dispatch a mutation |
| location-workflow: fresh revision and normalized intent | R: wrong CAS/path is written or private revision leaks to renderer |
| location-workflow: reset without chooser | R: reset opens the OS picker or carries an unintended set path |
| location-workflow: cancelled/malformed chooser; close during chooser | R: invalid/multiple/relative selections or retired intent publish preferences |
| location-workflow: conflict/unknown/thrown write | R: refusal is hidden, transport failure becomes success, or a write is replayed |
| location-workflow: configured probe and authoritative post-save probe | R: pre/post-write revision or native availability is ignored in effective path readback |
| location-workflow: stale publication and invalid post-save facts | R: retired completion is trusted or published-but-unresolved write is treated as safe to repeat |
| retention-workflow: coalesced reads/projection | R: same-version callers duplicate reads or expose revision/unknown fields |
| retention-workflow: save/reset revision consumption | R: write uses stale revision, reset includes a policy, or intent bypasses read admission |
| retention-workflow: invalid policy/operation | R: invalid request dispatches any write or consumes a good revision |
| retention-workflow: uncertain publication; explicit refusal; read during pending write | R: lost/refused write revives readiness, including through an intervening read, or is replayed |
| retention-workflow: invalid post-publication facts | R: malformed committed result becomes trusted write readback |
| retention-workflow: old/new version reads | R: stale reply replaces the revision used for the next write |
| retention-workflow: invalidated read/mutation; usage invalidation/version | R: stale work resurrects revision, facts or usage after lifetime change |
| retention-workflow: rejected coalesced reads | R: either consumer hangs/rejects or readiness survives a failed read |
| retention-workflow: invalid revision/presence facts | R: malformed native authority grants permission to mutate |
| retention-plan: settling/zero-day/precedence/forever | R: cleanup acts too early, chooses media over bundle disposal, or deletes forever-retained captures |
| retention-plan: periodic/after-capture bitrate | R: premature or wrong-source shrinking, threshold drift, or unwanted cleanup-mode behavior |
| retention-plan: exact unsigned-64 observations | R: rounding/overflow changes shrink eligibility or invalid native counters pass |
| retention-plan: real compiled private-stdin worker | R: wire protocol accepts invalid/oversized/disclosing data or fails to emit the real planner result |

D: one duplicate declaration and its direct helper import. Test/support delta:
8 lines added, 11 removed (-3); no new declarations/fixtures/mocks/production code.
The owner suite goes from 49 to 48 tests without dropping a distinct contract.

## Evidence and remaining gates

Baseline: the prior slice's normal hook passed the six Storage files in the
Desktop 332-pass/one-skip unit run. Candidate locked `npm ci`, `npm run typecheck` and `npm test` passed: 48 tests,
zero failures/skips. The first typecheck attempt lacked owner-local `tsc`;
installing locked dependencies repaired that prerequisite without source edits.

Sensitivity probes use a copied compiled owner package and the actual keeper
tests in `/tmp/apparent-dev-storage-audit-QUWnbN/package`, without modifying the
checkout's production code or outputs. The policy keeper fails each independently
broken behavior: overflow, fractional days, negative days, unknown fields,
inherited fields, rejection of valid nullable policy and nullable shortcuts
that admit unknown fields. Unmutated control passes.
A configured-path truncation mutant passes the original relative-path fixture
but fails the repaired absolute oversized input. Restoring compiled policy makes
the location keeper pass again. The helper and logs are disposable in the same
private job root; regenerate if removed.

Independent preservation review found the nullable/unknown-field preservation
gap described above; that row is restored and the shortcut mutant now fails.
No other lost contract was found. Full owner GREEN is complete. Hook/PR gates and exact-landed CI are still pending. This lane is audited, not yet delivered; it does not mark
the repository-wide campaign complete.

## CLI package boundary

R: `test/package.ts` retains twelve real dry-run cases over copied producer
bundles: recent/default media/default bundle/forever, zero-day settling/minimum,
bundle priority, pinned exclusion, partial defaults, malformed-policy fallback,
unknown-extension compatibility and full-u32 policy. Recursive source/config
byte/mode/size snapshots must remain unchanged. This exercises native exclusions,
config compatibility and the real worker/CLI bridge; rejecting extra mutation
fields in pure policy tests does not replace config-extension compatibility.

Read the actual Clean CLI caller, native policy loader, planner observations and
dry-run return before judging this script. It passed as the nested Storage check
in the media development-CLI composition proof (12 cases, no cleanup executed).
See `../../media/enablement/test-audit.md` for candidate identity and limits;
sealed package and Mac acceptance remain separate delivery gates.
