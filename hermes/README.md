# Apparent for Hermes

Native plugin source candidate, version **0.4.0**. Paste an Apparent recording handoff into
Hermes and press Send. `apparent_inspect` returns the spoken instructions,
timestamped interaction context and actual contact-sheet pixels together.
Pass `frame` to read a numbered keyframe when a detail needs closer inspection.
The bundled `apparent:recordings` skill guides Hermes to inspect the images,
investigate uncertainty and act under its existing approvals.

The staged package also adds **Record with Apparent** beside the composer.
It starts the local recorder through a dedicated local Hermes helper session,
including when the selected conversation is on a remote backend. The plugin
locates the installed `apparent` CLI on macOS/Linux and calls
`apparent hermes record <request-id>/<port>`. This is a trusted local shell
invocation; no external URL or URL-handler confirmation is involved. Normal
Apparent permissions and capture controls still apply.
When Apparent is stopped, the helper starts its runtime with
`apparent launch --background` so Settings does not replace the recording target.
Required onboarding still applies; normal app launches continue to open Settings.

This is a source candidate for Hermes Desktop on macOS/Linux, not a catalog
release. Native direct-recording integration and fresh onboarding remain
platform acceptance gates.

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

Recorder adapters that preflight `capture state` must use
`captureCanStart` from `desktop/controller.ts`: both `idle` and `completed`
allow a new recording. `completed` is the saved recording's Paste controls;
selecting, starting, recording and processing remain occupied. This preflight
does not replace the native Start request's atomic admission check.

Requires SDK support for `focusedSessionOwner`, `focusedSessionId`,
`profileRoutes`, `requestProfile`, `retainProfile`, `session.create` and
`shell.exec`, plus a full Apparent build with the native `hermes record`
worker. Older SDKs fail before recording. Hermes must expose a local route and
permit its normal local terminal safety checks.

The plugin creates a separate local helper session and pins its route and runtime
identity. A public random request ID and loopback port correlate the worker; a
separate signing key stays in the local runtime directory and never enters plugin
storage or process arguments. Authenticated status and acknowledgement prevent a
listener that knows the public ID from forging completion. The endpoint is bounded
to that recording and cannot read arbitrary files.

Hermes retains the exact session, route mapping and gateway instance/profile/epoch,
checks them again, resumes that exact session on a retained socket, then calls
`prompt.submit` through that connection. Changed
runtime identities or mappings fail closed. Missing sessions never fall back
to titles. A new empty draft is submitted only if its fresh-draft identity remains
unchanged; text typed during recording is preserved and the recording instructions
are inserted as a block for review and manual Send. A lost reply gets one retry with the same `input_id` and
text, using admission deduplication. Further failure retains the reference; the
composer button checks/retries that same handoff. The command palette's
**Apparent: discard pending handoff** abandons delivery without deleting a recording.
Reload replays neither Start
nor a new message identity. Native replay receipts hold only consumed tokens
and creation times, not media or transcripts.

For remote destinations, delivery uses only the existing Connect source ID.
If no Connect ID exists, the local recording remains saved and the plugin reports
that Connect upload must be enabled by the user in Apparent; the receiving backend
also needs its normal read approval. The plugin never changes upload consent,
credentials or configuration. A pending upload ID does not prove the recording is
ready to watch. “Recording sent” means gateway admission, not model vision or a
finished agent turn. The prompt asks the receiving agent to use the
`capture/agent/skills/make-it-apparent` skill and include its playable reply video;
that skill must be installed in the receiving agent's environment.
Disabling the plugin removes its control; manual paste remains the fallback.
The native bridge remains required for authenticated recording status and source
handoff.

## Setup and use

Install a compatible full Apparent CLI on the **recording computer** using the
[official agent installation guide](../capture/agent/docs/installation.md).
The recording computer needs the full recorder and its normal onboarding. A
headless receiving backend needs the plugin's existing agent CLI and runtime
libraries, without capture permissions. Reuse an
existing installation. Installing this plugin does not install or launch apps.

For development, copy this directory into the active Hermes profile's
`plugins/apparent/` directory, run the validation below, enable it with
`hermes plugins enable apparent`, then start a fresh conversation. Dependencies
are Python 3.11+, stock Hermes >=0.23.0 and Pillow >=10.2,<14. Pillow 13 is
supported for Hermes's managed Python 3.14 environment. The local CLI is resolved
from PATH, with macOS installed-app discovery as a fallback.

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
recording. Connect network/authentication belongs to the existing CLI. Loading
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
