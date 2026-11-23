# Apparent journey performance benchmark

This local Enablement benchmark compares two matched executions per build. It scores verified waits against a pinned control and reports resource costs independently. The contract covers desktop, recording, handoff, Connect, and the agent CLI. It preserves the earlier scores as historical evidence under their original measurement contracts.

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

The [contract](benchmark.json) lists timing endpoints, fixture groups, and limits. The medium clipboard component uses the slowest fixture median.

## Run

Use Node 22 on an isolated runner. Match the image, models, VM allocation, fixtures, and collectors across builds.

```sh
node enablement/timing/journey/run.ts contract
node enablement/timing/journey/run.ts audit /absolute/path/run.json
node enablement/timing/journey/run.ts evaluate /absolute/path/ledger.json /absolute/path/trace_processor
node enablement/ci/bend/check.ts
```

The contract command prints the SHA-256 to embed in each receipt. Set `runner` to the same frozen environment and scenario manifest digest for every matched result. Use a fresh `runId` for each execution. A run receipt has these fields.

| Field                                                                    | Meaning                                                                                                                                                                                              |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contractHash`, `revision`, `runner`, `runId`, `vcpus`                   | Contract digest, full Git SHA, frozen environment identity, unique execution ID, and guest vCPUs                                                                                                     |
| `measurementEvidence`                                                    | Scoreable Perfetto trace paths, clocks, and SHA-256 digests bound to the run identity.                                                                                                               |
| `waits`                                                                  | Map of checkpoint IDs to `{ "ms": 123, "verified": true }`. Use `checkpoint/fixture` for a checkpoint with named cases and `paste/fixture` for the Stop controls.                                    |
| `resources`                                                              | Map of recording fixture IDs to the resource fields below. Record every clipboard fixture, including the controls.                                                                                   |
| `resources[fixture].recording`, `.finalization`                          | Each has `p95Millicores`, `saturationMs`, `cpuSeconds`, `availableMemoryMiB`, `appPssMiB`, and `guestStealPercent`. Measure the longest continuous saturation duration and minimum available memory. |
| `resources[fixture].bundleBytes`, `.peakScratchBytes`, `.outputVerified` | Final logical bytes, peak additional allocated temporary bytes, and confirmation of usable media, ink, keyframes, transcript quality, and clipboard output.                                          |

The ledger is a JSON object with `reference` containing two receipts at the same exact control revision and `attempts` containing each experiment in execution order. Each attempt has a stable `hypothesis`, active effort in `seconds`, and either `runs` containing two matched receipts or an `outcome` describing a failed or discarded attempt. Count implementation and benchmark time. Reuse the same hypothesis ID for retries. Use separate IDs for genuinely different ideas.

The evaluator reads all scoring durations and resource values from the retained Perfetto spans and counters. It checks the trace digests and rejects missing, duplicate, or mismatched measurements. The producer fragments still provide output and endpoint verification. V5 retains the v4 weight and guard definitions and requires newly matched trace-backed runs. V4 uses its original evaluator from the pinned v4 checkout.

For automatic collection on Clanker, run `node enablement/timing/journey/suite.ts PLAN.json PRIVATE_JOB`. Use a clean checkout at the pinned `revision`, an empty private `/tmp/apparent-dev-…` job, and a pinned plan with these fields.

| Plan fields                              | Inputs                                                                            |
| ---------------------------------------- | --------------------------------------------------------------------------------- |
| `revision`, `appImage`, `appImageSha256` | Full Git SHA, absolute AppImage path, and its SHA-256                             |
| `template`, `user`                       | Qualified Omarchy VM template directory and its test SSH user                     |
| `model`, `previewModel`                  | Pinned local English Parakeet Q4 and Nemotron Q8 files from the Record probe      |
| `chromium`, `connectTarget`              | Absolute Chromium executable and private, existing Cargo target directory         |
| `traceProcessor`                         | Absolute Perfetto Trace Processor CLI executable                                  |
| `applicationRevision`                    | Full SHA of the packaged build when it differs from the pinned benchmark checkout |

Install frontend and Connect dependencies from their lockfiles. Keep other CPU-heavy work off Clanker. Use a bounded foreground user service. The suite runs serially and saves `recipe.json`, fragments and coverage. Two complete runs produce `ledger.json` and `baseline.log`. Retain the per-producer `*.trace.json` files with the ledger. Each trace uses one host or guest clock. Start spans preserve the separate picker and confirmed-source intervals. The recording resource windows carry the existing sampler's reported counters for CPU, RAM, disk and transcript quality.

## Collect CLI and disk evidence

```sh
node enablement/timing/journey/local-cli.ts /absolute/path/apparent /absolute/path/private-job /absolute/path/fixtures.json
node enablement/timing/journey/storage.ts bundle /absolute/path/capture.apparent
node enablement/timing/journey/storage.ts scratch /absolute/path/private-scratch -- workload arg
```

Supply the 8-second spoken take, 17-second nine-stroke take, and five-minute take as `short`, `ink`, and `long`. Run clipboard probes against an isolated compositor and Connect against an isolated service.

Storage reports logical bundle bytes and peak additional scratch bytes at 100 ms cadence.

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

For diagnostic Perfetto traces of all journey lanes, see [full-journey profiling](../../../record/enablement/performance/profile/README.md).
