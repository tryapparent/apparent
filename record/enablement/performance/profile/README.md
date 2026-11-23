# Perfetto profiling for the journey benchmark

## Measure and score the journey

The default suite writes Perfetto-compatible measurement traces for all verified
waits and recording resource profiles. Trace Processor measures the slices and
reads the reported resource counters for the matched v5 score. This mode needs
a Trace Processor executable. It can run on the ordinary isolated benchmark
setup. The optional stack collection below uses the provisioned profiling
environment.

## Profile complete producer lanes

The [journey suite's profile mode](#profile-the-full-journey-on-linux)
uses the same provisioned Perfetto binary as the focused Stop probe. Generate
the fixed configurations from the benchmark checkout.

```sh
node --input-type=module -e 'import { guestProfileConfig } from "./record/enablement/performance/profile/config.ts"; process.stdout.write(guestProfileConfig)' > "$job/guest.pbtxt"
node --input-type=module -e 'import { hostProfileConfig } from "./record/enablement/performance/profile/config.ts"; process.stdout.write(hostProfileConfig)' > "$job/host.pbtxt"
```

Install the guest config at `/etc/apparent-bench/guest.pbtxt` in a private
benchmark VM derivative and the host config at `/etc/apparent-bench/host.pbtxt`
on the dedicated synthetic worker. Use the root ownership and write restrictions
listed in the [focused Stop instructions](../README.md#profile-stop-locally). Provision the exact command for the account running that
environment, substituting the appropriate config path in the sudoers entry.

```sudoers
scrawl ALL=(root) NOPASSWD: /usr/local/libexec/apparent-bench-tracebox --txt -c /etc/apparent-bench/guest.pbtxt -o - --notify-fd 2
```

Lane traces start before the producer exercises the packaged app and flush
when it finishes. They are bounded to 15.5 minutes and 256 MiB each. Guest
traces include scheduling events. Host traces collect CPU stacks for the
AppImage, benchmark runtimes and browser processes on the dedicated worker.

## Profile the full journey on Linux

Run the same producer suite once with Perfetto. Use a dedicated synthetic Linux
worker for the host lanes and an isolated profiling VM template for the native
lanes. Do not profile on a shared machine running other users' processes.
Provision the [fixed Perfetto commands](#profile-complete-producer-lanes)
before running the suite.

```sh
node enablement/timing/journey/suite.ts PLAN.json PRIVATE_JOB --profile
```

The plan also needs `isolatedProfileHost: true` and an absolute `traceProcessor`
path to the provisioned Perfetto Trace Processor. To profile an existing
packaged build, set `applicationRevision` to its full source SHA and keep
`revision` pinned to the clean benchmark checkout. The suite verifies the
AppImage digest and build stamp.

The suite records the corpus, surface, practice, Settings and local CLI
producers inside their respective VMs. It records the isolated Connect CLI,
handoff and recipient producers on the dedicated Linux worker. Each producer
has a continuous profile covering all its checks. `run-1/profiles.json` maps
each verified checkpoint to its trace and timing receipt. The save and
clipboard timestamps in the corpus `phase-*.tsv` files use the same Linux
boottime clock as the trace. Guest and host clocks are independent. Use the
matching unstripped binaries to resolve native function names.

The index is emitted only after every required journey wait and resource passes
the coverage audit and each trace contains call stacks with no reported data
loss. The unscored `silent-prompt` entry has no producer in this suite. Profiled
runs are diagnostic and do not produce a scoring receipt, ledger or baseline.
The profile index links the same measurement traces by their clock and digest.
Host and guest measurement traces have separate clock domains.
All artifacts stay in the private job directories.
