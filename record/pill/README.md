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
