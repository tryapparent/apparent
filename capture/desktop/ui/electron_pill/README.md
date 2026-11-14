# Recording pill

Desktop's React/TypeScript row renders the existing Rust capture state through
bounded parent-owned pipes. Rust validates revisions, action availability,
capture generation and exact handoff selection before dispatch. The renderer
receives no bundle paths, credentials, configuration or capture contents.

The row covers selection, recording, processing and completion. It reuses
shared shadcn Button controls and Lucide icons. Cancel/dismiss uses ×; ordinary actions retain labels.
During ordinary recording, Cancel precedes
Whiteboard and Finish, matching the approved extension composition. Warnings and rejected actions remain inline;
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
