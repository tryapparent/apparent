# Recording context for agents

**Settings → Labs → Recording context for agents** controls the existing
`experiments.agentContext` flag through the shared config transaction. It is off
by default. Settings reads existing values from `~/.config/apparent/config.json`.
Start a new recording for the capture-time collectors to use the updated setting.
Turn the switch off to restore the standard handoff.

Enabling the switch requests desktop accessibility on Linux and readbacks
confirm whether it is available. Some apps need to restart before publishing
their controls. On macOS, it requests the per-app Accessibility grant using
the system prompt. Approve Apparent in Privacy & Security → Accessibility.
Turning Agent Context off stops collecting the extra context. The OS setting
or grant remains available to accessibility tools. A local dev page using
the Apparent SDK can also supply React component and source details.
See the [bundle guide](../../../capture/engine/docs/keyframes-and-text.md).

The same switch enables local English OCR and object recognition for circles.
Recognition uses pixels captured before the stroke and gives app-provided
labels priority. A previous circle-only preference does not opt in to the
combined feature.

When native accessibility resolves a browser page, clicks and marks can include
its HTTP or HTTPS URL. Credentials, queries and fragments are excluded. Page
paths may appear in the handoff. Availability depends on the browser exposing
its accessibility tree and Apparent identifying the interaction’s window.

On Hyprland, Chrome and Chromium may need to be restarted with
`--force-renderer-accessibility` before they publish page URLs. Apparent omits
URL context when it cannot uniquely identify the browser window. A recording
can include URLs from a private window if the browser exposes them through
accessibility.

## Verify browser handoff on a native desktop

Use an installed candidate in a disposable desktop session. Open two local
test pages with the same title and different paths. Include a test query and
fragment in each URL. Enable Recording context for agents and grant the
required accessibility and screen recording permissions.

Start a screen recording. Click a labeled control and draw a Shift circle
around it on each page. On macOS, repeat a take with a notification banner
visible away from the control. Stop the recording and run `apparent copy <bundle>`
for the saved bundle.

Check that the clipboard text and bundle summary contain the correct page
path at each click and circle time. Look for the test query and fragment in
the full summary and clipboard text, including the button and circle labels.
Neither marker should appear. Repeat with the Labs switch off to verify that
the next recording omits browser URLs.
