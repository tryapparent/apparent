# Isolated Connect CLI timing

The native test harness provisions an encrypted v2 synthetic capture on the
existing loopback server. It uses a private read grant and runs the actual
Apparent executable. Keep the work directory, expected assets, and captured
bundle private. This is a local benchmark and the test is ignored by default.

Set the following inputs.

- `APPARENT_BENCH_BINARY` points to the pinned executable.
- `APPARENT_BENCH_CONNECT_BUNDLE` points to a synthetic local capture.
- `APPARENT_BENCH_RESULTS` is the private output directory containing
  `connect-assets.json`.

The asset descriptor includes an `expectedFiles` map of fixture-relative
paths to SHA-256 digests, a nonempty `selectedFiles` list, and a
`summaryMarker` from the synthetic transcript. Include the bundle manifest
and at least the contact sheet and one referenced frame in the expected map.

```sh
cargo test --locked -p apparent-connect-client benchmark_connect_cli -- --ignored --nocapture
```

First inspect downloads to an empty destination, verifies expected asset
bytes and confirms the summary. Reuse inspects the downloaded local path.
Full and selected fetch each use fresh destinations on both passes. A repeat
fetch observes the warmed server path while still performing a transfer.
The probe produces a fragment for the
[journey scorer](../../../enablement/timing/journey/README.md).

## Ready-to-watch and first playback

Build the Connect client before the native fixture. Build the Worker before the
browser fixture. Use an installed Chromium and private output directory.

```sh
npm ci --ignore-scripts --prefix connect/client/typescript
npm run --prefix connect/client/typescript build
npm ci --ignore-scripts --prefix connect/service
npm run --prefix connect/service build
cd connect/service
node ../enablement/benchmark/recipient.ts "$results" "$chromium"
```

The browser producer reserves a synthetic capture in the local Worker, times
explicit sharing through an independent manifest read, then opens the ready
link in a clean page. The playback endpoint requires two presented frames
with advancing media time. Page requests stay on the isolated loopback
origin. The fragment carries the checkout revision used to build the Worker.

### Focused share-to-watch score

Run scored batches through the manual **Performance benchmark** workflow on
standard GitHub-hosted `ubuntu-24.04` x64. Use full pinned commit SHAs. For the
first calibration, use the same current-main SHA in both fields. For an
experiment, supply the incumbent and reviewed candidate SHAs.

```sh
gh workflow run performance-benchmark.yml --repo tryapparent/apparent --ref main \
  -f stream=connect -f control="$control_sha" -f candidate="$candidate_sha"
```

The reviewed workflow calls the owner entrypoint with three absolute paths:

```sh
node connect/enablement/benchmark/hosted.ts "$control_tree" "$candidate_tree" "$evidence"
```

Setup builds both Workers and stages migrations and recipient assets from
locked service inputs. It installs Chromium from locked Playwright and
Ubuntu FFmpeg when absent. Sampling requires Node 22.23.0, GNU time,
taskset and libx264. The workflow uploads synthetic receipts, resource
logs and waterfalls even on failure. `calibration.json` and
`comparison.json` index the receipts. Fixture media and caches stay local.

Both phases run serially in the same job with the same Chromium executable.
The sampler selects all CPUs in the Linux process affinity and checks that
each visible SMT sibling is included. A five-second preflight and the
per-sample guard use the guest's per-CPU `/proc/stat` to account for outside
CPU activity, I/O wait and steal at the existing 5% limits. I/O PSI is recorded
as diagnostic context. The runner reports its visible virtual topology and
does not certify the cloud host's physical cores. Receipt compatibility uses
the runner image, visible CPU profile, quota, and browser/tool revisions.

For local developer diagnostics, build the Worker with the commands above
and choose complete visible SMT sibling sets. Local output and historical
Clanker scores are outside the hosted score series.

```sh
git fetch origin main
results=$(mktemp -d /tmp/apparent-dev-connect-watch-XXXXXX)
TMPDIR="$results" node connect/enablement/benchmark/watch-score.ts baseline \
  "$results" "$chromium" "$cpus"
```

