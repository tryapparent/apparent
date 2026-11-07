# Native Shift source controller

`capture/desktop/workflow/native_host/ink_source.rs` observes the current Linux
owner PID/start ticks, boot ID, strong host epoch and one unrotated scale1
Hyprland/XRandR output. Capture/source IDs remain privileged original Engine
references. Screen surface and transform IDs are native-minted; the incarnation
identifies the observed monitor and producer, not an invented native window.

Observation does not install input. Matching capture/producer/generation and
Engine ACK boot/admission clock are required before the controller installs its
real `NativeInkObserver` on the existing telemetry gate. The actual donor target
must match the observed output. Each callback rechecks output identity; missing,
changed or unreadable geometry/clock makes collection unavailable. No default
coordinator rectangle, renderer points or caller-provided geometry is accepted.

Provisional points stay private until the donor reports an accepted release.
Stationary taps and unfinished input never become accepted history. Accepted
raw points, native observation times and frozen RGB are serialized once into
bounded sequence/digest batches. Reads retain identical bytes until exact ACK.
Stop remains independent: explicit seal removes the exact observer, waits for
its callbacks, then seals the retained original batches. No Drop cleanup or
successful seal is inferred from an unknown/unavailable source.

Focused tests drive the actual Shift donor callback into this controller,
including pre-ACK refusal, original coordinates/times, wrong ACK preservation,
geometry/clock changes, unfinished/zero input and post-seal callback refusal.
`npm run test:ink-sdk -- <exact-sdk046-tar> [native-controller-fixture]` creates a
fresh offline installed consumer, checks packed declarations and plain Node
exports, and optionally passes the actual controller's synthetic unit fixture
through public SDK046 validation and the NativeHost relay. It starts no worker,
socket, GUI, input listener or model. Fixture evidence is not OS acceptance.

This is the screen-source controller, not an enabled drawing route or complete
native factory adoption. Existing NativeHost socket dispatch, native-only input
owner activation, Board callback stamps/incarnations and Electron controls still
need integration. No competing legacy recording may be started to obtain input.
Actual native effects, latency of per-callback monitor joins, original sealed
facts and full Saved/Copy/Agent journey remain acceptance gates. Installed
routing and advertised capabilities are unchanged. Mac is unsupported here.
