# Recording start preference

**Settings → Permissions → Skip screen selection** is on by default on
macOS and Wayland sessions that use the screen-sharing portal for full-display
capture. Screen recordings started from the app or Record shortcut
use the full-display route. Turn it off to choose a screen before every
recording. The portal can still ask for system approval. GNOME Wayland
defaults to the picker because its direct capture API can start without a
sharing dialog. X11 has no native picker.

The next Screen recording reads `permissions.skipScreenSelection` from
`~/.config/apparent/config.json`. An absent value uses the session default.
Explicit `false` chooses the picker where available. Explicit `true` uses the
full-display route. Older profiles can still use the inverse key,
`experiments.chooseScreenEachTime`. The Permissions presenter and
`apparent settings` use the same config transaction.

macOS uses the picker-authorized ScreenCaptureKit filter for the movie and
keyframe candidates. Wayland reuses the selected portal session directly, with
no restore token on this route. If selection is dismissed, source identity
cannot be established, or the system rejects sharing, no other source is
substituted. Microphone and input requirements still apply.

Typed notes are unavailable with the macOS picker. Its fixed filter cannot add
the notes editor to the window exclusions after capture starts. To use typed
notes on macOS, turn on **Skip screen selection**.

Area capture, phone capture, and Agent capture retain their existing admission
and source selection.

## Recording pane

The installed Settings sidebar delegates **Recording** to Record’s public
`RecordingSection`. Composition supplies the `RecordingBridge`. It carries
projected device, transcriber and playback facts plus acknowledgements from the
existing Settings config transaction. The renderer has no config file or device
access.

| Control | Saved value and effect |
| --- | --- |
| Microphone input | `recording.microphone` stores the native device ID and name, or clears them for System default. New recordings fall back to default if the device is unavailable. The input level uses only an authorized native input while Recording is visible. |
| Microphone on/off | `recording.microphoneEnabled` applies to the next capture. The menu and Recording switch share the same writer. |
| Transcription engine | `recording.transcriber` selects Parakeet on Linux or Apple Speech on macOS under the existing `apple` value. Hex and Command depend on native availability. Command uses an existing usable `transcribeCommand`. The next capture uses the preferred engine and its existing fallback. |
| Language | macOS Apple Speech reads `recording.appleLocale`, or uses the system language when Automatic clears the value. Saving through the pane also restarts the speech-model check. Permission and model readiness come from the native provider. |
| Hex model and language | The model selector is available on both systems when Hex reports models. Selecting a model saves `recording.hexModel` and selects Hex in one transaction. The macOS language field saves `recording.hexLanguage` and accepts blank for English. Model support determines whether Hex applies it. |
| Other-app volume | `recording.lowerPlayback` and `recording.playbackLevel` apply at the next recording's volume-lowering start. macOS uses a 0–100% slider. Linux uses presets and requires audio support plus `experiments.linux-playback-ducking`. A saved On preference can be turned off when the experiment is unavailable. |
| Video export | `recording.videoExport` controls the Export Last Capture as Video menu item. |

The former top-level Recording keys remain accepted for existing files.
The CLI accepts a device ID as `{"id":"device-id"}` for
`apparent settings set recording.microphone`. Use `apparent mic list` to
discover IDs and `apparent settings reset recording.microphone` for the system
default. Settings output includes the ID for this preference.

Linux also projects H.264 encoder/decoder warnings and local model download
status. The native controller keeps the shared writer, microphone permission,
device enumeration, speech preparation and volume effects. The Electron meter
uses the existing Linux capture meter or the macOS helper’s existing AVFoundation
meter. Neither publishes audio samples to the renderer.

## Permissions

`PermissionsSection` uses only the projected state and actions in
`permissions-contract.ts`. Its rows reuse Record's recording requirements and
reflect observed system access. It shows **Check again** if the automatic access
check fails. The screen selection preference takes effect on the next capture.
The Bend repair policy also serves the native Settings fallback and onboarding
repair. Keep the native fallback available for missing assets or renderer startup
failure.
The native build consumes the compact generated table so Cargo can
build offline. After editing the policy, run
`node record/enablement/ci/bend/permission-table.ts > record/settings/permissions/permission-policy.json`
and verify it with `node record/enablement/ci/bend/check.ts`.

## Double-tap Shift for notes

During a screen recording with typed notes available, tap Shift twice quickly
over the recording target to open the note editor at the pointer. Hold Shift
and move the pointer to draw. The shortcut is always available in these
recordings. The app ignores the former `experiments.doubleShiftNotes` preference.

Record's Bend policy builds a checked native decision table for the input
pollers. They keep the monotonic timestamps, live ink, pointer position and
session guards local, so the gesture works without waiting on the renderer.
Regenerate the table with
`node record/enablement/ci/bend/check.ts --write-native-gesture`.
