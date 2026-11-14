# Verification and publication

## Preview baseline restoration

Development resumes from Preview 0.12.2, tag `preview-mac-12-2` at
`cbaa8f74c65e0d5951138501977f684b03790e09`, including its matching Linux AppImages
(whose filenames retain Cargo version 0.3.13). Pre-restoration main is preserved
at `bf7671b1d72b1a71168627407fe51da32fda5e1a` on
`migration/main-preserved-2026-11-08`. The restoration is a forward commit, not a
history rewrite. Later migration work must be deliberately ported; merging an
already-ancestral branch does not automatically reapply restored-away changes.

The application, native adapters, dependencies and bundled resources match that
published preview. The exceptions are repository development guidance, this
verification documentation, the verifier's description, workflow triggers, the
new repository-checks workflow and its publication-trigger regression contract.
Reused native evidence belongs to the preview and its unchanged inputs; it does
not certify a newly built installer. Before publication, recheck platform,
packaging, signing and runtime inputs under the existing release gates.

Restoring source does not update installed apps, captures, user config, remote
services, published installers or update feeds. Publication is a separate task:
Linux release and website/Connect delivery have no automatic or scheduled trigger.
Review compatibility with the currently deployed service before publishing this
older client/server source.

## Continuous delivery

Name new workflows `<Owner> · <Plain-language purpose>` in sentence case, with
platform qualifiers only when useful. New or changed value-stream workflows
should follow their owner directories and actual shared/composition/build
consumers on PRs and main pushes. Keep those dependencies covered by routing
contracts; surface unknown ownership rather than adding an all-stream trigger.
Preserve required-check admission and let pending affected delivery finish
across unrelated main pushes.

`stream-engine.yml` owns the new `engine/` native media producer and SDK checks
and commit-addressed artifact publication. It consumes the same
`enablement/ci/routing/consumers.ts` authority as the hook and other workflows;
`engine-media` / `engineMedia` is distinct from the legacy staged Engine suite.
The Rust-free SDK check runs in a clean Node container. Ready PRs and main also
qualify extracted Linux/Mac native packages against real synthetic media. Main
publishes a prerelease after both gates, without activating the installed app.
An unrelated main push cannot cancel a candidate's publication. Consumption must
pin an exact native artifact digest and compatible SDK; adding the app's pin and
integration/package consumers is required in the adoption slice. Until then,
Engine-only inputs have no installed-app consumer. SDK/capability details and
remaining adoption gates live in `engine/README.md`.

`checks.yml` verifies the native application and shared integration on PRs targeting
main and main pushes. Public and Connect have direct automatic entrypoints in
`stream-public.yml` and `stream-connect.yml`; neither depends on a default CD run.
Automatic PR and main triggers follow directory ownership. The sole authority is
`enablement/ci/routing/consumers.ts`: directory/consumer rules, named suites,
workflow input inventory and admission explanations. `selectRange` reads the
complete no-rename Git delta and applies that authority for both the ordinary
local hook and hosted workflows. Local `selection` delegates to it; executors
consume its plan instead of independently reclassifying paths. Plan fields are
`root`, `engine`, `desktop`, `client`, `foreground`, `browser`, `service`, `tools`,
`hermes`, `public`, `tooling` and `onboarding`. Mac projection retains the
existing platform exemptions, with reasons; it does not redefine ownership.

Both event filters are contract-checked against this authority, including every
tracked path's transitive consumers. Known unrelated directories are excluded;
shared/composition and explicit build/verification dependencies remain. A final
unknown-root guard reaches cheap ownership validation instead of silently losing
a new owner. Capture retains its combined native build and Record/installed
Connect client consumers. Public and Hermes do not acquire native dependencies
from root Cargo version/config changes. CI orchestration and unknown global
inputs retain conservative coverage; isolated prerequisite tests stay tooling.

