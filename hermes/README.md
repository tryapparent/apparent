# Apparent for Hermes

Native plugin source candidate, version **0.4.0**. Paste an Apparent recording handoff into
Hermes and press Send. `apparent_inspect` returns the spoken instructions,
timestamped interaction context and actual contact-sheet pixels together.
Pass `frame` to read a numbered keyframe when a detail needs closer inspection.
The bundled `apparent:recordings` skill guides Hermes to inspect the images,
investigate uncertainty and act under its existing approvals.

The staged package keeps the Apparent mark beside the composer. Clicking it
starts the local Apparent recorder immediately; the helper shows no Hermes
confirmation or completion popup. Apparent's normal first-run onboarding and OS
permission prompts still apply. Stop or cancel in Apparent. A saved recording is
submitted through Hermes's supported composer API only while the captured
connection, profile, stored session and visible composer still match. Typed
drafts remain separate.

On macOS, a cold start of the installed `.app` uses Launch Services without
activating the app, so recording runs under Apparent's app identity rather than
the caller's terminal process tree. First-run setup and OS consent are still
required. Unbundled development executables use the direct launch route and do
not establish installed-app permission behavior.

For an unsaved chat, the plugin first reads the visible fresh draft, then uses
the route's supported `session.create` call with an `idempotency_key` and opens
the returned stored session through `host.openSession` with that route and
`awaitHydration: true`. It proceeds only after the SDK reports the returned
stored ID on the visible route. If needed, the original typed text is inserted
as a block into that identified composer; an occupied or changed composer is
left untouched and recording does not start. It never treats the generic
`"new"` composer address as the recording's final destination. If the original
conversation is no longer visible, delivery waits. A false or ambiguous
composer dispatch is retained for recovery and is never automatically retried.
The SDK's submit boolean and insert acknowledgement mean local composer
dispatch/application only, not backend receipt, so the plugin does not claim
Hermes accepted or completed the turn.

Recording can be started from a local or SSH conversation through the explicit
local Hermes profile route. Local bundle paths are sent only to local
conversations. SSH delivery requires an existing Connect ID; the plugin never
enables uploads or read grants or changes credentials. The recording keeps the
native consumed-request journal, signed loopback status and ACK checks. The
plugin uses the legacy `shell.exec` `{command}` shape and
`host.composer.submit(sessionId, text)`, without runtime identity or admission
RPCs.

This is a source candidate for Hermes Desktop on macOS/Linux, not a catalog
release. Installed local/SSH recording, fresh onboarding and actual composer
delivery still require native proof on the supported platforms.

## Desktop package and routing

The desktop half is TypeScript. Hermes loads `desktop/plugin.js`, so generate a
package before installing it to get the button:

```sh
npm ci --ignore-scripts --prefix capture/desktop/ui/frontend
node --experimental-strip-types hermes/desktop/package.ts /tmp/apparent-dev-hermes-JOB/plugin
hermes plugins validate /tmp/apparent-dev-hermes-JOB/plugin
```

Use a new private per-job `/tmp/apparent-dev-…` directory. This build needs Node
and the frontend's locked dependencies, without Rust or cached Rust outputs.
Install the staged package through Hermes's normal reviewed install flow, then
enable its Desktop and Agent halves. Source/Git installation alone has no
generated desktop entry. This command publishes no catalog artifact.

Requires the stock Desktop SDK's `focusedSessionOwner`, `focusedSessionId`,
`focusedStoredSessionId`, `profileRoutes`, `requestProfile` and composer APIs,
plus an installed Apparent build containing the native bridge. It uses an
explicit local profile route for shell work. It does not register an OS handler
or enable `nativeLaunch`.

The token and loopback port are public request identifiers, not signing keys,
gateway credentials or session IDs. Apparent writes the HMAC key to a
mode-0600 file inside a mode-0700 user runtime directory. Hermes reads it
through the local `shell.exec` route and keeps it only in memory. Authenticated
state reads, signed responses and an authenticated acknowledgement prevent a
listener that knows the public request ID from forging completion. The bounded
endpoint returns only this request's status and saved reference; it cannot
control capture or read arbitrary files. It binds IPv4 loopback, checks
Host/origin/signature and expires after one hour.

