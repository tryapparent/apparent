# Recording start preference

**Settings → Permissions → Skip screen selection** is off by default on
macOS and Wayland. In that state, each Screen recording started from the app or
Record shortcut opens the native picker. Turning it on records one full display.
Wayland can still ask for system approval. X11 has no native picker.

The next Screen recording reads `experiments.chooseScreenEachTime` from
`~/.config/apparent/config.json`. Absent and explicit `true` choose the picker.
Explicit `false` uses the full-display route, preserving older saved selections.
The Record Permissions presenter uses the app's existing config transaction.

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
`permissions-contract.ts`. Its rows reuse Record's recording requirements and
reflect observed system access. It shows **Check again** if the automatic access
check fails. The screen selection preference takes effect on the next capture.
The Bend repair policy also serves the native Settings fallback and onboarding
repair. Keep the native fallback available for missing assets or renderer startup
failure. Rolling back the Electron surface also requires rolling back the
screen-selection default because the native fallback cannot edit that preference.
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

## Silent prompts

Enable **Settings → Labs → Silent prompts** to try camera-only dictation. The
switch is off by default and uses the existing config writer
(`experiments.silentPrompt`). Apparent automatically prepares the local runtime
and downloads the visual model on first use. Keep Settings open during setup.
Once ready, select **Start camera**, silently mouth a short prompt, then select
**Read my lips**. The camera stops after 12 seconds. Review the raw result and
select **Copy prompt** to use it in another app.

The app checks pinned [Lipflow](https://github.com/amywork777/lipflow), uv and
model downloads, installs locked Python dependencies, and places the working
setup beside Parakeet. The model download is about 1.2 GB and the runtime can
require several additional GB. Automatic setup supports Linux x86-64 and
macOS. Existing trusted Lipflow installs in the model store still work. The
stock LRS3-derived weights are for non-commercial research.

Setup uses a private staging directory. A successful install moves into
`lipflow-managed/` only after the decoder starts. Turning the switch off cancels
setup. Leaving Labs within the same Settings window lets setup continue.
If setup fails, **Retry setup** starts a fresh attempt. Inference reads video
only with Lipflow cleanup disabled and removes its temporary clip afterward.
STT-assisted personalization is tracked in [#1603](https://github.com/tryapparent/apparent/issues/1603).
