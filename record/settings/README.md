# Recording start preference

In Settings → Labs, **Start screen recording right away** is the default.
**Choose a screen each time** requests a fresh system selection for each Screen
recording started from the app or Record shortcut. Linux Wayland can also ask for
portal consent in the default mode. The picker choice is unavailable on X11.

The next Screen recording reads `experiments.chooseScreenEachTime` from
`~/.config/apparent/config.json`. The Electron Settings renderer uses the Labs
bridge and the app's existing config transaction. To return to the default
behavior, select **Start screen recording right away** in Labs.

macOS uses the picker-authorized ScreenCaptureKit filter for the movie and
keyframe candidates. Wayland reuses the selected portal session directly, with
no restore token on this route. If selection is dismissed, source identity
cannot be established, or the system rejects sharing, no other source is
substituted. Microphone and input requirements still apply.

Area capture, phone capture, and Agent capture retain their existing admission
and source selection. Keep the immediate Screen route while it is the rollout
default and while other callers still need it.