Unknown history, unsafe boundary changes and newly imported dependencies in the
exact pure onboarding policy closure retain the full named plan and reasons.
Ordinary pushes with known history and automatic workflow selectors use the same
admission check (local missing-history diagnostics still execute every suite):
missing ownership, unavailable input proof, or conservative suites excluded by
static filters fail explicitly before publication. Expand/audit the owning
input contract rather than accepting omitted coverage. Explicit manual diagnostics
retain their full-suite path. Additions/deletions and both rename sides are
included in the delta; unsafe onboarding moves cannot inherit a pure-file exemption.

Onboarding is the first focused subdirectory group, not a new top-level owner.
Ordinary account/presentation/state policy and renderer edits select onboarding
plus their real Desktop/Electron consumers, without app/Engine/client/service/web/
Public/Hermes suites. Existing scoped policy test/toolchain changes select the
onboarding suite. Protocol, preload, host, shortcut validation, durable pen-save,
Hyprland and native/provider changes retain native integration and platform gates.
Unknown onboarding files/imports do not inherit the audited pure-policy exemption.
Shared UI and Record changes retain their real consumers, including onboarding.

Both the hook and clean Node CI job consume `onboardingCommands()` through
`enablement/local-tests/run.ts --onboarding`: source policy tests FIRST, then
locked `tests/onboarding` installation without lifecycle scripts, then scoped
TypeScript checking. Its small locked manifest contains only TypeScript and Node
types. The clean job rejects Rust, frontend dependencies/generated output and
Electron; its source-only executor does not require Git or repository history.
The parent Desktop test command still consumes the same scoped typecheck; renderer
and bridge changes keep the canonical Desktop/Electron checks. Portable tests do
not establish native durability, permission, compositor or registration behavior.

Connect foreground uses the same authority's `foreground` suite for the exact
`connect/client/typescript/{src/foreground.ts,test/foreground.test.ts}` pair.
Only regular modifications with the audited Node import closure and unchanged
wire types/operations/stdio contract qualify for portable-only selection. Initial
adoption, deletion, moves, unsafe modes, new dependencies, protocol or native/
crypto/staging changes retain real native consumers. The shared executor inventory
is `foregroundCommands()`: locked npm install, package tests, typecheck and build;
hosted portable execution consumes it too. This registers the contract without
importing the separately held foreground runtime/UI/native implementation.

Foreground source is an installer payload input when adopted; its tests are not.
Portable policy checks do not imply a Rust-independent installer: main publication
may still rebuild the native shell to package the checked TypeScript. Worker
publication depends on its own runtime inputs, so foreground-only checks do not
deploy or invalidate an unchanged Worker. Existing activation gates remain.

Cross-directory dependencies are explicit: Public publishes the listed Capture
guides/skill and README; Capture embeds the Public wordmark. Connect's existing
browser composition verification still builds Public from source, so
`public/site/**` remains an explicit Connect entry dependency until that fixture is
independent; the named suite plan determines which consumer checks actually run. These filters do not claim full package independence or split the
native application's current build into new workflows. Root native manifests
and verification adapters retain their consumers. PR updates coalesce; main commits have distinct concurrency groups so
later documentation cannot cancel earlier code verification. Drafts retain cheap
contracts and relevant Public checks; ready PRs verify the proposed merge tree.

`enablement/ci/routing/consumers.ts` owns consumer facts for hosted selection,
local pushes and the Python native execution adapter. Ordinary owner prose needs
contracts only. README and guides read by Public run Public verification; the
agent skill embedded in the CLI retains native coverage. Public and Connect web
source do not select Rust or Electron. Shared UI/assets retain their real web,
service, Desktop and native consumers. Service changes retain client/root API
integration and run the canonical service build, serial tests and recipient browser.
Hermes inspection and complete compiled package delivery run independently in `hermes.yml` (continuous delivery hermes), on Linux and Mac for every affected PR/main candidate. Native admission does not consume Hermes results. Hermes-only changes skip automatic Linux app packaging; mixed or unknown inputs retain the existing publication gates. Audited
Linux drivers run launch-free contracts. Within a triggered workflow, unknown inputs/history, empty deltas, unsafe
modes/types, embedded instructions and execution-sensitive CI retain broad checks.
Repository `AGENTS.md` guidance runs cheap contracts only in local pushes and
hosted CI, including regular additions, deletions and renames between guidance
paths. Guidance under skills, prompts, instructions, tests, fixtures or templates
is not exempt. Mixed changes retain every other input's consumers; this does not
admit an unverified release or exempt Markdown embedded in a product.
Regular additions/deletions and both rename sides retain their owner consumers.
Native manifests, lockfiles, build helpers, Swift/Metal and embedded assets count
as native inputs even when no Rust source changes.

