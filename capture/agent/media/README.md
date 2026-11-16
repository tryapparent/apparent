# Agent movie frames

Agent's headless TypeScript worker maps requested bundle times onto the movie
clock and back by request index. Offset-clamped requests can share movie zero;
their original bundle times remain distinct for crop, annotation and cell labels.
Sampling, crop selection and sheet rendering still use Agent's existing callers.

`npm ci`, `npm test`, `npm run typecheck` and `npm run build` require only Node
22.18+. They import the published SDK, never Engine source, Rust or Electron.
This proves the component build boundary, not independence of the whole Agent CLI.

`engine.json` pins the immutable SDK 0.2 and native frame provider published from
`5bbe8e35e67b61703737991575860d4b1fd1ad57`. `stage.ts --out <owned-output>`
verifies archive/SDK/file digests, source identity, capabilities and modes before
staging. Only frame executables are installed; the complete source manifest is
retained separately as provenance. Record independently pins the same generation.
Runtime operations never download, build, discover providers or mutate config.

Application composition's `movie_frames.rs` hosts the worker in its packaged Electron runtime with
Node mode enabled. Its shared finite-worker resource helper retains bounded
output, a deadline and process-group cleanup. The frame adapter holds an output
directory descriptor across execution, rejects links and unexpected identities,
reads only bounded private pixels, then removes its temporary output. Both
`apparent zoom` paths use this adapter: full frames and chunked native-size crops.
The native `apparent frames` fallback also uses it when FFmpeg is absent.
Every `apparent frames` request first calls Agent's `range-worker.js`: TypeScript
owns the default 4 FPS, rate/range validation, native sampling step and saved-frame
selection margin. Decimal clocks preserve the full native `u64` range. Composition
checks the versioned reply's request identity before any extraction writes.
Preferred FFmpeg execution, PNG writing and saved-frame file admission remain in
the root CLI. FFmpeg keeps its existing exclusive cadence; native fallback keeps
its inclusive cadence. This slice preserves that existing difference.

Range decoding starts with four full-size frames, then sizes subsequent jobs from
observed pixel dimensions within Engine's 256MP/48-frame limits. Only a typed
resource-limit exit (72) retries a smaller batch; other failures do not repeat.
Each failed job is cleaned before retry, and PNG writing starts only after all
requested frames decode. Record's four-frame batching remains unchanged.

`npm run test:native` stages and executes the actual published provider with
synthetic 30fps media, offset duplicates, display rotation, private files and
redacted failure output. FFmpeg and the platform media runtime are required.
`test/package.ts --binary <CLI-or-AppImage> --settings <packaged-settings>`
exercises the installed Node host and both real zoom callers, checking bundle
labels, crop association, decoded PNG pixels, source preservation and cleanup.
It also excludes FFmpeg from the CLI child's executable search, requests 51
fallback frames across SDK jobs and repeats at lower FPS to check stale-output
removal while preserving unrelated files.
It also checks omitted FPS through both backends, saved-frame margin boundaries,
exact-clock worker replies and invalid requests without changing existing output.
Linux AppImages and signed Mac candidate checks run it. Optional `--proof-dir`
retains synthetic PNGs for inspection under a private disposable job directory.
These checks do not establish GUI, capture, permissions or physical-device proof.

The real composition test also observes elapsed time against the retained decoder
on the same synthetic movie, alternating order. The published path adds a Node
process and private-file transfer; this adoption is not a runtime optimization.
These small warm-fixture observations cannot establish cold build savings.

Revert the range caller/CLI routing and its two staged policy assets together for
range-policy rollback; it changes neither the SDK pin nor persistence. Restoring
the previous consumer restores the native default and margin calculation. Remove
this bridge only after its successor adopts all three extraction paths and passes
the same packaged Linux/macOS checks.
Revert the decoding consumer routing, package pin and staging together for rollback.
The legacy root decoder remains for periodic/phone media. Its superseded
bundle-clock `movie_frames_at` wrapper is removed after adopting its final range
caller. Record's explicit assembly frames use their own
published-SDK worker through the same resource adapter. No config writer or persistence format changes.
Native policy/rendering elsewhere and the root CLI build remain migration debt;
this slice makes no full independence or build-speed claim.
