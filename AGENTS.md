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

**Migrate what you touch.** Every feature must advance the architecture in its area; every Desktop implementation change must improve value-stream alignment and separation of concerns. Implement new product behavior in TypeScript. Changes to Desktop workflow decisions, product policy or UI behavior must include the smallest usable Electron + React/TypeScript + shadcn workflow slice in the same PR (`capture/desktop/ui/frontend`, canonical controls in `shared/ui`). Move touched legacy policy with its callers, persistence and tests. Do not leave a legacy-only workflow improvement or defer its migration to another issue. Keep this tied to the requested outcome, without an unrelated rewrite; name a concrete blocking dependency and remaining debt if safe adoption is impossible.

Keep capture/media execution and native resource, durability and safety mechanisms in Rust/native adapters. Bounded native correctness/security repairs that preserve the intended workflow do not require a UI port. Retaining product policy in native code requires a concrete native constraint or measured performance need. Keep native capture independent of UI responsiveness and measure affected performance when relevant.

Record owns the headless capture-to-handoff workflow, recording preferences, retention, default keyframe/transcript/bundle assembly and ordinary export policy. Desktop owns human controls and shell presentation; Agent owns inspection, targeted extraction and proof recipes. They consume published Engine capabilities; Agent uses Record for the standard outcome and may use Engine directly for specific operations. Engine must not import their product implementations or Connect/Public. Connect owns delivery/viewing policy; Shared holds reusable UI, schemas and utilities rather than displaced owner policy.

Preserve one authoritative persistence mutation contract across languages. Keep the working legacy path until its replacement and consumers are accepted; never introduce competing config writers or two implementations of the same visible surface. Document changed routing, rollback and removal conditions. Verify real callers, builds and packaging before removing donors. Delete verified dead code/tests/references rather than archiving them; check compatibility/data readers and other owners' reservations first. See [refactoring guidance](enablement/refactor.md).

Make TypeScript policy testable without Rust or Electron, renderer behavior separately, and bridges against real providers. Prove claimed owner build independence in a clean environment without Rust tools or cached Rust outputs; a file move or mocked bridge is insufficient. Connect and Public target zero repo-owned Rust/build dependency. Shared/composition must not reintroduce Rust into a TypeScript owner's development loop. The existing root Rust app remains authoritative for capabilities not yet adopted; do not add shims, crates or services merely to simulate ownership.

Use TypeScript for web code, scripts, tests and tooling. Do not add Python or authored JavaScript files without explicit approval; necessary fixes to existing files and tool-required configuration formats are allowed. Keep generated deployment JavaScript outside Git. Change Cargo manifests/lockfiles only when needed by the task.

## Ownership and references

These are ownership targets, not claims of completed migration. Engine's destination is top-level `engine/`; `capture/engine/` remains the legacy app runtime until capabilities are adopted through their public contracts with real callers, tests and package inputs.

| Owner | Home | Start here |
|---|---|---|
| Engine | `engine/`; legacy `capture/engine/` | [Capability adoption](engine/README.md), [capture](capture/engine/docs/capture.md), [keyframes/text](capture/engine/docs/keyframes-and-text.md), [export/retention](capture/engine/docs/export-and-retention.md) |
| Record | `record/` | [Storage](record/storage/README.md), [completion](record/completion/README.md) |
| Desktop | `capture/desktop/` | [Settings/permissions](capture/desktop/docs/onboarding-and-settings.md), [Linux](capture/desktop/docs/linux/linux.md), [motion](capture/desktop/docs/motion.md), [iPhone/routing](capture/engine/docs/iphone-and-routing.md) |
| Agent | `capture/agent/` | [Agent video workflow](capture/agent/docs/agent-video-workflow.md) |
| Connect | `connect/` | [Hosted web](connect/docs/hosted-web.md), [client](connect/docs/hosted-client.md) |
| Public | `public/` | [Website/deployment](public/site/docs/pages-deploy.md) |
| Shared | `shared/` | Reusable UI, schemas, assets and utilities |
| Enablement | `enablement/` | [Verification/CI](enablement/docs/continuous-delivery.md), [local checks](enablement/local-tests/README.md), [commit hook](enablement/directory-width/README.md) |

