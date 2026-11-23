# Settings composition

The shared Settings shell assembles the installed Electron panes. About owns
its presentation and update-channel policy here. The installed entry supplies
the existing artwork and the restricted About bridge. Version identity,
clipboard, external links, update execution, persistence and native recovery
continue through their existing host and platform adapters.

The Desktop frontend build bundles the same update-channel policy into the
installed worker. Its test suite checks the source policy and executes that
worker with the repository outside its working directory. The About Electron
smoke exercises the installed entry and preload with a synthetic parent.
Native update execution and package acceptance remain platform checks.

## Installed routes and recovery

The native coordinator opens General from the menu bar, Linux tray and
controls, app shortcut, and the final onboarding action. Reopening an
existing Settings session from those entry points raises its current pane.
The launch request for an already configured app and the post-update reopen
target About. The recording pill can open Agents directly. In the installed
Electron window, General, Recording, Storage, Permissions, Agents, Labs and
About share one sidebar and window. The native session filters actions against
the active pane and passes native effects and preference writes to their
existing owners.

If the packaged renderer cannot launch or its connection exits unexpectedly,
Linux can open the in-process GPUI window and macOS can open the Swift Settings
helper. macOS builds no longer include or poll the GPUI Settings presenter.
Both platforms still use the native key-code translation for onboarding. The
Swift helper's own keyboard handling continues to exercise the macOS shortcut
adapter.

Recording and Permissions are active recovery routes. In particular, the
installed [Permissions verification](https://github.com/tryapparent/apparent/pull/1573)
observed the native route on Ubuntu GNOME when Chromium could not start with a
sandbox. That fallback lets users change recording preferences and repair
permissions without weakening the sandbox. In the fallback sidebars, entries
that ask the parent retry the packaged window. The others stay in the native
window.

| Pane | Linux GPUI sidebar | macOS Swift sidebar |
| --- | --- | --- |
| General | Parent | Parent |
| Recording | Parent | Parent |
| Permissions | Local | Local |
| Agents | Parent | Local |
| Labs | Parent | Parent |
| About | Parent | Parent |

Storage and Labs need the packaged renderer. If Storage cannot open in
Electron, the session opens native General.

On Linux, the channel preference selects the source named by the separate
install action, which may install an earlier version. When the check finds no
update, About shows the result without an install action. Selecting a different
source clears that result and offers its install action. About reads restart readiness
from the native AppImage receipt independently of the configured channel.
Dismissing the offer or closing a failed restart keeps **Restart now** available
while that receipt still shows a staged image. About names the installed
channel beside **Restart now**, with a valid Stable release tag or abbreviated
Development commit ID when available. If restart fails and the receipt cannot
be confirmed, the selected source is offered for another install. The header
displays the running build identity. macOS opens the Sparkle check.

On Apple silicon, Stable About includes a secondary **Download Nightly** action
under App updates. The host resolves the latest installer from the Nightly
appcast and opens the exact GitHub release asset. The separate Nightly bundle
checks its own Sparkle feed and shows its version and commit in About. Nightly
starts with fresh onboarding, settings, shortcuts and recordings, and both
bundles reuse verified downloaded speech models. Both apps can run together.

Updater diagnostics schema 6 adds Linux curl transfer milliseconds (0–600,000)
and downloaded bytes (0–1 GiB). Invalid or unavailable measurements remain null.
These facts identify partial downloads reaching the total deadline without
sending content, URLs, paths or raw errors. Deadlines, retries, transaction guards
and reporting consent stay unchanged. A late stall and a continuously slow
transfer may still need further investigation. New facts require an updated
package and a new consented occurrence; historical reports cannot be enriched.

## Recording

Recording opens directly to its microphone and recording controls. The Record
shortcut is in General, T3 sending is in Agents, and experimental preferences
are in Labs.

Recording joins General, About, Agents, Labs and Storage in
the same Electron document. The native Permissions sidebar routes Recording
through that Settings session. The session chooses the presenter, filters its
actions, and owns the existing config transaction. The Electron
host clears Recording facts and cancels pending acknowledgements on a route
change. A lost acknowledgement leaves the saved value uncertain until the
native state arrives. The native presenter remains available on missing or
failed Electron assets. It is the rollback path until the supported platform
and package checks qualify deletion of the legacy Recording presentation.

After the ordinary frontend bootstrap, run `npm run build` in
`capture/desktop/ui/frontend` to rebuild the installed Settings renderer and
Bend module on Linux. Run the existing `tests/settings/shared-shell.smoke.ts`
Electron test to verify navigation, keyboard operation, and save/refusal with a
synthetic native parent. For a real-provider check, stage the same Settings
package beside an unchanged native app built with the Recording bridge. Its
normal sidebar sends the same actions and writer acknowledgements. Pure pane
changes rebuild the JavaScript assets only.

## Permissions

The same Electron window presents Record's Permissions section and accepts its
actions only on the Permissions route. The renderer receives status and the
applicable repair affordance. The native presenter waits for an OS observation
started after the action before confirming a Recheck or applying a repair.
Returning to Recording cancels pending requests and closes any owned drag
guides. Screen Recording prompts come from Apparent, and the existing signed
helper handles microphone, camera, speech and the System Settings drag guide.
Reopening uses the guarded application restart and refuses while a capture is
active. On Wayland the command repairs input-device access, and screen
authorization stays with the capture-time portal.

The native pane remains the rollback when the Electron assets fail to open.
Retire the native presentation after installed macOS and Linux package
acceptance covers both routes, native prompt and recovery behavior and fallback
on the supported packages. The underlying native observations and effects
remain in use.
