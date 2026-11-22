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
