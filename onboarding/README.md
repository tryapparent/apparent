# Onboarding

Own first-success teaching, practice and progress. Composition injects recording and delivery capabilities and assembles owner public surfaces; do not import sibling product implementations. Do not duplicate Record or Connect. Settings sections belong to their outcome owners.

This is the canonical top-level owner root, not a claim of completed migration. Put owner-specific enablement under enablement/ here. See the root AGENTS.md and shared/enablement/dependency-policy for enforceable boundaries.

The welcome tour is optional. **Later** and window close save its place and
silence startup. A successful recording keeps future launches quiet. Open
**Resume setup** in Settings → About to pick up a saved tour or **Show welcome
tour** to replay a finished one. Skipping the pen or shortcut practice keeps
the current choice. Recording entry points use the effective Record shortcut
or visible capture controls and surface permission repair for actual blockers.

The desktop build compiles the TypeScript launch policy for use before a
renderer starts. Electron and the native fallback share the Rust adapter and
its durable configuration transaction. The existing `seen` and `resume`
fields retain their meaning and a separate `deferred` flag records dismissal.
Earlier builds ignore the new flag and may reopen an unfinished tour on launch.

## Package releases

Onboarding versions independently of the desktop app. Change the version in
`package.json` and refresh its npm lockfile and Composition's local dependency
entry when delivering a new package. The Onboarding workflow checks and packs
the package and installs the archive into a clean Node project. A successful
main push publishes the checked archive, SHA-256 checksum and source receipt
under `onboarding-v<version>` on GitHub Releases. Identical repacks reuse the
published version. Changed bytes require a new version.

Download the tarball and checksum from that release, run
`sha256sum -c apparent-onboarding-<version>.tgz.sha256`, then install it with
`npm install ./apparent-onboarding-<version>.tgz`. The desktop build continues to
bundle the local source through Composition. The package supplies policy and
the host contract for applications with their own native capture capabilities.

To check without publishing, run `node onboarding/enablement/ci/run.ts` followed
by `node onboarding/enablement/ci/pack.ts /path/to/new-output-directory`.