The complete base-to-merge/push delta produces a suite plan. Platform callers
consume that plan; they never replace it with an empty-tree comparison. Portable
Connect web/service/driver checks run once on Linux. Desktop renderer tests run in
Electron on each selected platform; native root/staged Engine and standalone
client suites are separately selected. The finite renderer-only Mac Rust
exemption retains Mac Electron. Ordinary prose cannot undo a Linux exemption.
The manual Linux workflow defaults to all suites and retains full-tree diagnostics.
The standalone manual Mac workflow and its candidate-build jobs are retired;
automatic Mac suites and exact-main admission remain in `checks.yml`.
Historical exact-commit Mac receipts remain valid for release admission.
The advisory owner report does not control admission.

Main first runs fresh cheap contracts and selection. Ready PRs record their actual
checkout tree, head, run/attempt, plans and job results in the 14-day
`ci-tree-evidence-<attempt>` Actions artifact. Main can reuse a suite only from the
merged same-repository PR's completed trusted workflow run, with an identical
complete Git tree, matching head/run/attempt and sufficient successful suite
coverage, authenticated against GitHub's actual current-attempt job conclusions.
The workflow, selector/producer/runner code and package scripts must match the
trusted main parent; verification-definition changes always run fresh on main.
The recorded checkout SHA must independently resolve to the identical tree.
Failed, cancelled, skipped, expired, malformed, missing or inaccessible
proof is not reusable. A changed merge tree or direct push runs affected suites.
PRs cannot consume this main-only reuse route. Public artifact verification stays
fresh; reuse does not copy build artifacts, installed dependencies or native
binaries. Packaging still builds the exact main SHA and its revision metadata.

Fresh main `Linux verification` / `Mac verification` admission jobs require
successful contracts/selection plus every affected suite to pass now or have
validated identical-tree PR evidence. Missing selected coverage fails admission.
The Linux gate never waits for Mac. After Linux admission succeeds,
`release-linux.yml` automatically packages both AppImages and publishes the
existing Linux latest-Main channel. Its exact-SHA/attempt/repository admission,
stale-main suppression, packaging checks and noncancelling publication lock remain
required. A later main push cannot cancel an active publication. Mac publication
remains separately operated; Connect uses its own automatic tested delivery.
Linux success cannot admit Mac.
Historical full main CI and existing exact-main manual receipts remain valid.
Native/product acceptance and current-base integration remain owner obligations.
A successful draft or aggregate workflow conclusion alone supplies no release proof.

Local pushes use the same consumer map and retain mandatory theme, hook, selector,
prerequisite, timing, workflow and release-admission contracts. Qualified local
concurrency-only workflow edits retain their existing bounded exception; protected
main/tag pushes disable it. Node 22.23+ and Bun 1.3.10 are required. Run hook-backed
pushes through `t3-build` on Clanker. Local reuse receipts cannot admit a release.
Manual/tag Linux and Mac procedures and the bounded onboarding candidate exception
retain their existing requirements. No workflow enables Connect or changes provider
settings, consent, schema or deployment resources.

## Checks and artifact identity

Public's credential-free job runs `cd public/site && npm run verify`: its source
build, allowlisted resource graph, browser and shared appearance/analytics checks,
publication contracts, compiled movie worker in workerd, and Public-only Pages
preparation. It seals `.build/website` with the run SHA and every file's checksum.
The deploy job downloads only that workflow run's SHA-named artifact and validates
it before uploading. Credential-free verification jobs cannot deploy; only the
gated canonical-main deploy job receives production credentials.

