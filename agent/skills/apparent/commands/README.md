## Additional Apparent commands

### Look closer at a moment

Use `zoom` when the problem is motion (an animation, a jump, a flicker) or happens between keyframes, or when you can't tell what a mark points at:

```sh
apparent zoom <bundle> --at 0:21                 # a time, M:SS or seconds
apparent zoom <bundle> --at "the width changes"  # or a phrase they said
apparent zoom <bundle> --at 0:21 --span 1 --frames 16 --full
apparent zoom <bundle> --mark 2                  # the mark shown as ✎② in the text
apparent zoom <bundle> --mark 1 --frame 4        # ✎① of keyframe #4, when several have a ✎①
```

It prints the path of a PNG sheet of frames around that moment, the time of each cell, and what was said. Open the PNG and look at it before you act on the feedback. `--span` is the seconds covered (default 2, a quarter of it before the moment), `--frames` the number of cells (default 12), and `--full` shows the whole screen instead of the crop. The cells are numbered from #1 within the sheet, so those numbers aren't keyframe numbers.

`--mark` takes a mark's number from the text or its id (`m2`) and centres the sheet on the time it was drawn, with only that mark's ink, drawn whole from the moment it starts. `apparent inspect <bundle> --marks` lists every mark (`#2 ✎② 0:09 marked (2 strokes) · m2`: keyframe, number, time, shape, what it was drawn on, id), and `--marks --json` gives the same as JSON.

### Open a public GitHub issue

For a public GitHub issue, search existing issues, then preview with `apparent issue
--title 'Short title' --body 'Description'`. Get approval for the exact repository and
text before adding `--submit`. See `capture/desktop/docs/issue-reporting.md`.

### Capture control

For a running GUI app on macOS or Linux, use `apparent capture start --wait --timeout 30`
to start through the normal interaction-aware screen path and wait for a real frame. It refuses
occupied sessions rather than toggling. Retain the reply's top-level `capture_id`, including on
failure or timeout; do not infer ownership from `capture state`. For driver crash recovery,
retain your own 32-hex request ID first and pass `--request-id <id>`; retrying that ID cannot
start twice. Portal consent and existing permission checks still apply; no app is auto-launched.

`apparent capture stop <id> --wait --timeout 60` stops only that ID and returns `status: "saved"`
with its exact `bundle_path` only after successful save. Without `--wait`, Stop still returns
acceptance, not completion. Stop while starting is `not_ready`; `capture cancel <id>` can discard
that owned pending capture. `capture inspect <id>` recovers its status/result after a timeout or
disconnect; retrying Stop cannot stop a newer capture. Receipts survive only in this GUI process,
not an app restart. Rejected start IDs remain rejected; use a new ID only for a deliberate new take.

`capture state` remains a read-only global phase/active-ID view. Keep stdout JSON separate from
stderr; failures exit nonzero. Never use a shortcut toggle, `latest` or a directory scan to recover
an owned take. These commands do not control timed `record --duration`, change export audio,
send to a session or add automatic paste. See `capture/agent/docs/agent-video-workflow.md` in the repository
for bounded recovery and video QA. Check installed help before using new flags on an older build.

```sh
apparent import <movie.mp4-or-mov> [--out review.apparent]  # build a local bundle
apparent inspect <bundle>               # summary.md, the text above
apparent inspect <bundle> --json        # apparent.json
apparent inspect <bundle> --marks       # the marks, numbered as in the text [--json]
apparent frames <bundle> --from 0:04 --to 0:06 [--fps 4]   # plain PNGs of a range; prints their paths
apparent copy <bundle>                  # copy the capture to the clipboard
apparent export <bundle> [--out demo.mp4] [--no-zoom] [--crop auto|full|x,y,w,h] [--size 1920]
```

- `zoom` and `frames` write into `<bundle>/zoom/`. Leave the rest of the bundle as it is, because Apparent manages those files and cleans them up.
- Apparent does not send captures to agent sessions. Use `copy` to put a finished capture on the clipboard.
- `export` works on macOS and Linux (Linux requires `ffmpeg` and `ffprobe`). It writes one `.mp4` with ink and clicks burned in, audio in sync, and smooth activity zoom enabled by default (default `~/Movies/Apparent/<bundle>.mp4`). It opens on the whole capture for 0.5 s before zooming; explicit `--crop auto` or rectangles still bound the view. `--no-zoom` disables camera motion. The original recording stays unchanged. Without click/mark telemetry the camera stays still; use the app's recording shortcut for interaction-aware demos, not the timed `record --duration` path. `--no-ink`, `--no-clicks`, `--hevc` and `--fps` are also available.
- On Linux, `apparent update status` prints JSON with the selected channel, the **live process** version (`running.version`, or `null` if none), the installed AppImage identity, and whether a restart is pending. The `running` object in `~/.config/apparent/config.json` is a launch record, not proof the process is still alive after a crash; use `status` to validate its PID and start time. `apparent update channel stable|main` chooses the feed; `apparent update check` checks and stages an update for the next launch (installed AppImages only).
- Video and audio go to the Trash 7 days after a capture unless the person changed that in Settings. After that `zoom`, `frames` and `export` can't read the video, but `frames/`, the contact sheet and `apparent.json` remain.
- `apparent <command> --help` lists every flag, and `apparent skill` prints this guide as the installed version knows it.

The optional `make-it-apparent` workflow for a change demo, unresolved-problem demonstration or conceptual technical explainer is a **separate** skill. A finished implementation is not required; explicit live-app proof still requires real footage. The default capture-reading skill install does not guarantee it is present; install it explicitly in the agent's environment with `bunx skills add https://github.com/tryapparent/apparent/tree/main/agent/skills/make-it-apparent`. Installing a skill does not install the desktop app or grant recording permissions.
