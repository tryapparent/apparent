# Apparent: Agent Instructions

Apparent records screen, voice, cursor, clicks and ink so a human can point, talk and draw while an agent builds. It produces `.apparent` bundles for inspection and handoff. Support macOS and Linux only. Do not add Windows support, tests, release assets or new docs; retire existing Windows code only in a separately scoped change.

## Product

- Make capture, marking and handoff quick. Record known window, element, URL and session context rather than making agents infer it from pixels.
- Keep images visual and text semantic. Preserve time-aligned transcript, interactions and absolute paths in bundle text. Cut keyframes on meaningful action or visual change, retain full frames when cropping, and avoid rasterized captions/card chrome.
- Persist user settings and feature flags in `~/.config/apparent/config.json`, preserving unrelated keys and secrets. Document when file edits take effect, reconcile OS-owned effects, and discover active capture state before restart/change. A saved preference alone does not prove an OS permission or registration applied.
- Share user-facing behavior across macOS and Linux; adapters supply OS mechanics. Inspect both consumers when changing shared behavior and document real platform differences.
- Desktop is a fast capture-and-handoff tool: no desktop review workspace; conventional UI belongs mainly in Settings. The recording-sharing workspace belongs in Connect. Minimize stop-to-paste and stop-to-watch delays; distinguish a copied link from a recording ready to watch.
- Ship new user-facing features enabled by default unless explicitly asked for an opt-in experiment. Preserve consent and permission gates; this does not enable existing experiments.

## Architecture and migration

**Migrate what you touch.** Every feature must advance the architecture in its area; every Desktop implementation change must improve value-stream alignment and separation of concerns. Changes to Desktop workflow decisions, product policy or UI behavior must include the smallest usable Electron + React/TypeScript + shadcn workflow slice in the same PR (canonical outcome roots, canonical controls in `shared/ui`; existing `capture/desktop/ui/frontend` is a frozen migration donor). Move touched legacy policy with its callers, persistence and tests. Do not leave a legacy-only workflow improvement or defer its migration to another issue. Keep this tied to the requested outcome, without an unrelated rewrite; name a concrete blocking dependency and remaining debt if safe adoption is impossible.

Keep capture/media execution and native resource, durability and safety mechanisms in Rust/native adapters. Bounded native correctness/security repairs that preserve the intended workflow do not require a UI port. Retaining product policy in native code requires a concrete native constraint or measured performance need. Keep native capture independent of UI responsiveness and measure affected performance when relevant.

