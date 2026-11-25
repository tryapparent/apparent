# Hosted Record performance

Use the shared manual benchmark gateway on the public repository with the
standard `ubuntu-24.04` label. Choose the stream and exact full control and
candidate commit IDs. Use the same commit twice for calibration only. The
gateway passes three absolute paths to each owner entry.

| Stream | Owner entry | Exercise |
| --- | --- | --- |
| `record-start` | `record/enablement/performance/hosted/start.ts` | Production Electron pill on private Xvfb with independent framebuffer and Finish witnesses |
| `record-stop` | `record/enablement/performance/hosted/stop.ts` | Packaged finalizer with synthetic 27-second movie, two strokes, fixed English Parakeet, and independently read Wayland clipboard |
| `record-native-probe` | `record/enablement/performance/hosted/native-probe.ts` | KVM feasibility only using an actual four-vCPU Linux guest |

The runner needs Node 22.23.0, detached source checkouts and an existing
private evidence directory. Start installs Xvfb, xauth, xdotool, FFmpeg and
Electron's runtime dependencies. Stop uses the production AppImage dependency
and packaging recipes, Rust 1.99.1, Weston, Xvfb, GNU time, eSpeak NG and FFmpeg.
It downloads the fixed public Q4 English model and verifies its size and digest
before use. No production configuration, credentials or telemetry tokens enter
a replay process. The apt steps use the standard runner's passwordless sudo.

After the routes are registered on `main`, dispatch an exact run. Set
`stream` to `record-start`, `record-stop`, or `record-native-probe`.

```sh
gh workflow run performance-benchmark.yml --repo tryapparent/apparent --ref main \
  -f stream="$stream" -f control="$control_sha" -f candidate="$candidate_sha"
```

The gateway executes the corresponding owner command.

```sh
node record/enablement/performance/hosted/start.ts "$control_checkout" "$candidate_checkout" "$evidence"
node record/enablement/performance/hosted/stop.ts "$control_checkout" "$candidate_checkout" "$evidence"
node record/enablement/performance/hosted/native-probe.ts "$control_checkout" "$candidate_checkout" "$evidence"
```

Both scored adapters build their immutable inputs before measuring. They
collect a same-build noise and probe calibration, followed by serial control,
candidate, candidate and control repeats when comparing different revisions.
The existing owner runner qualifies decoded output, clipboard or pixel proof,
and resource limits. The hosted adapter also requires at most 5% virtual-CPU
steal in the Linux accounting window. It retains the CPU topology and CPU/I/O
PSI snapshots. `record-run.json` is the successful hosted receipt. It links
the comparison and raw attempts, including the millis needed by the existing
`score/frontier.ts` ledger. Its decision and active-effort rules are unchanged.
Local and old Clanker timings are diagnostic history.

Start reads and records digests for the staged Electron executable, pill host
and renderer entry before timing. It waits for quiet CPU and I/O after staging.
Cold attempts start a new process with a fresh, isolated profile after these
checks. Disk caches may contain the staged files. Profiles live outside the
uploaded evidence.

If Start fails before creating a comparison, it keeps the fixture's IPC and
frame evidence and tries one unscored cold launch with Chromium logging.
The diagnostic artifacts do not qualify the failed batch.

The Stop fixture is generated before the timer. FFmpeg supplies the movie and
eSpeak NG supplies Record's existing synthetic narration script. The replay
uses the actual whole-file Parakeet route and finalization, publication and
clipboard adapter. The hosted score runs from replay launch to verified Wayland
clipboard readback. Clanker native acceptance covers capture teardown and the
physical Finish shortcut. The waterfall shows the scored host interval and
separate, cutoff-relative Engine spans from the instrumented attempts.
Hosted Stop records a quiet CPU and I/O window after packaging, before arming
the replay. Its existing workload CPU-pressure limit still applies to each
arm. Completed traces and their waterfall are retained if a batch fails.
The hosted Stop replay process is pinned to two vCPUs from distinct cores
as reported by the runner. This leaves the other vCPUs available to the
clipboard and display observers. The affinity and its kernel readback are
recorded in `stop-affinity.json` and applied equally to all replay arms.
The receipt's timing and noise apply to this two-vCPU allocation.

## Native feasibility

The native Start and Stop producers require an isolated, sanitized Omarchy
desktop with PipeWire, Hyprland, KVM, four guest vCPUs, QMP input and independent
screen and clipboard witnesses. The standard public Ubuntu runner exposes four
vCPUs in its own VM. Hosted CPU topology and outer steal counters cannot
establish a dedicated physical core for the host observer. GitHub documents
nested virtualization as experimental with no compatibility, stability or
performance guarantee. [GitHub runner support](https://docs.github.com/en/actions/concepts/runners/github-hosted-runners)

The feasibility adapter checks the KVM device and attempts to boot the exact
runner kernel with a tiny BusyBox initramfs, hardware acceleration and no
network. It reports the actual four-vCPU guest topology, PSI and steal samples
if they can be collected. The kernel console and the structured counter sample
are retained as separate serial logs. A successful boot establishes this runner's
technical feasibility. Native scoring requires supported virtualization and
the real synthetic desktop template and guards. Use the existing Clanker VM
for native acceptance, with diagnostic status.
