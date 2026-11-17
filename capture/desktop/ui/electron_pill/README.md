# Recording pill

Desktop's React/TypeScript row renders the existing Rust capture state through
bounded parent-owned pipes. Rust validates revisions, action availability,
capture generation and exact handoff selection before dispatch. The renderer
receives no bundle paths, credentials, configuration or capture contents.

The row covers selection, recording, processing and completion. It reuses
shared shadcn Button controls and Lucide icons. Cancel/dismiss uses ×; ordinary actions retain labels.
Cancel/dismiss stays at the trailing edge in visual and keyboard order; during
ordinary recording it follows Whiteboard and Finish. Completion orders Inspect
before the primary Paste action, matching Whiteboard before Finish. Processing
and foreground upload indicators rotate unless OS or native reduced motion is enabled.
Warnings and rejected actions remain inline;
there is no expandable panel or Record-package dependency.

During recording, durable saved notes appear in the approved flush lilac extension
on the right, using the shared Lucide StickyNote icon. Zero hides the extension;
drafts never count. The 72px transparent footprint keeps Whiteboard, Finish and
Cancel fixed for 0, 1 and multi-digit counts. Its hidden region is excluded from
Linux input shape and hover. Clicking opens the existing notes list. Rust projects
the existing durable Store receipt and retains its sole persistence writer;
TypeScript owns the count presentation. The separate badge is suppressed only
while Electron owns the visible pill, and returns on native/Glass fallback.
The existing note editor and saved format are unchanged. Remove the fallback
badge only after all compatibility routes have accepted replacements.

Build the frontend with `npm ci && npm run build` in `../frontend`. Its build
transpiles the preserved CommonJS Electron host from `.cts`; generated `.cjs`
files are ignored and included by the existing Settings packaging route.
`npm run test:pill` exercises the real Electron main/preload/renderer with a
synthetic parent; it is not native capture acceptance.

Foreground upload holds the existing completion dismissal while an operation is
pending. Cancel and an admitted current upload result start a fresh 15-second
completion interval, so recovery or recopy controls do not inherit an expired
save timestamp. Revoked tokens, changed captures and stale results cannot refresh
the current presentation. Ordinary completion and manual-handoff recovery keep
their existing dismissal behavior.

An open public-sharing confirmation retains its exact revision's completion
surface while the user reads the disclosure. Confirm, cancel, a new semantic
snapshot or renderer reload releases that hold. The native adapter accepts it
only for the current completed view with an enabled sharing control; a closed
child cannot retain the presentation. Closing the confirmation resumes the
ordinary completion interval without uploading before consent.

The existing Desktop coordinator owns child startup and readiness. A failed
launch, expired readiness or child exit restores the native pill without
stopping capture. Linux warms the hidden child at startup and retains native
held-button/identity checks, drag clamping and exact-window pinning. The child
alone moves/remaps its Electron surface; Rust never remaps it concurrently.
The child also reconciles its X11 input stacking without taking focus.
The pill shows and hides immediately, without CSS animation or a spring/morph.
Recovery samples the owned process before closing it and records pipe-stop
codes, readiness/activation observations and the last flushed phase/revision.
An unhealthy transport is distinct from an observed OS exit. Electron stderr
records bounded termination reasons and relative timing, without parent frames,
capture labels, paths or error text. These observations do not change deadlines,
action admission or fallback.
Each new semantic snapshot is laid out before a hidden window becomes visible.
Clock and microphone snapshots do not request layout; a ResizeObserver handles
actual content/font size changes. The host has no periodic layout measurement.
Phase changes retain the visible pill's horizontal center, excluding the hidden
notes reserve. Display placement uses the same visible width. Note-count changes
within recording keep the existing control positions; work-area clamping still
takes priority near screen edges.
On Linux a mapped resize paints the new surface before restoring its rounded
native mask, preventing stale opaque corners on XWayland. Concurrent layout
requests share that paint barrier and obsolete snapshots cannot restore a mask.
Window move/resize/layout events publish physical geometry for the notes anchor,
instead of the GUI thread polling X11 geometry. Hidden Linux rendering is not
background-throttled, so preloading can finish before the first capture.
On Lua-configured Hyprland the native adapter installs an exact-window `no_anim`,
`no_blur` and `no_shadow`
runtime rule before acknowledging readiness, and retires it when the child pipe
closes. The native fallback uses the same rule for its window lifetime. These
are compositor mechanics; recording and presentation policy are unchanged.
Other compositors and older Hyprlang retain their own window-animation
policy; application CSS motion is still disabled. Startup/watchdog and native
fallback remain active. Rollback restores the previous presentation host and
geometry polling together; no capture or persisted preference format changes.
macOS Black uses this shared presentation by default. The existing movable-controls
feature retains dragging and Mac movie inclusion, not presentation admission.
It is enabled by default. Explicitly set `experiments.movableRecordingControls`
to `false` to exercise the excluded Mac route; omitting it tests the included route.
Glass retains native routing.
There is one visible pill. Missing packaged assets retain the native route.
The Mac host admits its exact AppKit window before publishing readiness or
showing it. A small Node-API adapter applies the existing native pill's guarded
`_setPreventsActivation:` mechanism without disabling keyboard eligibility.
It accepts only an owned window ID with the pinned pill title and panel mask;
unsupported native setup exits the child and retains ordinary native recovery.
The adapter is built with AppKit only on Mac, staged and signed with the app,
and included in the native candidate's architecture and file checks. Linux and
the standalone Connect TypeScript package do not build or load it. This is a
private AppKit mechanism: native focus and keyboard acceptance remain required.
On Mac with movable controls explicitly disabled, capture reset restores the child
window's explicit exclusion. If the
child becomes ready during capture, the native controls remain visible until
ScreenCaptureKit acknowledges that exact child ID in its applied filter. Failed
filter updates never acknowledge the requested ID or advance the candidate filter.
Unresolved window IDs retry at a bounded 250 ms cadence, even when requests stay
unchanged. Device capture uses its phone stream and does not wait for an SCK receipt.

