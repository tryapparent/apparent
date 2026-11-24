---
name: apparent
description: Use when the user invokes /apparent, asks to read their latest Connect recording, or provides an Apparent capture or handoff. Match narration to clicks, drawings and annotated frames to understand what the user is showing.
---

# Apparent captures

Apparent records someone's screen, voice, clicks and red ink, then packs the result into a `.apparent` folder (a bundle). They send it to show you a problem instead of describing it, so the capture is the bug report. Read it closely before you answer, and don't ask them to explain again what the capture already shows. If something is unclear, look closer with `apparent zoom` first.

## Open the latest Connect recording

For bare `/apparent` or a request for the latest Connect recording, run
`apparent connect list --limit 1 --json`. If
the user names a reader, pass `--reader <name>`. If the CLI reports multiple
readers, ask which reader to use. If read approval or CLI support is missing,
report the blocker and offer to inspect an exact capture ID or accessible bundle.

Use the returned `reader` and first capture's `id` together. Report which
recording you selected and when it was recorded, or say the time is unavailable.
An empty list means Connect has no current recordings for that reader. A
`pending` capture is still preparing. Keep its ID selected and tell the user
its state. A recording queued on the sender's device may be absent from Connect.

When the capture is `ready`, follow the [Connect inspection guide](connect/README.md) using
`--reader <returned-reader>`. Open the actual contact sheet and transcript.
Use selective fetch when supported and keep downloaded evidence in a private
directory. For `/apparent <capture-id>`, use that exact ID and the existing
reader selection flow. If the message only invokes the skill, summarize what
the recording shows and the request you heard. Follow any task the user gave in
the message using the recording as context.

## What a paste looks like

```text
[apparent 0:33 · OpenCode “Settings” · /Users/me/Library/Application Support/apparent/captures/apparent-1792432139176.apparent]
Open contact-sheet.png and frames/ in that folder before changing anything: the marks and words only make sense on the images, which can show more than the text does.
Cropped to: the activity in OpenCode (full frames in frames-full/)
- #1 (0:04) [clicked “New tab”] “Command T makes a new session, but here it should make a tab.”
- #2 (0:07) “No, it doesn't.”
- #3 (0:10) ⚑ “It says command shift B makes a new tab.”
- #4 (0:18) clicked (x 0.51, y 0.93)
```

- The first line has the length, the app and window recorded, and the bundle path.
- The next line asks you to open the images first. Do: the text is only what was said and done, and a problem can show in a frame without being marked or mentioned.
- Each `#N (M:SS)` line is a keyframe: what they did at that moment in brackets, then what they said while it was on screen. A line with no quote has the action alone.
- `⚑` means they flagged the moment on purpose. `⟨Name⟩` means the app reported a new screen. Lines starting `·` are events or values the app logged.
- Optional lines near the top: `Screen:` with app context, `Note:`, and `Cropped to:`. Older bundles may include `For session:` as recorded metadata; that does not authorize delivery.
- Coordinates are fractions of the captured area, from the top left (x 0.51 is just right of centre).

When you answer, refer to moments the same way, as in "#3 (0:10)", so the person can find them on the contact sheet.

## Reading a bundle

Send sanitized `apparent feedback` for even minor friction or workarounds, then continue the task.

1. Look at `contact-sheet.png` in the bundle first (it's often attached already). It shows every keyframe in time order, left to right and top to bottom, each with its number `N` in a small white chip in a top corner (the `#N` in `summary.md`).
2. Read the transcript lines next to it. Speech recognition mishears names and code terms, so trust the screen when the two disagree.
3. Open `frames/frame-NN.png` for any keyframe you need at full size (`frame-03.png` is #3). When the summary says `Cropped to:`, the uncropped screens are in `frames-full/`.

If the contact sheet is not attached, try opening it at the bundle path in the first line. A plain `apparent copy` is text-only by default; the Paste control offers the image first and the text second, but a paste keystroke does not prove the composer accepted either. If you cannot open the local path (for example, the capture is on another machine), ask for `contact-sheet.png` as an attachment and check that you can actually view it. Do not claim to know what a click or mark targeted from “element unavailable” or coordinates alone; wait for the image when that target matters to the request. Never send a draft on the user's behalf.

What the drawings mean:

- Red strokes, circles, underlines and arrows are the person's marks, and they point at the problem. Marks drawn on the same screen all show on one keyframe. When there are several, the text numbers them in drawing order (`✎① 0:06 …`, `✎② 0:09 …`); the image shows only the ink, so use `apparent zoom --mark` to see which ink is which.
- A ripple around the cursor shows a click or tap, and a finger trail shows a swipe.
- A glowing red trail that tapers off is the laser pointer, used to point without leaving a mark.

Other files: `apparent.json` is the full manifest (keyframes, `marks` with shape and box, `events`, `transcript.words` with times, app `context`, and `autocrop`). `recording.mp4` or `recording.mov` and `audio.wav` are the source media. A `.media-pending` file means the video is still being copied from another Mac.

## The apparent CLI

### Check the build

Check `apparent --version` and the specific command's `--help` before diagnosing
missing capabilities. Compare the embedded revision with the intended release.
Older builds may print only the package version. Resolve the exact executable
and compare installation provenance and artifact checksum where needed. See
`capture/agent/docs/installation.md` for platform layouts.

Use `apparent feedback --help` for the command format. If the command is unavailable, keep the draft in chat and check the installed version before sending. A public GitHub issue needs separate approval.

### Configuring Apparent

Native app launch is available by default on Mac and Linux (an explicit
`experiments.nativeLaunch: false` disables it). With an updated, OS-registered app, the exact
`apparent://open` URL opens the idle app; it never records or sends, and leaves
active capture work alone. Other URLs/parameters are rejected. Linux registration
is explicit: `apparent launch-handler install`; `apparent launch-handler status`
reads the OS selection. See `capture/desktop/docs/native-launch.md`. Browser timers cannot confirm
installation or successful opening. Do not change a user's handler to test this.

Settings uses `~/.config/apparent/config.json`, overridable through
`APPARENT_CONFIG`. Use the owning documentation for supported keys and when
changes take effect. Preserve unrelated JSON keys and keep the file private
(`0600`). Never print the full file. Manage permissions through OS grants.

`apparent` is the installed Apparent app's binary on macOS or Linux. If `command -v apparent` finds nothing on a Mac, use `/Applications/Apparent.app/Contents/MacOS/apparent` (or the same path under `~/Applications`); on Linux, use the installed `~/.local/bin/apparent` link or the AppImage's path. Settings › Agents can install the CLI link without replacing another program. Run the command on the computer with Apparent and access to the bundle; elsewhere, read `contact-sheet.png`, `frames/` and `apparent.json` directly. Most commands take a bundle path or `latest`, the newest capture. Quote paths containing spaces, such as macOS `Application Support` paths.

Use the [Connect inspection guide](connect/README.md) for remote captures and the
[command guide](commands/README.md) for zoom, capture control and export.