Connect's credential-free job retains its publication contracts, full hosted
TypeScript/workerd/D1/R2 suite, independent browser build, composed website checks
and credentialed cross-origin synthetic browser scenarios. Its production gate
requires its own same-run portable and affected Linux/Mac consumer verification
for the same commit. Its local
composition is an integration fixture, not a Public publication prerequisite.

Node 22.23.0 and Bun 1.3.10 remain pinned. Browsers use the website lockfile's
`playwright-core`. Public and Connect production publication use separate locks
that never cancel an upload. Public rejects a candidate outside main ancestry, with newer Public inputs on
main, or that would overwrite an equal/newer deployed website. Public fetches full
main history and compares all changed paths, including both rename sides; an
unrelated main advance can no longer strand its pending exact-SHA artifact.
Connect admission and pre-deploy checks, and automatic Linux admission, use the
same authority for payload-input comparison. Verification-only policy tests and
native-client checks do not supersede unchanged installer/Worker payloads; main
policy-test-only plans also skip installer publication. A newer affected change
still supersedes the old candidate; failed ancestry/history/input checks cannot admit it. Exact-SHA checks,
sealed artifacts, publication ordering and existing activation gates remain. Superseded candidates
skip without upload or a new receipt; transport, auth and integrity failures remain
failures. Dispatch current main to publish a replacement when appropriate.

## Website activation: Cloudflare Pages

The Public deploy job publishes only the sealed `dist-apparent` to the isolated
`apparent-capture` Pages project, using `public/site/scripts/cd/publish-pages.ts` and
`public/site/wrangler.pages.jsonc`. It does not execute `public/site/wrangler.jsonc`, deploy the
hosted Worker, or connect to Clanker. See
[`../public/site/docs/pages-deploy.md`](../public/site/docs/pages-deploy.md) for the current build,
source-built homepage preservation, video limits, exact hostname cutover and rollback.
Set `WEBSITE_PAGES_API_TOKEN` in `website-production`; the existing
`WEBSITE_CD_ENABLED=true` gate enables only Pages. Remove obsolete SSH settings
when present; they are no longer read. The hosted activation gate is unchanged.

### Retired Clanker capture-site origin

After canonical Pages acceptance, the capture site's Caddy serving block,
release symlink and historical release directories were removed. Do not restore
the old DNS A record, configure website SSH credentials, recreate that release
tree or run historical overlay activators. Production `publish_site.py` already
rejects this root; its temporary-filesystem tests are not a deployment procedure.
Use only the Pages rollback in `public/site/docs/pages-deploy.md`.

The proxy is shared. Its container, volumes, unrelated sites and separate
document-product poller/deploy-control services remain in place. They must not
be removed as capture-site cleanup. The website publication lock remains as an
inert coordination inode; there is no active capture website behind it.

## Connect automatic delivery

Affected pushes to `main` deploy Connect automatically after its selected checks
and publication verification pass. `HOSTED_CD_ENABLED=true` enables this route;
setting it false is the emergency delivery stop, not a per-release approval.
PRs never receive deployment credentials or publish. The current-stream guard
runs before upload and again before activation, so newer affected changes
supersede stale candidates while unrelated main advances do not strand delivery.

The `hosted-production` environment is restricted to `main`, with:

| Kind | Name | Meaning |
| --- | --- | --- |
| Variable | `CLOUDFLARE_ACCOUNT_ID` | Existing account pinned by `connect/tooling/hosting/scripts/profile.ts` |
| Secret | `CLOUDFLARE_API_TOKEN` | Worker version upload/deployment and configuration read access |

The adopted target is the existing `apparent-hosted-beta` Worker, private bucket
and initialized database. Its API is mounted at `app.tryapparent.com/connect`;
the historical hosted API and Google callback remain available. The gateway
packages only the Connect documents and owned assets, preserving Public's root.
Its mounted auth, native streaming, consent, evidence/media and recipient behavior
are retained from the running beta rather than the obsolete root-only template.

