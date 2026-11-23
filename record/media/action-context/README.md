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
and verify the whole ink bounding box at release. Hyprland uses the focused
compositor window, validates point/ink geometry and coverage, and rejects
conflicting window, focus and title events during observation. Unproven
Wayland pointer coordinates, other Wayland compositors, phone and timed CLI
captures have no action context. Notes and laser points currently have no row.
The collector uses a bounded background queue and discards results older than
50 ms from submission. Work remains off the input sampling path and the bundle
can be saved when evidence is missing.
