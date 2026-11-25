# Electron click-through without a VM

The scored lane runs on the public repository’s standard GitHub-hosted
`ubuntu-24.04` runner. The manual performance gateway accepts
`stream=onboarding` and full `control` and `candidate` commit SHAs. Select
the current main commit for control and a reviewed commit for candidate. Use
the same SHA twice for calibration only.

```sh
gh workflow run performance-benchmark.yml --repo tryapparent/apparent \
  --ref main -f stream=onboarding \
  -f control="$CONTROL_SHA" -f candidate="$CANDIDATE_SHA"
```

Inside the job, the gateway calls the owner entry point with absolute paths
to fresh, detached checkouts and a private evidence directory.

```sh
node onboarding/enablement/performance/hosted.ts \
  "$CONTROL_CHECKOUT" "$CANDIDATE_CHECKOUT" "$EVIDENCE_DIR"
```

The adapter builds each distinct SHA with the locked production frontend
builder, pins a common Electron runtime by tree hash and runs the sandboxed
coach under Xvfb. The evidence contains the runner CPU topology and affinity,
build fingerprints, the full commands, calibration and matched receipts, raw
milliseconds and Perfetto waterfalls. The candidate batch runs only after
same-job calibration qualifies. Each batch uses the same serial
control/candidate/candidate/control order, including the same-build
calibration and tracing-overhead checks. A failing prerequisite, output
check or resource guard fails the run and leaves the available evidence.
Before calibration or comparison, the hosted job records one setup click-through
per distinct build to exercise the newly staged files and shared runtime. The
setup requires all output and readiness checks. Its traces and pressure samples
are retained in `setup-cold-*`. Scores use only the planned four measured
trials in each group. Every measured trial
waits for the existing quiet-host gate and uses a new process and profile.
The hosted cold variant represents a fresh process and welcome profile
with prepared runner files.
After the builds, the hosted adapter selects the quietest two-vCPU subset
from one preflight sample. The subset contains a full visible SMT pair or
two visible cores with one thread each. It uses this subset for setup, every
calibration arm, and matched comparison. A systemd service cgroup enforces
placement for the benchmark, observer, Xvfb and every Electron descendant.
A separate unscored probe verifies that injected CPU work on those same CPUs,
outside the replay cgroup, trips the 5% outside-CPU guard.

For each whole replay window the guard subtracts replay-cgroup CPU time
from busy time on the selected CPUs. Selected and guest-wide steal must each
stay within 5%, guest full I/O pressure within 5%, and throttled periods must
remain unchanged throughout the workload hierarchy. Guest-wide CPU and
CPU PSI remain in the raw receipts. The placement receipt describes Linux's
visible vCPUs and provides no hypervisor placement evidence.

The `complete-visible-smt-v1` placement changes both available CPU capacity
and attribution. Calibrate a new series and keep guest-wide endpoint-v2
receipts, including run 45621791935, separate.

## Local developer replay

Build the existing desktop frontend with `npm --prefix capture/desktop/ui/frontend run build`
and use its matching Electron executable. Alternatively, use the runtime and
assets from the same extracted AppImage. `ASSETS_ROOT` is the built frontend
root or the extracted `usr/share/apparent/settings/app` directory. Supply the
exact source SHA of each built input and a fresh job directory owned by the
current user with mode `0700`. Local receipts are diagnostic. Historical
Clanker scores belong to a separate epoch.

```sh
node onboarding/enablement/performance/benchmark.ts \
  "$ELECTRON" "$ASSETS_ROOT" "$CONTROL_SHA" "$job"
```

Add `"$CANDIDATE_ASSETS_ROOT" "$CANDIDATE_SHA"` to compare one candidate
against the incumbent. The runtime, collectors and fixtures must match. The
runner opens an isolated Xvfb display for each execution and runs
control, candidate, candidate, control in order. It verifies both fresh
welcome and fresh-process resumed-practice projections. Host page caches are
uncontrolled. Control-only execution also collects same-build repeats and
interleaves ordinary verification with detailed tracing for an overhead
estimate. Ordinary verification retains the same DevTools probes and endpoint
checks. Observation polling is every 20 ms plus scheduling and request time,
with two animation frames after actionable layout. This estimate covers the
incremental instrumentation, while the checkpoints include the common observer
cost. Every trace includes host-monotonic intervals. Instrumented Composition
can additionally emit Unix-time points under the same ephemeral attempt ID.

The click-through drives the production Electron coach, Whiteboard host and
renderer. The fixture parent launches the Whiteboard child when its local
practice take starts, as the native coordinator does during active practice.
It sends the initial paper only after a real renderer click returns the
attempt-scoped coach action. The adapter observes the Whiteboard show
acknowledgement and canvas paint, then draws at the first verified opportunity.
The receipt records the prewarm lead, the lesson text at input, the exact
non-demo stroke, and the matching paper acknowledgement and practice
disposition. The lesson text is an annotation. The observer can draw during
the demo and advance the lesson before **Your turn** appears.

The fixture supplies the native parent effects for both variants, including
the scoped practice projection, a fixed first RGBA frame and save receipt, a
file-backed clipboard and a file-backed completion writer. The fixture reads
back all three outputs. The production coach must admit the scoped Finish
setup intent before the writer commits, and the probe observes coach closure
after readback. The isolated VM remains the acceptance path for the native
coordinator deciding when to prewarm, physical shortcut and capture,
playback quality, OS clipboard, native config, installed launch and permissions.

Each observation prints raw milliseconds and writes a receipt and a
Perfetto-compatible trace. Driver dwell appears independently. Per-stage
attribution reports covered, overlapping and unattributed time without adding
parallel spans twice. Endpoint version 2 scores
`practice-record-to-accepted-ink`, from dispatch of the synthetic start until
the exact acknowledged stroke is visible after paint. It also records the
first verified coach action and the Whiteboard-open-to-ink interval. Coach
startup, painted canvas, first media, clipboard, and completion still have
stage checks. CPU, process RSS, output size and contention remain guarded.
A qualified control is normalized to 100. Calibrate again on the current
main build with this collector before scoring product changes. The previous
epoch launched the board on click, waited for the teaching cue and scored
coach startup. Same-build differences between observers are measurement
corrections. Both runs require at least 1 GiB available memory. Local replay
retains the original 10% host CPU PSI and 30% host idle guards.

A focused campaign ledger is an array of entries with `hypothesis` and
`activeSeconds`. Add the path to a matched `comparison`, or an `outcome` and a
`tested` flag. Infrastructure failures carry `tested: false`. Record only
active effort in seconds. The scorer takes the frozen baseline receipt and
reuses the journey Bend speed and stop rules. Each hosted comparison entry
also supplies a `calibration` path to the calibration receipt from its own
job. Jobs in the same campaign must match the frozen runner image, kernel,
vCPU topology and model, fixture, collector, and Electron runtime. The
scorer uses each job’s matched control ratio to update the incumbent’s
speed and requires a gain beyond both historical and in-job repeat noise.

```sh
node onboarding/enablement/performance/hill-climb.ts "$baseline" "$ledger"
```

For a Linux fixture environment with no working Chromium sandbox, use
`APPARENT_ONBOARDING_FIXTURE_NO_SANDBOX=1` with trusted build output on the
isolated virtual display. The setting applies to the two fixture Electron
processes. Normal product launch keeps its production sandbox configuration.
