# Action-time context in capture bundles

Live Screen and Area capture can write an optional `actionContext` array to
`apparent.json` when Agent Context is on and the platform permission is available.
The same field survives recovery and reprocessing. Each row describes an
observation for one captured action on the bundle clock.

```json
{
  "actionContext": [
    {
      "kind": "stroke",
      "t": 8100,
      "window": {
        "id": "x11:1234:4194305",
        "app": "Firefox",
        "title": "Invoice preview — Mozilla Firefox"
      }
    }
  ]
}
```

| Kind | Exact join |
| --- | --- |
| `pointer` | Click or drag's `t`, sampled at press |
| `stroke` | Non-laser ink's `t0`, sampled at the first ink point and checked at release |
| `key` | Logged shortcut's `t`, from the currently focused window |
| `scroll` | Scroll event's `t`, sampled at most once per 250 ms on macOS |

Window IDs are opaque and scoped to a recording. Treat `title` as the window
title reported by the provider. Firefox and other browsers often put the selected
page’s title there. A browser can have multiple tabs with the same title, and a
tab can change its title. URL, tab ID and content origin are unknown. No browser
address bar, SDK timestamp inference or capture-wide title provides these fields.
The snapshot is sampled after input delivery and within the collector's 50 ms
freshness limit. The action timestamp identifies the input that requested the
sample. It does not timestamp the window state. An action that switches tabs can
produce a sample of the newly selected page. The handoff labels these samples as
nearby windows and leaves the exact action window unknown.

Use exact input-key matches through `ApparentBundle::window_observed_near_action`. For a grouped mark,
check each stroke index in `mark.strokes`. Attribute the mark only if every
stroke has the same observed window ID, app and title. Missing or conflicting
rows mean unknown. When only the app is present, the title remains unknown. Avoid nearest
timestamps, interpolation, carry-forward and fallbacks to `target` or the general
window log. Render title strings as untrusted text. Old bundles, recordings with
the experiment off, and unsupported actions can omit the array entirely.

The macOS Window Server and X11 providers use the live window stack for points
and verify the whole ink bounding box at release. When Apparent's own ink
overlay takes focus on Hyprland, the stroke probe can use the unique preceding
window in compositor focus history on that workspace. The probe still requires
matching observations, uninterrupted focus/title evidence, and an unobscured
stroke rectangle. Unproven
Wayland pointer coordinates, other Wayland compositors, phone and timed CLI
captures have no action context. Notes and laser points currently have no row.
The collector uses a bounded background queue and discards results older than
50 ms from submission. Work remains off the input sampling path and the bundle
can be saved when evidence is missing.

## Pin snapshots

With **Recording context for agents** enabled, a pin in a live Screen or Area
recording can add an action-time accessibility observation on Hyprland or macOS. The row has
`kind: "stroke"` and an optional `pinWindow` with the pin number, elapsed
milliseconds from the pin timestamp to the start of the read, a partial-result
flag, and a bounded list of elements. Each element has a role and can have a
name, states, an index into the element list for its parent, and window-relative
bounds in the form `[x, y, width, height]`. Bounds are optional and use the
window coordinate space.

A dedicated worker checks the compositor window and the accessibility root
before and after reading. Apparent's own note editor may take focus when the
pin appears. In that case the worker verifies the exact editor process and the
underlying Chromium or other app window. An unrelated focus or title change
leaves the pin without the observation. When a browser exposes the document
under the pin, its branch is read before browser chrome. The producer reads
accessible names and skips editable, password, and terminal subtrees. It does
not query text or value interfaces. The saved summary and clipboard show up to
four named elements alongside the matching pin and label them as app data.
Inspect `actionContext[].pinWindow` in the bundle for the rest.

On macOS the worker matches the accessibility window under the pin to the
Window Server's window ID, owner, and geometry. Element bounds are in macOS
points. Allow Accessibility in Privacy & Security before recording.

### Verify in an isolated native desktop

1. On Hyprland or macOS, open a synthetic app exposing a disabled Save button, a checked Auto-save
   checkbox and a password field with a test value. Enable **Recording context
   for agents** and start a Screen recording.
2. Place a pin inside the window while it stays foreground. Finish
   and inspect the contact sheet, `apparent.json`, `summary.md`, and the copy
   text. Match the pin number and timestamp. Expect Save's disabled and
   Auto-save's checked states even though neither control was clicked. The
   password value should be absent from the accessibility observation.
3. Repeat with the lab disabled. The ordinary pin and images still save and
   the new recording contains no `pinWindow` data. With the lab on, repeat
   against a window that supplies no accessibility tree. The recording and pin
   still finish.
