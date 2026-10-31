# Apparent incremental architecture campaign

Status: strategy/tooling candidate, based on canonical `tryapparent/apparent`
main `6f043ff4ab4f4bdfa7e180c97ef7c37a397ff2ef` (fetched and compared).
During drafting, main advanced to `b06b1e45` through #237 (Linux audio ducking).
Its source/build delta is not included here; this candidate remains based on the
assigned `6f043ff4`. Parent must check combined-tree acceptance against newer main.
**No application migration starts until this strategy PR merges.** The parent
coordinator owns merge and progress updates on main; a worker finishing is not
completion. No deployment, release or unrelated merge is authorized here.

## Target and dependency rules

Optimize for ordinary features and recovery staying with one accountable owner,
not a perfect directory tree. These are ownership targets, not invented packages:

| Owner | Owns | Must not own |
|---|---|---|
| Capture Engine | Recording mechanics and OS adapters; sessions/resources; actual-frame readiness; stop/cancel; processing, bundles and archive safety | Desktop UI, clipboard/paste, onboarding, upload-consent or login policy |
| Capture Desktop | Human GPUI workflow: shortcuts, picker, ink, controls, review, Settings, onboarding and local handoff | A second recorder/finalizer or Connect auth/storage internals |
| Capture Agent | Automation, explicit owned requests, deadlines, cancellation, machine-readable receipts and evidence export | Dependence on a Desktop installation, GPUI event loop or hidden Desktop helper fallback |
| Connect | Authorized client transfer, accounts/devices, service/storage/auth and authenticated browser UI | Calling product's consent or presentation decisions |
| Public | Marketing, explanation, brand and download presentation | Authenticated application implementation or private pitch/capture artifacts |

Desktop and Agent consume supported Engine and Connect contracts. Engine never
imports either product. Connect accepts authorized work; the caller retains
consent/presentation policy. Public may link to Connect, not import its authenticated
implementation. Thin composition assembles owner outputs; it does not absorb policy.
Keep product behavior shared across macOS/Linux. Adapters provide native mechanics
and explicit capabilities. No Windows work, web Desktop migration, new daemon/IPC,
service, database or repository is part of this campaign. Keep GPUI working.

Agent's final target is independently installed recording on clean macOS and Linux
machines where Desktop has **never** been installed. A graphical session and OS
permissions are legitimate prerequisites. A second root binary, GUI remote control,
injected worker, package build or headless `--help` is not that acceptance.

## Authority and supported halfway state

Current main source and merged PR acceptance are implementation authority. This
accepted campaign and AGENTS.md set future scope and verification policy. Subsystem
docs describe existing contracts; reconcile stale statements against source and
later explicit decisions. Historical threads, staging plans and passing old logs
are evidence, not permission to revive their larger scope or claim main adoption.

Main currently remains a Rust binary with GPUI/native dependencies. The Engine
package is real but unconsumed by production. Connect browser entry isolation is
real but `site/` still owns its build/package. Existing GUI automation still requires
the running Desktop app. These are supported migration states, not failures to hide.

Move one authoritative implementation and its tests at a time. Existing paths may
forward **toward** the new owner through direct re-exports or thin adapters; never
maintain two behavioral implementations. New work uses the accepted seam immediately.
Freeze the donor against new responsibilities, allowing bounded bug repairs when
needed. Record each facade's owner, consumers and deletion condition in its slice:
remove it when all supported callers/build inputs/docs have migrated and compatibility
checks pass. Keep only aliases required by an actual external contract. Do not widen
legacy imports to make a new feature easy, or freeze unrelated feature delivery.

Parallel lanes own useful outcomes and their tests/PRs, not arbitrary files. One writer
owns each shared hotspot/module declaration/manifest. Use short-lived main-targeted
PRs, not the #199 umbrella as an integration destination. Branch from a committed
provider only when necessary; integrate accepted prerequisites into main promptly.
No application edits are authorized by this document's unmerged branch.

## Verification policy and executable routing