Rollback is removal of the Electron routing calls and fields in Desktop's
coordinator; the native implementation remains required for failure recovery
and the compatibility routes above. Remove it only after accepted replacements
cover those consumers and both platforms, including startup/crash recovery,
focus, stacking, dragging, capture visibility and actual Paste delivery.

Native acceptance must use the exact packaged candidate in isolated Linux and
macOS environments. Synthetic renderer checks do not establish that acceptance.

## T3 destinations

Settings → Labs → **Send recordings to T3** is explicitly off by default.
When enabled and paired, processing/completion replaces Paste with the approved
destination capsule. New thread is the default; the first Down opens the list
and highlights New thread, which remains selectable when there are no existing threads. Up/Down, Home/End, wheel and touch
navigate three visible rows. Escape closes without confirming; Enter, Space or a row
click confirms. All connected computers appear together with computer and project labels. Settled, archived, deleted and subagent threads are excluded.
Server ordering preserves pins/manual positions, then active and snoozed shelves;
client-only project ordering and visibility are unavailable through this API.
New threads use the last confirmed project's defaults, or the first project
before any confirmation. The selected computer and project are shown in the capsule, rows, accessible label and tooltip. A configured `t3.projectId` overrides that fallback.

Desktop's TypeScript main-process controller owns selection, transport and durable
receipts. The renderer receives only public thread titles, project labels and
handoff state. Rust provides a process-namespaced capture identity, eligibility
(practice captures are excluded) and the exact standard handoff on finalization,
including after dismissal or a newer capture. Confirmation while processing
freezes the destination and dispatches when that capture is ready; browsing does
not arm a handoff. Close hides the picker without cancelling confirmed work;
Cancel handoff is available before submission starts.

On Linux the ordinary non-focusable controls and keyboard picker require different
constructor roles. Main replaces the window using the same renderer and retains
the donor until the replacement commits. Rust re-admits its exact ID, capture
exclusion and compositor rule before sending an ID-bound activation. Old activation
acknowledgements cannot admit a newer window. Returning to recording restores the
non-focusable role; the off route retains its original window and focus behavior.
macOS keeps its existing keyboard-eligible nonactivating panel.

The controller uses T3's authenticated shell and Effect WebSocket RPC, without a
T3 patch. Existing messages use normal auto delivery; new threads honor project
model/workspace and environment runtime defaults. Credentials stay in main.
Private atomic `t3-handoffs` receipts beside the config retain stable command,
message and new-thread IDs. A missing acknowledgement is uncertain; manual Retry
reuses those IDs. Copy instead writes the exact prepared handoff and waits for
clipboard readback. Successful receipts drop their copy of the handoff text.
Renderer reloads retain main-process work; a whole-app restart restores receipts,
but cannot resume a finalizer that no longer exists. Native failure/Glass routes
retain ordinary Paste. Turning the setting off restores Paste for the next take
without erasing receipts or cancelling confirmed work. Removal requires accepted
replacement of the controller, its private completion channel and both platform
consumers together; there is no competing native selection policy.

`tests/pill/t3/controller.test.ts` exercises isolated HTTP/WebSocket providers and receipts;
`tests/pill/t3/destination.smoke.cts` drives the actual built Electron renderer, main and
clipboard. These do not establish a real T3 mutation or native capture acceptance.