Verification builds and seals the gateway, service and browser assets once.
Publication downloads those exact bytes, stages a strict Wrangler version upload,
then checks the full binding/secret-name profile and runtime configuration before
activating it at 100%. Secrets stay in Cloudflare. No subscription, resource,
route, cron, database migration, budget seed or credential rotation is changed.
Readback checks the exact version tag, every public asset hash and anonymous
credentialed CORS on both API origins. It does not establish live Google sign-in
or authenticated recording acceptance. A failed readback fails the job without
silently rolling traffic or data back; its receipt records the previous version
for an investigated Worker rollback. Public and Connect publish independently;
protocol changes must retain compatibility or use a reviewed release sequence.

## Local verification

For broad root checkpoints, use `cargo build -j 3 --offline` and
`cargo test -j 3 --offline -- --test-threads=2`; on macOS prefix Cargo with
`taskpolicy -c utility`. Rebuild after Rust changes before running
`target/debug/apparent`: `cargo test` does not rebuild the application executable.
On Clanker run each heavy command or hook-backed push once through
`/home/simon/.local/bin/t3-build`, never nested, honoring `T3_BUILD_JOBS`.

Run the commands in the checks section from the repository root (the Node commands
from their package directories). For a no-network deployment wiring check, generate
configuration using **synthetic** identifiers and run
`(cd connect/service && node_modules/.bin/wrangler deploy --config wrangler.cd.json --dry-run)`.
This proves configuration and packaging only, not permissions or deployment. Never
put real tokens in test fixtures, the generated file, artifacts, or logs.

## Rust verification environment

Before explicit local verification (or a direct main push) starts subprocesses
for Rust checks, the verifier
checks the caller's Unix `TMPDIR` (or `/tmp` when unset). Run the same read-only
check before direct expensive commands:

```sh
python3 enablement/verification.py --base unknown --preflight
```

Supply a short absolute, user-owned mode-0700 temporary root. Ancestors must be
root/current-user owned and not group/world writable, except root-owned sticky
ancestors supported by the Engine. Symlinks are rejected without following them.
The check diagnoses rather than replaces `TMPDIR`, repairs permissions or deletes
anything. For an isolated run on Clanker, create a private per-job
`/tmp/apparent-dev-<job>-<run>/` directory, explicitly pass it as child `TMPDIR`,
and keep its context alive until all foreground checks exit.
Retain ownership/cleanup receipts outside that tree for long-running work.

The pathname budget models ordinary `agent_capture` socket fixtures: Linux
`apparent-owner-<32 hex>/capture.sock`, macOS `ac-<32 hex>/s` (owner fixtures use
`/tmp` there). It counts filesystem bytes, including separators, with space for
NUL. This is a deterministic prerequisite, not a writability/bind guarantee,
fixture completeness check or native proof. Ignored Electron/native scenarios
must check their own longer HOME-derived socket paths. Keep hostile/sticky and
symlink production tests enabled; a friendly preflight environment does not
replace those assertions.

The platform workflow checks a private temporary root before its first Cargo
command. Its Rust/native job also performs the locked frontend install, explicit
Electron download/resolution and executable/input readiness check before compiling,
with a five-minute setup deadline. Download archives are cached by OS, architecture
and frontend lockfile; installed modules and test results are never restored.
Cold downloads remain required on a cache miss. These prerequisites do not replace
any Electron/Rust or native GUI assertion. Feature pushes
and PR CI run its regression tests as part of the cheap contracts; they do not
require a Rust test environment when no Rust suite is selected. Before any native
allocation, inspect the exact candidate and real scenario entry point offline:
verify fixture files/schema, selectors against current controls, required guest
capabilities and the existing canonical repository/issue budget ledger plus
allocation/cleanup receipts. Missing receipts are not zero spend. Follow the
native owner's existing preflight and shared queue; this command grants no
allocation authority and establishes no GUI acceptance.

