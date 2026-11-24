# Measure pill startup without a VM

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
