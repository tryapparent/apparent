# Desktop enablement

Desktop owns the build, packaging, release, native proof, performance and local
installation tooling here. Runtime adapters and the shipped Electron frontend
stay in their product directories. The shipped Wayland clipboard helper stays
at `scripts/support/apparent-restore-clipboard.py`; it is an AppImage runtime
input, not development tooling. `scripts/legacy` retains unsupported Windows
tooling outside this migration.

## Callers and dependencies

- `release-mac-preview.yml` invokes `packaging/` and `release/` for the app, DMG,
  Sparkle feed and Homebrew publication; `release-linux.yml` invokes `linux/`
  for AppImages, codec/CPU smoke checks, signing and Main preview publication.
- `verification-platform.yml` invokes the same packagers, retained-candidate
  proof and `native/` drivers. Existing native gates, signing identities,
  candidate provenance, permissions and concurrency remain authoritative.
- `linux-updater-harness.yml` runs the `linux/gui/` and `linux/updater/` contracts.
- The shared local runner discovers Desktop regression tests here and consumes
  `local-tests/desktop-install.ts`; CI installation receipts invoke its owning
  regression test. The shared fixture copier includes that real implementation.
- `inputs.ts` supplies exact Desktop packaging and Linux driver facts to the
  central consumer graph. Admission, ancestry, cross-owner selection and shared
  execution remain in root Enablement; there is no second selector.

Run from the repository root. Existing relative paths retain their depth; all
active callers use this directory directly, without forwarding scripts. Existing
packaging assets/output names and runtime resource paths are unchanged. See
[release procedure](../docs/release.md), [Linux proof](../docs/native-testing.md),
[Mac preparation](mac/prepare.md) and [performance safety](perf/screen-guard.sh).

This migration does not claim independent Desktop compilation: the native app
still compiles root Rust and consumes Engine, Record, Shared UI and Connect.
The root native builder, prerequisite coordinator and release-admission verifier
remain cross-owner dependencies. Splitting their mixed native execution requires
contracts with those owners, rather than moving them into Desktop wholesale.
Rollback requires reverting this migration with its callers together. No config,
release activation or installed application state is migrated.
