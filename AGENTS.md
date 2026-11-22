# Apparent agent instructions

Apparent records screen, voice, cursor, clicks and ink for capture and handoff in `.apparent` bundles. Support macOS and Linux only. Retire existing Windows code in separately scoped work.

## Product

- Implement new ideas and feature explorations as default-off features in Settings → Labs. Preserve consent and permission gates.
- Keep Desktop focused on capture and handoff, with conventional UI mainly in Settings. Connect owns the recording-sharing workspace. Minimize stop-to-paste and stop-to-watch time, and distinguish a copied link from a recording ready to watch.
- Record known window, element, URL and session context. Preserve time-aligned transcript, interactions and absolute paths in bundle text. Cut keyframes on meaningful action or visual change, retain full frames when cropping and keep captions and metadata semantic.
- Use the authoritative mutation contract for `~/.config/apparent/config.json` across languages. Preserve unrelated keys and secrets. Document when changes take effect, reconcile OS-owned effects and check for active capture before changing or restarting the app.
- Share user-facing behavior across macOS and Linux. Inspect both consumers of shared changes and document platform differences.

## Architecture and migration

- **Migrate what you touch to Bend2.** Move changed decisions, validation, transformations and state transitions with their production callers, tests and build integration in the same PR. Keep any non-Bend implementation required by runtime, platform or integration constraints and name the blocker. Follow the [Bend guide](shared/enablement/bend/README.md).
- Desktop workflow, policy and UI changes must include the smallest usable Electron + React/TypeScript + shadcn slice in the same PR. Use `shared/ui` controls. Keep capture/media execution, native resources, durability and safety in native adapters. Bounded native correctness or security repairs that preserve the workflow need no UI port. Keep capture independent of UI responsiveness and measure affected performance.
- **Freeze `capture/` as a migration source.** Existing paths can be repaired, deleted or moved out under dependency checks. New paths, inbound moves and feature growth belong outside the donors. Follow the [dependency policy](shared/enablement/dependency-policy/README.md) for owner mapping, language rules and staged limits. TypeScript is the default for host/effect glue and tooling. New Python is restricted to `hermes/`, new Rust to `engine/`, and new authored JavaScript is forbidden. Keep generated JavaScript out of Git.
- Preserve a single visible surface. Keep working legacy paths until replacements and consumers are accepted. Document routing, rollback and removal conditions. Verify real callers, builds and packaging before removing donors. Check data compatibility and writer reservations before deleting dead code. See the [refactoring guide](enablement/refactor.md).
- Test Bend policy independently of Rust and Electron and verify bridges against real providers. Prove claimed Rust-free builds in a clean environment without Rust tools or cached outputs. Connect and Public target zero repo-owned Rust/build dependencies, including through Shared and Composition. The root Rust app owns capabilities still awaiting adoption.

## Ownership and references

| Root | Responsibility |
|---|---|
| [Onboarding](onboarding/README.md) | First success, practice and progress |
| [Record](record/completion/README.md) | Recording UI, capture, marks, bundles, transcripts, [storage and retention](record/storage/README.md), export and headless recording APIs |
| [Handoff](handoff/README.md) | Clipboard, paste, destinations, outbound intent, receipts and retries |
| [Connect](connect/docs/hosted-web.md) | Sharing, encryption, upload, auth, remote access, readiness and revocation |
| [Agent](agent/README.md) | Recording interpretation, inspection and extraction |

[Public](public/enablement/docs/pages-deploy.md) and [Hermes](hermes/README.md) own their products. [Engine](engine/README.md) and Shared supply capabilities. Composition assembles owner public contracts and Settings sections. Each stream owns its section’s UI, validation, persistence and effective state. Native window hosting is infrastructure. Mixed shell code with unknown ownership stays unclassified.

The public capability chain is Agent → Record → Engine → Shared. Only Record accesses Engine. Product siblings cannot import one another outside that chain, and no stream imports Composition. Composition supplies narrow interfaces and callbacks. Owners can use public Shared and declared external dependencies.

