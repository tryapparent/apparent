# Native host client

This package ships compiled ESM and declaration files for Node.js 22.18 or newer.
Its runtime has no React, Electron, TypeScript, Rust, or source-tree dependency.
Install a matching `@apparent/app-contracts` package beside it; the contracts
package's `./native` export contains only headless native DTOs and constants.
The source package is a development dependency solely for this owner's build.

`npm run build` emits `dist/`; `npm pack` builds before packaging. The package
exports `@apparent/native-host`, `@apparent/native-host/pen`, and
`@apparent/native-host/clipboard`. To install local artifacts together:

```sh
npm install ./apparent-app-contracts-0.1.0.tgz ./apparent-native-host-0.1.0.tgz
```

The installed package contains no TypeScript source. `npm run test:packed`
builds and packs both packages, installs them into a fresh consumer, checks plain
Node imports and strict consumer declarations, and exercises the compiled client
against a synthetic native-host socket.

`createNativeHostPort()` is privileged composition code for the fixed
`$HOME/.config/apparent/agent-control/capture.sock` endpoint. It returns only
the consumer-neutral `NativeHostPort` contract from `@apparent/app-contracts/native`;
pass this object to a Record-owned adapter in trusted composition, never expose
the socket or this client to a renderer. Example:

```ts
import { createNativeHostPort } from '@apparent/native-host';

const nativeHostPort = createNativeHostPort();
// Supply nativeHostPort to Record's owner adapter before composing RecordClient.
```

The protocol is v1, correlated by request ID, bound to owner `record`, and uses
the running GUI's `process.hrtime` deadline
timeline. The Rust listener checks same-UID peer credentials, private socket
ownership/mode, bounded frames, queue admission, and deadlines. Snapshot facts
are cached GUI observations scoped to that Desktop process. A screen-permission
read does not run a capture probe. A fresh GUI process has a new epoch; mutations
require its exact epoch and revision. Unknown mutation results are not retried.

Current operation limits:

- `readSnapshot` reports cached permission facts and the configured/effective
  shortcut projection. Uninitialized, paused, external, or unverified shortcut
  registration is reported as unknown/external and cannot be saved.
- `requestPermission` uses the app-owned permissions-only helper on macOS,
  independently of a legacy onboarding Session. An active legacy Session or
  busy helper refuses admission. Linux has no direct permission-request action.
  Dispatch acceptance does not grant permission.
- `openSystemSettings` uses that same helper on macOS. Linux supports only the
  Accessibility instructions route when a supported URL opener is available;
  other permission settings actions are unavailable.
- `validateRecordShortcut` uses the platform key-layout mapping, Desktop's
  reserved/taken checks, and the macOS native reservation query. It has no
  settings write or registration effect.
- `saveRecordShortcut` requires a fresh epoch/revision, an idle capture lifecycle,
  and proven live registration. It delegates registration to the existing
  runtime setter, compares persisted state inside the existing config writer
  transaction, reads the runtime value back, and rolls registration back on
  refusal where possible. Config compensation compares the value written by
  this request before restoring it, preserving a concurrent external edit.

This client does not implement safe relaunch, capture readiness, pen selection UI,
pickers, strokes, clipboard reads, or capture admission. It is not injected into an
installed route or Preview. Onboarding adoption must use
`adoptOnboardingProgress` from #731; host-held legacy journey-writer quiescence
is still a required, separately proven bootstrap lifecycle gate. Owner-envelope
presence does not prove quiescence, and this slice performs no adoption or
cutover. The existing repair UI/factory remains Onboarding-owned.

