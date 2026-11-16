# Apparent for Hermes — catalogue distribution 0.4.0

This is the complete Agent and Desktop package, including the reviewed, plain-text
`desktop/plugin.js`. The catalogue installs this directory at an immutable commit;
no package build, release download or self-update runs during installation.

Source, release identity and reproduction instructions are in [PROVENANCE.md](PROVENANCE.md).
The normal TypeScript sources remain in `hermes/desktop` on development Main.
This distribution branch is not intended to merge into development Main.

## Setup

Install Apparent through the Hermes catalogue after its maintainers approve this
pin. In Hermes Desktop, open **Capabilities → Plugins**, find the installed User
package **Apparent**, turn it **On**, and use **Rescan** after an update. Agent
activation and the Desktop switch are separate Hermes-owned choices.

Install the compatible native Apparent app separately on the recording computer.
The catalogue does not install or update it. Local recording needs an app containing
the trusted `apparent hermes record` and authenticated mailbox contracts (Apparent
Main commit `90cd546103bd557a2fdd4eae5a316eeca6029097` or a compatible successor).
On an SSH receiving host, install the Apparent receiving CLI and configure existing
Connect read access through Apparent's normal consent flow. No recorder or desktop
permissions are needed on that receiving host.

## Record and inspect

Click the purple **a** in the composer, record, then Finish in Apparent. Existing
OS permissions and first-run onboarding still apply. The plugin binds the result
to the original connection, profile and session. Typed drafts are preserved and
receive an inserted handoff; an empty draft submits once. Ambiguous sends remain
pending for manual recovery and are never replayed automatically.

Local chats receive the exact saved absolute `.apparent` path. SSH chats receive
only a Connect ID and require an existing upload pointer. No local path is sent
to the SSH receiver. The `apparent_inspect` tool accepts that exact path or ID and
returns transcript, time-aligned context and contact-sheet pixels; `frame` selects
a numbered keyframe. It never guesses the latest capture.

## Security and consent disclosure

- The composer control uses the public Hermes SDK and an explicit local profile's
  `shell.exec` route to launch the installed local Apparent CLI and read its
  request-specific, mode-0600 bridge HMAC key. A user click authorizes this trusted
  launch; it has no additional Hermes confirmation popup. Untrusted URI activation
  retains Apparent's confirmation gate. Native onboarding and OS capture consent
  are not bypassed. The key authenticates a bounded, loopback recording receipt;
  it is not a Hermes/provider/account credential.
- The Agent tool runs the separately installed `apparent inspect` / `apparent fetch`
  CLI outside the terminal sandbox, without an extra tool approval prompt. Its
  subprocess receives only PATH, HOME, TMPDIR and APPARENT_CONFIG. The CLI may
  access its own configured account and Connect endpoint (default
  `https://hosted.tryapparent.com`) to retrieve an explicitly supplied Connect ID.
  The plugin does not read credential stores, alter grants, sign users in, enable
  uploads, or install/update native software.
- Recording transcripts and image pixels are sent to the configured model provider
  as tool results. Connect snapshots are private temporary files removed after
  the image result is assembled. Recordings and source bundles are not deleted.
- A completion or dispatch receipt proves delivery state, not that the model
  understood the recording. Missing upload/read grants remain actionable errors.

## Verified scope and remaining limits

The production package passed isolated clean-package, Python inspection (Pillow
12/13), TypeScript routing/bridge and stock Hermes validation on Linux and macOS
for source commit `e7b8245f5cbd3ad6c76cdb49f3c898a761035c4a`. Installed Linux
Hermes local and real SSH/Clanker sessions successfully recorded, delivered the
correct source kind and invoked `apparent_inspect` with transcript/image results.
The Desktop button fix preserves a draft in real Electron form regression tests.

The current full installed macOS composer flow has not been re-run. Typed-draft
preservation across every real local/SSH route-switch case is not fully accepted.
Reply-video delivery from an SSH backend to the Desktop client is separate: a
backend-local file link alone does not establish playback on the client.
