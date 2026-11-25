## Use Apparent's local narrator

Use Apparent's installed Kokoro narrator (`bm_fable`). Report setup or synthesis failures before proposing another voice. Keep Flite, espeak, cloud TTS and transcription models out of this route.

- **Bundle export:** check `apparent export --help`, then use `apparent export "$bundle" --narration "$cues" --out "$movie" --fps 30` with private absolute paths. Follow the [cue schema](../../../../capture/engine/docs/export-and-retention.md#local-narration) in exported-video milliseconds. Shorten text or extend slots as needed. Respect `experiments.exportNarration: false` and preserve the source bundle and config.
- **Explainer without a bundle:** render the diagrams with a local editor or renderer and synthesize each plain-text cue with the separately provisioned [standalone narrator](../../../../capture/agent/narrator/README.md#worker-protocol-and-offline-behavior). The installed Apparent CLI has no `trace` subcommand. Run the narrator readiness check below, then synthesize to a fresh private path and validate each WAV before aligning visuals and captions to it.

On the target macOS or Linux host run `node capture/agent/scripts/provision-narrator.ts --check` from the checkout. Require validated pinned assets and a synthetic WAV. Follow the [provisioning steps](../../../../capture/agent/narrator/README.md#provision-explicitly) for missing assets or a missing worker, within existing network and build authority. Synthesis is offline after setup.

When approved private listening is supported, listen to the full final narration in sync with the video. Check intelligibility, pronunciation, pacing, clipping and caption alignment.

Check stream timing on the final narrated MP4 (`movie`), including direct FFmpeg renders:

```sh
ffprobe -v error -show_entries stream=codec_type,start_time,duration -of json "$movie"
```

Require finite start times near zero and durations matching the plan for both streams, allowing for frame rounding and AAC padding. Include pauses as silence. Container duration and decode success can hide damaged audio timing.

Decode both streams end to end:

```sh
ffmpeg -hide_banner -nostdin -xerror -i "$movie" -map 0:v:0 -map 0:a:0 \
  -af silencedetect=noise=-45dB:d=0.2,astats=metadata=0:reset=0 -f null -
```

Check for signal in every cue window and clipping in the peak levels. Adjust the silence threshold as needed. If a mix loses cues or breaks timing, render retimed cues separately, mix to PCM from zero through the planned duration, and encode AAC when muxing. Repeat both checks.

Inspect cue-boundary frames for caption and action timing. Compare any available local transcript with the script and cues. Without confirmed audio input, keep audio bytes and base64 local, return only QA text and frames, and disclose listening, playback and native proof gaps.

If the context rejects input after an audio attempt, record the error and failed step, then stop retrying there. Use a supported fresh context to resume from the exact retained local movie, cue sheet and available QA outputs. Carry forward completed checks and their limits.

### Produce a conceptual video for an invisible mechanism

Use an existing local renderer/editor and encoder; no guest or desktop recorder is needed. Do not install a renderer, add a product dependency or use a paid service just for the video without authorization. Resolve Apparent's current visual assets from `shared/assets/brand/`, site styles and supplied fonts. Use Paper `#F5F0E8`, Carbon `#020102`, restrained Signal `#7A58C7` and Lilac `#B7A5D8` if no newer palette exists. Prefer supplied Host Grotesk, otherwise a readable system sans. Keep labels large and beside their objects, use flat fills and clear arrow direction, and do not recolor real footage. Keep the established readable rounded dark subtitle style. Do not fabricate a logo or imply a conceptual diagram is an app screenshot.

#### Show quantitative evidence as a chart

When the point depends on a comparison, trend, or breakdown, consider one chart before writing a list of numbers. State the question in the headline. Use aligned bars or dots for category comparisons, a line for time, and stacked bars for parts of an additive total. Label the units, the key values, and any sample or scope limit the viewer needs. Use measured or cited data. Label illustrative numbers in the frame and the narration.

For the [dithered stacked-bar style](https://x.com/miaugladiator1/status/2125213334601601250/photo/1), generate the plot from a data table with deterministic SVG or an existing chart renderer. Draw horizontal segments on one shared zero-based scale, then clip a seeded or ordered square-pixel pattern inside each segment. Keep the segment bounds, labels, total numbers and axes crisp. Use the Apparent palette and a consistent component order with text labels. Keep the full chart visible while the narration explains the comparison. Use solid fills if the texture obscures narrow segments, ripples in playback, or makes the data hard to read.

Retain the editable data and chart source. Render at the final slide resolution, inspect the encoded video at the smallest intended player size, and check that captions leave values and labels visible. Verify that visible lengths, labels and totals agree with the data.

Render a timed visual sequence, synthesize permitted narration when required, and encode a private playable MP4 at 30 fps with burned captions. Keep editable visual sources, narration, timed text and timing map outside git and public asset directories. A storyboard, script or HTML page alone is not delivery. Inspect every scene, transition and caption boundary at the intended player size and review the whole final export; verify timing, labels, privacy and playback. Check frame rate, duration and decoding with available media tools. No generated video can establish live app behavior. If rendering or delivery fails, report that exact production blocker rather than claiming there was no subject to explain.