`composition/` contains CLI/composition wiring; capture-internal shared mechanisms stay in `capture/`. Read the relevant owner guidance before changing a subsystem. Keep documentation concise and beside its owner. The preserved migration branch is a source for bounded reviewed ports, not a branch to merge wholesale; [baseline details](enablement/docs/continuous-delivery.md#preview-baseline-restoration).

## Work and verification

Use judgment to choose the smallest coherent change and proportionate testing and review. Read-only subagent review is allowed when useful. Respect other writers and explicit holds, keep reservations narrow, and release them with the exact contract/commit and remaining gates. Repair necessary prerequisites within scope rather than stopping at a failed diagnostic; a retry cap limits repetition, not independent investigation.

**Shared Electron/React UI and platform-independent TypeScript behavior can be verified on Linux.** Test changed OS-specific behavior on the affected OS, using NoMac for macOS when needed. Native capture, permissions, window integration and packaging require relevant platform checks; shared renderer proof alone does not establish those effects. For Linux native GUI work use the isolated VM procedure in the Linux guide, not a host app or another worker's VM. Physical-device behavior needs suitable hardware. Existing required CI and branch protections still apply.

Choose checks by changed behavior, not commit IDs. Reuse evidence only for unchanged relevant inputs and identify its source. Inspect the actual changed renderer for UI work and relevant real bundle text/images for output changes; documentation/tooling-only work needs no capture. Distinguish tests, GUI/native proof, permission state and publication, and report unrun checks or gaps honestly. Never turn a build, CLI help or bundle path into proof of downstream behavior.

On Clanker run heavy builds/tests and hook-backed pushes once through `/home/simon/.local/bin/t3-build`, honoring its job allocation and temporary-output rules. See [verification commands and prerequisites](enablement/docs/continuous-delivery.md#local-verification). Rebuild the executable after Rust changes before running it; `cargo test` does not rebuild `target/debug/apparent`.

## Delivery

For implementation work Simon authorizes in `tryapparent/apparent`, finish through merge into `main` and passing CI for the exact landed commit, without repeated code-review/merge approval. Use short-lived, coherent PRs against current main; preserve trunk usability and explicit task/release holds. Follow failures caused by the change through repair and verification. Normal automatic CD consequences are authorized; separate activation, destructive migration, access, spending and external-message restrictions remain. Other repositories normally receive a scoped commit and draft PR unless authorized otherwise.

Use authenticated `gh` for GitHub operations. Watch workflow runs with `gh run watch <run-id> --exit-status` and a foreground wait, not scheduled automations. Honor harness-mandated PR watch/yield rules. Use existing completion notifications and resume ownership; stop for an explicit pause, a genuine blocker with no useful authorized next step, or a required orchestration yield. Analysis-only work ends with the requested analysis.

Keep CI aligned with owner directories and their actual shared/composition/build consumers; unrelated changes should not rebuild or deploy another product. Preserve required-check admission and pending deliveries across unrelated main pushes. Detailed selectors, commands and publication procedures belong in the [CI guide](enablement/docs/continuous-delivery.md); releases follow the [release guide](capture/desktop/docs/release.md).

## Safety and resources

- Keep private captures, transcripts, credentials and personal data out of public artifacts. Use synthetic/sanitized evidence. Preserve others' work and real user data; ask before destructive or ambiguous deletion, access/spending beyond existing authority, provider-setting changes or contacting people. Reasonable isolated synthetic end-to-end tests within existing authority are allowed; clean up only identified test artifacts.
- Old bundle session metadata does not authorize forwarding captures. Use `apparent copy <bundle>` for clipboard handoff; separate delivery to a person, organization or session requires permission. Search existing issues before filing a report.
- Never reset Kit's real TCC grants, wake/flash the Studio displays, record/benchmark its real screen, play test audio aloud on Kit's Macs or post tests to a real OpenCode session. Use isolated/approved test environments and the [screen safety gate](capture/desktop/scripts/perf/screen-guard.sh). Follow the Settings guide for installed Mac testing; signing and update storage remain outside disposable output.
- NoMac: **$2 cumulative per canonical repository/issue (or standalone PR); each session at most $0.50 / 30 minutes**, normally with a 300-second idle timeout. Existing spend and concurrent reservations share that budget; retries/branches/derived issues do not reset it. Narrower task limits win. No top-ups or session extensions are included; work without an issue/PR needs an approved budget bucket. [Queue, ledger and cleanup procedure](enablement/docs/continuous-delivery.md#nomac-verification).
- When Simon says “make it apparent,” follow [the skill](capture/agent/skills/make-it-apparent/SKILL.md), inspect the complete recording and deliver a playable video in the conversation with truthful limits.

On Clanker, follow `/home/simon/AGENTS.md`: disposable helpers, diagnostics, build/test output, screenshots, proof media, fixtures and VM runs belong in private `/tmp/apparent-dev-<job>-<run>/` jobs. They may be cleaned during verification; regenerate them. Durable evidence elsewhere requires an explicit retention request. Canonical repositories, tools, required application data/config, bounded existing caches, VM templates and real private captures retain their proper locations; this is not authority to move/delete existing data or change cleanup services.
