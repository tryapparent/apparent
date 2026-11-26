# Onboarding

Own first-success teaching, practice and progress. Composition injects recording and delivery capabilities and assembles owner public surfaces; do not import sibling product implementations. Do not duplicate Record or Connect. Settings sections belong to their outcome owners.

This is the canonical top-level owner root, not a claim of completed migration. Put owner-specific enablement under enablement/ here. See the root AGENTS.md and shared/enablement/dependency-policy for enforceable boundaries.

The welcome tour is optional. **Later** and window close save its place and
silence startup. A successful recording keeps future launches quiet. Open
**Resume setup** in Settings → About to pick up a saved tour or **Show welcome
tour** to replay a finished one. Electron setup tests the effective Record
shortcut. **Use shortcut** completes regular setup. **Change shortcut** opens
the native shortcut editor. Recording entry points use the effective Record shortcut or visible
capture controls and surface permission repair for actual blockers.

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

## Recording permission repair

The installed Electron setup window renders the permissions checklist and
the focused repair view from `renderer/permissions.tsx` using Shared
controls. Composition supplies current native observations and the blockers
identified by Record. The tour and the native fallback still use the
existing progress and request adapters, including the guarded screen
permission relaunch. The existing config writer owns progress and resume state.

The native fallback remains available when the Electron presentation cannot
open. An app rollback restores the earlier Electron renderer and native
permission routing together. Retiring the fallback or moving the rest
of the tour requires installed acceptance on macOS and Linux.

## Dictation app conflicts

On macOS, **Settings → Labs → Dictation app conflicts** saves the default-off
`labs.onboardingWisprFlow` preference. Existing
`experiments.onboardingWisprFlow` values remain readable.
The next shortcut setup visit checks for running Wispr Flow and Superwhisper
apps. The prompt names the apps it found and offers to keep them open or request
a normal quit. With both running, the quit action asks both to exit. A refusal
or timeout offers retry or continuation. The frog animation follows an observed
exit, then setup proceeds to shortcut selection. Neither app's settings change.

The Electron hosts share the Onboarding decision in `host/wispr.ts`, the
React screen in `renderer/wispr/`, and the AppKit adapter in `host/wispr-native.ts`. The
adapter looks up fixed bundle IDs and receives only the app set from the
current offer when quitting. Package consumers of `./wispr` now return app IDs
with a running result and receive that set as the provider's third argument.
Turn the flag off to bypass the prompt. Linux and the native fallback continue
directly to shortcut setup.

The Electron smoke uses synthetic detection and quit responses. Run
`APPARENT_WISPR_NATIVE_TEST=1 node --experimental-strip-types --test capture/desktop/ui/frontend/tests/onboarding/wispr/macos.test.ts`
from the repository root on an isolated Mac to exercise the AppKit adapter
against owned fixtures.

The Electron recording controls display the **Double-tap Shift to add a note**
tip for eight seconds on the third eligible recording start. Onboarding counts
real starts with both the Electron controls and note editor available, excluding
guided practice. It persists the count in
`onboarding.doubleShiftNoteStarts` through the existing config transaction.
The tip policy and native table are verified by
`onboarding/enablement/ci/bend/check.ts`.

## Frog after dictation

**Settings → Labs → Frog after dictation** saves `labs.dictationFrog`, off by default.
Existing `experiments.dictationFrog` values remain readable. On macOS, the
frog waves after the first, third, fifth, and subsequent odd-numbered input
sessions in Wispr Flow and Superwhisper. Each app has its own cycle.
Cancellations and microphone tests also count.
The observer reads per-app input state through Core Audio. It opens no input
stream and stores neither audio nor text.

The desktop coordinator supplies current capture state. Onboarding's
Bend policy admits the transition and the existing config transaction reserves
the cycle position in `onboarding.dictationFrogAlternation` or
`onboarding.superwhisperFrogAlternation`. Upgrading starts a fresh cycle for
each app. Turning the experiment off pauses progress. The Labs
preview plays the same transparent eight-second clip without touching progress.
Reduce Motion suppresses animation. The automatic overlay is click-through,
non-activating, and closes if a capture starts.

Composition builds the overlay into `dist/frog-nudge/` alongside the desktop
Settings renderer. A build without that entry stays quiet. Linux retains its
existing onboarding experience.

## Desktop frog trial

Enable **Settings → Labs → Desktop frog** on macOS or a supported Linux
session, then open **Show welcome tour** from About. Confirm the shortcut to
reach the frog naming step. Naming the frog leads to the platform’s guided
capture. The guided practice uses the existing capture,
annotation, save and handoff actions. A completed practice recording and
**Finish setup** commit the frog to the profile before it lands on the desktop.

The red button appears on hover and starts apparent through the existing
recording action. Drag to move the frog or double-click to hop. Right-click it
and choose **Quit for 1 hour** to hide it temporarily, including across an app
restart. When the hour ends, it returns when recording and setup are idle. The frog
pauses during capture and setup. Turning the experiment off hides it, and
turning it back on restores a previously named and adopted frog. On restart
the frog starts in the display corner again.

### Frog wardrobe

After adopting a frog, turn on **Frog wardrobe** in Settings → Labs.
The frog earns and equips sunglasses at 10 eligible saves. The flowering
lily pad follows after 20 more saves (30 total). The unicorn horn follows
after another 30 (60 total). The desktop frog shows the achievement and
celebrates briefly. With reduced motion it shows the achievement without
the hop or streamers. Equip and Remove in Labs change what the frog
wears without resetting ownership.

Only new, successfully published user-started Desktop recordings count.
Guided practice, feedback, simulations, Agent-started captures, imports and
recovered recordings are excluded. Clipboard and share outcomes are separate.
The native completion receipt is deduplicated by bundle ID. The same profile
transaction records the count and the new equipped item. Existing earned
items and save counts carry forward without replaying celebrations. Progress pauses
with either experiment off, survives onboarding replay and is local to the
active profile. A process crash between bundle publication and the progress
write can miss a credit. The recording itself remains saved.

### Linux desktop frog

Labs uses the desktop frog capability supplied by the native session. The
Linux adapter uses X11 on Xorg and XWayland on Hyprland. Other Wayland sessions
keep the normal welcome tour. Linux lands the frog in the corner after setup.
The existing native screen-recording path owns consent, startup, and capture
lifetime. The frog button issues a start request after hiding its window.

The Onboarding Electron smoke drives the production frog child under Xvfb
with synthetic coordinator messages. It checks the visible window and start
protocol. Installed checks on each supported window manager still cover
stacking, focus, workspaces, drag, output changes, capture exclusion and
real recordings. The Mac adapter needs an installed check when it or the
shared native path changes. Release packaging retains its platform checks.
