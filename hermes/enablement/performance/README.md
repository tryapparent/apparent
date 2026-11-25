# Local Apparent inspection in Hermes

This lane measures how long Hermes waits for usable recording evidence after invoking the Apparent tool. The input is the synthetic red-button handoff from the Hermes integration tests. The endpoint is delivery of the real tool return value to the local `HermesToolHostFixture`. The verifier checks the source, transcript and timed note, independently opens the returned JPEG, checks its dimensions and pixels, and confirms all synthetic workspace files are byte-identical.

The host fixture implements Hermes tool, hook, skill and RPC registration, the executable setting and the result sink. It calls the real pre-LLM hook and the registered `apparent_inspect` handler. The handler calls a real full Apparent CLI twice through the shipping Python supervisor. The CLI reads a real local `.apparent` manifest and the plugin reads and encodes the real contact sheet. The probe has a private HOME, working directory and TMPDIR, a clean environment and a local-path input. It does not use a Hermes profile, model, live receiver, Connect account or OS capture device.

## Run

Use the shared manual workflow for scored hosted calibration and comparisons.
Pin an exact revision on main for the control. Equal SHAs request calibration
only. A different candidate SHA compares its shipping Hermes plugin against
the control plugin with the same frozen control CLI. The workflow preserves the
10% unrelated CPU guard, the synthetic endpoint checks and the trace receipts.

```sh
gh workflow run performance-benchmark.yml --repo tryapparent/apparent \
  --ref main -f stream=hermes -f control="$main" -f candidate="$main"
```

For comparisons, retain the hosted experiment receipt and the active
implementation effort in the campaign ledger. Each job uses its own matched
same-build calibration. Local replay is available for diagnosis.

Use Node 22, Python 3 with the plugin's pinned-range Pillow dependency, and `taskset` on Linux. Supply a clean full CLI built from the frozen main revision. A source build can use `cargo build --locked --bin apparent` with a private target directory and the normal build prerequisites. Keep the binary beside its linked runtime libraries or use the verified extracted release payload. Benchmark after builds finish. Choose a logical CPU whose SMT sibling is also quiet.

```sh
job=$(mktemp -d /tmp/apparent-dev-hermes-perf-XXXXXX)
git fetch origin main
main=$(git rev-parse FETCH_HEAD)
node hermes/enablement/performance/run.ts baseline "$job" /absolute/path/to/apparent 6 "$main"
```

`baseline` prepares the pinned generated scoring modules on first use. To run on an offline machine, prepare and transfer the two generated modules under the same private job before measurement. The prepare invocation only downloads the pinned, checksum-verified Bend toolchain sources.

```sh
node hermes/enablement/performance/run.ts prepare "$job"
```

The JSON output includes raw per-block median milliseconds and the baseline score of 100. Each block ID names a JSON trace and receipt in the job directory. Nine fresh workers in each block give nine cold and nine warm samples. Cold starts when the observer issues the local invocation that launches Python. Warm starts when the same worker invokes its already registered tool. Both finish at delivery to the result sink, before independent verification and receipt serialization. Filesystem caches remain warm. The cold receipt separates the probe's Python bootstrap from plugin and dependency import. The warm receipt contains no registration or import replay.

All intervals use Linux host monotonic nanoseconds. Each attempt has one ID and a parent-indexed span tree. The critical path reports inclusive and exclusive times and the gap outside the top-level spans. Both CLI calls are serial. The overlap data shows parent pipe waits inside the observed supervisor interval, with no double-counting on the critical path. The executable's internals inside a CLI span are unattributed. The trace brackets the delivery timestamp with the observer launch and verified receipt arrival. It reports observer receipt time separately from the user wait.

Calibration runs untraced, traced, traced, untraced. Compare the paired traced and untraced medians for observer overhead. Derive same-build speed-index noise from the two untraced block medians. Benchmark comparisons use only untraced runs. Per-block `/proc/stat` counters reject more than 10% unrelated occupancy on either the measured CPU or its SMT sibling. This is an admission check for scheduler contention, with tick granularity. Shared caches and system activity can still affect timing, so retain both repeats and their contention counters. CPU is summed process-tree CPU time, with verification excluded from timed resource intervals. RSS reports plugin and reaped-descendant high-water marks separately. The storage guard checks the final fixture, config and scratch tree; it does not sample temporary peak allocation. A failed block preserves any complete receipt and never advances the frontier.

## Compare

Pass a candidate plugin directory containing the same packaged entrypoints and skill, a stable hypothesis ID, and measured active seconds spent on that experiment before collection. Keep candidate directories immutable and retain their source patches and build identities. The runner also counts its measured collection time. Exclude inactivity and external waiting from reported effort.

```sh
node hermes/enablement/performance/run.ts compare "$job" /absolute/path/to/apparent 6 /absolute/candidate/hermes hypothesis-id 120
node hermes/enablement/performance/run.ts status "$job"
```

Compare blocks run incumbent, candidate, candidate, incumbent against the same CLI and workload. Pool medians using the shared Bend2 comparison contract. Cold and warm each contribute half of the frozen-control score. Lower is faster. Require both paired repeats and the pool to beat same-build speed noise and every candidate repeat to advance the frozen-control frontier beyond noise. Guard exact result digest, local file integrity, both waits, tree CPU, and both RSS high-water marks. The lane permits latency movement up to the greater of 5% or measured phase noise, CPU growth up to the greater of 10% or 2 ms, and peak RSS growth up to the greater of 10% or 1024 KiB.

`status` replays the ledger and reports the qualified incumbent, repeat noise, cumulative active effort, complete one-hour windows, early pace, cutoff, recent gains, distinct tested hypotheses and the shipped Bend2 stop verdict. Invalid trials retain their effort and outcome without counting as tested ideas. Stop requires two early and two later complete windows, both recent windows at or below 20% of early pace, and five distinct tested ideas since the last material improvement.

Run the existing isolated Hermes package validator and affected integration tests for changes to the plugin boundary. Test recorder, OS consent, Desktop renderer, remote transport or Connect separately when a production change reaches those boundaries.
