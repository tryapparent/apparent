# Recording context for agents

**Settings → Recording → Recording context for agents** is on by default.
The shared preference retains the CLI ID `labs.agentContext` and reads existing
`labs.agentContext` and `experiments.agentContext` values. Changes apply to
the next capture. Use `apparent settings set labs.agentContext false` to opt out
or `apparent settings reset labs.agentContext` to restore the default.

Local object recognition uses pixels captured before a circle and gives
app-provided labels priority. An ambiguous result keeps the timestamp and frame.
English text recognition inside circles requires an explicit opt-in. It can read
visible input values in the selected pixels. Captured images retain visible text.

Choose **Enable desktop accessibility** for additional control details on a
system where it is off. On Linux the button enables the desktop-wide AT-SPI
setting. Some apps need a restart before publishing their controls. On macOS
the button requests the per-app grant in Privacy & Security → Accessibility.
The desktop setting or grant remains available to other tools after opting out
of recording context. Local circle labels work independently of the grant.
To allow a registered local Apparent SDK page to provide component details or
developer diagnostics, explicitly set the preference on with
`apparent settings set labs.agentContext true`. An inherited on-by-default
preference leaves SDK diagnostics off. See the [bundle guide](../../../capture/engine/docs/keyframes-and-text.md).

Browser observations in new captures contain the HTTP(S) site origin. Private
and regular windows use the same rule. Credentials, paths, queries and
fragments are excluded. If Apparent cannot identify the interaction's window
and page, the action retains its visual evidence. On Hyprland, Chrome and
Chromium may need to restart with `--force-renderer-accessibility` to expose
browser pages. Linux clicks can carry a site without an OS-derived control name.

## Verify browser handoff on a native desktop

Use an installed candidate in a disposable desktop session. Open two local
test pages on distinct origins with the same title and different paths. Include a test query and
fragment in each URL. Reset Recording context for agents to its on-by-default
state and grant the required accessibility and screen recording permissions.

Start a screen recording. Click a labeled control and draw a Shift circle
around it on each page. Switch back to the first page and repeat. In a private
browser window, try a third origin with a distinct path, query and fragment.
Use synthetic password and ordinary input values and keep their fields visible
beside a labeled control. Draw a circle around an input value as a control case.
The added text should omit both typed values while the images retain the pixels.
On macOS, repeat a take with a notification banner visible away from the control.
Stop the recording and run `apparent copy <bundle>` for the saved bundle.

Check that the clipboard text and bundle summary contain the correct site origin
at each click and circle time. For consecutive actions on one page, the
clipboard shows the site once with the action times underneath. Draw three
complete Shift circles on the same page with less than 1.2 seconds between
them. Check for three separately timed marks with their own labels and the
same site origin.
The clipboard uses a short nearby location only when it adds context. Circles
with an unidentified target keep their timestamps and mark numbers. The saved
summary retains individual browser observations and records missing context.
Pass the saved bundle to a local agent consumer and verify that it can identify
the cited controls and mark times from the handoff. Compare equivalent takes
with recording context off and on. Record frame drops, peak process memory
and elapsed time from Stop to clipboard publication.
Look for the test path, query and fragment in the full summary and clipboard text,
including the button and circle labels.
These markers should be absent from the added context. Repeat with the switch
off to verify that the next recording omits browser site observations.
