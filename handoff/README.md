# Handoff

Own clipboard/copy/paste, destination choice, outbound intent, receipts, retry and uncertainty. Composition injects narrow capabilities for Record and Connect; do not import their implementations or fabricate a protocol framework. Connect owns encryption, upload, auth, readiness and revocation.

This is the canonical top-level owner root, not a claim of completed migration. Put owner-specific enablement under enablement/ here. See the root AGENTS.md and shared/enablement/dependency-policy for enforceable boundaries.

## T3 destination picker

The recording controls use the Handoff chooser and controller. The
Composition entry supplies the existing config path and builds into the
Electron pill's existing `t3.cjs` asset. The host still owns the IPC, focus,
window geometry, and native capture lifecycle.

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

## Compact recording prompts

Settings › Labs › Compact recording prompts is off by default. Turning it
on sets `experiments.compactHandoff` in the standard config. The setting is
read during bundle finalization. Copy, paste and T3 send use the format saved
with the bundle, so the prompt still matches its images after a toggle.

The format puts the timeline before the inspection command, with one line
per timestamp. It keeps the setup link at the GitHub repository root and
honors the Agents video preference. Local paths keep a short transfer cue.
Existing recordings keep their original format. Turn off the Labs switch to
return to numbered handoffs for newly saved recordings.

Record stores one display label per frame and uses it for the full and cropped
images, contact sheets and detailed inspection. Frames in the same second use
milliseconds. Identical times also have a suffix. Numeric indexes and filenames
still work, and `zoom --mark ... --frame` accepts the displayed label.
Record's Bend check compares the shipped native precision table with
`record/media/src/assembly/frame-label.bend`.

## Transcript-only handoff

The separate Labs switch is off by default and applies when a handoff is prepared.
A recording with speech and no detected visual activity sends the transcript
by itself. Pointer movement, clicks, scrolling, ink, notes and scene changes
keep the full handoff. A missing transcript or a timed CLI capture without
interaction telemetry also uses the full handoff. Saved recordings remain
available through Apparent.
