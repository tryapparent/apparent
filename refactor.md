# Apparent incremental architecture campaign

Status: strategy/tooling accepted on canonical `tryapparent/apparent` main through
[#239](https://github.com/tryapparent/apparent/pull/239), merged as
`f1b46d2a62145abae6f93a99d29de9da023e675b` (ancestry and acceptance checked).
Current-main reconciliation includes accepted config #221, merged as
`476b1361e8f222c008789c33af39478b7d7c82d5`; the preceding checkpoint was
`715a8918e58cdc48dfe28e1a829145fbb44d8bc9`:
#246 selector repair and #242 processing join the previously recorded merged
slices. Acceptance below is bounded, not production browser adoption, publication
correctness, Engine adoption or native proof. The parent
coordinator owns merge and progress updates on main; a worker finishing is not
completion. Simon authorizes the parent to merge this and future refactor PRs when
required review and verification pass; workers do not merge. Deployment and release
remain separate authorization decisions.

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
and explicit capabilities. No new Windows support, web Desktop migration, new daemon/IPC,
service, database or repository is part of this campaign. Bounded removal of verified
obsolete Windows code is explicitly authorized under the retirement rule below.
Keep GPUI working.

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
package is real but unconsumed by production. Connect browser entry isolation and
an independent additive browser package are real; `site/` still owns the production
build/publisher and authenticated implementation. Existing GUI automation still requires
the running Desktop app. These are supported migration states, not failures to hide.

Move one authoritative implementation and its tests at a time. Existing paths may
forward **toward** the new owner through direct re-exports or thin adapters; never
maintain two behavioral implementations. New work uses the accepted seam immediately.
Freeze the donor against new responsibilities, allowing bounded bug repairs when
needed. Record each facade's owner, consumers and deletion condition in its slice:
remove it when all supported callers/build inputs/docs have migrated and compatibility
checks pass. Keep only aliases required by an actual external contract. Do not widen
legacy imports to make a new feature easy, or freeze unrelated feature delivery.

### Retire before moving

After this strategy merges, workers may delete verified-obsolete tracked code, docs
and assets in bounded coherent slices without asking for each deletion. Verify
requiredness first: trace consumers/references, current build/runtime/package inputs,
supported compatibility and historical-data readers, and active owner reservations.
Delete retired implementations with obsolete tests/references instead of migrating or
archive-copying them; git history is the archive. Candidate examples include retired
OpenCode routing glossary/`CONTEXT.md`, old icons and legacy sites, **only after that
check**. “Not deployed” alone is not obsolete. This also authorizes bounded legacy
Windows removal, never new Windows support. Preserve active work, supported readers
and current inputs until verified retired. Private captures, credentials, evidence
and uncommitted work are outside cleanup authority. This PR changes policy only;
no bulk application/site deletion starts before the parent merges the strategy.

Parallel lanes own useful outcomes and their tests/PRs, not arbitrary files. One writer
owns each shared hotspot/module declaration/manifest. Use short-lived main-targeted
PRs, not the #199 umbrella as an integration destination. Branch from a committed
provider only when necessary; integrate accepted prerequisites into main promptly.
Application edits remain limited to assigned slices and exclusive owner reservations.

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
commit or last push. Missing history, an empty/unknown delta, changed shared/build/
security/lifecycle behavior and selector/hook/CI edits broaden to root plus Engine build/tests.
Document-only changes run hook/selector contracts without Cargo. Engine-test-only
changes build/test Engine without the root app. Rename/delete selection includes
both donor and destination. `.github/workflows/verification.yml` uses the same selector
on PR base/main-before deltas, on macOS and Linux, with no secrets or publication.
Existing website/Connect, updater and release workflows remain intact.

The follow-through selector recognizes the exact reviewed config #221 (`1ea0d146`)
and recorder #225 (`28d83f3d`), plus processing `84ef8f56`, source pairs using complete Git blob identities and
regular-file modes, including donor bodies, destination imports/re-exports and tests.
Only those complete deltas (alone, combined or with narrow docs/package tests) select
root compilation plus existing owning test sets: handoff/hosted/Settings for config,
capture/agent_capture for recorder. The pinned config fixture repair is included.
Merged #246 adds the exact current-main config three-file recipe (logging repair
already present) and processing recipe `d59796c3` → `f135448c`; historical recipes
remain revision-bounded. No current config extraction acceptance follows from routing.
Processing runs bundle_processing/capture/recover/sketch; its complete production
block and all ten artifact test bodies were compared byte-for-byte to `f1b46d2a`.
Each filter must execute passing tests; a zero-match run fails. Any altered body,
missing test, mode change, shared/native/build change or unknown extra path restores
full root/Engine checks. These are source-pair gates, not commit-message, label,
environment or user-selected bypasses. New donor bytes require review, not a guessed
"mechanical" classification.

