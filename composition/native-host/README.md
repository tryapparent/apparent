# Native host client

The [ink-source v1 obligation](INK-SOURCE-V1.md) records the joint drawing
registration/input/lifecycle boundary. It is not an implemented native port;
current pen RGB support alone does not establish accepted ink.

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

The separate `createNativeClipboardTextReadbackPort()` factory exports
`writeTextReadback(text, observed)` for native Wayland. Its exact success receipt
is `{status:'written-readback',digest,byteLength}`: the native helper accepted this
request's selection-write submission and bounded native readback matched the
supplied UTF-8 bytes. Helper `READY` is local acceptance, not a compositor ACK.
It does not prove acquisition, the readback's origin or owner, persistence, a
paste or delivery. Identical preexisting/foreign text can satisfy that transient
byte observation even when the observed bytes did not originate from this helper.
Different/unreadable replacement, timeout or lost/malformed replies remain
`outcome-unknown`, with no retry. The same text/frame limits and pre-effect
refusals apply. Other backends refuse the new operation before effect. Existing
`writeText`, `applied` and Wayland unknown semantics are unchanged; callers must
explicitly choose the new port rather than fall back between guarantees.
The facade exposes neither ambient contents nor a clipboard read operation.

The package build removes its own generated `dist` directory before compilation,
refusing an output-directory symlink or non-directory. Packing verifies that
only outputs from the current source files remain; ignored modules from a
previous branch cannot enter the public tarball.

## Privileged accepted-ink relay (source preparation)

`@apparent/native-host/ink` exports `createNativeInkRelay`,
`createNativeInkSourcePort` and the separate `NativeInkSourcePort` DTO. The
factory binds the original capture/source reference and owned NativeHost
identity to fixed socket operations. It requires an authenticated Engine ink
sink; **installed drawing remains unqualified**. The source observations match the
committed Engine contract `aa17795f` and [native source obligation](INK-SOURCE-V1.md).
No renderer may supply this port, accepted events, geometry, tokens or timestamps.

The relay joins the original capture/source and owned host incarnation, forwards
native `eventsJson` bytes without reserialization, and ACKs the retained native
batch only after a matching Engine receipt. A lost reply, digest/sequence change,
ambiguous ACK or timeout latches unavailable; it never rebinds or automatically
resends. Native input sealing resolves callback admission and drains callbacks
into retained batches; Engine finish follows exact batch acknowledgement, including
`finalSequence: null` only for genuine zero-batch completion. Accepted history is
separate from Board's current stack and never proves surviving canvas pixels.

Finish has one two-second monotonic deadline. Dispatch video Stop independently,
concurrently with this drain; never put Stop behind it. A complete ingress finish
is not an original material/Saved receipt, native effect qualification, permission,
process exit or ownership clearance. See the [controller and collector](NATIVE-INK-CONTROLLER.md)
for implemented source mechanics and static proof. Application adoption, actual
recorded overlay/Board effects and affected native acceptance remain required
before enabling or advertising drawing. Old snapshot ABI and
existing native producers are unchanged.

Binding/observation leaves native input admission closed. Only a matching Engine
registration opens it via `activateInput`, carrying the verified boot identity and
original admission monotonic timestamp. This extra native step is not an Engine
protocol change. Refused/unknown activation never becomes ready. Relay failure
does not prove either native input or Engine registration is absent: the owning
host retains those lifetimes, seals the native source safely, and preserves unknown
work under its normal shutdown contract. The relay does not cancel capture or
release ownership automatically.

The native-only source now installs the existing Board callback tap in that same
capture scope. `readBoard` observes its current stack and local revision; fixed
`controlBoard` intents (`open`, `undo`, `clear`, `close`) use that revision.
`requested` acknowledges dispatch only. Actual callbacks retain native windows,
transforms, coordinates and monotonic stamps. Undo/clear preserve accepted
history; close/reopen preserves the current completed stack with a new window
incarnation. The source closes and observes Board closure before sealing input.
An open window, changed geometry, missing callback or uncertain effect cannot
become successful empty collection.

Input remains prepared while the native coordinator creates the donor overlay;
only the matching continuation arms the scoped collector. Paint uses a separate
observer-derived projection, never the legacy recorder's active flag. A Stop
drain joins an already-issued exact batch under its original bounded deadline,
sealing further forwards first. Application/native qualification is still a
separate gate; these source operations do not establish recorded pixels.
