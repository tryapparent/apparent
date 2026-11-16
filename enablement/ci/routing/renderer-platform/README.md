# Finite Settings renderer admission

The selector's reviewed Settings set contains four existing cards: `storage.tsx`,
`retention.tsx`, `error-reporting.tsx` and `reference.tsx`. They render React controls
and call the restricted `window.apparent` bridge or Record's Storage controllers
through `src/storage/transport.ts`. They do not implement Darwin window, permission,
capture, packaging or persistence adapters. The obsolete `connect-settings.tsx`
name cannot qualify as a regular modification: adding it retains Mac verification.

The allocation bug crosses three boundaries:

1. `select.ts` marks regular card modifications `macos=false`, `mac_rust=false`,
   but its CLI's `macEnabled = result.macos || !mac_rust` keeps Desktop in `mac_plan`.
2. `native-sharing/run.ts --plan` reconstructs `macos=true` from that Desktop flag.
   `checks.yml` additionally admits Mac whenever `mac_rust=false`.
3. `verification-platform.yml` packs selected Desktop into the Mac `rust` fallback.
   Simply clearing the caller condition also leaves `evidence.ts --admit` expecting
   a successful Mac result for the stale plan.

The bounded correction is to project with `macEnabled = result.macos` and remove
the `mac_rust=false` alternative from the caller's Mac condition. The reusable
workflow needs no change. `style.css` remains Mac-required because it reaches
other surfaces, including the pill. Bridge, transport, permissions, main/preload,
dependencies, packaging, native, unknown and mixed changes retain Mac admission.
Additions, deletions, renames and unsupported modes do not qualify. Manual and
release callers retain their default full native plans.

Linux retains `npm test`, the full `test:electron` command and root/native bridge
verification. Its Electron inventory includes Storage, retention, selected
reference and Connect smoke coverage. Mac's focused `test:electron:mac` covers
Hermes hide/focus and pill window/native assertions; those implementations remain
Mac-required. Installed Storage/reference native fixtures also consume the cards,
but already required `mac_plan.root=true`: card-only deltas already skipped those
fixtures. This correction removes the unrelated Mac allocation, preserving that
native guard and Linux's rendering/bridge proof. Changes to native providers and
workflow definitions retain the installed Mac gates.

`admission.test.ts` commits actual source blobs in isolated Git repositories and
runs both real selector CLIs, evaluates the actual caller/reusable YAML conditions,
and executes final Mac admission. The normal `bun test enablement/ci/` contract
discovers it. No renderer, bridge or native test command is removed.

Expected allocation benefit is **one Mac job to zero per qualifying delta**.
No qualifying hosted duration or occurrence rate has been measured. Current-main
run `43907593853`, attempt 1, commit `db51bba0`, succeeded: Mac job `133443597773`
ran 16:41:44–17:11:03 UTC on 2026-11-16 (1 × 1,759 seconds allocated). That was a
full native change, not this renderer-only case, so its duration is not a savings
estimate. Queue delay, overlapping Linux work and workflow wall time are separate.
The older retention commit `7617fc0` also edited its smoke test and would remain
Mac-required; its hosted run must not be counted as an avoided allocation.
