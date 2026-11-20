#[cfg(target_os = "linux")]
pub(crate) mod linux;
#[cfg(target_os = "macos")]
pub(crate) mod macos;
#[cfg(target_os = "windows")]
pub(crate) mod legacy_windows;
#[cfg(target_os = "windows")]
pub(crate) mod windows;
#[path = "../../../../engine/native/note_tap.rs"]
pub(crate) mod note_tap;
#[cfg(any(target_os = "linux", target_os = "macos"))]
pub(crate) use note_tap::NoteTap;
#[cfg(target_os = "linux")]
pub(crate) use linux::*;
#[cfg(target_os = "macos")]
pub(crate) use macos::*;
#[cfg(target_os = "windows")]
pub(crate) use windows::*;

#[cfg(any(target_os = "linux", target_os = "macos"))]
pub(crate) fn observe_note_tap(
    tap: &mut note_tap::NoteTap,
    at: Option<(f64, f64)>,
    now: std::time::Instant,
    pure: bool,
    telemetry: &super::SharedCaptureTelemetry,
) {
    use std::sync::atomic::Ordering;
    if !telemetry.has_note_editor() || telemetry.notes_editing.load(Ordering::Acquire) {
        tap.reset();
        return;
    }
    if !pure && !tap.is_pressed() {
        return;
    }
    if at.is_none_or(|(x, y)| !telemetry.contains_screen_point(x, y)) {
        tap.reset();
        return;
    }
    let drew = !pure && tap.is_pressed()
        && telemetry.live_ink.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
            .as_ref().is_some_and(super::is_real_ink);
    if let Some((x, y)) = tap.observe(now, at, pure, drew, telemetry.note_tap_epoch()) {
        telemetry.request_note_at(telemetry.elapsed_ms(), x, y);
    }
}
