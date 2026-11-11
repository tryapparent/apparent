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

`checks.yml` is the native/shared automatic workflow, on PRs targeting main and main
pushes. PR updates coalesce; main commits have distinct concurrency groups so
later documentation cannot cancel earlier code verification. Drafts retain cheap
contracts and relevant Public checks; ready PRs verify the proposed merge tree.

`enablement/ci/routing/consumers.ts` owns consumer facts for hosted selection,
local pushes and the Python native execution adapter. Ordinary owner prose needs
contracts only. README and guides read by Public run Public verification; the
agent skill embedded in the CLI retains native coverage. Public and Connect web
source do not select Rust or Electron. Shared UI/assets retain their real web,
service, Desktop and native consumers. Service changes retain client/root API
integration and run the canonical service build, serial tests and recipient browser.
Hermes inspection and complete compiled package delivery run independently in `hermes.yml` (continuous delivery hermes), on Linux and Mac for every PR/main candidate. Native admission does not consume Hermes results. Audited
Linux drivers run launch-free contracts. Unknown inputs/history, empty deltas,
unsafe modes/types, embedded instructions and execution-sensitive CI retain broad checks.
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
Manual platform workflows default to all suites and retain full-tree diagnostics.
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
and Connect activation remain separately operated; Linux success cannot admit Mac.
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
it before uploading. PR/push jobs have no production credentials and cannot deploy.

Connect's credential-free job retains its publication contracts, full hosted
TypeScript/workerd/D1/R2 suite, independent browser build, composed website checks
and credentialed cross-origin synthetic browser scenarios. Its production gate
still requires full Linux/shared verification for the same commit. Its local
composition is an integration fixture, not a Public publication prerequisite.

Node 22.23.0 and Bun 1.3.10 remain pinned. Browsers use the website lockfile's
`playwright-core`. Public and Connect production publication use separate locks
that never cancel an upload. Public rejects a candidate that is no longer current
main or would overwrite an equal/newer deployed website. Superseded candidates
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

## Hosted activation (separate operator gate)

Complete [`../connect/service/README.md`](../connect/service/README.md)'s deployment prerequisites
first: approved Free-plan configuration and CPU proof, existing private Standard
R2 bucket, initialized D1/ledger, live Google/cookie/device/cron proof and security
review. A green local workerd suite is not those proofs. Do not activate this job
against an uninitialized database or change to Paid implicitly.

Configure `hosted-production`, limited to `main`, with:

| Kind | Name | Meaning |
| --- | --- | --- |
| Variable | `CLOUDFLARE_ACCOUNT_ID` | Approved account ID |
| Variable | `HOSTED_D1_ID` | Existing initialized database UUID |
| Variable | `HOSTED_R2_BUCKET` | Existing private Standard bucket name |
| Variable | `HOSTED_GOOGLE_CLIENT_ID` | Approved Google OAuth client ID (public) |
| Secret | `CLOUDFLARE_API_TOKEN` | Least-privilege token for this Worker/deployment and binding reads |

The existing Worker's `GOOGLE_CLIENT_SECRET` and `TOKEN_ENCRYPTION_KEY` stay in
Cloudflare. They are never supplied to Actions or rotated by CD. Restrict the token
as far as Cloudflare permits and review its actual access before activation.
`hosted_config.py` validates the required public identifiers and writes an ignored
`connect/service/wrangler.cd.json` next to the existing entrypoint. The fixed production
origins retain hosted API/auth/callback and legacy transition CORS; the UI stays
on app. Observability, workers.dev and preview URLs remain off. No CPU override,
resource creation command, database migration or ledger initializer is run.

After separate approval, set repository variable `HOSTED_CD_ENABLED=true` and
dispatch `main`. Wrangler uses strict deployment and tags the version with the
checked SHA. Readback requires one 100%-traffic version with that exact tag and
an anonymous `/v1/session` response with the canonical credentialed CORS headers.
This read-only probe does not prove live Google sign-in, authenticated cookies,
uploads or native integration. Inspect those separately before calling it live
acceptance. A failed readback fails the job; it does **not** silently change
traffic again or roll back a database. Disable the gate and use Cloudflare's
reviewed Worker version rollback after investigating; record the previous version
before the first activation. Website and Worker publication are independent, not
a distributed transaction. Protocol changes must retain backwards compatibility
or use a separately reviewed release sequence.

## Local verification

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

Mac verification pins Rust 1.99.1 and checks the disposable Intel hosted runner's
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
