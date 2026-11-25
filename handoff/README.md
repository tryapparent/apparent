# Handoff

Own clipboard/copy/paste, destination choice, outbound intent, receipts, retry and uncertainty. Composition injects narrow capabilities for Record and Connect; do not import their implementations or fabricate a protocol framework. Connect owns encryption, upload, auth, readiness and revocation.

This is the canonical top-level owner root, not a claim of completed migration. Put owner-specific enablement under enablement/ here. See the root AGENTS.md and shared/enablement/dependency-policy for enforceable boundaries.

## T3 destination picker

The recording controls use the Handoff chooser and controller. The
Composition entry supplies the existing config path and builds into the
Electron pill's existing `t3.cjs` asset. The host still owns the IPC, focus,
window geometry, and native capture lifecycle.

**Agents → Send recordings to T3 Code** saves `agents.t3DestinationPicker`.
The picker starts off and enabling it still requires pairing before a send.
**Ask for video proof** saves `agents.agentDemoVideo`, on by default for the
next handoff. Both preferences keep reading their prior `experiments` keys.

The picker uses T3's `server.getConfig` environment label for multiple
computers. Missing, duplicate, or address-only names receive numeric
disambiguation. Connection addresses remain in Settings. Browse advances
the visible rows without creating outbound intent. Selection and retries
keep the original origin and request identity.

Opening the picker shows a scrollable catalogue. Search matches thread title,
project, computer and thread state. The last successfully sent recording's
thread appears first and is the quick-send default while it is available.
New thread options follow it, or appear first when the previous thread is unavailable.
The remaining shelves are pinned, inbox, working, snoozed and settled. Within those shelves the picker uses T3's
server timestamps and saved pin keys. T3's client-local folders, project
filters, optimistic moves, and observed inbox return times can differ from
the shell snapshot. Archived threads and subagent threads are excluded.
New worktree launches prefer T3's marked default ref. If T3 cannot mark a
default, the picker uses an existing `origin/main`, `origin/master`, `main`
or `master` ref, in that order.
The collapsed picker retains the existing quick-send shortcut.
An unconfirmed send displays the saved destination and retries the persisted
request. The Handoff renderer receives focus, send and share callbacks from
the existing Electron pill adapter, which remains the native integration point.
On Hyprland, the native adapter returns focus to the previously active window
after the picker releases it. The adapter acts only while the compositor still
reports the admitted picker as active.

### Pairing from a terminal

On the target T3 environment, use the CLI that matches the running server
to create a short-lived pairing link. Where supported, select only
`orchestration:read` and `orchestration:operate`. On the computer running
Apparent, give the full link to `apparent t3 pair` on stdin. Keep the link out
of chat and shell arguments.

`apparent t3 status` lists the saved origins. To replace a credential in place,
pair again with the same origin. To remove one computer first, pass its exact
origin to `apparent t3 forget <origin>`. Running `forget` without an origin
removes all local T3 credentials. Server-side sessions expire normally.

## Compact recording prompts

New recordings save timestamp labels with their keyframes. Copy, paste and T3
send use those labels in compact prompts so the timestamps match the images.

The format puts the timeline before the inspection command, with one line
per timestamp. It keeps the setup link at the GitHub repository root and
honors the Agents video preference. Local paths keep a short transfer cue.
Existing recordings keep their original frame labels.

Record stores one display label per frame and uses it for the full and cropped
images, contact sheets and detailed inspection. Frames in the same second use
milliseconds. Identical times also have a suffix. Numeric indexes and filenames
still work, and `zoom --mark ... --frame` accepts the displayed label.
Record's Bend check compares the shipped native precision table with
`record/media/src/assembly/frame-label.bend`.

Recording context uses plain “clicked” when the capture has no element name.
Named targets, repeat counts, shortcuts, and speech stay in the handoff.
With compact recording prompts, an action inherits its keyframe timestamp when
the displayed times match. Distinct times and precise frame labels remain
visible. The raw timeline remains available through `apparent inspect --json`.

## Transcript-only handoff

A recording with speech and no detected visual activity sends the transcript
by itself. Pointer movement, clicks, scrolling, ink, notes and scene changes
keep the full handoff. A missing transcript or a timed CLI capture without
interaction telemetry also uses the full handoff. Saved recordings remain
available through Apparent.

## Auto paste

Apparent saves a local desktop screen capture and copies its text. If a writable
field is focused at Finish and stays focused, Apparent also pastes the draft. A
visual handoff attempts the contact sheet first, then the text. The receiving
app controls attachment acceptance and you submit the draft yourself.

Auto paste is on by default. Settings → Handoff or
`apparent settings set labs.autoPasteDraft false` turns it off for the next
Finish. The Settings move keeps the existing preference ID and saved choices.
Existing `experiments.autoPasteDraft` values remain readable. Practice, agent, phone and terminal workflows retain
manual handoff. On Wayland without the Hyprland shortcut adapter, use explicit
Paste and grant keyboard access before automatic paste can use the desktop
portal. If focus, clipboard ownership or provider access changes, check the
draft and use the saved recording to recover.
