# Apparent journey performance benchmark

This local Enablement benchmark compares two matched executions per build. It scores verified waits against a pinned control and reports resource costs independently. The contract covers desktop, recording, handoff, Connect, and the agent CLI. It preserves v2 as historical evidence under its original denominator.

| Phase                         |  Points |
| ----------------------------- | ------: |
| First use                     |       2 |
| Open and Settings             |       9 |
| Start recording               |      29 |
| During recording              |       5 |
| Stop and clipboard            |      34 |
| Hand off                      |       8 |
| Remote readiness and playback |       7 |
| Agent CLI                     |       6 |
| **Total**                     | **100** |

The [contract](benchmark.json) defines the endpoints, fixture groups and provisional limits. Visible Start and the 22–33-second clipboard component each receive ten points. Clipboard cases in the original corpus each have an equal share of their component. The medium component uses the slowest per-fixture median. The 39-second, 41-second, and five-minute cases also have guards. The 65-second review is both scored and guarded.

## Run

Use Node 22 on the isolated native runner. Select and record the exact main revision, local English speech model, OS image, vCPU and RAM allocation, stimuli, capture mode and sampling configuration before measuring. Use the same scenario data and timing boundary for both builds. Keep CPU-heavy work off the host during matched runs and retain the raw evidence separately from Git.

```sh
node enablement/timing/journey/run.ts contract
node enablement/timing/journey/run.ts audit /absolute/path/run.json
node enablement/timing/journey/run.ts evaluate /absolute/path/ledger.json
node enablement/ci/bend/check.ts
```

The contract command prints the SHA-256 to embed in each receipt. Set `runner` to the same frozen environment and scenario manifest digest for every matched result. Use a fresh `runId` for each execution. A run receipt has these fields.

| Field                                                                    | Meaning                                                                                                                                                                                              |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contractHash`, `revision`, `runner`, `runId`, `vcpus`                   | Contract digest, full Git SHA, frozen environment identity, unique execution ID, and guest vCPUs                                                                                                     |
| `waits`                                                                  | Map of checkpoint IDs to `{ "ms": 123, "verified": true }`. Use `checkpoint/fixture` for a checkpoint with named cases and `paste/fixture` for the Stop controls.                                    |
| `resources`                                                              | Map of recording fixture IDs to the resource fields below. Record every clipboard fixture, including the controls.                                                                                   |
| `resources[fixture].recording`, `.finalization`                          | Each has `p95Millicores`, `saturationMs`, `cpuSeconds`, `availableMemoryMiB`, `appPssMiB`, and `guestStealPercent`. Measure the longest continuous saturation duration and minimum available memory. |
| `resources[fixture].bundleBytes`, `.peakScratchBytes`, `.outputVerified` | Final logical bytes, peak additional allocated temporary bytes, and confirmation of usable media, ink, keyframes, transcript quality, and clipboard output.                                          |

The ledger is a JSON object with `reference` containing two receipts at the same exact control revision and `attempts` containing each experiment in execution order. Each attempt has a stable `hypothesis`, active effort in `seconds`, and either `runs` containing two matched receipts or an `outcome` describing a failed or discarded attempt. Count implementation and benchmark time. Reuse the same hypothesis ID for retries. Use separate IDs for genuinely different ideas.

The evaluator requires complete verified evidence. A v2 receipt uses different endpoints and cannot establish a v3 baseline. Local inspect, zoom, frames, and export have a native collector. The desktop, clipboard and isolated Connect timings come from their owner probes. Supply proven journeys at the documented boundaries, including the physical Finish event and actual screen and mic samples. The audit identifies the missing fields before evaluation.

## Collect CLI and disk evidence

```sh
node enablement/timing/journey/local-cli.ts /absolute/path/apparent /absolute/path/private-job /absolute/path/fixtures.json
node enablement/timing/journey/storage.ts bundle /absolute/path/capture.apparent
node enablement/timing/journey/storage.ts scratch /absolute/path/private-scratch -- workload arg
```

The CLI fixture manifest maps `short`, `ink`, and `long` to clean synthetic bundle paths. Use the 8-second spoken take, 17-second take with nine strokes, and five-minute take from the corpus. The collector copies bundles to an isolated directory and verifies emitted summaries and decodable images or media before emitting timings. Use those verified waits in the run receipt. Run clipboard probes only against an isolated compositor. Run Connect on an isolated service with synthetic captures. Measure fresh retrieval, repeat retrieval into a new directory, and reuse of the local bundle separately.

The storage collector reports bundle logical bytes and video, audio, image, and other bytes. The scratch sampler reports the highest additional allocated bytes observed at 100 ms cadence. Pass the workload's dedicated temporary directory so the sample excludes previous outputs and unrelated files. Sub-sample peaks can be missed. Keep the storage observer cadence the same across builds.

## Decisions

The speed index is the weighted sum of candidate-to-control wait ratios. The control scores 100, and lower is better. The inverse shown for climbing is `100 / score`. Accept a candidate only if both matches clear the CPU, memory, storage, output and latency guards. Recording may use up to 3.5 vCPUs at p95, with less than 500 ms of consecutive saturation at 3.9 vCPUs. Finalization may use all four. The report shows CPU-seconds by phase, peak PSS, saved bytes and peak scratch bytes. A resource increase within budget can accompany a verified speed gain. If speed is within the repeat noise, a candidate can win the resource tiebreak by improving one reported cost without increasing another. This preserves the speed progress count.

The early pace is the mean inverse-speed gain per hour in the first two complete one-hour effort windows, frozen thereafter. A speed gain requires both matched repeats and the pooled score to improve by more than the baseline pair's inverse-speed spread. The evaluator recommends stopping when the last two complete windows are at or below 20% of early pace, at least five distinct hypotheses have been tested since the last verified gain, and the incumbent passes the guards. A verified gain resets the count. Exact limits and report fields come from the versioned contract.

## Assemble run evidence

Supply the run identity and the producer fragments. Each fragment contains
the measured executable's `apparent --version` string, `waits`, and, where
applicable, `resources`. Duplicate checkpoints and mismatched revisions are
rejected. The command prints the coverage audit to stderr and the receipt to
stdout.

```sh
node enablement/timing/journey/run.ts assemble identity.json recording.json cli-waits.json connect-cli-waits.json > run.json
```

Use the [native recording probe](../../../record/enablement/performance/README.md)
and [isolated Connect probes](../../../connect/enablement/benchmark/README.md)
for those phases. The Record guide includes a separate Settings run on the same native environment. Spoken recording fixtures also include `wordErrorRate`,
which the scorer compares with the matched reference. A complete receipt
requires the remaining visible desktop and handoff events as well as remote
readiness and playback evidence.

## Desktop handoff

Use the exact extracted AppImage and the frontend's locked Playwright package.
Start a dedicated Xvfb display and clear the active desktop's Wayland and
session-bus variables. Set `APPARENT_BENCH_HANDOFF_ROOT` to the private
extracted AppImage and `APPARENT_BENCH_RESULTS` to the private results path.

```sh
env -u WAYLAND_DISPLAY -u DBUS_SESSION_BUS_ADDRESS xvfb-run -a   node --test composition/pill/enablement/handoff-timing.ts
```

This producer feeds a synthetic completed take into the packaged pill and
uses the shipped picker and T3 transport with a local receiver. It verifies
the selected destination, exact draft text, independent receiver acceptance,
and visible confirmation. The fixture has no live T3 account or workspace.
