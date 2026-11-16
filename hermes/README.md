# Apparent for Hermes

Version **0.4.0**. Paste an Apparent recording handoff into Hermes and press
Send. `apparent_inspect` returns spoken instructions, timestamped interaction
context and contact-sheet pixels. Pass `frame` to read a numbered keyframe.
The bundled `apparent:recordings` skill guides inspection and work under Hermes's
existing approvals.

## Record from the composer

The **Record with Apparent** control keeps the purple Apparent mark beside the
composer. Clicking it starts the trusted local recording helper immediately;
there is no Hermes confirmation or completion popup. Apparent's normal first-run
onboarding and OS permission prompts still apply. Finish or cancel in Apparent.
Untrusted external `apparent://hermes/...` activation keeps the existing native
confirmation path.

The plugin pins the connection, profile, route, runtime session and stored
session captured at click time. Existing chats receive a handoff block alongside
their current draft; an empty draft submits once. For a fresh chat, it reads the
live draft, creates a session with the supported `session.create` `request_id`
and `source: 'gui'` fields, then opens the returned stored session through
`host.openSession`. It rechecks the current draft and route before navigation.
Draft text remains in the original composer if either changed. The SDK's dispatch
result confirms only local composer application, not backend receipt or model
completion.

Recording from SSH uses a helper shell session on an explicit local Hermes
profile route. The helper only reads the local signed mailbox key and starts the
local Apparent CLI; it never runs a command on the SSH receiver. Runtime contract
detection selects canonical session-scoped routing or the explicitly supported
legacy command-only route. Other RPC errors fail closed.

The capture-ID-bound handoff returns the exact saved bundle path and an optional
Connect ID, protected by the authenticated signed mailbox. Local conversations
always use the saved bundle path, even when Connect has an upload pointer or no
read credential. SSH delivery requires the existing 32-hex Connect ID. Local
paths are never inserted into a remote composer. Uploads, read grants and
credentials are never changed automatically.

A confirmed negative composer dispatch can be retried manually. A timeout or
uncertain dispatch remains pending for manual recovery and is never replayed
automatically. Reload does not start another recording. Discarding a pending
handoff does not delete its capture. Submission is not evidence that Hermes
received the backend request or that a model inspected the recording.

## Package and SDK requirements

Install the complete `apparent-hermes-0.4.0.tar.gz` and matching `.sha256` from
[Hermes releases](https://github.com/tryapparent/apparent/releases?q=hermes-v)
once published. Verify the checksum, extract to a private directory, then use
the normal Hermes plugin install, validate, doctor and enable flow. The installer
writes only `plugins/apparent`; it does not edit account settings or activation.

In Hermes Desktop, open **Capabilities → Plugins**, find the installed **User**
package **Apparent**, and turn it **On**. Stock Hermes keeps this Desktop switch
separate from CLI plugin enablement. The purple Apparent mark then appears in
the composer. Use **Rescan** after replacing an already installed package.

The Desktop SDK must expose `focusedSessionOwner`, `focusedSessionId`,
`focusedStoredSessionId`, `profileRoutes`, `requestProfile`, `openSession`, and
`composer.getDraft`, `composer.insertText` and `composer.submit`. An installed
Apparent app must contain the trusted `apparent hermes record` CLI and signed
mailbox bridge. The plugin does not register an OS handler or enable
`nativeLaunch`.

Build the plugin package independently with Node, the locked Hermes build
dependency and the shared static composer mark at
`shared/assets/brand/apparent-app-icon.svg`. No other owner sources or builds are
needed; isolated CI checks out only Hermes and that single asset:

```sh
npm ci --ignore-scripts --prefix hermes/enablement
HERMES_JOB=$(mktemp -d /tmp/apparent-dev-hermes-XXXXXX)
node --experimental-strip-types hermes/enablement/package.ts "$HERMES_JOB/release"
```

The standalone Record lifecycle package lives at `record/capture-request`. Its
build, typecheck and tests require Node/TypeScript and no Rust or Electron. The
Desktop frontend compiles and bundles its package output into the existing
Electron helper. Hermes package generation does not build or stage the frontend.

## Safety, rollback and removal

The public request token and port are not credentials. The native helper stores a
separate HMAC key in a mode-0600 file inside a mode-0700 runtime directory. Hermes
reads that key through the local shell route. Signed state, response verification
and a separate authenticated acknowledgement bind status and source facts to
that request. The loopback endpoint is read-only, bounded, and cannot control
capture or read arbitrary files.

Disabling the plugin removes the composer control; manual paste remains
available. Rolling back the plugin leaves local captures, app settings and
Connect preferences untouched. The native bridge continues to support the
untrusted URI confirmation flow and the legacy `source` field for older clients.
Keep that compatibility until installed packages no longer use the URI,
mailbox or `capture handoff` contracts. No catalog admission, release or installed
macOS/Linux acceptance is claimed by this source change.

## Inspecting recordings

The Agent tool accepts an explicit absolute `.apparent` bundle path (or its
`apparent.json`) or a lowercase 32-hex Connect ID. It never guesses the latest
recording. Local paths must be readable on the receiving host. Connect fetches
use the configured origin and existing read grant; missing approval and
pending/expired uploads remain actionable errors. The plugin neither enables
uploads nor reads credential stores.

Image reads stay within the selected bundle and reject traversal, symlinks and
non-regular files. Inputs are bounded to 8 MiB and 25 million pixels; output is
JPEG with a 1600-pixel maximum edge. Original files are unchanged. A Connect
snapshot is downloaded into a private temporary directory and removed after
result pixels are embedded. No Hermes provider credential is passed to Apparent.

Run the focused package checks with:

```sh
python3 -m unittest discover -s hermes/tests -v
node --experimental-strip-types --test hermes/desktop/*.test.ts hermes/enablement/distribution/*.test.ts hermes/distribution/cache/*.test.ts
```

The ordinary Hermes package build does not require Rust. Installed renderer,
local no-read-credential, remote SSH and native OS-consent acceptance remain
separate checks.

Engineering ownership, hosted gates and remaining cache migration are described in
[enablement](enablement/README.md).
