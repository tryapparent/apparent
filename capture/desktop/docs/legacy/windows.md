# Windows (unsupported historical implementation)

Apparent supports macOS and Linux. The former Windows capture, input, overlay and media
backends have been retired. The notes below describe the historical implementation.

## One app, one UI

Every GPUI view (capsule, picker, review, welcome tour) is shared; only the OS shell differs, behind `#[cfg_attr(..., path = ...)] mod platform` in `capture.rs` and `ui.rs`, which expose the same items on both OSes. Never fork a view per OS; add a platform function instead.

Windows global coordinates are physical pixels (Apparent is per-monitor DPI aware) and `TargetFrame` holds pixels, so `MAX_CAPTURE_SCALE` is 1; views convert with `platform::points_per_pixel`.

## Shortcuts, overlay and windows

Shortcuts are `RegisterHotKey` plus low-level hooks and a key-state poller (injected input is ignored; a masked key is tapped while Alt is held so the app in front doesn't open its menu). The ink overlay is a GPUI window made layered and transparent in its build callback (after the first frame it stops drawing) and resized a turn later (inside an update GPUI misses `WM_SIZE`); Apparent's popups use `WDA_EXCLUDEFROMCAPTURE` (`APPARENT_SHOW_OWN_WINDOWS=1` keeps them for screenshots). GPUI quits when its last window closes, so `ui::platform::keep_alive` holds a hidden one.

## Helper, transcription, Settings

`win/helper.rs` stands in for `apparent-helper`: Media Foundation for movies, `transcribe.cpp` Parakeet for `Engine::Apple`: Hex's installed model, else Apparent's own copy of Hex's Parakeet Unified English in `%LOCALAPPDATA%\Apparent\models`, which `speech::install` (shared with Linux) downloads at launch through `speech_model::ensure` (Windows' `curl.exe`, pinned Hugging Face revision, SHA-256 checked, `.verified.json` receipt); a capture made before it finishes is transcribed again once it lands (`.transcript-pending`), privacy switches for permissions. The welcome tour is `onboarding_window.rs` on the same JSON protocol as `capture/desktop/native/Onboarding.swift`, and Settings is `settings_window.rs` on the same `View`/`Action` protocol as `capture/desktop/native/Settings.swift` (both run in process through the sessions' `Transport::InProcess`). Launch at login is the user's `Run` key (`win/login.rs`); removal errors other than an absent key must propagate so `launchAtLogin` is not saved as off while Windows still starts Apparent. The native AppKit + Metal pill is macOS only: `native/pill/other.rs` keeps its shared types with a `NativePill` that never opens, and `handoff::native_pill` is always off, so Windows draws the GPUI capsule.

## More than one display

`screens::displays()`/`current()`/`pointer()` read `win::monitors()` and the cursor in global pixels (`Screen::id` is the monitor's index, `scale` its DPI scale), so the picker opens on the pointer's monitor and follows it like on macOS: `ui::platform::move_picker_window` moves the picker's HWND, `InkOverlay::move_to` moves the overlay (off the UI thread, as inside an update GPUI misses the resize) and `ui::platform::display_at` maps a monitor to GPUI's display by its DIP origin.

## agentContext and the command-line tool

- `agentContext` looks up what clicks and marks land on through UI Automation (`win/uia.rs`, behind `ax::hit_test`; the rest of `ax.rs`, its prober and `apply`, is shared). It reads names, localized control types and automation ids, never a control's value, so nothing typed into a field (passwords included) is read. `cargo test win::uia -- --ignored --nocapture` names whatever is under the pointer. `ax_other.rs` stays the stub for systems with neither lookup.
- Settings › Agents puts `apparent` on PATH with a `apparent.cmd` shim in `%LOCALAPPDATA%\Microsoft\WindowsApps`, which is on every user's PATH (`win/command_line.rs`, the same API as `command_line.rs`): a symbolic link needs Developer Mode and a hard link can't cross drives. The shim runs this `apparent.exe` with every argument; another program called `apparent` there is left alone.

## Not on Windows

The cabled iPhone, video export, Sparkle (**Check for Updates…** opens the releases page) and reading the browser tab URL (the `sdk.js` page bridge still works).

## Historical packaging

The former Windows release workflow built an unsigned x64 ZIP with
`apparent.exe`, the Visual C++ runtime DLLs and transcribe.cpp's DLLs.
transcribe.cpp used `dynamic-backends` to select a ggml CPU tier at runtime.
The Windows packaging check verified the executable's DLL imports and checked
for AVX-512 outside the designated tiers after the failure tracked in #58.

## Bundle recovery

A Screen capture writes `unfinished.json` (target, ink, clicks, window log) beside its video and audio before the bundle is built and deletes it after. If the process dies in between, as #58 did, the next launch runs `apparent recover` in a child process, which builds those bundles in place, once each (`.recovering`; delete it to let `apparent recover` try again). Captures from before it (0.3.10) left only `recording.mp4` and `audio.wav`; once nothing in such a bundle changed for 10 minutes, the same launch pass builds it from those alone, as a full-frame Screen capture with no ink or clicks. `apparent recover <bundle>` builds one now, on a Mac too. Retention leaves bundles alone until they've been tried.