Canonical product roots are **onboarding/**, **record/**, **handoff/**, **connect/** and **agent/**. Existing **public/** and **hermes/** remain recognized owners. Supporting capability roots are **engine/** and **shared/**; **composition/** assembles owner public contracts and surfaces. There is no Desktop product stream or canonical desktop/ destination. Native generic window hosting is infrastructure.

Onboarding owns first-success teaching, practice and progress, not another recording/delivery implementation. Record owns the full recording feature, including the capture pill, input meter/live captions, whiteboard/ink/notes, save/bundle/transcript/keyframes, storage/retention/export, and headless APIs. Handoff owns clipboard/copy/paste, destination choice, outbound delivery intent, receipts, retries and uncertainty. Connect owns encryption, upload, auth, remote access, readiness and revocation. Agent owns interpretation, inspection and extraction.

The special public capability chain is Agent -> Record -> Engine -> Shared. Only Record accesses Engine; Agent accesses Record. Other sibling product implementations cannot import one another, including Onboarding/Handoff importing Record/Connect. Composition injects narrow capability interfaces/callbacks and assembles owner-provided surfaces; no stream imports Composition. Owners may use their own implementation, public Shared and declared external dependencies. Record may have React UI; ownership does not imply an execution environment. Do not fabricate network/protocol frameworks to cross these boundaries.

Composition assembles Settings from owner public sections. Each stream owns its section UI, validation, persistence and effective-state behavior. Shared supplies canonical controls.

All capture/ paths are frozen migration donors: no additions or inbound relocations, including tools/tests/docs. Existing edits/deletions/outbound moves remain subject to dependency checks; do not grow features inside donor files. Known feature paths map to outcome owners in shared/enablement/dependency-policy/snapshot.ts; mixed shell remains explicit Legacy/unclassified debt, not blanket Desktop ownership. No mass relocation is required.

Preserve one authoritative persistence mutation contract across languages. Keep the working legacy path until its replacement and consumers are accepted; never introduce competing config writers or two implementations of the same visible surface. Document changed routing, rollback and removal conditions. Verify real callers, builds and packaging before removing donors. Delete verified dead code/tests/references rather than archiving them; check compatibility/data readers and other owners' reservations first. See [refactoring guidance](enablement/refactor.md).

Make TypeScript policy testable without Rust or Electron, renderer behavior separately, and bridges against real providers. Prove claimed owner build independence in a clean environment without Rust tools or cached Rust outputs; a file move or mocked bridge is insufficient. Connect and Public target zero repo-owned Rust/build dependency. Shared/composition must not reintroduce Rust into a TypeScript owner's development loop. The existing root Rust app remains authoritative for capabilities not yet adopted; do not add shims, crates or services merely to simulate ownership.

Prefer Bend2 for pure typed decisions and state transitions with a [supported build and proof path](shared/enablement/bend/README.md). Use TypeScript for integration, React, effects and tooling. Keep generated JavaScript outside Git. New Python or authored JavaScript requires explicit approval. Change Cargo manifests and lockfiles only as needed.

## Ownership and references

These are ownership targets, not claims of completed migration. Use the canonical outcome roots declared above. Existing capture/ references describe frozen donors. Unknown mixed shell remains Legacy/unclassified debt. Settings is assembled by Composition from owner public sections; native generic hosting is infrastructure.

| Owner | Home | Enablement and CI home | Start here |
|---|---|---|---|
| Engine | `engine/`; legacy `capture/engine/` | `engine/enablement/` | [Capability adoption](engine/README.md), [capture](capture/engine/docs/capture.md), [keyframes/text](capture/engine/docs/keyframes-and-text.md), [export/retention](capture/engine/docs/export-and-retention.md) |
| Record | `record/` | `record/enablement/` | [Storage](record/storage/README.md), [completion](record/completion/README.md) |
| Onboarding | `onboarding/` | `onboarding/enablement/` | [Ownership](onboarding/README.md) |
| Handoff | `handoff/` | `handoff/enablement/` | [Ownership](handoff/README.md) |
| Agent | `agent/`; legacy `capture/agent/` | `agent/enablement/`; legacy `capture/agent/enablement/` | [Agent video workflow](capture/agent/docs/agent-video-workflow.md) |
| Connect | `connect/` | `connect/enablement/` | [Hosted web](connect/docs/hosted-web.md), [client](connect/docs/hosted-client.md) |
| Public | `public/` | `public/enablement/` | [Website/deployment](public/enablement/docs/pages-deploy.md) |
| Hermes | `hermes/` | `hermes/enablement/` | [Integration and distribution](hermes/README.md) |
| Shared | `shared/` | `shared/enablement/` for shared-package tooling | Reusable UI, schemas, assets and utilities |
| Repository Enablement | `enablement/` | Shared engineering mechanisms and repository-wide coordination only | [Verification/CI](enablement/docs/continuous-delivery.md), [local checks](enablement/local-tests/README.md), [commit hook](enablement/directory-width/README.md) |
| Composition | `composition/` | Cross-owner assembly and integration checks; invoke owner entrypoints | CLI/composition wiring and cross-owner acceptance |

**Each value stream owns its enablement and CI end to end.** Put stream-specific build, verification, test harnesses/fixtures, packaging, release/deployment tooling, diagnostics and engineering runbooks under that stream's `enablement/` directory. Product implementation stays in its existing home; unit tests may remain beside the implementation they verify. A language, platform or the label “CI” does not transfer ownership to root Enablement. Existing `scripts/`, verification and root Enablement locations are migration sources, not exceptions for new stream-specific tooling.

Root `enablement/` owns genuinely shared runner/bootstrap mechanisms, hooks, reusable verification infrastructure and repository-wide admission/coordination. Stream-owned entrypoints and dependency declarations define their checks and delivery inputs; root coordination consumes them and combines actual shared/composition consumers without duplicating stream policy or maintaining competing selectors. Shared mechanisms may be consumed by streams without moving their release or correctness decisions to the root.

GitHub requires workflow entrypoints in `.github/workflows/`. Each stream owns its workflow's behavior and invokes its `enablement/` entrypoints there; keep provider-required YAML wiring thin. Cross-stream workflows coordinate owner entrypoints and shared execution rather than taking over stream-specific build, test or publication policy. Preserve required check identities, permissions, concurrency, candidate/artifact provenance and delivery gates during migration.

Migrate tooling with its real callers, package/workflow inputs, tests, path routing and owner documentation. Remove obsolete donors after the replacement is accepted; a new directory, forwarding wrapper or duplicated implementation alone does not establish ownership. Keep bounded changes independently usable, record concrete remaining dependencies, and retain native/platform verification where affected.

`composition/` contains CLI/composition wiring; existing capture-internal shared mechanisms are frozen migration sources in `capture/`; new mechanisms belong with their destination owner. Read the relevant owner guidance before changing a subsystem. Keep documentation concise and beside its owner. The preserved migration branch is a source for bounded reviewed ports, not a branch to merge wholesale; [baseline details](enablement/docs/continuous-delivery.md#preview-baseline-restoration).

## Work and verification

Choose the smallest coherent change and proportionate checks. Read-only subagent review is allowed. Respect explicit holds and narrow writer reservations. Release them with the exact contract, commit and remaining gates. Repair in-scope prerequisites. Retry caps still allow independent investigation.

For boundary changes, inspect real producers and consumers and verify with representative producer outputs. Implementation-mirroring fixtures do not establish compatibility. Keep procedures with their owners.

**Linux can verify shared Electron/React UI and portable TypeScript.** Before booking a Mac for legacy UI work, compare it with moving the smallest usable slice to Electron and testing on Linux. Prefer migration when cheaper overall and behavior is preserved, including real routing and persistence. If Mac proof remains necessary, name the changed native behavior or migration blocker.

Test changed OS-specific behavior on the affected OS, using NoMac when needed. Verify native capture, permissions, window integration and packaging on their relevant platforms. Use the Linux guide's isolated VM for native GUI work, never the host or another worker's VM. Physical-device behavior needs suitable hardware. Honor CI and branch protections.

Select checks by changed behavior. Reuse proof only for unchanged relevant inputs and cite its source. Inspect the actual renderer for UI changes and real bundle outputs for output changes. Docs and tooling need no capture. Report test, GUI, permission and publication evidence separately, including gaps. A build, CLI help or bundle path alone proves no downstream behavior.

## Delivery

For implementation work Simon authorizes in `tryapparent/apparent`, finish through merge into `main` and passing CI for the exact landed commit, without repeated code-review/merge approval. Use short-lived, coherent PRs against current main; preserve trunk usability and explicit task/release holds. Follow failures caused by the change through repair and verification. Normal automatic CD consequences are authorized; separate activation, destructive migration, access, spending and external-message restrictions remain. Other repositories normally receive a scoped commit and draft PR unless authorized otherwise.

Use authenticated `gh` for GitHub operations. Watch workflow runs with `gh run watch <run-id> --exit-status` and a foreground wait, not scheduled automations. Honor harness-mandated PR watch/yield rules. Use existing completion notifications and resume ownership; stop for an explicit pause, a genuine blocker with no useful authorized next step, or a required orchestration yield. Analysis-only work ends with the requested analysis.

Before yielding, name the exact prerequisite and the event that will resume work. A registered PR watch is not proof that it covers workflow completion after an already-reported failure, another PR merging, deployment or runner-capacity recovery. Report an uncovered event explicitly; preserve ownership and harness rules without inventing a new monitor or claiming a callback exists.

Keep CI aligned with owner directories and their actual shared/composition/build consumers; unrelated changes should not rebuild or deploy another product. Preserve required-check admission and pending deliveries across unrelated main pushes. Repository-wide coordination belongs in the [CI guide](enablement/docs/continuous-delivery.md); stream-specific commands, selectors and publication procedures belong beside their owning `enablement/` implementation. Desktop release requirements remain in the [release guide](capture/desktop/docs/release.md) until migrated with their callers.

## Safety and resources

- Keep private captures, transcripts, credentials and personal data out of public artifacts. Use synthetic/sanitized evidence. Preserve others' work and real user data; ask before destructive or ambiguous deletion, access/spending beyond existing authority, provider-setting changes or contacting people. Reasonable isolated synthetic end-to-end tests within existing authority are allowed; clean up only identified test artifacts.
- Old bundle session metadata does not authorize forwarding captures. Use `apparent copy <bundle>` for clipboard handoff; separate delivery to a person, organization or session requires permission. Search existing issues before filing a report.
- Never reset Kit's real TCC grants, wake/flash the Studio displays, record/benchmark its real screen, play test audio aloud on Kit's Macs or post tests to a real OpenCode session. Use isolated/approved test environments and the [screen safety gate](capture/desktop/scripts/perf/screen-guard.sh). Follow the Settings guide for installed Mac testing; signing and update storage remain outside disposable output.
- NoMac: **$2 cumulative per canonical repository/issue (or standalone PR); each session at most $0.50 / 30 minutes**, normally with a 300-second idle timeout. Existing spend and concurrent reservations share that budget; retries/branches/derived issues do not reset it. Narrower task limits win. No top-ups or session extensions are included; work without an issue/PR needs an approved budget bucket. [Queue, ledger and cleanup procedure](enablement/docs/continuous-delivery.md#nomac-verification).
- When Simon says “make it apparent,” follow [the skill](capture/agent/skills/make-it-apparent/SKILL.md), inspect the complete recording and deliver a playable video in the conversation with truthful limits.

On Clanker, follow `/home/simon/AGENTS.md`: disposable helpers, diagnostics, build/test output, screenshots, proof media, fixtures and VM runs belong in private `/tmp/apparent-dev-<job>-<run>/` jobs. They may be cleaned during verification; regenerate them. Durable evidence elsewhere requires an explicit retention request. Canonical repositories, tools, required application data/config, bounded existing caches, VM templates and real private captures retain their proper locations; this is not authority to move/delete existing data or change cleanup services.

## Staged code comments

Do not add or change lexical code comments, including doc comments and tool directives. Existing comments may remain or be deleted. The pre-commit staged rule, exact identity/rename handling, supported syntax and fail-closed limits are documented in [dependency policy](shared/enablement/dependency-policy/README.md). Markdown/prose and comment-looking literals are not code comments. Shebangs are executable syntax.