The known `connect/web` package inventory from #200, checked at 5b checkpoint
`c5bb1b78`, selects its independent frozen Bun 1.3.10 install, production build,
artifact/resource-closure and dev/preview route fixtures, and separate synthetic browser
build/fixtures, without Rust. Its current closure reads only the five approved
`site/public` assets outside the package; changes there or in publisher/service/shared
inputs still broaden. CI provisions Node/Chrome for that route. This is executable
routing for the additive package, now merged through #244; historical package
acceptance is recorded in 5b below. It is not production adoption. Unknown new
browser paths remain broad. #246 admits only the exact additional
`connect/web/src/SharedLinks.tsx` filename; unknown, shared-input and unreviewed mixed
deltas still broaden rather than acquiring a generic browser/Rust exemption.

Do not certify arbitrary `main.rs` edits: that file composes every subsystem. A
later extraction revision must be source-compared and its exact blobs reviewed
before replacing the pinned processing pair; the registry is deliberately bounded.
Routing #241 alone did not complete any checklist step beyond 1. This remains
a small selector, not a Rust parser, broad test framework or native harness.

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
- [x] **Bounded verification-routing follow-through** — [#241](https://github.com/tryapparent/apparent/pull/241), tested head `c3f72f7a`, merge `1ca21c67`. Exact source-pair and additive browser rules above are merged, not extraction acceptance. Retained normal-hook evidence reports Linux root build/671 passed/3 ignored, Engine build/22 passed and 15 hook + 13 selector contracts; final-head CI checks passed. The real browser driver receipt at `c5bb1b78` is historical synthetic evidence, not a fresh current-main run.
- [x] **Current source-pair/inventory repair** — [#246](https://github.com/tryapparent/apparent/pull/246), tested `e73bb366455a3156daa3f5b423e26fdb103cf894`, merge `76792fa186cf1f3ad88348596ac360f119de6706`. Parent inspected the terminal independent Luna review: no findings. Parent normal-hook proof: root build/683 passed/3 ignored, full Engine suite, 15 hook + 16 selector contracts. Retained final CI [41281996167](https://github.com/tryapparent/apparent/actions/runs/41281996167) passed Ubuntu 683/Mac 607 root tests (3 ignored each), with Engine checks. No new Rust CodeQL analysis was configured for this run; earlier #242/#245 Rust analyses remain historical evidence only. This accepts selector repair, not config, browser adoption or native behavior.
- [x] **Retired OpenCode glossary deletion (one C slice)** — [#243](https://github.com/tryapparent/apparent/pull/243), tested head `ea3ddd38`, merge `3b5d715b`. Deleted `CONTEXT.md` and its sole direct guide reference in `docs/routing.md`; no source, supported historical metadata reader, runtime or package input changed. Current-main tracked references are only the intentional campaign example and selector/deletion regression. Retained final normal hook passed 15 guard + 13 selector tests on the exact docs-only rule; CI Rust execution was skipped, not a Rust pass. The earlier broad invocation's Engine trusted-ancestry failure remains a failed historical invocation, not waived or relabelled green. C and the final sweep remain unchecked.

## Milestones (not a serial feature blockade)

**A — useful main separation:** cohesive authoritative ownership, immediate caller
adoption and donor deletion. The Connect client slice belongs here; an additive
leaf alone does not complete it. **B — independent capture products:** real Engine
and archive coordination, native/runtime closure and standalone Agent acceptance
remain required under 6–10. B is not complete because A builds, and independent
B work need not wait behind unrelated A cleanup when its actual prerequisites
and owner reservations are satisfied.

## Ordered remaining checklist

An unchecked box stays unchecked until implementation is merged **and** the stated
acceptance is met. Record merged PR, tested revision, reused/fresh results and remaining
limits in the same PR where possible. Strategy acceptance is recorded below; no
other pending item becomes complete merely because a worker finishes it.

- [x] **1. Strategy and verification tooling.** Merged #239 as `f1b46d2a62145abae6f93a99d29de9da023e675b`. All ten required checks passed, including CodeQL's five language analyses/aggregate, harness contracts, selector, and macOS/Linux Rust jobs. Final Actions run [41256544899](https://github.com/tryapparent/apparent/actions/runs/41256544899) verified root builds/full suites (Linux 671 passed/3 ignored; Mac 595 passed/3 ignored), Engine builds/22 tests on each, and hook/selector fixtures (14 + 7). Test/tooling repairs through `bdcd00650e22c0af79699aa597e137957a091233` fixed the HOME display assertion, short socket fixture, owned Mac ACL teardown and actual ACL test selector; the focused regressions passed before full suites. This is merged-main acceptance with retained final-head CI evidence, not a fresh run on this documentation change. No native GUI/capture, deployment or release acceptance is claimed.
- [x] **2a. Reuse config #221.** Accepted [#221](https://github.com/tryapparent/apparent/pull/221), tested `26d1d965aa5dc08d12ad58550087922e46daad88`, merged `476b1361e8f222c008789c33af39478b7d7c82d5`. Exact config storage/test extraction and locked-writer contract preserved; all eight final-head checks passed, including macOS/Linux changed-tree Rust jobs. This records parent acceptance and retained CI, not a new native run. Connect consumes these real writers through its provider; no second preference store.
- [x] **2b. Recorder extraction accepted through #250.** Accepted [#250](https://github.com/tryapparent/apparent/pull/250), reviewed/tested `344b6f2959ca28616dc141abc02ab886cf576995`, merged `a9e089f2457bc30d0856280a07f50a33ad36e73e` on unchanged parent `476b1361e8f222c008789c33af39478b7d7c82d5`. Parent verified exact merged whole-tree identity; the three recorder files are byte-identical to independently reviewed extraction `2085f796`, with inverse reconstruction preserving all nine moved and twelve retained test bodies/attributes. All eight final-head checks passed. Actual [run 41284430144](https://github.com/tryapparent/apparent/actions/runs/41284430144): [macOS job 124782783770](https://github.com/tryapparent/apparent/actions/runs/41284430144/job/124782783770) passed the root build, `agent_capture` selection 18 and `capture` selection 45; [Linux job 124782783803](https://github.com/tryapparent/apparent/actions/runs/41284430144/job/124782783803) passed the root build, `agent_capture` selection 19 and `capture` selection 43. These filters overlap and are not summed as distinct tests. This records retained exact-source review/CI and parent acceptance, not a fresh native run. Existing `capture` exports remain the sole recorder compatibility facade for Desktop, timed CLI, bundle processing and native samplers; remove it only after supported consumers/build inputs migrate to the accepted Engine contract. Native adapters, readiness/start/stop/join/retention and window/screen behavior are unchanged; no native replay is required solely for this mechanical move. Milestone B's real native/runtime, Engine/archive and standalone Agent acceptance remains fully required. #233 is not repeated; legacy #225 remains open and untouched.
- [x] **3. Common bundle processing out of main.rs (bounded in-crate extraction).** [#242](https://github.com/tryapparent/apparent/pull/242), tested `f135448c8b252066b104fc4790b2a2273500a9c8`, merge `715a8918e58cdc48dfe28e1a829145fbb44d8bc9`. Parent fresh independent review: **APPROVE_SOURCE**; 30,642 production bytes, all ten complete tests and eleven root exports preserved, with inverse reconstruction against current donor base. Exact-head CI [41280661463](https://github.com/tryapparent/apparent/actions/runs/41280661463) logs confirm Linux 683/Mac 607 passed (3 ignored each), root builds and Engine 23 passed on each platform. Retained focused proof: 10 processing/43 capture/8 recovery/19 sketch; `pr242-current-main` output records show synthetic manifest/summary/PNG parity within documented identity/path exclusions. Merge preserves both owned blobs; only #245 ledger/#246 tooling advance its base, and reconstructed full merge tree matches. This reuses exact-source execution evidence, not a fresh docs-branch run. Demo and compatibility exports stay root; publication 6, Engine/standalone adoption and native capture remain unaccepted.
- [ ] **4. Useful Desktop coordination seams.** After 3 and the already-merged #233. Extract only cohesive human workflow/presentation state needed by upcoming work; keep exact request receipts before stale-UI guards, current consent before Connect admission, feedback local and clipboard/onboarding in Desktop. Accept focused completion/cancel/stale-result tests, source preservation for moves and compile. Excludes a wholesale #208 split, empty folder taxonomy, renderer replacement and relocating active picker/ink owners' code.
- [ ] **5a. Independent Connect client.** Implementation on `t3/extract-connect-client` extracts and adopts the full production `connect/client` package, removes donor implementation, and leaves only root application adapters. Real #221 provider reads/writes preserve worker→queue→config locking, overrides, generations, admission/transport cancellation, #191 sharing identity/status distinctions and local fallback. Existing curl/loopback scenarios move with the package; root still runs real-provider config races, CLI/logging and UI lifecycle seams. Independent package and affected root/macOS/Linux checks plus review remain acceptance gates until merged. No protocol-only staging, auth redesign or native/live-OAuth claim; see `docs/hosted-client.md`.
- [x] **5b. Additive Connect browser package (historical merged staging acceptance only).** [#244](https://github.com/tryapparent/apparent/pull/244), reviewed final package `41bf5780a6b62cdffce2876a2df9ecfaf6f32e30`, merge `89a41b877857c5ef29d05db22d90563786d2765f`. Parent accepted independent staging, not 5c. Fresh Git comparison here confirms the complete `connect/web` tree `8c90c1c8ea56d71a3495daf8a4dd8cc25f70fcf1` is identical at reviewed head, merge and pinned current main. At the merge, `Hosted.tsx`, `api.ts`, `hosted.css` and `base.css` exactly match `site/src/hosted` donors. Retained final-head normal-hook evidence reports Bun 1.3.10 frozen install, TypeScript/production build, four artifact/closure + two dev/preview route tests and all 32 synthetic browser scenarios, including raw-failure-body redaction; 15 hook + 13 selector tests passed. This reuses historical execution/review, not a fresh browser run or live OAuth/native/deployment proof. **Current donor drift:** merged #191 changes legacy `Hosted.tsx`, `api.ts` and `hosted.css` and adds `SharedLinks.tsx`; the staged package remains unchanged, while `base.css` still matches. Do not claim current-main behavior parity. Reconcile those contracts in the owner-gated 5c adoption before replacing production donors; production build separation remains incomplete.
- [ ] **5c. Adopt browser package and remove donors.** After 5b; parent now exclusively owns composition, replacing the cancelled Pages-owner reservation. Sole publisher composes independent output while preserving accepted homepage overlay, canonical/legacy routes and query/auth/origin contracts. Accept synthetic route/consent checks, built graph separation, allowlist/privacy/collision rejection and packaging behavior. Delete old authenticated implementation only after production composition consumes the new one. Excludes publisher replacement, deploy, private pitch publication and route redesign.
- [ ] **6. Checked publication correctness.** After 3; separate behavior PR from moves. Use #210 (successor of #209) as evidence for `coordinate`/`publish_after`/`checked`, porting only dependency-complete work. Whiteboard mutation **and fallback** remain inside the outer publication closure through validation and terminal effects. Accept failed writes/media/cleanup never produce Saved, durability/identity checks, pending transcript/recovery writer coordination and synthetic MP4/MOV plus relevant batched platform proof. Excludes premature Engine success or format redesign.
- [ ] **7a. Paired shared model/candidate leaves.** After 2b and Engine dependency/build decision. Production root adoption is implemented on `t3/engine-recorder-adoption`, stacked on frozen Connect client #253 (`e05b7d38e26096a8ea41c310576a15eeda775bd9`); #253 is not accepted by this integration. Authoritative model/candidate bodies and three regression tests move from `a9e089f2` into Engine, with donors deleted and direct root compatibility exports. Native/session/readiness/stop/Drop bodies remain byte-identical. The root path dependency adds only Engine's libc/serde/serde_json lock edges; the independent Engine manifest/lock and existing Connect entries stay unchanged. Source inverse reconstruction and the initial Engine build/13 recording tests passed at `d99574ff`; dependency-complete normal broad root/Engine verification, independent Luna review and macOS/Linux CI remain required. Unchanged native behavior is reused as preservation evidence, not a new native session; no standalone Agent or future independent Bun run is claimed. Keep unchecked until parent acceptance, after #253's separate gates (including independent Mac package proof) pass. Facade owner, consumers and deletion condition are in `capture/engine/README.md`.
- [ ] **7b. Shared recorder worker orchestration.** After 7a; reassess #216 injected-worker contract. Accept actual-frame readiness through Stop/Drop joins, resource lifetime/retry preservation and owning tests on both platforms. Native adapters remain explicit dependencies until moved. This is not standalone native acquisition.
- [ ] **7c. Production Engine ownership.** After 6 and required 7a/7b contracts. Reassess #211, covering Desktop and timed screen/device paths together before any media side effect and through detached finalization/terminal publication. Agent-via-GUI follows the same owner. Timeout does not cancel or release ownership. Accept real multiprocess contention/restart/kill/wrong-owner/stop/cancel tests, correct first-frame readiness, exact finalizer receipt and batched native proof on macOS/Linux. Preserve socket/API compatibility and caller consent; no second recorder or PID/TTL ownership shortcut.
- [ ] **8. Archive coordination.** After 7c and publication writer coordination. Cover each reader/writer/export/reprocess/recovery/retention/import/transfer path and destructive bypass in coherent operation-sized PRs. Read/Write/Finalize Engine leases are all **shared maintenance exclusions**, not writer serialization. Keep publication serialization and BUSY/process-local claims until tested replacements cover their invariant. Retain persisted bundle identity across rename; filename alone is insufficient. Accept contention, reader/maintenance races, rename/retry/deletion/failure tests and operation parity. Excludes blanket replacement of all guards from package-only proof.
- [ ] **9a. Native/runtime/build closure.** After 7c/8 and active retained-capability/native-producer handoffs. Trace manifests, Swift/native helpers, generated resources, models, config callbacks, dynamic libraries, install/signing/TCC identity and embedded inputs. Move capture mechanics without Desktop policy. Accept independently built Engine/Agent closure and accurate platform capability errors; package/install regressions receive relevant native proof. No helper fallback into an installed Desktop or developer tree.
- [ ] **9b. Standalone Agent.** After 9a. Own automation deadlines/cancellation/evidence; consume Engine directly while preserving explicit request identity, inspect/retry and local-only behavior. Accept clean macOS/Linux install and real record/readiness/stop/cancel/saved/evidence flow where Desktop was never installed; inspect resulting bundles and dynamic/runtime dependencies, plus coexistence/admission with Desktop. Graphical sessions/permissions may be required and must be stated. No claim from a root second binary or injected worker alone.
- [ ] **10. Finish product/build separation and delete facades.** After relevant product adoptions, not necessarily after every unrelated feature. Complete Desktop/Agent/Connect/Public build, test, docs and packaging references; remove superseded implementations and forwarding paths when consumer inventories are empty. Accept fresh-checkout supported builds, import/dependency checks, installation/update/CLI/URL compatibility and privacy-clean public artifact. Keep external aliases only where needed. Excludes a cosmetic repo-wide rename, new topology or web Desktop campaign.

- [ ] **C. Opportunistic coherent deletion slices.** After 1 and clearance of any active owner; may accompany a relevant slice or run independently, without waiting for 10. Verify requiredness as above, delete retired code/docs/assets with obsolete tests/references, and record why supported consumers/readers/build inputs survive. Use reference/import/artifact checks and affected verification for the actual deletion; do not exhaustively refactor dead paths or create archive copies. No private/uncommitted/evidence cleanup. Record each merged slice and acceptance; check C only after the final sweep meets acceptance.
- [ ] **11. Final legacy sweep.** After 10 and each applicable owner handoff. Recheck remaining legacy code/docs/assets, Windows remnants and stale references against supported consumers/readers and packaged artifacts. Delete only verified-retired paths in bounded PRs, or record the remaining requirement/blocker and resume condition. Accept no unneeded donor implementations/archive copies and passing affected checks; do not turn required compatibility paths into deletion targets or refactor every historical path.

## Blockers, staging disposition and resumption

No unchecked dependent item may be skipped into correctness. An independent lane may
continue after a bounded blocker is recorded. Recheck live ownership before assignment.

| Work | Current limit | Resume condition |
|---|---|---|
| #221 config | Accepted as 2a at merge `476b1361`; final tested head `26d1d965` has eight passing checks | Keep its locked storage and test semantics authoritative; acceptance does not imply native replay |
| Recorder #250 / legacy #225 | #250 accepted and merged as `a9e089f2`; exact reviewed head `344b6f29` and focused Mac/Linux CI are recorded in 2b. #225 remains open, untouched | Reuse mechanical-move evidence by actual source/build-input closure; Engine/native/standalone milestones remain required, not implied by recorder extraction |
| Connect client | 2a accepted; dependency-complete production extraction reserved on `t3/extract-connect-client` | Parent accepts complete package + facade/provider/test adoption after independent review and platform checks; no staging-only acceptance |
| Browser source sync / production adoption | Sync `31281ba5` independently reviewed but unmerged; no current-main donor parity claim. Former Pages owner cancelled; parent exclusively reserves 5c composition | Parent accepts source sync and composed artifact before donor deletion; reserve publisher/Pages runtime, functions/lib, wrangler, homepage and workflow paths. Isolated ten-path retirement re-cut `2ac8cb21` is source-only, not completed cleanup, deployment or infrastructure proof |
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