Each stream owns build, tests, packaging, delivery and diagnostics in its `enablement/`. Root Enablement owns shared execution and repository admission. Keep provider YAML thin and invoke owner entrypoints. Preserve routing to actual consumers, check identities, permissions, concurrency and artifact provenance. Migrate tooling with its callers, tests and delivery inputs. See the [CI guide](enablement/docs/continuous-delivery.md#stream-owned-delivery).

## Verification

Choose proportionate checks for changed behavior and verify boundaries with real producer outputs. Reuse evidence only when relevant inputs match and cite its source. Inspect the changed renderer for UI work and real bundle outputs for output changes. Report test, GUI, permission and publication evidence and gaps.

Use Linux for portable logic and shared Electron UI. Compare migrating a small legacy UI slice with booking Mac time. Verify changed native behavior, permissions, window integration and packaging on the affected OS. For Linux native GUI work use your [isolated VM](capture/desktop/docs/linux/linux.md), never the host or another worker’s VM. Physical-device behavior needs appropriate hardware.

## Delivery

For Simon-authorized work in `tryapparent/apparent`, finish through merge into current `main` and passing CI for the exact landed commit. Honor holds and branch protections and repair failures caused by the change. Normal automatic CD is authorized. Separate activation, destructive migrations, access, spending and external communications require their own authority. Other repositories normally receive a scoped commit and draft PR.

For shipped Desktop changes, verify a publicly downloadable Development installer on Linux Main and/or macOS Nightly for each affected platform. Follow a superseding release candidate if it contains the change. Report direct links and shipped SHA, or the exact publication blocker. Use the [Composition release guide](composition/enablement/release/README.md).

Use authenticated `gh` and the [issue traceability contract](shared/enablement/issues/README.md). Use `Closes` for complete issues and `Refs` for partial work. Confirm closures appear under GitHub’s linked Development view. Use T3’s PR watch as the sole observer for covered checks and reviews and yield as directed. For a separate run, use a supported exact-run notification or one bounded foreground observer for its ID, SHA and attempt. See the `github-operations` skill. Before yielding, name the actual prerequisite and what will resume work.

## Safety and resources

- Draft `apparent feedback` for even minor friction or workarounds, continue the task, and ask once at handoff before sending the sanitized drafts.
- Keep private captures, transcripts, credentials and personal data out of public artifacts. Use synthetic or sanitized evidence. Preserve real data and other writers’ work. Clean up only identified test artifacts. Ask before ambiguous or destructive deletion, provider-setting changes or contacting people.
- Use `apparent copy <bundle>` for clipboard handoff. Sending a capture to a person, organization or session requires permission. Search existing issues before filing reports.
- Never reset Kit’s real TCC grants, wake or flash Studio displays, record or benchmark its real screen, play test audio on Kit’s Macs or post tests to a real OpenCode session. Use approved isolated environments and the [screen safety gate](capture/desktop/scripts/perf/screen-guard.sh).
- NoMac limits are **$2 cumulative per canonical repo/issue or standalone PR** and **$0.50 / 30 minutes per session**, normally with a 300-second idle timeout. Count existing spend and concurrent reservations across retries, branches and derived issues. Narrower task limits win. Require an approved bucket for untracked work. See [queue, budget and cleanup](enablement/docs/continuous-delivery.md#nomac-verification).
- On Clanker, follow `/home/simon/AGENTS.md` and use a private `/tmp/apparent-dev-<job>-<run>/` for disposable artifacts. Keep native signing and update storage outside disposable output.
- For “make it apparent,” use [the skill](capture/agent/skills/make-it-apparent/SKILL.md), inspect the complete recording and deliver a playable video with truthful limits.

## Staged code

Do not add or change lexical code comments, including doc comments and tool directives. Existing comments may remain or be deleted. Follow the [staged dependency policy](shared/enablement/dependency-policy/README.md#lexical-comments).
