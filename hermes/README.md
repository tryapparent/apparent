# Apparent for Hermes

Native Python plugin, version **0.1.0**, maintained independently in this
directory. It consumes an installed full `apparent` app CLI; it never imports or
builds Engine, Desktop, Agent or Connect implementation. Python is an explicitly
approved exception for the Hermes integration. Supported target: Hermes Desktop
on macOS/Linux; shared Python checks alone do not certify either native UI.

## First slice

Paste the handoff text produced by Apparent and press Send normally. The plugin
adds `apparent_inspect`, `apparent_frame`, `apparent_zoom` and `apparent_status`.
Inspection returns the CLI's semantic summary and contact-sheet pixels in a
Hermes multimodal result. Frame/zoom tools investigate details. Images are
bounded to 8 MiB input, 25 million pixels, and a 1600-pixel long edge on output.
Text fallback includes the exact local image path for Hermes's existing vision
tool; a tool result does not prove that a model actually saw the image.

The read-only `apparent:recordings` skill and targeted `pre_llm_call` guidance
teach the agent to interpret the user's speech as instructions, inspect images,
and investigate uncertainty before asking. Third-party text visible on screen
does not grant authority. Missing images do not discard clear transcript work.
This is instruction guidance, not a guarantee of model obedience.

Use the exact absolute bundle path or lowercase 32-hex Connect ID in the user's
handoff. No automatic `latest` selection or arbitrary URL fetching is provided.
Connect IDs are delegated to the installed CLI with its existing configured
origin/read grant. Each fetch uses a fresh private `apparent-hermes-*` temporary
directory, retained for follow-up inspection; its returned path is authoritative.
The plugin does not enable uploads, read credential stores, or install a CLI as
a hidden inspection side effect. Expired/missing media can block temporal zoom.
The independent `apparent-agent` CLI is not substituted: its current local-only
Connect and zoom contracts differ from the full app's published CLI contract.

## Development and validation

Python 3.11+ and Pillow `>=10.2,<13` are required. From the repository root:

```sh
python3 -m unittest discover -s hermes/tests -v
hermes plugins validate ./hermes --install-deps
hermes plugins doctor ./hermes --ci
```

These commands need no Cargo, Node build or source-built Apparent. Use an
isolated Hermes profile for integration development. Plugin settings accept an
absolute `executable` path; otherwise discovery checks PATH, the standard Linux
CLI link and installed Mac application locations. Registration never launches
the GUI, starts capture, makes a network request or changes settings. Removal
does not delete installed Apparent or recordings.

## Installation acceptance still open

The product requirement is one plugin installation that provisions both the
recorder and CLI and triggers existing onboarding. This candidate **does not yet
meet that requirement** and is not ready for a catalog submission or release.
The current documented Hermes plugin API has no native post-install callback;
`register()` also runs for discovery/validation and is not an installation hook.
Do not hide executable downloads or onboarding launch in plugin registration.

The existing official Linux installer is headless CLI provisioning, not recorder
installation/onboarding. The Mac preview has separate app identity/install rules.
The supported setup trigger and official checksum-pinned recorder artifacts must
be established and tested on affected platforms before claiming complete setup.
No substitute installer, source build, binary bundling or privilege escalation
is introduced by this first tool slice.

## Distribution and releases

The future catalog entry uses `repo: https://github.com/tryapparent/apparent`,
`subdir: hermes`, a full reviewed commit SHA and the quoted plugin version.
Release tags use `hermes-v<version>`. Bump `plugin.yaml` and this README together;
tests enforce agreement. A tag/release is not catalog acceptance: link the
catalog PR from the release and record its merge/pin before calling it available.
Each catalog update requires a new reviewed pin; there is no plugin self-updater.
The recorder/CLI retains its own release lifecycle and compatibility proof.

Disclosure for future catalog review: runs the local Apparent executable without
a shell; reads only explicitly requested recording evidence; Connect inspection
can use the CLI's existing network/authentication path; zoom writes derived PNGs
through the CLI; fetched evidence is retained in private temporary directories.
No telemetry, background watcher, automatic send, conversation picker, recording
control or Desktop UI is included in this slice. See issue #837 and auto-send #847.