## NoMac verification

Use NoMac for changed macOS-specific behavior when an approved local Mac is not
available. Shared Electron/React presentation and platform-independent policy can
be verified on Linux; this does not replace affected native, permission, window
integration or packaging checks, or required CI. Physical-device behavior needs
appropriate hardware. Follow the installed NoMac testing skill for the current
CLI, shared FIFO and provider lifecycle.

The spending limits in root `AGENTS.md` govern this repository, including when a
general-purpose skill describes broader authority. Before allocation, historical
charges plus concurrent maximum-cost reservations must fit the canonical
repository/issue (or standalone PR) budget in one shared private ledger. Unknown
costs are not zero; threads, retries, derived issues and owner changes do not reset
the budget. Additional sessions within the remaining budget need no new approval.
Ask only for authority or budget that is actually missing; no top-up or session
extension is included.

Prepare the candidate before allocation, use the shared FIFO, and preserve exact
session ownership, charge and provider/queue cleanup receipts. Never attach to or
stop another worker's session. Test records distinguish actual native behavior,
synthetic checks, reused evidence and remaining gaps.

## Advisory owner lanes

`python3 enablement/owner_lanes.py --base origin/main --head HEAD` prints a
versioned JSON proposal over the complete merge-base delta. `--json <path>` saves
it; `--summary <path>` appends an input/reason summary. Main CI retains this report
as `owner-plan-<runner>` and in the selector job summary. Its `HEAD^` comparison is
advisory only: cancelled-run coverage still comes from unchanged empty-tree full
verification. `executed: false` means the report supplies no successful-test proof.

Explicit manual entrypoints use `--lane <name> --run` (and `--online` for locked
Cargo dependencies). Lanes are `capture` (whole root build/test), `engine-staged`
(staged Engine package, not production Engine), `connect-client` (independent
Cargo build/test), `connect-web` (existing package build/browser fixtures),
`connect-service` (build and real synthetic workerd tests), `public-site`
(standalone build/package and website/publication contracts), and `desktop-ui`
(JS and synthetic Electron smoke). Use the Connect workflow for complete
composed-site and cross-origin acceptance, and platform workflow for real Rust
bridge/native checks. Entrypoints require the same toolchains, browser and system
dependencies as those workflows; they do not install OS dependencies or grant
native acceptance. Run heavy local commands through the existing build runner.

Client edits also select Capture: root tests intentionally reuse client scenarios
with the real AppConfig provider. Renderer edits select Capture for Rust bridge
integration. Shared UI feeds Desktop and service recipient UI. Connect web feeds
its retained composition fixtures and consumes five explicit Public assets. It is
not an input to Public publication. Service API changes
include root/browser consumers. Production Engine/Desktop/Agent remain root
modules with reverse dependencies; no lane claims their isolation. Shared,
unclassified, newly added, deleted, renamed or type-changed inputs and missing
history select every lane. Manifests and lockfiles follow their owner's consumers;
root build, packaging and verification inputs remain broad.

No report output controls execution, hooks, release admission or publishers.
Before enabling skipping in a separate issue, establish each suite's complete
input closure including toolchain/platform, native/build/packaging contracts and
verifier identity; compare against successful compatible proof covering the full
candidate, including cancelled-run changes. Missing or incompatible proof must
rerun. Validate shadow decisions against full execution and investigate omissions.
Dependency caches are not test receipts; no speedup is claimed here.

## Commit integration checkpoint

With `core.hooksPath=.githooks`, `post-commit` refreshes `origin/main` with a
five-second, noninteractive fetch on feature branches. When HEAD does not contain
that main commit, it prints `INTEGRATION REQUIRED` and the exact fetched SHA.
The owning agent should finish running operations, preserve any remaining
uncommitted work, rebase onto that SHA, inspect incoming changes and rerun affected
checks before starting the next work section. This is an advisory checkpoint,
not an enforced merge gate or an automatic rebase. A partial commit remains a
partial commit: the hook never stashes, stages, rewrites, pushes or changes files.

