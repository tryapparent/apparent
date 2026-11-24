# Settings Contract Implementation Plan

**Goal.** Every saved desktop preference is discoverable and editable without opening Settings. Its canonical JSON path follows the pane where it is displayed.

**Architecture.** Each product owner defines its preferences. Composition assembles the Settings catalog and supplies the same contract to Electron and the CLI. Shared provides the private, atomic config transaction. Owners retain policy and effects.

**Tech stack.** Bend2 for changed preference decisions, TypeScript and React for catalog assembly and presentation, and the existing native host for config, CLI and OS effects.

## Architecture migration

The original [Settings migration](https://github.com/tryapparent/apparent/issues/530) chose a single Electron window and a Settings development loop that can use an unchanged native backend. The installed window has shipped. This plan advances policy ownership and build independence through the preference slices. The current [ownership rules](../../../AGENTS.md#architecture-and-migration) put touched pure policy in Bend2 and use TypeScript for host glue.

- Record owns picker, transcription and Storage semantics, including their defaults and compatibility transforms. Labs is a pane that composes owner controls. Handoff supplies its auto-paste and T3 contracts, Agent owns speaking style, Onboarding owns its experiments, and Connect supplies its existing account and consent flows. Composition owns navigation, catalog assembly and dispatch.
- Adopt each owner's contract in the real callers before retiring the matching raw key reads, defaults and request handlers from the legacy Settings host. Reuse the installed Electron shell and Record Storage's existing headless controllers. Keep the shared native transaction for publication and native adapters for OS facts, registration, capture and filesystem safety.
- Prove an owner-only Settings edit in a clean environment without Cargo, rustc or cached build outputs. Build/test the owner package and run a real Settings interaction against a pinned, unchanged native backend. Record the exact commands, backend identity, elapsed time and Rust invocations against the existing edit-to-test baseline. A picker change that regenerates an embedded native policy table still needs a native build. Track that boundary separately from the owner-only development check.

## 1. Inventory and define the contract

- [ ] Assemble a coverage fixture for General, Recording, Storage, Permissions, Agents, Labs and About from `composition/settings/renderer/shell.tsx` and the installed Settings entry at `capture/desktop/ui/frontend/src/settings.tsx`. For every persisted control, record its owning pane, current key, default, reader, writer, platform, reload point and CLI equivalent. Include dynamic controls and controls rendered in multiple places. A secondary control references the original preference ID.
- [ ] Create the definition format in `shared/settings/` and the assembled catalog in `composition/settings/preferences.ts`. Each entry supplies a stable `pane.preferenceName` ID, label, value type, validation, default and availability, and application timing. Use stable names such as `labs` and `permissions` while allowing the displayed heading to change. Use the ID as the canonical JSON path. Keep credentials and runtime receipts outside the public catalog. Permission status comes from the OS, and sign-in and installation use their existing commands.
- [ ] Define `apparent settings list [pane]`, `get <id>`, `set <id> <json-value>`, and `reset <id>`, with `--json` for automation. Return saved and effective values, source (explicit, legacy, default, or system override), availability, and application timing. Represent absence separately from explicit JSON null. Reject unknown IDs, invalid values and writes unsupported on the current platform. Omit private and secret-bearing fields from output.

## 2. Move two preferences through the full path

- [ ] Start with `permissions.skipScreenSelection` and `labs.localStreamingTranscription`. Trace picker readers and writers through `record/settings/permissions/permission-policy.bend`, `engine/permissions/settings.rs` and `engine/recording/selection.rs`. Trace streaming through `capture/desktop/settings/labs/mod.rs`, `capture/desktop/coordinator/recording.rs` and `engine/recording/model-cache/resident_final.rs`. Verify the base's picker default before editing because that change has its own delivery thread. Preserve effective defaults, explicit choices and platform behavior.
- [ ] Add failing fixtures for legacy-only, canonical-only, conflicting values, absent values and malformed canonical values. Resolve canonical first. A present invalid value uses the owner's fallback and returns a diagnostic. Translate legacy `chooseScreenEachTime: false` to `skipScreenSelection: true` and invert the other boolean as well. Prove that the value drives both the switch and the next capture.
- [ ] Round-trip set, reset, failed writes and concurrent unrelated writes through the transaction in `shared/handoff/config_store.rs`. While older installers remain selectable, write the canonical field, the previous format and its compatibility value together. Recognize a later write from an older app when the canonical value still matches the previous write. Reset clears both fields and the compatibility value. Verify older Stable and fallback launches preserve reporting opt-outs and retention limits.
- [ ] Add the CLI in `composition/cli.rs` and connect the two existing Settings actions to the same preference operations. Use pane-bound IDs in the Electron bridge and keep its restricted payloads. Route changed defaults, validation and transforms through owner Bend2 builds. Reuse Record's checked native decision-table path where the native reader requires it. Wire the policy to all normal consumers and package inputs. Keep new paths outside `capture/`.

## 3. Require the contract in CI

- [ ] Add `enablement/ci/settings-contract/check.ts` and its contract tests. Validate the assembled catalog for duplicate IDs, collisions with legacy aliases and pane mismatches. Require registered bindings for persisted controls in migrated panes. Check real action registrations and production read/write entrypoints. Use syntax-aware checks for direct application config access and keep an exact, shrinking baseline of unmigrated call sites. Limit access to the shared writer, owner adapters and compatibility readers. Include a failing fixture for each violation, including a raw writer call and a Labs binding using a Permissions ID. Document which indirect calls static checks can detect and use runtime contract tests for the remaining paths.
- [ ] Wire the check into existing required repository verification via `.github/workflows/checks.yml` and its routing under `enablement/ci/`. Run it for catalog, owner, UI bridge, CLI, writer and verifier changes. Add a routing test for each input class and verify a rejected fixture fails the required job. Keep release and pre-push checks on those same inputs.

## 4. Migrate the remaining controls by owner

- [ ] Move the rest of Permissions and Labs, then General, Recording, Storage, Agents and About. For each pane, migrate the installed control, CLI entry and all production consumers together. Remove the pane's legacy call-site allowances after tests pass. Keep config aliases in the compatibility reader while older files are supported.
- [ ] Cover side effects with the owning adapters. Shortcut changes must report actual registration. Launch at login must report OS approval and reconciliation. Retention must preserve explicit null. Performance reporting must rotate its consent revision in the same write. Connect consent and revocation must use their existing guarded operations. For live effects, report applied, pending or refused from the provider and test each reachable result.
- [ ] Update `capture/agent/skills/apparent/SKILL.md` to use the headless commands and verify the effective value. Link the CLI help and owner docs to the same contract. Declare the migration complete when every persisted control has a catalog entry and production has no remaining raw preference call-site allowances.

## Verification and delivery

Run failing fixtures before each change and rerun them through the production entrypoints after it. Use disposable configs and synthetic values throughout.

```sh
node --experimental-strip-types --test enablement/local-tests/settings-contract.test.ts
node --experimental-strip-types enablement/ci/settings-contract/check.ts
node record/enablement/ci/bend/check.ts --proof
cargo test --locked screen_selection
npm test --prefix capture/desktop/ui/frontend
xvfb-run -a npm run test:electron --prefix capture/desktop/ui/frontend
```

The first two commands are deliverables of stage 3. They must pass on the branch with the checker enabled and fail on deliberately broken fixtures. The other commands exercise the existing policy, native and Electron suites. Add the real CLI integration test to check saved/effective output, reset and errors using `APPARENT_CONFIG`. The Electron bridge suite uses a synthetic parent. Verify the exact installed build on isolated Linux Wayland and macOS with the real host, including CLI-to-UI and UI-to-CLI round trips, next-capture behavior and restart. Follow the repository design skills and check the affected panes at the supported sizes and themes, including keyboard operation and error recovery.

For each shipped slice, require passing CI for the landed SHA and verify the applicable Linux Main and macOS Nightly installers. Record the tested SHA, installer links and native evidence. See [Desktop release](../../../composition/enablement/release/README.md).
