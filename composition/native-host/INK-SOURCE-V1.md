# Accepted ink native-source obligation, v1

Joint source agreement for Engine's Capture/2 `registerInkProducer`,
`submitInkEvents`, `finishInkProducer` proposal. This document defines Platform's
adoption obligation, not an implemented/exported port or native availability.
Engine owns the public worker protocol, owner authentication, clock checks,
clipping/normalization, original fact sealing and admission limits. Record owns
canonical projection and preservation of original sealed facts. Platform owns
actual input acceptance, surface registration, UI state/effects and forwarding.
Do not copy the canonical mapper, invent point authority or add a service.

## Truthful donor observations

Linux Shift input already uses `runtime/platform/linux.rs`'s native pointer
sample while `InkOverlay` takes XWayland pointer input. Evdev supplies modifier
state/readability; Held facts alone supply no position. Keep stale-pointer
suppression, pure-Shift/notes-edit suppression, 1.5-pixel thinning, 2400-point
gesture limit, release acceptance and existing `recording_ink` clipping/output
splitting. `OverlayView` paints telemetry; paint output is not input acceptance.
Unreadable devices or unjoined pointer/surface identity remain unavailable.

Board's native listeners accept GPUI window-local pointer positions. Preserve
1600x1100 paper, the donor64-point toolbar offset, inside-only start, clamped
extension, finish on up/up-out, undo active-or-last, and clear active plus stack.
Close removes the window while the owner-held Board survives; Stop snapshots
before closing; a new capture resets it. Current Board arrays have no native
timestamps, IDs or RGB. Add these at the actual native callbacks, not by later
inspection of arrays, renderer timestamps or inferred drawing intent. Board's
current paint color is not the pen preference: omit RGB unless the adapter can
freeze the exact observed drawing color at begin. Never recolor old strokes.

## Registration and event authority

Use a separate versioned NativeInkSource port beside existing NativeHost ports;
leave the old NativeHostSnapshot ABI unchanged. Its implementation belongs to
Platform. Fixed privileged operations bind the original capture, read observed
source/surfaces/events, acknowledge an exact retained batch, apply Board actions
under CAS, and seal/drain source input. These are obligations, not current method
exports. Renderer commands contain only fixed UI intents (open/undo/clear/close),
never accepted points, claimed transforms, clock stamps or producer/owner tokens.

The native adapter must supply these observed facts, in one coherent revision:

| Fact | Authority and lifetime |
| --- | --- |
| Strong process epoch/revision, PID/start identity | Existing owned NativeHost process; no weak PID-only fallback |
| Producer ID and generation | Native-minted, original-capture scoped and never reused after replacement |
| Boot ID and clock domain | Native `/proc` boot ID and Linux CLOCK_MONOTONIC; compare Engine's admitted domain |
| Engine source ID/generation | Reference to the original authenticated Engine binding, not claimed as a native observation |
| Native output name, physical rect, compositor rect/scale | Actual native monitor/output observation, matched to Engine's confirmed original portal source |
| Logical surface ID, native surface incarnation, content rect, transform generation | Actual owned surface; a move/resize/scale/reopen changes its transform/incarnation |
| Point and acceptance stamps | Native CLOCK_MONOTONIC sampled at the actual input observation/acceptance, canonical-u64 ns; not hardware-event time |
| Gesture ID, sequence, RGB if observed | Native accepted event order and frozen source color; no caller-created accepted history |

Initially qualify only the exact single-monitor scale1 geometry join. Do not
generalize to fractional scale/rotation/multi-monitor until their existing
native mappings are qualified. A source/output/transform change invalidates the
unfinished gesture before further points; earlier accepted geometry stays fixed.
Board's logical plane survives close/reopen; its replacement window does not
reuse native incarnation/transform identity. No unobserved affine matrix.

The trusted owner host reads the identity-joined native source, then forwards its
original ordered events to Engine's authenticated registration. It is a trusted
native-observer boundary, not independent OS attestation. Ordinary renderer or
arbitrary SDK caller data must not replace it. All registration/producer secrets
stay privileged. Native retained sequence/batch digest and Engine acknowledgement
must correlate exactly; lost replies do not reset IDs, retry acceptance under a
new identity or silently drop events. Bounds must fit Engine's published limits
(proposed64KiB frames,256 points/batch,2400/gesture,4MiB facts); overflow latches
incomplete/unavailable rather than truncating and reporting complete.

## History, UI effects and completion

Agree **immutable accepted history plus separate current Board stack**. Later
undo/clear do not rewrite accepted points/times/RGB. Their observed native effects
change the current stack; active undo discards unfinished work before last-stack
undo. Close/reopen preserves that stack. Forward ordered undo/clear/surface-state
effects for Engine's producer integrity, but do not add erase fields to SDK045
StrokeFacts. Record's accepted-history projection remains authoritative for that
history; movie pixels are visual authority. Neither history nor its canonical
projection promises final-surviving-mark reconstruction or time-exact canvas
replay. Do not render an inferred full-canvas replay from this history.

Electron owns the product commands/workflow. Native acceptance and overlay
mechanics reuse the donors; no second legacy recorder/presentation is enabled.
Final UI/native composition must prove actual draw/undo/clear/close-reopen effects
before the route is advertised or enabled. A command acknowledgement alone does
not prove pixels or accepted native input.

On Stop/cancel seal input admission, explicitly resolve/discard the unfinished
gesture, drain original ordered events and positively finish before immutable
materials revision/lease sealing. **Native video Stop must remain live even if
ink drain fails.** Engine owns the bounded material-finalization barrier and
marks collection unavailable/explicit failure on missing/gapped/lost completion;
never postpone Stop indefinitely, shift/clamp stamps or manufacture collected
empty. An Engine ingress ACK is not native effect observation. Disconnect,
source replacement, unknown batch/finish, stale CAS or changed geometry stays
honest; there is no implicit reconnect/rebind to a different capture.

## Delivery and retained return

Engine freezes one matching typed public port and implements it in its existing
worker. Platform then implements this separate native source/client and actual
Electron control adoption on a dependency-closed branch, including strict
protocol/CAS, source/clock/geometry, lifecycle and overflow tests. Coordinate
exact overlapping donor callback edits with Engine before writing them. Record's
admitted original-sealed consumer is reused; no Platform output mapper.

Platform retains direct return to the existing Engine/Record/parent routes:
exact committed public native source contract, paired package identities,
focused/independent checks, actual affected native proof and source release.
Implementation/package completion is not input permission or native availability.
Until registration, actual acceptance/effect, drain and sealed producer output
are qualified, stroke collection remains unavailable. No X1/guest/native take,
permission change, provider/model change or paid resource is authorized here.