Detached checkouts, main, and in-progress rebase/merge/cherry-pick/revert/bisect
operations skip the checkpoint. A failed or timed-out fetch reports unknown
freshness without failing the successful commit. No background worker is started;
other worktrees are untouched. Existing worktrees acquire the hook when they
integrate this change; frozen evidence checkouts need not be updated. Local hook
checks do not replace current-main integration and review before merge.

## Verification timing diagnostics

Native verification and Linux packaging pin Rust 1.99.1. Cargo 1.100 changes
the build-output layout; the current native runtime staging assumes the older
layout and leaves the direct CLI unable to load its transcription library.
Upgrade only after staging and direct CLI execution pass on the new layout.
Mac verification also checks the disposable Intel hosted runner's
compiler inventory before dependency-cache restore. Only the known unused 1.98.0
stable toolchain may be removed; unknown identities fail before mutation. Keep all
three workspace paths in the Rust cache even if client execution moves jobs:
Actions cache versions include paths as well as the visible key. Compiler,
environment and manifest invalidation remain Swatinem defaults. Mac dependency
caches may save after later native failures on main and feature branches under
Actions' normal branch isolation. Saving after failure is armed only once the
changed-tree compilation and tests succeed, avoiding immutable partial seeds
after compiler/setup failures. Caches never admit verification or publication.

The existing unoptimized-root observation (Mac run 42505355940) restored a 748 MiB
fallback cache in about 34 seconds and compiled root tests in 3m20s. Main already
has that profile; this change claims no profile or compatible-hit speedup.
Pinning prevents future compiler drift, and failure saves can avoid repeated cold
dependency compilation after a failed run. Those savings are projected, not a
measured walltime reduction; successful exact-key hits already skip cache saves.
No main-only save restriction is used, so isolated feature branches can seed caches.

After native prerequisites pass, the prepared Electron download-cache path is
exported to subsequent job steps. Clean packaging installs reuse that archive
while retaining the ordinary installer and its checksum/version checks.

Platform Rust jobs retain seven-day observation-only JSONL spans and Cargo HTML
compiler timings. Spans report elapsed active command time, never CPU time or
billed savings. Runner queue time is separate: use Actions job queued/started
timestamps; it is not included in command spans. No queue estimate is inferred
from workflow walltime. The exact candidate SHA accompanies spans.

The verifier times contracts, application build, test compilation and test
execution separately. With timing enabled, an identical Cargo test selection is
compiled with --no-run first; the original Cargo test command then executes in
full, including its normal incremental compiler check. Compiler HTML describes
compilation rather than harness execution. Packaging, bridge integration, native
assertions and native Storage socket/control readiness have named spans.
Readiness spans can overlap the enclosing native assertion span; do not sum them.

Missing/endless spans mean incomplete observation, never successful acceptance.
Started commands retain their start record if interrupted; TERM/INT/HUP are
forwarded and exit status is preserved. Artifact upload is guarded by the timing
step outcome, runs after failures, and missing diagnostics only warn. Diagnostics
record no arguments, environment dump, transcript or application data. Existing
native evidence, cleanup, 60-minute Rust timeout and release gates are unchanged.

## Portable verification routing

Automatic CI runs affected portable checks once, through `routing/run.ts`, before
selected native suites. Manual platform callers run the full portable inventory.
The Python adapter retains root/Engine command execution, resource and temporary
filesystem safety. TypeScript supplies its owner decisions. Routing tests exercise
command omission and failure propagation; they do not establish native acceptance
or measured runtime/cost savings.

## PR verification evidence

The automatic verification status reporter and its `Verification complete` commit
status have been removed to eliminate repeated GitHub API reconciliation.
Linux, Mac and Public verification workflows remain available under their existing
manual triggers. Exact-head verification, independent review, native acceptance
and publication admission remain required; inspect their workflow evidence
directly. The retired status is no longer required by branch protection.

