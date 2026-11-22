# Native recording performance probe

This is the Record-owned Linux producer for the
[journey benchmark](../../../enablement/timing/journey/README.md). It uses
a disposable Omarchy VM, synthetic English audio, the normal recorder and
the independently verified clipboard.

Run with a sealed AppImage, the sanitized VM template, and the verified Q4
English model. The results directory must be private and newly created.

```sh
node enablement/timing/journey/native/run.ts "$template" scrawl "$image" "$sha256" "$model" "$job"
```

The runner qualifies the stock chooser in the dedicated synthetic guest before
confirming its only output. It checks the guest ownership, display identity,
framebuffer signature, and pointer position. It refuses input when those checks
fail.

```sh
node enablement/timing/journey/native/recording-report.ts "$job/vm" > "$job/recording.json"
```

The scored wait starts at the physical Record chord that finishes the owned
recording. A persistent observer timestamps the verified clipboard on the
same host monotonic clock. Guest CPU and memory windows use the native Finish
log and the owned saved and clipboard receipts. The probe times CLI copy
against a seeded clipboard and checks the readback independently.

The report requires the VM runner's integrity-verified retention, exact
capture IDs, expected ink and duration, useful keyframes, valid transcript
word clocks, decodable saved video, and verified clipboard. It reports saved
bundle bytes and sampled peak additional allocation beneath the app's
isolated temporary directory. Keep the probe cadence identical across builds.

For a bounded transport smoke, set `APPARENT_BENCH_PROBE` to a single
fixture ID such as `quick-silent`. A smoke reports partial coverage.

Set `APPARENT_BENCH_SURFACE=1` and use a fresh job to collect visible Start.
The observer measures two successive qualifying framebuffer samples for each
milestone. It records the first timestamp, sample gap, pixel markers and
frame digest. It verifies that a recording identified after each shortcut
was saved with usable visual evidence. The observer removes its temporary
scan files after success and retains the last frame when detection fails.

```sh
node record/enablement/performance/start-report.ts "$job/vm" > "$job/start.json"
```

The interval excludes time spent choosing a source. Visible Start and first
valid screen and microphone samples have their own endpoints.

Set `APPARENT_BENCH_SETTINGS="$PWD/composition/settings/enablement/performance.ts"`
for a separate native Settings job with the same arguments. This run has no recording and requires no portal approval.
It launches the packaged app from a stopped state, verifies the first
interactive Settings panel, then starts a separate background instance. With
that instance ready, it opens Settings, selects Recording, and verifies its
controls. The isolated guest
temporarily enables a loopback observer for that packaged Settings process.
After verified retention, use `vm/artifacts/artifacts/launch-waits.json` and
`vm/artifacts/artifacts/settings-waits.json`.

Set `APPARENT_BENCH_LOCAL_CLI_FIXTURES` to the absolute local CLI fixture
manifest to run inspect, zoom, frames, and export inside the same disposable
VM. Use retained synthetic recordings for the three input paths. No portal
interaction is needed. Use `vm/artifacts/artifacts/cli-waits.json` after
integrity-verified retention.
