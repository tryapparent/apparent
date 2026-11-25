# Destination picker and receipt benchmark

The lane measures two user waits on the Electron recording controls.

- **Open picker.** A trusted click on the enabled trigger in the mapped picker window to a selectable existing thread in the expanded picker.
- **Submit recording.** A trusted click on that thread to the presented Submitted indicator. An independent T3 loopback receiver verifies the exact dispatch payload and command identity. The observer verifies the corresponding private, durable sent receipt on disk.

The scenario measures each wait in a fresh Electron process. The fresh catalogue loads when the synthetic completed-recording frame arrives. The prewarmed catalogue loads during a synthetic recording phase. The command reports synthetic completion frame to observed mapped trigger as a separate diagnostic. The primary score excludes this setup, handoff text production, and the time between the clicks.

## Score on GitHub Actions

Use the [manual hosted workflow](../../../enablement/timing/hosted/README.md)
with stream `handoff` and pinned SHAs. The adapter builds both revisions
before timing and retains calibration, matched receipts and per-trial
waterfall spans in the run artifact. Hosted guest CPU and I/O pressure
use the existing 5% limits. The enclosing host's pressure and SMT
topology are outside the guest's visibility.

When all four pressure attempts for a hosted trial slot fail, the driver
takes a separate diagnostic replay and retains `scheduler-diagnostic.json`.
It samples idle guest pressure before launch, process CPU and thread scheduler
counters at the Electron and Handoff boundaries, and observer and cgroup
accounting through cleanup. Snapshot work can perturb the replay. The file is
unscored and cannot qualify a repeat. A missing counter or disabled scheduler
accounting remains visible in the artifact.

## Local diagnostic replay

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

Run the diagnostic replay from the tooling worktree. The Composition launcher supplies the actual Desktop bundle entry point, Electron runner, and WebSocket server implementation. Handoff owns the fixture, interaction, acceptance checks, spans, admission, and score.

```sh
env -u WAYLAND_DISPLAY -u DBUS_SESSION_BUS_ADDRESS TMPDIR="$job/tmp" \
  xvfb-run -a node composition/pill/enablement/focused-handoff.ts \
  pilot "$job" "$job/control"
```

The pilot records both variants and synthetic screenshots. It bypasses
pressure admission and emits no campaign score. Earlier Clanker receipts
are historical and remain outside the hosted score series.

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