## Audited platform boundaries

`capture/desktop/linux/capture/portal.rs` is reached through Desktop's
`cfg(target_os = "linux")` module and Linux capture module. The Linux appearance
adapter has the same OS boundary. Their callers, module declarations, ABI and
packaging are not exempt. Regular modifications to these reviewed leaves do not
select Mac native checks. The Linux guide is ordinary prose. The five reviewed
GUI VM/capture drivers in `routing/consumers.ts` select launch-free contracts,
not a Mac build. Unknown/additional native inputs and unsupported file types/modes
retain conservative coverage. Both rename sides always contribute consumers.

Five Settings TSX cards and `src/style.css` are the finite renderer-only Mac Rust
exemption. The cards feed Settings; the stylesheet feeds foundation, Settings,
onboarding, installer, controls and pill. Vite builds their entries and
`test:electron` executes the actual renderer smokes. `stage-settings.py` stages
these assets separately from the native binary. Mac Electron remains selected;
Linux root/bridge verification remains selected. New entrypoints, bridge,
main/preload, dependencies, packaging and unknown renderer files retain native
checks. Settings frog PNGs remain native `include_bytes!` inputs. Build-version
watches remain intact: a revision-label change is not evidence of a new policy
consumer, and proof reuse never reuses a packaged binary with an old revision.
Manual full-tree/release callers default to full native execution.

Public's five Markdown body inputs are checked against the actual agent-document
builder in regression tests. README and guides select Public; the agent skill is
also embedded by the CLI and retains native coverage. Shared UI/assets preserve
native consumers. Connect web's five imported Public assets are explicitly listed
in the shared consumer map. Public-only source and new browser files avoid Rust;
an unexpected native source in a web owner remains broad. Expand exemptions only
with a consumer audit and adverse/mixed-delta tests. Selector tests are command
selection evidence, not measured savings or native product acceptance.

## Stream-owned delivery

Public PRs use the complete Git delta and fail-closed selector. Every main push
checks the full Public tree, so a later unrelated commit carries a failed or
superseded website update forward. Its canonical-main publisher requires fresh
verification, `WEBSITE_CD_ENABLED`, the website environment, a sealed exact-SHA
artifact and live readback. Main and manual publication share a noncancelling lock.
The default workflow no longer invokes Public.

Connect PRs derive a complete-delta plan from the same consumer map. Browser-only
edits run portable checks; service/client changes retain the existing root/client
consumers on both platforms. Unknown inputs fail closed. Every main/manual run
checks Connect's complete tree, including native consumers, rather than allowing an
unrelated follow-up commit to hide a failed delivery. This conservative main
coverage is intentional and is not a measured build-time reduction.

`stream-connect.yml` admits its publisher only after its own successful
contracts, portable checks and affected Linux/Mac suites, on canonical main with
`HOSTED_CD_ENABLED`. That automatic route does not require a `checks.yml` Linux
receipt. Manual dispatch uses the same stream-owned checks and admission; the
old `web-delivery.yml` entrypoint has been replaced. Worker publication retains its production environment,
noncancelling lock, current-main check, approved bindings and version/CORS readback.
No resource migration or disabled-service activation is included. The existing
Connect composition/browser verification remains in the publisher. The restored baseline has no browser Worker publisher; the pre-change
`web-delivery.yml` only deployed `apparent-hosted`. This workflow preserves that
existing disabled activation boundary and does not replace or cut over the
separately deployed `apparent-connect-web` browser Worker. Porting that retained
implementation and its installed API profile requires a separate compatible
source/runtime slice; this change does not claim full Connect runtime migration
or independently released native packaging.

GitHub path filtering uses its documented complete changed-file limits: rename
sides and mixed inputs are covered by routing contracts; diffs beyond GitHub's
300-file filter window can be omitted upstream. The workflow cannot recover an
event GitHub did not start. Very large cross-owner changes should be split or
explicitly verified through the manual platform/stream entrypoints.