Baseline mode expects the checkout at the fetched main SHA and the Worker
built from it. It records untraced, traced, traced, untraced replays in that
order. Each replay uses two new capture IDs and identical synthetic MP4,
image and text bytes. Cold is the first measured share and viewer navigation
in the new Worker and Chromium context after fixture boot. Warm reuses the
processes and context with a new page and capture. The loopback route guard
disables the browser HTTP cache in both cases. Worker startup, Chromium
startup, synthetic asset generation and fixture authentication are outside
the timed user wait.

The start is the synthetic Share activation immediately before manifest
preparation. The sender calls the real reserve, share, PUT and complete
routes from the existing Miniflare producer. Link issuance is measured as
its own milestone while the capture is still pending. A separate,
unauthenticated loopback client reads the share manifest and matches
readiness, byte totals, and the expected path, size and digest of every asset.
The viewer opens immediately after this proof. The real recipient page must
render a visible video and present two frames with increasing media timestamp
and frame count. The host timer ends on acknowledgement of the advancing
frame. A separate read verifies every original asset byte outside that timer.

The no-VM substitutes are **Synthetic Share Activation**, **In-memory Sender
Manifest and Transfer Driver**, **Seeded Device Grant**, **Miniflare D1/R2**
and **Programmatic Media Play**. They stand in for the Desktop gesture,
disclosure, queue, native snapshot, clipboard, cloud transport, external
identity provider, managed persistence and Play-button input. The trace uses
actual Worker requests, capability checks, recipient markup and Chromium
video presentation. It does not measure native clipboard readback, managed
provider latency, physical display or recipient-open-while-pending polling.
The existing Connect client public-copy tests and native and provider lanes
remain the proof paths when those boundaries change. The service's
`npm run test:recipient` also covers pending viewer behavior and revocation.

Each private `watch-score.json` holds raw milliseconds, runtime and build
identity, full attempt traces and individual guard results. The traced path
shows sequential preparation, reservation, link issuance, transfer, publication,
manifest readback and player acknowledgement. Per-file PUT spans are nested
inside transfer. Browser document, media and static fetch spans can overlap
and are accounted separately from the sequential critical path. Coverage
reports interval union, overlap and unattributed time. Browser frame stamps
are relative to page navigation; the scorer does not subtract them from the
Node monotonic clock. No polling allowance is added to the one-shot manifest
check. The frame callback and its Playwright acknowledgement are separate
observations.

The score is the mean of the cold and warm Share-to-advancing-frame waits,
normalized to 100 for the two qualified traced main repeats. Lower is faster.
The baseline separately reports same-build speed variation and traced-minus-
untraced probe overhead. GNU time records replay process-family CPU seconds
and peak single-process RSS, including setup, and the manifest records
verified stored capture bytes. These are local resource proxies. Linux CPU
counter deltas minus replay CPU estimate outside work on the selected cores.
More than 5% outside CPU or host I/O/steal on selected cores invalidates the
batch. Compare CPU and RSS against the higher matched incumbent repeat plus
10%, and require the same stored bytes and exact output. Each cold/warm share
and play component may regress by at most the larger of 20 ms or 10% against
the higher matched incumbent repeat.

For a local matched diagnostic replay, build both checkouts, keep the harness
identical and run `compare` in the candidate checkout:

```sh
TMPDIR="$results" node connect/enablement/benchmark/watch-score.ts compare \
  "$results" "$chromium" "$cpus" "$incumbent_checkout" "$baseline_receipt"
```

Hosted comparisons run incumbent, candidate, candidate, incumbent in order.
Download the hosted receipts and keep a private ledger with `baseline` set
to the absolute path of the frozen hosted baseline receipt and
`entries` containing `hypothesis`, `activeSeconds`, `outcome` and
`receipt`. Use measured active campaign work only. Diagnostic failures have
an outcome and can omit the hypothesis so they contribute no tested idea.
Then run:

```sh
node connect/enablement/benchmark/watch-score.ts ledger "$ledger"
```

The ledger verifies that comparisons used the current incumbent and the
frozen fixture and runtime. Both paired repeats and the aggregate must
clear measured same-build noise for a qualified candidate to advance the
frontier. The shipped journey Bend policy evaluates the stop decision using
the first two and latest two complete one-hour windows and distinct tested
ideas since the last gain. It emits the window gains, threshold, hypothesis
set, qualified incumbent and current score.
