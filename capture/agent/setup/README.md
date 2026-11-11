# Hermes setup

`apparent setup hermes --check --json` diagnoses without installing, starting
capture, launching a URL, loading plugins, stopping processes or writing settings.
Requires Node 22.23+ on PATH; archive repairs and archive tests also need tar and gzip. The installed CLI embeds this Agent-owned TypeScript
policy; native composition only transports arguments/status. No source checkout,
Rust tools, Electron or cached Rust output is needed to run the policy.

Use `--profile /absolute/active/hermes/profile` to inspect that profile's
`plugins/apparent` Agent source, compiled Desktop half and compatibility manifest.
No profile is guessed and no filesystem tree is scanned. Installed and configured
are separate from actually loaded. Setup does not use `plugins doctor` as proof
of a working button, parse private Hermes settings or run discovery that may
write caches. Activation and loaded SDK capabilities remain unknown until checked
in the intended Hermes session. A package declaration is not runtime compatibility.

JSON schema version 1 contains `mode`, `ready`, `checks` and `repairs`. Each check
has a stable `id`, `status` (`ok`, `absent`, `unknown`, `incompatible`), detail and
optional action. Missing provider output, timeout, invalid JSON, null running or
installed updater identity and unavailable capture control mean unknown, not idle
or absent. A live `capture state` reply can include `app: {schema: 1, version,
build}` from the answering GUI process. Setup compares that build label with
the installed CLI's `--version` on both platforms, so an older running app can
be detected even when Linux updater metadata is missing. Old apps without these
facts remain unknown. Only clean revision labels or complete matching updater identities
establish a build match; equal unidentified or modified labels remain unknown.
Neither a version mismatch nor an idle state authorizes
an automatic restart. `ready` requires every check to be ok; exit 1 means unresolved checks,
not necessarily a failed repair. Provider stderr is intentionally omitted.
A successful repair is rechecked and does not imply readiness or recording proof.

Without `--check`, supported bounded repairs are:

- Linux: when the selected URL handler has no actual desktop file, call the
  existing `apparent launch-handler install` writer. It preserves conflicting
  entries and native-launch opt-out, checks its own prerequisites and selects
  the handler. Setup reads the selected file and resolves its executable target;
  xdg-mime's answer alone is insufficient. A conflicting/stale existing file is
  reported for inspection, never overwritten by this command.
- With `--package /absolute/apparent-hermes-VERSION.tar.gz --sha256 EXPECTED_DIGEST
  --profile /absolute/profile`, verify the archive against the expected SHA-256
  obtained from the official release, snapshot it in a private temporary directory,
  reject unsupported paths and archive entry types, then extract and call
  the published package's `install.cjs` writer. This option executes that trusted
  installer. No download, arbitrary release selection or source compilation is
  performed. The package owner verifies owned file hashes, fills missing files
  idempotently and refuses modified files; unrelated files remain untouched.
  Hermes still owns dependency consent and Agent/Desktop activation.

The independent Hermes delivery owner supplies `install.cjs`, `apparent/`, and
`apparent/compatibility.json` (`schema: 1`, `plugin: apparent`, `hermes: >=0.23.0`,
`platforms: [linux, darwin]`). Setup is a consumer, not another package writer.
Until that artifact is published, obtaining it remains a distribution prerequisite.

The command cannot bootstrap a missing `apparent` executable. Follow the
[official installer prerequisite](../docs/installation.md), then rerun setup.
It does not guess an AppImage release, replace a broken PATH symlink, register
macOS LaunchServices, enable nativeLaunch, update the app or restart an older
running app. Use the existing platform installers/providers for these actions.
No recording or process stopping is attempted even when capture state is known;
unknown state never authorizes either. Native consent remains mandatory.

Independent policy verification, without Cargo or app artifacts:

```sh
node --test capture/agent/setup/hermes.test.ts
node capture/agent/setup/hermes.ts --check --json --profile /absolute/profile
```

Linux registration and updater providers are platform-specific. On macOS, the
read-only [LaunchServices query](https://developer.apple.com/documentation/appkit/nsworkspace/urlforapplication%28toopen%3A%29-7qkzf?language=objc)
resolves the selected application and its executable, then compares the real
target with this CLI. No handler returns absent; unavailable/malformed native
output remains unknown, and a different or missing executable is incompatible.
This lookup opens no URL, activates no app and performs no registration. Use the
official Mac installer for repairs. Installed native app URL
launch, actual Hermes button loading, native recording and end-to-end handoff
require separate real platform acceptance. Synthetic fixtures establish policy
and idempotence, not GUI or recording success. Live X1 is not a test fixture.

`node --test capture/agent/setup/*.test.ts` runs the policy suite independently.
On macOS it also registers and removes a unique synthetic URL scheme to verify
the real OS lookup without altering the actual `apparent` handler or launching
anything. That native contract is skipped on Linux, not counted as Mac proof.
