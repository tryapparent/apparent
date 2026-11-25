# Agent verification

## Context experiment comparison

Build the development CLI and prepare its normal media/transcription prerequisites
first. The comparison requires Node 22.18+ and existing bundles with video; it
never selects a personal capture set, records a screen or plays audio.

On Clanker, invoke the scenario through the shared build runner:

```sh
/home/simon/.local/bin/t3-build --jobs 2 -- node --experimental-strip-types \
  agent/enablement/context-comparison.ts \
  --experiment agentContext /absolute/synthetic.apparent
```

Use `--binary /absolute/apparent` to select another already built CLI. The default
is the repository's `target/debug/apparent`; rebuild after Rust changes.
Output defaults to a private `/tmp/apparent-dev-agent-eval-*/report/` directory.
`--out` selects a fresh directory with an existing parent, outside source bundles.
All generated artifacts are disposable under the workspace's temporary-data rules.
The command prints the index path; existing output is never overwritten.

The helper reprocesses every supplied bundle twice, with and without the selected
experiment, retaining both runs' contact sheets and frames. Both text summaries
come from the baseline run's transcript so a second transcription cannot create a
false difference. Each summary points back to its original absolute bundle path.
Inspect `index.md`, both summaries and the images; this is a manual comparison,
not automatic visual acceptance. Facts recorded live, such as accessibility labels
and page events, are kept as recorded and cannot be reconstructed afterward.

The baseline uses a private copy of `APPARENT_CONFIG` (or the normal config file)
with only `experiments` removed. It preserves unrelated options and never writes
the real config or source bundles. CLI logs stay in the private temporary job.
A failed comparison is listed in the index, returns nonzero and is not retried;
other explicit inputs can still complete. Partial reports and private logs remain
for diagnosis; retry with a fresh output directory. Owned intermediate bundles/config are
removed before return. No app restart, activation, publication or release occurs.

[Test cleanup ledger](test-audit/README.md) records audit decisions, probes and limits.

## Local inspect performance

From the repository root, point both arguments at the same clean release build
for a local diagnostic replay. For a paired replay, pass the incumbent first
and candidate second. Pin the process to a quiet CPU and keep its visible SMT
peers quiet. Local receipts identify the venue and leave the campaign score
empty.

```sh
job=$(mktemp -d /tmp/apparent-dev-agent-inspect-XXXXXX)
taskset -c "$cpu" node agent/enablement/performance/inspect.ts \
  /absolute/control/apparent /absolute/candidate/apparent "$job" \
  /absolute/synthetic-fixtures.json
```

Use `-` in place of the fixture manifest to create disposable cases with the
control's real `apparent demo` producer. The short case removes event, stroke and
mark records, the ink case preserves the annotated demo, and the long case
repeats timestamped narration, events and keyframe metadata to cover roughly
five minutes without recording or generating more source media. A retained
fixture manifest has `short`, `ink` and `long` keys with absolute bundle paths.
Supply only explicitly synthetic bundles containing timed spoken keyframes,
their PNGs and a contact sheet. Reuse the same immutable corpus for every
comparison. There are no OS or provider effect substitutes.

Use Linux with Node 22, Bun, FFmpeg, GNU Time, Git and an unstripped native release
ELF for each revision. The diagnostic pass uses `nm` and `sudo -n bpftrace`
with kernel BPF and BTF support. It observes only direct children of the runner
executing the named binary. No probes modify the binary. No live service is
called. A user without the required local probe access cannot collect a complete
trace receipt.

The runner verifies full stdout against the control and checks the bundle path,
timed spoken text and keyframe labels. FFmpeg independently decodes the
referenced sheet and spoken-keyframe PNGs. The endpoint is invocation through
complete, verified stdout and successful process exit. The ABBA comparison
uses equal-weight per-case medians across 11 new processes per block with warm
input pages. Two control medians provide the same-build noise estimate. A
qualified hosted same-build control scores 100. CPU time, peak RSS, disk output
blocks and immutable bundle bytes are reported separately. Blocks with measured interference
above 10% on the measured CPU or its SMT sibling during or around the block are retained as unqualified.

The diagnostic runs preserve one UUID per invocation and use Linux monotonic
timestamps for the outer wait, exec, app startup, local routing, bundle and
index reads, formatting, stdout and exit. The trace partitions the interval
into leaf spans, overlap and unattributed time. It reports probe overhead
from before/probed/after samples. On freshly generated fixtures it also
measures fresh-process starts after advising eviction of only the owned index
file. This leaves runtime-library pages warm and reports the advice without
claiming verified residency.

The command writes `receipt.json` under its private job and prints the same
JSON. Every block includes raw milliseconds, binary SHA-256 and the full
source revision resolved from the build label. An optional final JSON argument
supplies a hill-climb ledger with the path to the qualified frozen control as
`referenceReceipt` and `experiments` containing `hypothesis`, `activeSeconds`, `tested`,
`qualified`, `score` and `repeatScores`. Use the incumbent comparison to test
each hypothesis, and compare an eligible challenger with the frozen control
for the score series. The decision uses the shipped journey Bend policy and
one-hour active windows. Invalid attempts are recorded with `tested: false`
and supply no speed gain or distinct hypothesis.

This focused score covers default local `inspect` of explicit paths on Linux.
It uses retained pixels and does not exercise a live capture, Connect, Agent
Context experiments, Hermes, or the packaged zoom and frames providers. The
journey's local CLI scenario and the existing [packaged extraction checks](../../capture/agent/media/README.md)
cover additional boundaries.


### Hosted campaign runs

The shared manual performance workflow dispatches Agent on a standard public
GitHub-hosted Ubuntu 24.04 x64 runner. In the gateway, select the Agent stream
and supply full reviewed `control` and `candidate` commit SHAs. Equal SHAs run
calibration alone. The gateway invokes this owner entry point with detached
checkouts and a private evidence directory.

```sh
node agent/enablement/performance/hosted.ts   /absolute/control-checkout /absolute/candidate-checkout /absolute/evidence
```

The gateway provides Node 22.23.0 and the complete checkouts. The adapter stages
the locked release CLI and adjacent native libraries from each input. It installs
the existing Ubuntu prerequisites, bpftrace, Rust 1.99.1, and Bun 1.3.10. It uses
a new synthetic demo corpus from the control for both runs, then performs
A/A/A/A calibration followed by A/B/B/A when the revisions differ.

The adapter records CPU affinity, effective cgroup quota, guest-reported SMT
peer sets and kernel pressure. PSI snapshots provide host context. Qualification
uses the sampled CPU contention, guest steal and cgroup throttling guards.
The scheduler and steal counters describe the
guest-visible CPUs. Hypervisor topology beyond those counters is unavailable.
Before scoring, the adapter pins a competing subprocess to the selected CPU
and requires the same contention guard to reject it. The worker exits before
calibration. Both batches use the selected CPU and its guest-visible peers
with the existing 10% guard. The CPU resource guard compares medians of seven verified process samples
per fixture and retains every sample. A missing native probe or failed resource,
output or contention guard exits nonzero and retains the available evidence.

The evidence directory contains exact command arguments, build logs, CPU
admission and contention proof, receipts and monotonic trace waterfalls.
The gateway uploads the available evidence even for a rejected run. Build
outputs and synthetic source fixtures are disposable. Previous Clanker
measurements are diagnostic history.
