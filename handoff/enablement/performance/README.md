# Destination picker and receipt benchmark

The lane measures two user waits on the Electron recording controls.

- **Open picker.** A trusted click on the enabled trigger in the mapped picker window to a selectable existing thread in the expanded picker.
- **Submit recording.** A trusted click on that thread to the presented Submitted indicator. An independent T3 loopback receiver verifies the exact dispatch payload and command identity. The observer verifies the corresponding private, durable sent receipt on disk.

The scenario measures each wait in a fresh Electron process. The fresh catalogue loads when the synthetic completed-recording frame arrives. The prewarmed catalogue loads during a synthetic recording phase. The command reports synthetic completion frame to observed mapped trigger as a separate diagnostic. The primary score excludes this setup, handoff text production, and the time between the clicks.

## Run on Linux

Use a quiet machine with Node 22, the locked Desktop dependencies, Xvfb, and accessible Linux PSI and Electron process PSS counters. Build both revisions before taking measurements. On Clanker, use the shared build runner for the builds and keep artifacts in the private job root.

```sh
job=$(mktemp -d /tmp/apparent-dev-handoff-XXXXXX)
mkdir "$job/control" "$job/tmp"
control=$(git rev-parse origin/main)
git archive "$control" | tar -x -C "$job/control"
printf '%s\n' "$control" > "$job/control/APPARENT_BENCH_REVISION"
(
  cd "$job/control/capture/desktop/ui/frontend" &&
  TMPDIR="$job/tmp" npm ci &&
  TMPDIR="$job/tmp" npm run build
)
```

Run, validate, and score the baseline from the tooling worktree. The Composition launcher supplies the actual Desktop bundle entry point, Electron runner, and WebSocket server implementation. Handoff owns the fixture, interaction, acceptance checks, spans, admission, and score.

```sh
env -u WAYLAND_DISPLAY -u DBUS_SESSION_BUS_ADDRESS TMPDIR="$job/tmp" \
  xvfb-run -a node composition/pill/enablement/focused-handoff.ts \
  baseline "$job" "$job/control"
```

Prepare a second archive the same way for a single candidate SHA. Invoke the same command with `compare "$job" "$job/control" "$job/candidate"`. Use the current qualified incumbent as that comparison's control. Keep the original baseline for the campaign stop command. Use `pilot "$job" "$job/control"` for a two-variant trace and synthetic screenshots during tool bring-up. Pilots bypass pressure admission and emit no score.

The runner emits raw milliseconds and a JSON comparison on stdout. It also writes each trace or quiet trial, the pressure admission record, and `comparison.json` under a new private directory printed on stderr. A pressure check runs before the scored block. A sample over the CPU or I/O pressure limits is retained as invalid and repeated in its original slot, with a bounded number of attempts. The benchmark fails if it cannot obtain a valid sample in that slot.

## Trace and guards

The same capture UUID joins the renderer actions, benchmark-only main-process probes, the receiver call and the receipt. The browser clock is calibrated before and after the two interactions using bounded monotonic round trips. Both clicks and the first DOM, selectable or visible, and two-frame renderer milestones are recorded in the browser clock. The receiver, main-process spans and calibrated browser milestones use Linux monotonic milliseconds. The trace has the cross-clock offset bounds so sub-bound differences can be interpreted appropriately.

The benchmark probes wrap the actual Controller, Delivery, Store and Transport methods in a disposable bundle. They also record the Electron host's layout, picker focus and selection IPC boundaries, and its window resize events. Follow `selectionToDispatchMs`, `dispatchToAcceptanceMs`, `acceptanceToDomMs` and `domToRendererPresentationMs` for the serial receipt path. The preparation, picker, and send attribution each use the union of selected operation intervals. Overlap is reported separately, and residual time includes scheduling, renderer work and any uninstrumented gaps. Parent and child spans remain available in the trace.

The quiet score runs the normal built Electron bundle without main-process probes. The primary wait is the sum of the two waits. Each batch uses a median of three trials per variant and gives the variants equal weight. Four independent batches run control, candidate, candidate, control. Baseline mode runs the same build in all four batches, freezes it at 100, and reports the observed range in speed-index units. Lower scores are faster. The extra traced repeats report probe overhead against their corresponding quiet batches. This measures the effect of the main-process probes above the shared browser witness. Every scored trial has absolute CPU, PSS and receipt size limits. Across-build qualification also checks both repeats for per-variant regressions and for Electron cumulative CPU, post-send PSS, and retained receipt size. CPU includes startup through receipt observation. All trials verify receiver dispatch, payload, acceptance and persistence before their outputs can be scored.

The named effect substitutes are the synthetic pill parent stream (`state`, `handoff-ready`, and window activation), Playwright trusted input on Xvfb, and the synthetic T3 HTTP/WebSocket receiver. Actual Electron layout and rendering, socket transport, and file and directory synchronization run in the score. Two browser frames and an Electron window mapping are evidence of renderer presentation on Xvfb. Pilots additionally retain screenshots. Native compositor input, platform focus restoration, physical recording and clipboard, and real T3 provider acceptance remain outside this lane. Record owns the physical Finish-to-clipboard score. Use native isolated verification for any change affecting those boundaries.

## Experiment ledger and stop

Keep one JSON array of active-effort entries for the focused run. A tested idea has `seconds`, `hypothesis` and an absolute `comparison` path. Unscored diagnostic or invalid work has `seconds` and a concrete `outcome`. Record active effort even when it produces no scored result. Exclude unattended build, admission and infrastructure waits. Only valid comparison receipts contribute tested ideas. Keep the actual control and candidate SHAs, raw evidence and architectural proof with each entry.

```sh
TMPDIR="$job/tmp" node handoff/enablement/performance/stop.ts \
  "$baseline_receipt" "$experiment_ledger"
```

Pass `pending` instead of a baseline receipt to record that no qualified incumbent is available. The command uses the shipped journey Bend2 speed and stop decisions and reads the shipped matched repeat and window limits. Each tested idea must beat the guard-qualified incumbent on the aggregate and both repeats beyond frozen noise to advance the curve. The verdict reports active seconds, complete one-hour windows, early and recent gain rates, cutoff, and distinct tested ideas since the last accepted gain.
