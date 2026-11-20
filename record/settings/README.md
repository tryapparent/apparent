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

Typed notes are unavailable with the macOS picker. Its fixed filter cannot add
the notes editor to the window exclusions after capture starts. To use typed
notes on macOS, select **Start screen recording right away**.

Area capture, phone capture, and Agent capture retain their existing admission
and source selection. Keep the immediate Screen route while it is the rollout
default and while other callers still need it.

## Recording pane

The installed Settings sidebar delegates **Recording** to Record’s public
`RecordingSection`. Composition supplies the `RecordingBridge`. It carries
projected device, transcriber and playback facts plus acknowledgements from the
existing Settings config transaction. The renderer has no config file or device
access. **Settings → Labs → Recording start** uses its existing experiment.

| Control | Saved value and effect |
| --- | --- |
| Microphone input | `microphone` stores the native device ID and name, or clears them for System default. New recordings fall back to default if the device is unavailable. The input level uses only an authorized native input while Recording is visible. |
| Transcription engine | `transcriber` selects Parakeet on Linux or Apple Speech on macOS under the existing `apple` value. Hex and Command depend on native availability. Command uses an existing usable `transcribeCommand`. The next capture uses the preferred engine and its existing fallback. |
| Language | macOS Apple Speech reads `appleLocale`, or uses the system language when Automatic clears the value. A successful change restarts the speech-model check. Permission and model readiness come from the native provider. |
| Hex model and language | The model selector is available on both systems when Hex reports models. Selecting a model saves `hexModel` and selects Hex in one transaction. The macOS language field saves `hexLanguage` and accepts blank for English. Model support determines whether Hex applies it. |
| Other-app volume | `lowerPlayback` and `playbackLevel` apply at the next recording's volume-lowering start. macOS uses a 0–100% slider. Linux uses presets and requires audio support plus `experiments.linux-playback-ducking`; a saved On preference can be turned off when the experiment is unavailable. |
| Video export | `videoExport` controls the Export Last Capture as Video menu item. It does not export a capture by itself. |

Linux also projects H.264 encoder/decoder warnings and local model download
status. The native controller keeps the shared writer, microphone permission,
device enumeration, speech preparation and volume effects. The Electron meter
uses the existing Linux capture meter or the macOS helper’s existing AVFoundation
meter. Neither publishes audio samples to the renderer.

## Permissions

`PermissionsSection` uses only the projected state and actions in
`permissions-contract.ts`. Its rows reuse Record's recording requirements.
The Bend repair policy also serves the native Settings fallback and onboarding
repair. The native build consumes the compact generated table so Cargo can
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

## Silent prompts

Enable **Settings → Labs → Silent prompts** to try camera-only dictation. The
switch is off by default and uses the existing config writer
(`experiments.silentPrompt`). With a trusted local [Lipflow checkout](https://github.com/amywork777/lipflow)
prepared with its `.venv/bin/lipflow` and visual models, choose the checkout
folder, then select **Start camera**. Silently mouth a short prompt and select
**Read my lips**. The camera stops after 12 seconds if you leave it running.
Review the raw result and select **Copy prompt** to use it in another app.

Apparent uses video only and calls Lipflow's file mode with cleanup disabled.
It runs the stock model in a private temporary directory and deletes the clip
after decoding. The folder choice lasts for the Settings session. The trial
ships no model weights. Lipflow's standard weights are for non-commercial
research. This slice measures the stock baseline, with STT-assisted
personalization tracked in [#1603](https://github.com/tryapparent/apparent/issues/1603).