Record's native pen producer is separately exported as `@apparent/native-host/pen`.
`readStrokeColor()` returns only the running process epoch/scope and the actual
telemetry getter value. It sends no expected-state or mutation fields and reads no
configuration. `rgb: null` is the unknown legacy default; `[0,0,0]` is explicit
black. Call it to inspect startup state or reconcile an unknown apply result; the
facade does not automatically retry either operation. Apply still uses the
existing `NativeHostPort.readSnapshot()` epoch/revision alongside the exact
legacy value. It accepts only an exact 8-bit sRGB tuple or `null` plus the observed top-level
`penColor` presence/value and current GUI epoch/revision. It sends raw channels;
palette-name mapping and defaults remain Record-owned. The GUI compares the exact
persisted legacy value while holding the existing config writer lock, then invokes
the Engine telemetry setter and returns its process-scoped getter readback. A
conflict returns the fresh persisted value; a lost/failed effect is unknown and
must not be retried automatically. `null` preserves the historical red/default
appearance; `[0,0,0]` is an explicit black. This capability does not add a config
writer or enable a product route. Point-only whiteboard UI and capture-to-stroke
availability remain unsupported.

Record's text-only clipboard producer is separately exported as
`@apparent/native-host/clipboard`. `writeText(text, observed)` accepts the exact
UTF-8 text and the `processEpoch`/`revision` from a fresh `readSnapshot()`.
`MAX_UTF8_TEXT_BYTES` is 21,800 and `MAX_SERIALIZED_FRAME_BYTES` is 131,072
including the terminating LF. The text bound reserves 270 bytes for the largest
supported UUID/epoch/revision/deadline envelope and budgets six serialized bytes
per UTF-8 input byte for JSON-escaped control characters. Existing host operations
keep their 4,096-byte frame cap. These limits do not cover every valid Record
handoff: Record must preflight and show a typed oversize refusal without
truncating, splitting, normalizing, or substituting other content.

An applied receipt contains only the lowercase SHA-256 digest and exact UTF-8
byte length of the supplied string. X11 can confirm its live owner and exact text.
Wayland performs the write/readback but reports `outcome-unknown`: matching bytes
cannot establish compositor selection ownership. macOS requires the pasteboard
change count to advance and remain stable across exact string readback. Unsupported backends
refuse before writing. A mismatch, timeout after possible effect, or lost reply is
`outcome-unknown`; this port has no read operation and never restores or returns
ambient clipboard contents. The bounded native worker admits one write at a time.

### Combined PNG and text candidate

`createNativeClipboardPngTextPort()` from `@apparent/native-host/clipboard`
adds `writePngAndText(pngBytes, text, observedEpochRevision)`. It snapshots the
supplied bytes and text before asynchronous work and uses the existing GUI socket
and shared clipboard effect lane. It accepts no filesystem path or MIME selector,
exposes no ambient clipboard read or snapshot, retries no unknown write and performs no text
fallback. The separate `NativeClipboardPort.writeText` API and its limits remain
unchanged.

Limits: `MAX_PNG_BYTES = 4_194_304`, `MAX_PNG_DIMENSION = 4096` per axis,
`MAX_PNG_DECODED_BYTES = 67_108_864`, and the existing `MAX_UTF8_TEXT_BYTES = 21_800`.
The native worker validates a complete static PNG within those resource bounds;
animated, corrupt or unsupported images are refused before effect. PNG bytes use
canonical lowercase hex on the private wire. The separate
`MAX_PNG_TEXT_SERIALIZED_FRAME_BYTES = 9_000_000` includes JSON escaping, envelope
and terminating LF; text-only frames still have their original 131,072-byte bound
and other native operations retain 4,096 bytes. Valid handoffs can exceed these
limits. Callers must surface typed refusal rather than truncate, split or replace
the content.

Applied returns only `{text:{digest,byteLength},png:{digest,byteLength}}` for the
exact supplied UTF-8 and original PNG bytes. The macOS producer requires exact
readback of both formats with an advanced, stable pasteboard change count. Supported KDE/Hyprland
Wayland sessions reuse the existing multi-MIME owner and checks both payloads but returns
`outcome-unknown`: its clipboard protocol does not expose authoritative selection
ownership. X11 refuses combined copy before effect because its existing donor
cannot offer both formats atomically. No new X11 implementation is supplied.

This candidate does not establish Linux/Mac OS-effect acceptance, a delivered GUI
archive or installed/Agent adoption. Those native and artifact gates must pass
before a usable capability return; socket fixtures and compiled package imports
alone do not clear them. The native producer does not read `clipboardImage` or
choose a handoff format; that preference and output eligibility stay with callers.
