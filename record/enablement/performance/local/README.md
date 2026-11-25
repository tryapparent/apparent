# Measure pill startup without a VM

Use the [hosted gateway](../hosted/README.md) for new campaign scores. Local
execution is for developer replay and diagnostics.

On Linux, install Node 22, Xvfb, FFmpeg with X11 capture, xdotool and the
repository's Bend2 toolchain. Pass the unpacked directory of a verified Linux
AppImage, or the Desktop frontend directory of an exact build with the built
pill host, `dist/pill/index.html` and locked Electron runtime. Use the same
layout for both arms. Record each build's Git SHA and package digest with the
results. Use a new path within the private benchmark job directory.

```sh
node record/enablement/performance/local/startup.ts "$control_build" "$job/pill-baseline"
node record/enablement/performance/local/startup.ts "$control_build" "$job/pill-comparison" "$candidate_build"
```

The first command repeats the same build twice. The second runs control,
candidate, candidate, control. Each arm measures three launches from a new
process and three transitions from a ready, hidden pill. Cold runs include
process launch with a fresh profile. Warm runs begin after hidden window
activation. Neither variant flushes the OS page cache.

The runner launches the production Electron host and React renderer. Its
synthetic capture provider sends a recording revision over the real desktop
parent protocol. A local admission fixture acknowledges the window ID emitted
by Electron. Xvfb supplies a private display. FFmpeg observes the recording
marker in two successive framebuffer samples, then xdotool clicks it and the
runner checks the matching Finish reply. This covers the local renderer wait.
Use the native Start producer for the physical shortcut, platform admission,
capture permissions, Hyprland pin and first live media.

Stdout includes each arm's median raw milliseconds, the normalized score
and the receipt path. The receipt keeps the individual attempts, acknowledgement
and paint timing, overlap, raw framebuffer proof, runtime hashes and resource
checks. The baseline records the repeat gap per variant. It also compares
input-to-host frame acknowledgement with the observer running throughout and
starting after that acknowledgement. Accept a score only with the endpoint
proof, framebuffer sample gap at most 50 ms and CPU pressure at most 5%.
Candidate process-tree CPU ticks and proportional memory are sampled after
the verified Finish reply. The guard allows 10% or a floor of four CPU ticks
and 32 MiB from the slower resource reference in each variant. Retained RGB
evidence has a fixed size. Media quality and bundle storage are guarded in
the native lane.

## Verify picker-skipped startup natively

Use the same sealed AppImage, template and verified model as the
[native runner](../README.md#collect-native-reports).

```sh
node record/enablement/performance/native/start.ts "$template" "$guest_user" "$image" "$sha256" "$model" "$job"
```

The warmup qualifies
portal consent on the owned synthetic display. Both measured trials send a
physical Record shortcut with the chooser preference off and a restored source.
The picker-skipped host driver waits for three quiet one-second samples before
each timed shortcut.
The guest uses the pinned English model and the runner retains the real
screen-frame and microphone-sample milestones. The report decodes both saved
takes and retains per-capture traces, sampled CPU, memory and video bytes.
The focused scorer requires the same selection path for all four reports.
The wrapper retains `start.json` and exits with status 2 for any trial with
host CPU pressure or guest CPU steal above 5%.

### Evaluate the hill climb

Keep a separate ledger for each endpoint. A ledger's `reference` records the
frozen `revision`, two same-build `ms` values, a `qualified` flag and the
`evidence` receipt path. Append `attempts` with the `idea`, integer active
effort `seconds` and a distinct `evidence` path. For a tested idea, attach a
`comparison` with the full `controlRevision`, `candidateRevision`, matched
`controlMs` and `candidateMs` pairs, and its guard `qualified` flag. Leave out
`comparison` for an infrastructure failure, a rejected measurement or setup.
Keep those receipts without counting them as tested ideas. Exclude time spent
waiting for the build or test runner from active effort.

```sh
node record/enablement/performance/score/frontier.ts "$job/ledger.json"
```

The command uses the repository journey's Bend2 material-gain and stop
decisions. It prints the best qualified score, same-build speed variation,
complete active-effort windows, early and recent gain rates, and the distinct
ideas since the last accepted gain.

## Replay the native Stop fixture without a VM

Use Node 22, Xvfb, Weston with its X11 backend and software renderer, GNU time,
FFmpeg, the repository Bend2 toolchain, and a verified unpacked Linux AppImage.
Pass an integrity-verified native `threshold-27` [recording report](../README.md#collect-native-reports)
with its adjacent retained `vm/` directory. The command copies only the synthetic
manifest, movie and narration from that take. It checks the two saved ink
strokes, pins the English Parakeet model and records the build and fixture digests.
Use a new owner-only `/tmp/apparent-dev-…` result path.

```sh
node record/enablement/performance/local/stop.ts "$control_appdir" "$native_report" "$model" "$results"
node record/enablement/performance/local/stop.ts "$control_appdir" "$native_report" "$model" "$comparison" "$candidate_appdir"
```

For a shared host, the same command accepts `--collect` with the positional
arguments above and `--score "$results"` after collection. Keep packaging and
the Bend2 scorer outside the sealed timing run.

The real AppImage replays the fixed movie and narration through
`apparent reprocess --bench 1`. The native fixture uses whole-file transcription
with its streaming and live-word experiments off. Retaining that route keeps
recognition work on the same side of the cutoff. Each arm runs in a new process
with its own home. Weston inside Xvfb supplies a private Wayland clipboard. The
packaged clipboard reader first checks a unique seed and then independently
reads the exact newly saved bundle reference. FFmpeg decodes both output
tracks, and the runner verifies the pinned transcript source, the word clocks,
the saved ink, and the output size. A test of the physical Finish chord or
Desktop completion worker uses the native Stop lane.

The comparison normalizes the command's finalization-entry-to-clipboard-return
stopwatch to 100. The separate host spans cover command launch, full replay
and independent clipboard readback. The app reports local stage durations
that can overlap. The baseline repeats with logging enabled, disabled,
disabled and enabled to measure same-build variation and logging overhead.
The candidate comparison uses matched control, candidate, candidate, control
runs with logging enabled throughout. The receipt includes CPU pressure,
whole-replay CPU time and peak RSS, filesystem output count, bundle bytes,
and transcript edit distance against the verified fixture. Use the native
lane for post-Finish process resources and peak scratch allocation.

For a build with the Engine's local Finish trace emitter, set
`APPARENT_STOP_BENCH_SPANS=1` on the collection command. The probe records
content-free spans with the exact arm ID and a common finalization cutoff.
The raw receipt contains span boundaries, parallel work, gaps, and the last
measured prerequisite before bundle assembly. In calibration, the inner arms
leave tracing off. Restore the same probe setting on every arm of a candidate
comparison. The flag writes only to the replay log.