Mechanical means behavior and runtime/build inputs are preserved, aside from explained
module/import/visibility wiring. Require inverse reconstruction or precise moved-body
comparison, test-ID mapping, import/dependency review, affected macOS/Linux compilation
and focused existing tests. Reuse exact relevant historical evidence after comparing
source and embedded/native/build inputs; name its revision, limits and reason for reuse.
Do not repeat a full suite, review or native session merely because a SHA changed.

A move mixed with a fix is a behavior change. Shared inputs, build/package changes,
security/privacy/consent, recording lifecycle/readiness/stop/cancel, resource ownership,
publication and uncertain impact broaden checks. Use focused regressions plus broad
integration/shared-build checkpoints; batch relevant native proof at material behavior
boundaries. Never credit Linux compilation as Mac/GUI proof, waive a red test, or turn
an unavailable check into green. Keep synthetic media/auth evidence distinct from real
OS capture and live OAuth. Follow AGENTS.md's failure repair and platform safety rules.

This explicitly replaces the old blanket full-suite/native/bundle-inspection demand
for every mechanical move, including old PR checklists. It does not erase actual
unresolved compile/test failures. Reconcile #221/#225 gate descriptions with their
current delta and retained proof before acceptance; do not relabel old native work.

`./.githooks/pre-push` retains clean exact-HEAD, hidden-index and final-tree guards.
`scripts/verification.py` selects from the complete main-merge-base delta, not the last
commit or last push. Missing history, an empty/unknown delta, shared/build/security/
lifecycle paths and selector/hook/CI edits broaden to root plus Engine build/tests.
Document-only changes run hook/selector contracts without Cargo. Engine-test-only
changes build/test Engine without the root app. Rename/delete selection includes
both donor and destination. `.github/workflows/verification.yml` uses the same selector
on PR base/main-before deltas, on macOS and Linux, with no secrets or publication.
Existing website/Connect, updater and release workflows remain intact.

The initial selector intentionally does not guess that arbitrary Rust code is
mechanical or claim that future packages already exist. Unknown/new owners safely
broaden. Add reviewed focused rules with deterministic tests when a slice's closure
is known; do not use flags, labels, commit messages or hook bypasses as proof. The
current conservative fallback may still run a broad suite for an unrecognized move.
This is a small routing script, not a new verification framework or native harness.

On Clanker run all new heavy builds/tests and hook-backed pushes once through
`/home/simon/.local/bin/t3-build`; never nest it. Lightweight selector/shell fixtures
may run directly. Keep full logs and receipts outside git. Commit coherent checkpoints
before long verification, then finish the commands and PR publication yourself.
After 30 minutes without a credible path, preserve/checkpoint, record blocker and
resume condition, and take the next independent step. Do not start an infrastructure
project to unstick a move. Coordinator checks disk every two hours; at 90% or higher,
clean only verified idle regenerable artifacts, never active work or retained proof.

## Completed on actual main (bounded acceptance)

Checked boxes below certify only the named merged slice, not the complete target.
PR links use the canonical repository; main ancestry was checked at the pinned base.

