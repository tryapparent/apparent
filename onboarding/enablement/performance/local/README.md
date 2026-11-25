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
The hosted adapter puts the click-through, Electron processes, Xvfb, and
observer in one owned cgroup without changing the runner's CPU allocation.
Receipts include total guest CPU PSI and the sampled workload CPU counters.
The hosted guard subtracts attributable workload CPU from guest-wide CPU
use and requires at most 5% outside CPU, 5% guest steal, and 5% full I/O
pressure. It rejects any new throttled periods in the workload hierarchy.
The readings describe the runner OS and its exposed vCPU topology. They do
not expose hypervisor placement.

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

The click-through dispatches actual coach input and opens the actual Electron
Whiteboard through its production entry and parent protocol. It verifies the
painted drawing surface and the lesson’s **Your turn** cue, dispatches an
input stroke, reads the renderer’s accepted stroke, and verifies the Close
action and board shutdown. The virtual desktop does not exercise compositor permissions
or shortcut delivery. The explicitly named `practiceFixture` effects supply a
fixed first RGBA frame and save receipt for Record, a file-backed clipboard for
Handoff, and a file-backed completion writer for the native Onboarding config
transaction. The fixture reads back all three outputs. The production coach
must admit the scoped Finish setup intent before the writer commits, and the
probe observes coach closure after readback. The isolated VM remains the
acceptance path for capture, playback quality, OS clipboard, native config,
installed launch and permission integration.

Each observation prints raw milliseconds and writes a receipt and a
Perfetto-compatible trace. Driver dwell appears independently. Per-stage
attribution reports covered, overlapping and unattributed time without adding
parallel spans twice. Accepted ink and the Whiteboard Close action have their own checkpoints. The baseline and candidate scores focus on opening the coach to
the first usable surface. Other stage times and CPU, process RSS, output size,
verification, candidate stage regression and contention guards are in `benchmark.json`. A qualified
control is normalized to 100. Preserve diagnostic receipts for rejected runs
and repeat on a quiet host. Both runs require at least 1 GiB available memory.
Local replay retains the original 10% host CPU PSI and 30% host idle guards.
Compare native capture resource guardrails in the VM lane before retaining
a product improvement.

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
