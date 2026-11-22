# Recording pill

Record owns the active pill in `pill-state.bend`. The portable TypeScript host
instantiates it once per coordinator, projects the renderer view, and carries
display text alongside typed outcomes. The application embeds the generated
module and evaluates it in a process-local QuickJS context without Node APIs,
filesystem access, or a renderer dependency. The native app build runs the
pinned Record compiler before linking. An installed app can present the Glass
and GPUI fallbacks when Electron is unavailable or exits during capture.

| Input | Record policy |
|---|---|
| Picker opened, target selected | Selecting layout and available controls |
| Capture started, sealed, saved, failed | Recording, processing, completion or dismissal |
| Activity, pointer and reveal events | Switch controls, minimum reveal and linger |
| Publication, upload and consent observations | Completion copy, retry state and dismissal holds |
| Deadline or surface hidden | Begin dismissal or retire the dismissed surface |

A native monotonic deadline drives completion expiry. The existing animation
clock drives the switch-controls reveal, including lab time scaling. Both
deadlines are returned by Bend. The coordinator compares current time to those
deadlines and evaluates the module only when an observation changes or a
deadline comes due. Clock text, waveform, live transcript and animation frames
use the existing renderer paths. The renderer's transport revision admits only
current controls and never renews a hold from a dead renderer. A renderer exit
leaves the policy instance and its capture untouched.

## Microphone activity

The Electron recording pill shows Soft Bloom around the recording dot when
the capture supplies microphone history. The newest captured sample drives
its size. Quiet and expired samples hold the last size. Reduced Motion uses
a fixed halo and shows sound with side ticks. Microphone warnings still
come from the capture, and the renderer exposes the current activity to
assistive technology.

The desktop renderer build bundles the generated `soft-bloom.mjs` policy.
The Glass and GPUI fallbacks continue using the native waveform. Reverting
the renderer and its build wiring restores the previous meter without a
settings or capture migration.

**Recording pill doodles** is on by default. The pill samples the saved Labs
preference at the next recording start. The shared Electron pill paints
the optional art behind the controls with capped opacity. Reduce Motion
uses still artwork. The native microphone indicator retains its own status.

## Native fields and boundaries

- `active_recording`, pending finalizer count, capture/selection generations and
  Agent receipts carry native producer identity, authorization, and resource
  lifetime. They protect exact capture and bundle effects independently of UI
  visibility and protect against asynchronous stale producers.
- `island_phase` and the native adapter’s presentation and wake fields cache
  Record outputs. The last observed facts are cached for deduplication. The previous
  phase, last completed presentation, interpolation values, springs, outgoing
  groups, animation timestamps and last clock are draw resources for the
  native fallback. They let a renderer finish a transition after Record has
  moved on.
- Native and Electron window IDs, readiness, input geometry, attachment,
  compositor admission and exclusion receipts belong to their platform adapters.
  Electron's revision and local dialog state belong to the window protocol.
  Record decides whether a live consent hold retains the completion.
- Exact bundle paths, local clipboard admission, T3 delivery receipts, Connect
  login and upload tokens stay with their capability owners. They yield typed
  observations and control availability facts to the pill. Text from any of
  these capabilities can change without changing retry, consent, or timeout
  policy. Native capability fences still run before effects.
- The cached native completed phase carries frame count and duration from the
  finalizer receipt. Its timestamp records the initial receipt. Its inbox count
  is zero for local completion. None of these fields drives expiry or admission.

## Verification and rollback

On Linux, the native parent selects XWayland when launching Electron, before
Ozone initializes, and supplies the same X11 scale as the native pill. The
Electron constructor selects the window's keyboard role at creation. Native
compositor admission uses the window ID reported by Electron main after layout
and before activation. Hyprland pins the exact child by process and XID-specific
title, and prepares its scoped motion rule before mapping. The parent ignores
hidden geometry for admission and falls back to the native pill if compositor
admission fails, even when Electron reports a visible window.

Run `node record/enablement/ci/bend/check.ts` to compile the module and exercise
the packaged host entrypoints under Node with no Cargo or Electron.
Add `--proof` for the pinned kernel verdict. The root native suite exercises
the same module embedded in the app. The frontend's `test:pill` checks the real
Electron host and renderer with a synthetic parent. Use the isolated native
test routes for capture, Electron loss, native fallback, and packaged
macOS/Linux acceptance.

Rollback is a revert of the cutover, including the embedded host, Rust event
wiring and renderer protocol. Each app build embeds the matching policy; no
preferences, bundle format, or on-disk state requires migration.

## Overlapping captures

Finish keeps one live recording at a time. Engine stops the screen, microphone
and window telemetry together. The finalizer signals source release when Engine
returns, and the pill policy then permits the normal Record actions while the
older bundle is still being built. The
older capture keeps its own receipt and handoff identity. A late result cannot
replace the newer pill or write its clipboard.

An already confirmed T3 send appears in a compact left extension during the
next recording. The recording row supplies the window's alignment point.
The extension keeps its square end underneath the rounded recording row and
shares the Notes extension's color and button treatment. The tab shows pending
work, a check after acknowledgement, or an attention state with a same-request
retry when the saved handoff is available.

The [Composition renderer](../../composition/pill/renderer/main.tsx) assembles
Record's pill and Handoff's destination picker through the Desktop bridge.
The [Composition smoke tests](../../composition/pill/enablement/) exercise the
installed Electron entrypoint and loopback T3 transport together. Run them
through the Desktop frontend's existing `test:pill` or `test:electron` command.

The recording Whiteboard opens the packaged Electron window assembled by
Composition. Onboarding injects its drawing lesson into the same window.
The Record Bend policy supplies editing decisions to the native capture session,
which owns the accepted paper across close, reopen and renderer loss. The
native bundle writer publishes timestamped Whiteboard keyframes for the paper
visible before Undo or Clear removes ink, plus a separate final image if ink
remains at Finish. The capture retains the latest 12 pre-edit snapshots. The
practice example stays in the renderer and never enters those images.

Both pill implementations request the same surface. The desktop package stages
`dist/whiteboard` beside its other popup assets and uses the installed shared
Electron runtime. Removing that asset requires reverting the routing and policy
together to restore a working recording and practice surface.
