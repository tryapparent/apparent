# Record export metadata

This headless package interprets movie metadata for the existing Mac/Linux video
export path. It consumes the published `@apparent/engine-sdk`; it does not import
Engine implementation, Electron or Rust. It chooses the video timeline over a
longer container/audio tail, and selects only audio that actually overlaps that
timeline. Native nonempty edit segments take precedence over padded track ranges.
The SDK supplies display dimensions and provider-local stream IDs. Missing audio
duration does not establish usable audio. Empty video fails before encoding.

Run `npm ci`, `npm run typecheck`, `npm test`, and `npm run build` here with Node
22.18+. These policy/build commands need no Rust, Electron, native outputs or
FFmpeg. The default verification workflow also runs them in a clean Node container.

## Installed consumer

Desktop composition builds this package and explicitly stages the runtime pinned
in `engine.json` using `stage.ts --out <generated-app-directory>`. Provisioning
checks the downloaded archive SHA-256, complete file inventory, file hashes/modes,
source commit, architecture and SDK contract. A verified existing provider can be
reused offline. SDK executable/type/package bytes are also pinned independently
of npm's lock integrity. No source build, provider discovery or provisioning runs
when a person exports a movie.

The complete app stages the worker, SDK and native reader beside its existing
locked Electron runtime. On macOS the packager signs the native readers as nested
app code; producer manifest hashes describe the original artifact before that
signing, while the app's sealed inventory describes installed signed bytes.
Linux retains its existing FFmpeg/FFprobe runtime prerequisite.

`composition/media_probe.rs` is the native resource adapter: one finite headless
worker using `ELECTRON_RUN_AS_NODE=1`, explicit capability paths, bounded output
and deadline, and owned process-group cleanup before reaping. The SDK bounds and
cleans its native reader. Record errors never forward native diagnostics/private
paths. CLI and menu export use this same path by default. A missing/broken package
fails clearly before encoding; there is no second metadata-policy fallback.

After staging, `npm run test:native` exercises the real published reader through
the compiled worker with synthetic audio/video, silence, rotation and bad input.
Root export tests verify the actual production caller/encoder. Run
`node --experimental-strip-types record/media/test/package.ts --binary <packaged-cli> --settings <packaged-settings-root>`
from the repository root to check the packaged worker, locked runtime and real CLI
with rotated synthetic audio/video and unchanged source bytes. Mac platform CI
runs it after signing; Linux AppImage packaging runs it against the built image.
These checks do not prove capture, GUI, permissions or physical audio behavior.

## Scope and rollback

Existing crop/camera/ink/encoding, explicit recorded/silent/narration policy,
settings and persistence remain authoritative. Phone import and retention still
use the legacy helper probe; its Mac implementation cannot be deleted until those
consumers migrate. Linux export's superseded FFprobe parsing is removed here.
Revert this consumer slice and its artifact pin together for rollback. No user
config/data migration or installed experimental routing is involved. This does
not claim complete application build independence or measured CI savings.