- [x] **Staged Engine admission/lease package** — [#220](https://github.com/tryapparent/apparent/pull/220), merge `77dd5bbf`. Independent package/process contract accepted; 22 package tests and retained source-identical Mac package evidence. Root combined Linux evidence reported 668 passed/3 ignored with #222. No production recorder, finalizer or retention caller consumes Engine; no native capture acceptance is implied. See `capture/engine/README.md`.
- [x] **Connect entry isolation** — [#222](https://github.com/tryapparent/apparent/pull/222), merge `d21115b5`. Canonical/legacy routes, built dependency closure and synthetic packaged/dev/preview auth/consent/browser checks retained. `site/` still owns build/package/publisher; no independent Connect package or live OAuth claim. See `docs/hosted-web.md`.
- [x] **Recording versus Desktop completion seam** — [#233](https://github.com/tryapparent/apparent/pull/233), implementation `b6c3fd39478c357f6f79b3a5d6e2199bb02707c1`, merge `92b76040`. Linux UI selection 51 passed; full suite 668 passed/3 ignored; build and independent source review passed. Native/GUI/E2E intentionally omitted, not claimed. `src/ui/recording_completion.rs` still uses the crate-root finalizer; whiteboard and GPUI coupling remain. No Engine adoption or standalone Agent.

## Ordered remaining checklist

An unchecked box stays unchecked until implementation is merged **and** the stated
acceptance is met. Record merged PR, tested revision, reused/fresh results and remaining
limits in the same PR where possible. The strategy itself remains pending on this
branch; main presence plus passing strategy acceptance is its completion condition.

- [ ] **1. Strategy and verification tooling (this PR).** Depends on no application change. Accept: this file/AGENTS agree; real hook/CI routing and deterministic fixtures pass; broad fallback and exact-tree guards preserved; main-targeted draft read back and parent merges after required checks. Excludes app code, deployment, release and fabricated native proof.
- [ ] **2a. Reuse config #221.** After 1. Reconcile head `1ea0d146` against current main and original reviewed blobs; integrate the existing storage/test extraction, not another implementation. Accept inverse reconstruction, preserved config/unknown keys/secrets and queue→config contract, affected compile and handoff/hosted-config/Settings tests. Reuse retained full results where inputs match. Excludes consent/schema changes, second preference store and unnecessary native replay.
- [ ] **2b. Reuse recorder #225.** After 1 and 2a; head `28d83f3d` already contains #221. Accept preserved recorder bodies/test mapping/re-exports, affected compilation and recorder tests; inspect exact candidate difference rather than importing unrelated history. Excludes Engine adoption, native adapter changes and duplicate #204 extraction. #233 is already complete; do not redo it.
- [ ] **3. Common bundle processing out of main.rs.** After 1; serialize `src/main.rs` ownership, preferably after 2 to avoid wiring collisions. Move current main lines 661–1488 into `src/bundle_processing.rs` with the ten existing artifact tests and direct root re-exports. Recheck ranges/symbols on the actual base. Accept reconstruction, call-site/import review, affected compilation/tests and synthetic manifest/summary/image equivalence when relevant. Demo stays root. Reuse byte-identical production evidence from #201, not its whole donor diff. Excludes publication fixes, UI/completion edits, format changes and Engine packaging.
- [ ] **4. Useful Desktop coordination seams.** After 3 and the already-merged #233. Extract only cohesive human workflow/presentation state needed by upcoming work; keep exact request receipts before stale-UI guards, current consent before Connect admission, feedback local and clipboard/onboarding in Desktop. Accept focused completion/cancel/stale-result tests, source preservation for moves and compile. Excludes a wholesale #208 split, empty folder taxonomy, renderer replacement and relocating active picker/ink owners' code.
- [ ] **5a. Independent Connect client.** After 1/2a and active #191 handoff. Own client manifest and fresh config-provider reads/transactions, preserving queue→config lock order, grant generations, revocation and local fallback. Accept independent build without GPUI/native build inputs and existing synthetic transfer/auth/consent/fetch tests plus failure/disable races. A protocol leaf is optional preparation, not client independence; avoid it if a coordinated full-package slice is feasible. No auth/renewal redesign in the mechanical extraction.
- [ ] **5b. Additive Connect browser package.** Independent of Capture after 1; `connect/web/**` only. #200's four behavior source files are reported byte-identical to pinned main; port relevant package work, not an umbrella. Accept source/route/auth/consent preservation, compile/artifact closure and privacy checks appropriate to build delta. Preserve shared Bun 1.3.10 pin unless a demonstrated need justifies a separate change; staging's 1.4.4 is not authority. This supported temporary staging is not completed production build separation.
- [ ] **5c. Adopt browser package and remove donors.** After 5b and active Pages owner's clearance. Sole publisher composes independent output while preserving accepted homepage overlay, canonical/legacy routes and query/auth/origin contracts. Accept synthetic route/consent checks, built graph separation, allowlist/privacy/collision rejection and packaging behavior. Delete old authenticated implementation only after production composition consumes the new one. Excludes publisher replacement, deploy, private pitch publication and route redesign.
- [ ] **6. Checked publication correctness.** After 3; separate behavior PR from moves. Use #210 (successor of #209) as evidence for `coordinate`/`publish_after`/`checked`, porting only dependency-complete work. Whiteboard mutation **and fallback** remain inside the outer publication closure through validation and terminal effects. Accept failed writes/media/cleanup never produce Saved, durability/identity checks, pending transcript/recovery writer coordination and synthetic MP4/MOV plus relevant batched platform proof. Excludes premature Engine success or format redesign.
- [ ] **7a. Paired shared model/candidate leaves.** After 2b and Engine dependency/build decision. Reassess #214/#215 together; move authoritative types/buffer/tests and delete donors in the same adoption slice. Accept wire/constructor/type-identity parity and package/root compilation/tests. No duplicate long-lived leaves, session adoption or standalone claim.
- [ ] **7b. Shared recorder worker orchestration.** After 7a; reassess #216 injected-worker contract. Accept actual-frame readiness through Stop/Drop joins, resource lifetime/retry preservation and owning tests on both platforms. Native adapters remain explicit dependencies until moved. This is not standalone native acquisition.
- [ ] **7c. Production Engine ownership.** After 6 and required 7a/7b contracts. Reassess #211, covering Desktop and timed screen/device paths together before any media side effect and through detached finalization/terminal publication. Agent-via-GUI follows the same owner. Timeout does not cancel or release ownership. Accept real multiprocess contention/restart/kill/wrong-owner/stop/cancel tests, correct first-frame readiness, exact finalizer receipt and batched native proof on macOS/Linux. Preserve socket/API compatibility and caller consent; no second recorder or PID/TTL ownership shortcut.
- [ ] **8. Archive coordination.** After 7c and publication writer coordination. Cover each reader/writer/export/reprocess/recovery/retention/import/transfer path and destructive bypass in coherent operation-sized PRs. Read/Write/Finalize Engine leases are all **shared maintenance exclusions**, not writer serialization. Keep publication serialization and BUSY/process-local claims until tested replacements cover their invariant. Retain persisted bundle identity across rename; filename alone is insufficient. Accept contention, reader/maintenance races, rename/retry/deletion/failure tests and operation parity. Excludes blanket replacement of all guards from package-only proof.
- [ ] **9a. Native/runtime/build closure.** After 7c/8 and active retained-capability/native-producer handoffs. Trace manifests, Swift/native helpers, generated resources, models, config callbacks, dynamic libraries, install/signing/TCC identity and embedded inputs. Move capture mechanics without Desktop policy. Accept independently built Engine/Agent closure and accurate platform capability errors; package/install regressions receive relevant native proof. No helper fallback into an installed Desktop or developer tree.
- [ ] **9b. Standalone Agent.** After 9a. Own automation deadlines/cancellation/evidence; consume Engine directly while preserving explicit request identity, inspect/retry and local-only behavior. Accept clean macOS/Linux install and real record/readiness/stop/cancel/saved/evidence flow where Desktop was never installed; inspect resulting bundles and dynamic/runtime dependencies, plus coexistence/admission with Desktop. Graphical sessions/permissions may be required and must be stated. No claim from a root second binary or injected worker alone.
- [ ] **10. Finish product/build separation and delete facades.** After relevant product adoptions, not necessarily after every unrelated feature. Complete Desktop/Agent/Connect/Public build, test, docs and packaging references; remove superseded implementations and forwarding paths when consumer inventories are empty. Accept fresh-checkout supported builds, import/dependency checks, installation/update/CLI/URL compatibility and privacy-clean public artifact. Keep external aliases only where needed. Excludes a cosmetic repo-wide rename, new topology or web Desktop campaign.

## Blockers, staging disposition and resumption

No unchecked dependent item may be skipped into correctness. An independent lane may
continue after a bounded blocker is recorded. Recheck live ownership before assignment.

| Work | Current limit | Resume condition |
|---|---|---|
| #221 then #225 | Open drafts, not main. Older descriptions demand native replay; discovery reports exact inverse reconstruction against `6f043ff4` and preserved reviewed blobs | Strategy merged; reconcile actual candidate/build delta and reuse receipts, then affected compile/focused acceptance |
| Connect client | #191 owns `src/hosted.rs` and tests | Explicit owner handoff/path reservation; strategy merge alone does not clear it |
| Browser production adoption | Pages thread owns publisher/composition | Clearance from Pages owner `99ea5290-aecc-4bf0-8aca-3200f62f5e5c`; reserve `scripts/cd/**`, Pages packaging/runtime scripts, functions/lib, wrangler, published-homepage and publisher workflow |
| Native dependency closure | #185 retained-capability changes and #235 Linux producer | Owner handoff and exact retained capabilities/build inputs agreed; no racing native moves |
| Other live feature paths | #234 mark text, Mac share-picker, retirement/hosted-sharing and website Pages writers; #237 audio ducking merged while drafting | Explicit exclusive reservation or wait for merge; do not touch their production files here; retain #237's new build inputs in future delta comparisons |
| Standalone Agent/native behavior | No clean-machine runtime proof yet | Complete prerequisites and obtain owned bounded platform slot; no new harness project after 30-minute dead end |
| Web Desktop host | #213 is diagnostic staging, not accepted native implementation | Separate future campaign/authorization; excluded here, GPUI remains |

Staging #199–216 is a library of evidence, not a merge queue: #199 umbrella is not
the target; #200 informs 5b/5c; #201 informs 3; #202's bounded package already reached
main through #220; #203/#205 already merged unrelated CI/build-label work; #204 is
superseded for the recorder seam by #225; #206 recovery popup is separate product
work; #207's manifest/hook policy is not automatically imported; #208 is optional
coordination evidence, not mandatory file splitting; #209 is superseded by #210;
#211 needs correctness and production-lifetime adoption; #212's CI assumes packages
not on main and is not transplanted; #213 is excluded; #214/#215 require paired donor
deletion; #216's injected worker is useful but not native closure. Re-cut against
current main and preserve attribution; do not blindly cherry-pick these branches.

## Evidence and limits

Historical owner threads: `6ad16648-03aa-45cd-aacd-9031295ba670` (stopped original),
`7b7cdc5b-2de9-455a-8037-ce43069c025d` (continuation),
`ac8137ae-287f-439b-8016-9f803b6deae8` (strategy/discovery),
`6309b1b1-5327-41fd-98e1-b6d1d25aed1f` (#233 completion). Their proposals for a web
Desktop, broad staging merge and blanket native checks are superseded by this scope.

Config/recorder retained Linux receipts were inspected at
`~/.local/share/apparent/refactor-evidence/serial-main-221225-v1/verification-results.json`:
config `61338307`, recorder `63cbbb5b`, base `d21115b5`, 668 passed/3 ignored each,
focused tests and exact namespace mapping. These are historical revisions, not fresh
runs against `6f043ff4`. Parent discovery additionally reports Mac 592 passed/3 ignored
after canonical-root fixture correction (`mac-execute-v2` logs), and exact inverse
reconstruction of current heads #221 `1ea0d146`/#225 `28d83f3d` against current main.
Read those logs and compare all changed inputs before carrying that evidence to a new
candidate. This document does not claim a fresh native capture, Mac compile or install.

Relevant contracts: `capture/engine/README.md`, `docs/capture.md`,
`docs/keyframes-and-text.md`, `docs/hosted-{api,client,web}.md`,
`docs/export-and-retention.md`, `docs/linux.md`, `docs/agent-video-workflow.md` and
`docs/onboarding-and-settings.md`; read the matching guide before each implementation.
No private capture directory exists on this implementation host at the checked default
Mac/Linux locations. No private bundle, recording, transcript or secret is committed.
Strategy verification results belong in its PR/handoff; unchecked steps above remain
pending until the parent records their actual merged acceptance on main.
