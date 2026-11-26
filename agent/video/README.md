# Narrated video CLI

Use `apparent video` to turn local evidence into a narrated walkthrough. It runs
offline, leaves source media intact, and never records a screen or uploads a
movie. Use the [Make It Apparent skill](../skills/make-it-apparent/SKILL.md) to
choose a viewer question and check the story and claims.

## Inspect and render

```sh
apparent video inspect before.png after.png recording.mp4 --starter-plan --out evidence
apparent video inspect recording.mp4 --from-ms 15000 --to-ms 22000 --frames 8 --out action
apparent video render evidence/starter-plan.json --out review --voice-cache voice-cache
```

Edit the starter plan before rendering. Its three scenes reference your files
and leave the narration empty for you to write. The first two sources appear
side by side in the opening, followed by one full-frame source per scene.
Choose sources that make the difference apparent. Add or reorder scenes to show
the action, what the output contains, and what the viewer needs to do. The
ranged scan accepts one video. Its sheet gives source times in milliseconds,
and `evidence.json` records the original dimensions for precise highlights.

Use an existing parent and a fresh output directory for each command. Keep
the evidence, plan and review in a private workspace. Inspect supports PNG,
JPEG, WebP, MP4, MOV, MKV and WebM. Render requires FFmpeg with libass,
drawtext, H.264 and AAC, ffprobe, and the provisioned local Apparent narrator.
The [narration guide](../skills/make-it-apparent/narration/README.md) covers
provisioning. If an Electron runtime is unavailable, use Node 22 on PATH.
Render honors `experiments.exportNarration=false`.

## Scene plan

```json
{
  "version": 1,
  "scenes": [
    {
      "shots": [
        {
          "file": "../before.png",
          "label": "Earlier",
          "boxPixels": [120, 88, 180, 48]
        },
        {
          "file": "../after.png",
          "label": "Fixed",
          "box": [0.2, 0.3, 0.12, 0.08]
        }
      ],
      "say": ["The same report now includes the missing button state."]
    },
    {
      "shots": [{ "file": "../recording.mp4", "fromMs": 15000, "toMs": 22000 }],
      "say": [
        {
          "text": "Watch what appears when the report is pasted.",
          "startMs": 1200
        }
      ],
      "holdMs": 650
    }
  ]
}
```

File paths are absolute or relative to the plan. Each scene uses one full
frame or two full frames side by side. In a video shot, `atMs` selects one
frame and `fromMs` with `toMs` selects a moving excerpt. With no time on a
video shot, the first frame is held. A still image takes no times. Optional
`box` and `boxPixels` each use left, top, width and height in the source frame.
Use fractions from 0 to 1 for `box` or whole pixels for `boxPixels`. Highlights
keep the full source frame visible.

Use one to six spoken captions per scene, up to 108 characters each. The renderer measures the
generated speech, fits each caption to its speech cue, and extends the last
frame as needed. Use `{"text":"…","startMs":1200}` to start speech and its
caption at the matching action, measured from the scene start. A plain string
starts after the previous cue. Overlapping cues are rejected. The default hold after speech is 450 ms. A plan can contain
up to 20 scenes and render up to three minutes. Source audio is replaced by
one local narration track.

## Review the result

The JSON receipt names the verified `video.mp4`, editable `captions.srt`, and
`review.jpg` with time-stamped frames from the start, middle and end of each
scene. `verification.json` includes scene and cue times in 30 fps output frames,
a stream check, local voice cache counts, and an end-to-end decode check. Watch the full movie to verify
the spoken explanation matches the action, highlights are readable, and the
ending clearly states the status and next action. Use a new output path for
a revised plan. Pass the same private `--voice-cache` on subsequent renders
to reuse exactly matching lines with the same narrator assets.