Composer submission is local dispatch only; it does not prove backend receipt or
model completion. The saved capture and its source remain in Apparent if delivery
fails. Disabling the plugin removes its control; manual paste remains available.

## Setup and use

Install a compatible full Apparent CLI on the **Hermes backend host** using the
[official agent installation guide](../capture/agent/docs/installation.md).
The existing app includes that CLI. The recording computer needs the full
recorder and its normal onboarding; a headless receiving backend needs only
the CLI and its runtime libraries, without capture permissions. Reuse an
existing installation. Installing this plugin does not install or launch apps.

For development, copy this directory into the active Hermes profile's
`plugins/apparent/` directory, run the validation below, enable it with
`hermes plugins enable apparent`, then start a fresh conversation. Dependencies
are Python 3.11+, stock Hermes >=0.23.0 and Pillow >=10.2,<14. Pillow 13 is
supported for Hermes's managed Python 3.14 environment. If the executable is not
on PATH, set the plugin's `executable` setting to its absolute app CLI path
through Hermes's plugin settings. No global Apparent settings are rewritten.

Paste the handoff generated by Apparent. The tool accepts an explicit absolute
`.apparent` bundle path (also its `apparent.json`) or a lowercase 32-hex Connect
ID, rather than guessing the latest recording. Local paths must be readable on
the receiving host. It uses the full installed `apparent` CLI:

```sh
apparent inspect /absolute/recording.apparent
apparent inspect /absolute/recording.apparent --json
```

For Connect it first runs `apparent fetch <id> --out <private-path> --wait 120`,
using the CLI's configured origin and existing read grant. Missing read approval,
pending/expired recordings and CLI failures remain actionable errors. The
plugin neither enables uploads nor reads credential stores. Follow the normal
CLI read-approval flow when needed. A 150-second subprocess deadline bounds
each CLI invocation; `--wait 120` is the fetch readiness budget.

## Evidence and privacy

Image reads stay inside the selected bundle and reject traversal, symlinks and
nonregular files. Inputs are bounded to 8 MiB and 25 million pixels; output is
JPEG with a 1600-pixel maximum edge. Original files are unchanged. Missing or
malformed visuals preserve clear transcript instructions and report uncertainty.
An image envelope alone does not establish that the model actually saw it.

Each Connect call downloads to a new mode-0700 temporary directory and removes
its snapshot on success or failure, once result pixels have been embedded. Use
the original ID for another keyframe request; this downloads again. Snapshot
paths in the CLI summary no longer exist after the call. Temporal zoom or a
separate text-only-model vision route can use the existing CLI to fetch into an
agent-owned private directory, inspect/zoom there, then clean up that download.
Local bundles remain available for normal frame/zoom/vision tools.

The plugin runs bounded subprocesses and reads only the explicitly selected
recording. Both the supervisor and CLI receive only `PATH`, `HOME`, `TMPDIR`,
and the documented `APPARENT_CONFIG` override when set. These preserve executable
discovery, saved configuration/authorization and temporary storage selection.
Provider keys, interpreter/loader overrides and arbitrary
`APPARENT_*` variables are not forwarded. Connect uses its existing saved
authorization; the plugin does not pass Hermes provider credentials to it.
Connect network/authentication belongs to the existing CLI. Loading
registers the tool, skill, message hook and desktop control; it starts no new
capture. An in-flight handoff can resume with its original destination and
message identity. No settings or credentials are rewritten.
Removing the plugin does not remove Apparent or local recordings. Private
transcripts and images must stay out of public issues and uploads.

## Verification and distribution

```sh
python3 -m unittest discover -s hermes/tests -v
hermes plugins validate ./hermes --install-deps
hermes plugins doctor ./hermes --ci
```

These checks need no Rust build. The repository check workflow runs the focused
suite on Linux and macOS. Integration proof separately exercises an installed
Apparent CLI and Hermes registry/model. Python is the explicitly authorized
Hermes integration exception; this package imports no application internals.

Plugin versions are independent of app versions. A future `hermes-v<version>`
tag and catalog PR must identify the exact tested SHA (`subdir: hermes`), with
the same version as `plugin.yaml`. No catalog submission or self-updater is
part of this slice. [#837](https://github.com/tryapparent/apparent/issues/837)
tracks the broader experience.
