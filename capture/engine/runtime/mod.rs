use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicI32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use anyhow::{Context, Result};

pub(crate) mod audio;
pub(crate) mod phone;
pub(crate) mod platform;
pub(crate) mod recording;
pub(crate) mod screens;

use crate::shared::model::{
    CaptureMode, InteractionEvent, RgbaFrame, SCALE, Stroke, TargetFrame, TargetInfo,
};
pub(crate) use apparent_capture_engine::ink::clip_recording_ink;

pub(crate) use platform::*;

#[cfg(any(target_os = "macos", test))]
#[cfg_attr(not(target_os = "macos"), allow(unused_imports))]
pub(crate) use recording::recorder::sample_real_candidate;
pub use recording::recorder::{
    CANDIDATE_BUDGET_BYTES, CANDIDATE_EDGE, CandidateBuffer, FRAME_SAMPLE_INTERVAL,
    ScreenCaptureSession, ScreenRecording, capture_size,
};
pub(crate) use recording::recorder::{CANDIDATE_EDGE_NO_VIDEO, Sampler, push_candidate};

/// Resolve a CLI recording target before creating a bundle or starting any recorder.
pub fn record_target(
    window_query: Option<&str>,
    check_ready: impl FnOnce() -> Result<()>,
) -> Result<TargetInfo> {
    resolve_record_target(window_query, check_ready, || discover_target(None))
}

pub(crate) const WINDOW_RECORDING_DISABLED: &str =
    "Window recording is temporarily disabled while source-lifetime safety is implemented. No Window recording will start; choose Screen or Area explicitly.";

/// Admission for new recordings only; saved Window bundles remain readable.
pub(crate) fn ensure_recording_mode(mode: CaptureMode) -> Result<()> {
    anyhow::ensure!(mode != CaptureMode::Window, WINDOW_RECORDING_DISABLED);
    Ok(())
}

fn resolve_record_target(
    window_query: Option<&str>,
    check_ready: impl FnOnce() -> Result<()>,
    display: impl FnOnce() -> TargetInfo,
) -> Result<TargetInfo> {
    if window_query.is_some() {
        ensure_recording_mode(CaptureMode::Window)?;
    }
    check_ready()?;
    Ok(display())
}

#[cfg(test)]
mod record_target_tests {
    use super::*;

    #[cfg(target_os = "linux")]
    #[derive(Default)]
    struct InkObserver(Mutex<Vec<NativeInkObservation>>);
    #[cfg(target_os = "linux")]
    impl NativeInkObserver for InkObserver {
        fn observe(&self, observation: NativeInkObservation) {
            self.0.lock().unwrap().push(observation);
        }
    }

    #[test]
    #[cfg(target_os = "linux")]
    fn native_ink_tap_keeps_observed_positions_times_and_frozen_rgb() {
        let (sender, _) = flume::unbounded();
        let telemetry = SharedCaptureTelemetry::new(sender);
        telemetry.reset_for_session(TargetFrame { x: 0.0, y: 0.0, width: 100.0, height: 100.0, scale: 1.0 });
        let observer = Arc::new(InkObserver::default());
        let installed: Arc<dyn NativeInkObserver> = observer.clone();
        assert!(telemetry.install_native_ink_observer(installed.clone()));
        assert!(!telemetry.install_native_ink_observer(Arc::new(InkObserver::default())));
        telemetry.set_stroke_rgb(Some([0, 203, 255]));
        track_shift_ink_observed(&telemetry, (10.25, 20.5), true, false, Some(100));
        telemetry.set_stroke_rgb(Some([255, 0, 0]));
        track_shift_ink_observed(&telemetry, (10.5, 20.75), true, true, Some(101)); // donor thinning
        track_shift_ink_observed(&telemetry, (40.75, 50.25), true, true, Some(102));
        track_shift_ink_observed(&telemetry, (40.75, 50.25), false, true, Some(103));
        assert_eq!(*observer.0.lock().unwrap(), vec![
            NativeInkObservation::Point { first: true, position: [10.25, 20.5], observed_at_ns: 100, rgb: Some([0, 203, 255]) },
            NativeInkObservation::Point { first: false, position: [40.75, 50.25], observed_at_ns: 102, rgb: Some([0, 203, 255]) },
            NativeInkObservation::End { accepted: true, observed_at_ns: 103 },
        ]);
        assert!(!telemetry.remove_native_ink_observer(&(Arc::new(InkObserver::default()) as Arc<dyn NativeInkObserver>)));
        assert!(telemetry.remove_native_ink_observer(&installed));
        assert!(!telemetry.remove_native_ink_observer(&installed));
    }

    #[test]
    #[cfg(target_os = "linux")]
    fn native_ink_tap_stationary_shift_is_not_accepted_and_clock_failure_is_explicit() {
        let (sender, _) = flume::unbounded();
        let telemetry = SharedCaptureTelemetry::new(sender);
        let observer = Arc::new(InkObserver::default());
        assert!(telemetry.install_native_ink_observer(observer.clone()));
        track_shift_ink_observed(&telemetry, (10.0, 20.0), true, false, Some(100));
        track_shift_ink_observed(&telemetry, (10.0, 20.0), false, true, Some(101));
        assert_eq!(observer.0.lock().unwrap().last(), Some(&NativeInkObservation::End { accepted: false, observed_at_ns: 101 }));
        track_shift_ink_observed(&telemetry, (20.0, 30.0), true, false, None);
        assert_eq!(observer.0.lock().unwrap().last(), Some(&NativeInkObservation::ClockUnavailable));
        let before = native_ink_monotonic_ns().unwrap();
        let after = native_ink_monotonic_ns().unwrap();
        assert!(before > 0 && after >= before);
    }

    #[test]
    #[cfg(target_os = "linux")]
    fn native_ink_tap_overflow_is_explicit_after_the_exact_donor_limit() {
        let (sender, _) = flume::unbounded();
        let telemetry = SharedCaptureTelemetry::new(sender);
        let observer = Arc::new(InkObserver::default());
        assert!(telemetry.install_native_ink_observer(observer.clone()));
        for i in 0..2400 { track_shift_ink_observed(&telemetry, (i as f64 * 3.0, 20.0), true, i > 0, Some(i + 1)); }
        assert_eq!(observer.0.lock().unwrap().len(), 2400);
        assert!(!observer.0.lock().unwrap().contains(&NativeInkObservation::CapacityExceeded));
        track_shift_ink_observed(&telemetry, (7200.0, 20.0), true, true, Some(2401));
        assert_eq!(observer.0.lock().unwrap().last(), Some(&NativeInkObservation::CapacityExceeded));
    }

    #[test]
    #[cfg(target_os = "linux")]
    fn native_ink_tap_removal_waits_for_the_original_callback() {
        struct Blocking { entered: flume::Sender<()>, release: flume::Receiver<()> }
        impl NativeInkObserver for Blocking {
            fn observe(&self, _: NativeInkObservation) {
                self.entered.send(()).unwrap();
                self.release.recv_timeout(Duration::from_secs(2)).unwrap();
            }
        }
        let (sender, _) = flume::unbounded();
        let telemetry = SharedCaptureTelemetry::new(sender);
        let (entered_tx, entered_rx) = flume::bounded(1);
        let (release_tx, release_rx) = flume::bounded(1);
        let observer: Arc<dyn NativeInkObserver> = Arc::new(Blocking { entered: entered_tx, release: release_rx });
        assert!(telemetry.install_native_ink_observer(observer.clone()));
        let drawing = Arc::clone(&telemetry);
        let callback = thread::spawn(move || track_shift_ink_observed(&drawing, (10.0, 20.0), true, false, Some(100)));
        entered_rx.recv_timeout(Duration::from_secs(2)).unwrap();
        let (removed_tx, removed_rx) = flume::bounded(1);
        let removal = thread::spawn(move || removed_tx.send(telemetry.remove_native_ink_observer(&observer)).unwrap());
        assert!(removed_rx.recv_timeout(Duration::from_millis(20)).is_err());
        release_tx.send(()).unwrap();
        assert!(removed_rx.recv_timeout(Duration::from_secs(2)).unwrap());
        callback.join().unwrap();
        removal.join().unwrap();
    }

    #[test]
    fn desktop_ink_crosses_target_and_only_visible_segments_are_saved() {
        let (sender, _) = flume::unbounded();
        let t = SharedCaptureTelemetry::new(sender);
        t.reset_for_session(TargetFrame {
            x: -100.0,
            y: -50.0,
            width: 100.0,
            height: 100.0,
            scale: 2.0,
        });
        for x in [-150.0, -75.0, 50.0] {
            track_shift_ink(&t, (x, 0.0), true, true);
        }
        let live = t.live_ink.lock().unwrap().clone().unwrap();
        assert!(live.pts[0] < 0);
        assert!(live.pts[live.pts.len() - 3] > SCALE);
        track_shift_ink(&t, (50.0, 0.0), false, true);
        assert!(!t.shift_held.load(Ordering::Acquire));
        assert_eq!(t.desktop_ink.lock().unwrap().len(), 1);
        let (_, saved) = t.finish_session();
        assert_eq!(saved.len(), 1);
        assert_eq!(saved[0].pts[0], 0);
        assert_eq!(saved[0].pts[saved[0].pts.len() - 3], SCALE);
        assert!(t.desktop_ink.lock().unwrap().is_empty());
        assert_eq!(t.target_frame.lock().unwrap().x, -100.0);
    }

    #[test]
    fn accepted_stroke_rgb_is_frozen_across_updates_and_clipping() {
        let (sender, _) = flume::unbounded();
        let t = SharedCaptureTelemetry::new(sender);
        t.reset_for_session(TargetFrame { x: 0.0, y: 0.0, width: 100.0, height: 100.0, scale: 1.0 });
        assert_eq!(t.stroke_rgb(), None);
        t.set_stroke_rgb(Some([0, 203, 255]));
        assert_eq!(t.stroke_rgb(), Some([0, 203, 255]));
        track_shift_ink(&t, (-10.0, 50.0), true, true);
        t.set_stroke_rgb(Some([255, 0, 0]));
        track_shift_ink(&t, (50.0, 50.0), true, true);
        track_shift_ink(&t, (110.0, 50.0), true, true);
        track_shift_ink(&t, (110.0, 50.0), false, true);
        let (_, saved) = t.finish_session();
        assert!(!saved.is_empty());
        assert!(saved.iter().all(|stroke| stroke.rgb == Some([0, 203, 255])));
        t.set_stroke_rgb(Some([0, 0, 0]));
        assert_eq!(t.stroke_rgb(), Some([0, 0, 0]));
        t.set_stroke_rgb(None);
        assert_eq!(t.stroke_rgb(), None);
    }

    #[test]
    fn notes_stay_on_selected_source_and_editor_suppresses_desktop_ink() {
        let (sender, receiver) = flume::unbounded();
        let t = SharedCaptureTelemetry::new(sender);
        let frame = TargetFrame { x: -1280.0, y: -100.0, width: 1280.0, height: 800.0, scale: 2.0 };
        t.reset_for_session(frame);
        t.shift_down(10, 200.0, 200.0);
        assert!(!t.shift_up(20, 200.0, 200.0));
        t.shift_down(30, -640.0, 300.0);
        assert!(t.shift_up(40, -640.0, 300.0));
        assert!(receiver.try_iter().any(|e| matches!(e, LiveOverlayEvent::Note { pin: 1, x: 0.5, y: 0.5, .. })));
        t.notes_editing.store(true, Ordering::Release);
        track_shift_ink(&t, (-500.0, 300.0), true, true);
        track_shift_ink(&t, (500.0, 300.0), true, true);
        assert!(t.live_ink.lock().unwrap().is_none());
        t.reset_for_session(frame);
        t.shift_down(50, -640.0, 300.0);
        t.reset_for_session(TargetFrame { x: 0.0, ..frame });
        assert!(!t.shift_up(60, -640.0, 300.0));
        assert!(t.strokes.lock().unwrap().is_empty());
    }

    #[test]
    fn window_recording_is_disabled_before_target_lookup_or_display_fallback() {
        for query in ["Project", "", "   "] {
            let result = resolve_record_target(
                Some(query),
                || panic!("disabled window recording must not check permissions or encoders"),
                || panic!("disabled window recording must not fall back to a display"),
            );
            assert!(result.unwrap_err().to_string().contains("Window recording is temporarily disabled"));
        }
    }

    fn target(mode: CaptureMode, title: &str, app: &str) -> TargetInfo {
        TargetInfo {
            mode,
            app: Some(app.into()),
            bundle_id: None,
            window_title: Some(title.into()),
            window_id: (mode == CaptureMode::Window).then_some(42),
            display_id: 0,
            frame: TargetFrame {
                x: 0.0,
                y: 0.0,
                width: 800.0,
                height: 600.0,
                scale: 1.0,
            },
        }
    }

    #[test]
    fn display_recording_checks_readiness_before_discovery() {
        let calls = std::cell::RefCell::new(Vec::new());
        let display = resolve_record_target(
            None,
            || { calls.borrow_mut().push("ready"); Ok(()) },
            || { calls.borrow_mut().push("discover"); target(CaptureMode::Display, "", "") },
        ).unwrap();
        assert_eq!(*calls.borrow(), ["ready", "discover"]);
        assert_eq!(display.mode, CaptureMode::Display);
        assert!(ensure_recording_mode(CaptureMode::Display).is_ok());
        assert!(ensure_recording_mode(CaptureMode::Region).is_ok());
    }

    #[test]
    fn unavailable_display_recording_does_not_discover_a_target() {
        let error = resolve_record_target(
            None,
            || anyhow::bail!("permission unavailable"),
            || panic!("discovery must not run before permission admission"),
        ).unwrap_err();
        assert_eq!(error.to_string(), "permission unavailable");
    }
}

/// Live UI events emitted by the global input monitor to drive Apparent's HUD & Review windows.
#[derive(Clone, Debug)]
pub enum LiveOverlayEvent {
    /// ⌥⇧S (or the configured shortcut) went down; `shortcut::Shortcut` decides what it means.
    CaptureShortcut,
    PasteLatestShortcut,
    UndoStroke,
    RequestSnapshot,
    Note { pin: u32, t: u64, x: f32, y: f32, screen_x: f64, screen_y: f64 },
    NoteClosed { focus: u64, owner: u32 },
    NoteOutside,
    NoteResumeDrawing,
    NotesUnavailable,
    /// The iPhone mirror ended on its own (unplugged, never found, or access denied).
    PhoneEnded,
    /// The welcome window: a button, fresh permission states, or the helper exiting.
    Onboarding(crate::capture::desktop::settings::onboarding::Event),
    /// The initial permission check is finished, including when grants are unavailable.
    OnboardingInitialized,
    /// The Settings window: an action, fresh permission states, or the helper exiting.
    Settings(crate::capture::desktop::settings::Event),

}

// Carbon HIToolbox modifier bits. The shortcut is stored with them on every platform.
pub const CARBON_CMD_KEY: u32 = 1 << 8;
pub const CARBON_SHIFT_KEY: u32 = 1 << 9;
pub const CARBON_OPTION_KEY: u32 = 1 << 11;
pub const CARBON_CONTROL_KEY: u32 = 1 << 12;

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ShortcutConfig {
    pub key_code: u32,
    pub carbon_modifiers: u32,
    pub label: String,
}

impl Default for ShortcutConfig {
    fn default() -> Self {
        Self::default_record()
    }
}

/// Apparent's two global shortcuts.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ShortcutKind {
    /// Start, switch or finish a recording (⌥⇧S).
    Record,
    /// Paste the latest capture into the app in front (⌥⇧V).
    Paste,
}

impl ShortcutKind {
    pub const ALL: [Self; 2] = [Self::Record, Self::Paste];

    pub fn default_config(self) -> ShortcutConfig {
        match self {
            Self::Record => ShortcutConfig::default_record(),
            Self::Paste => ShortcutConfig::default_paste(),
        }
    }

    /// The letter of the default, on the active layout (Dvorak's S is not ANSI's).
    fn default_char(self) -> char {
        match self {
            Self::Record => 's',
            Self::Paste => 'v',
        }
    }

    pub(crate) fn ansi_code(self) -> u16 {
        match self {
            Self::Record => KEY_S,
            Self::Paste => KEY_V,
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Self::Record => "Record",
            Self::Paste => "Paste last capture",
        }
    }

    /// Whether it can be turned off. Record can't: it's the way into Apparent.
    pub fn can_unset(self) -> bool {
        self == Self::Paste
    }
}

impl ShortcutConfig {
    pub fn default_record() -> Self {
        Self {
            key_code: u32::from(layout_s_keycode()),
            carbon_modifiers: CARBON_OPTION_KEY | CARBON_SHIFT_KEY,
            label: shortcut_label(CARBON_OPTION_KEY | CARBON_SHIFT_KEY, "S"),
        }
    }

    pub fn default_paste() -> Self {
        Self {
            key_code: u32::from(layout_v_keycode()),
            carbon_modifiers: CARBON_OPTION_KEY | CARBON_SHIFT_KEY,
            label: shortcut_label(CARBON_OPTION_KEY | CARBON_SHIFT_KEY, "V"),
        }
    }

    /// No shortcut: nothing is registered and no key press matches. Only the paste shortcut can
    /// be turned off.
    pub fn unset() -> Self {
        Self {
            key_code: u32::MAX,
            carbon_modifiers: 0,
            label: String::new(),
        }
    }

    pub fn is_unset(&self) -> bool {
        self.label.is_empty()
    }

    /// Whether this is `kind`'s default, which also answers to its aliases (⌃⌥⇧, ⌘⌥⇧, ⌃⌥⌘
    /// and the ANSI key).
    pub fn is_default_for(&self, kind: ShortcutKind) -> bool {
        self.carbon_modifiers == CARBON_OPTION_KEY | CARBON_SHIFT_KEY
            && shortcut_parts(&self.label).1 == kind.default_char().to_ascii_uppercase().to_string()
    }

    pub fn key_label(&self) -> &str {
        shortcut_parts(&self.label).1
    }
}

/// `⌃⌥⇧⌘` in the order macOS writes them, for Carbon modifier bits; on Windows and Linux the
/// same modifiers as `Ctrl+Win+Alt+Shift+` (`Super` on Linux), ready to take a key.
pub fn modifier_symbols(carbon_modifiers: u32) -> String {
    if cfg!(not(target_os = "macos")) {
        let label = shortcut_label(carbon_modifiers, "");
        return label;
    }
    [
        (CARBON_CONTROL_KEY, '⌃'),
        (CARBON_OPTION_KEY, '⌥'),
        (CARBON_SHIFT_KEY, '⇧'),
        (CARBON_CMD_KEY, '⌘'),
    ]
    .into_iter()
    .filter(|(bit, _)| carbon_modifiers & bit != 0)
    .map(|(_, symbol)| symbol)
    .collect()
}

/// A shortcut as this platform writes it: `⌥⇧S` on macOS, `Alt+Shift+S` on Windows and Linux.
pub fn shortcut_label(carbon_modifiers: u32, key: &str) -> String {
    let held = |bit: u32| carbon_modifiers & bit != 0;
    if cfg!(not(target_os = "macos")) {
        let mut parts = Vec::new();
        for (bit, name) in [
            (CARBON_CONTROL_KEY, "Ctrl"),
            (CARBON_CMD_KEY, SUPER_KEY),
            (CARBON_OPTION_KEY, "Alt"),
            (CARBON_SHIFT_KEY, "Shift"),
        ] {
            if held(bit) {
                parts.push(name);
            }
        }
        parts.push(key);
        parts.join("+")
    } else {
        let mut label = String::new();
        for (bit, glyph) in [
            (CARBON_CONTROL_KEY, '⌃'),
            (CARBON_OPTION_KEY, '⌥'),
            (CARBON_SHIFT_KEY, '⇧'),
            (CARBON_CMD_KEY, '⌘'),
        ] {
            if held(bit) {
                label.push(glyph);
            }
        }
        label.push_str(key);
        label
    }
}

/// The name of the key in ⌘'s place: the Windows key, Linux's Super.
const SUPER_KEY: &str = if cfg!(target_os = "linux") {
    "Super"
} else {
    "Win"
};

/// The system paste keystroke: `⌘V` on macOS, `Ctrl+V` on Windows and Linux.
pub fn system_paste_label() -> &'static str {
    if cfg!(not(target_os = "macos")) {
        "Ctrl+V"
    } else {
        "⌘V"
    }
}

/// The keys of a shortcut label, one per keycap: `⌥⇧S` → `⌥`, `⇧`, `S`; `Alt+Shift+S` →
/// `Alt`, `Shift`, `S`.
pub fn shortcut_keys(label: &str) -> Vec<String> {
    if label.contains('+') && label.len() > 1 {
        let mut keys: Vec<String> = label
            .split('+')
            .filter(|key| !key.is_empty())
            .map(str::to_owned)
            .collect();
        // `Ctrl++` binds the plus key itself.
        if label.ends_with("++") {
            keys.push("+".into());
        }
        keys
    } else {
        label.chars().map(String::from).collect()
    }
}

pub fn apparent_log(msg: impl AsRef<str>) {
    use std::io::Write;
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let line = format!("[{ts}] {}\n", msg.as_ref());
    eprint!("{line}");
    // Tests log fixture failures on purpose; keep them out of the user's real log.
    if cfg!(test) {
        return;
    }
    let Some(dir) = log_dir() else {
        return;
    };
    let _ = std::fs::create_dir_all(&dir);
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join("apparent.log"))
    {
        let _ = f.write_all(line.as_bytes());
    }
}

/// A shortcut label split into its modifiers and key: `⌥⇧S` → (`⌥⇧`, `S`), and on Windows
/// `Alt+Shift+S` → (`Alt+Shift`, `S`).
pub fn shortcut_parts(label: &str) -> (&str, &str) {
    // The key itself may be "+" (`Ctrl++`), or a letter outside ASCII.
    let before_key = label.char_indices().last().map_or("", |(i, _)| &label[..i]);
    if let Some(plus) = before_key.rfind('+') {
        return (&label[..plus], &label[plus + 1..]);
    }
    let split = label
        .char_indices()
        .find(|(_, c)| !matches!(c, '⌃' | '⌥' | '⇧' | '⌘'))
        .map_or(label.len(), |(i, _)| i);
    label.split_at(split)
}

/// Whether a key press is the record shortcut. A custom one matches exactly; the default ⌥⇧S
/// also answers with ⌃ or ⌘ added and as ⌃⌥⌘S, on the active layout's S key (`s_code`) or the
/// ANSI one.
pub fn is_capture_shortcut(
    cfg: &ShortcutConfig,
    s_code: u16,
    keycode: u16,
    cmd: bool,
    ctrl: bool,
    alt: bool,
    shift: bool,
) -> bool {
    shortcut_matches(
        ShortcutKind::Record,
        cfg,
        s_code,
        keycode,
        cmd,
        ctrl,
        alt,
        shift,
    )
}

/// `is_capture_shortcut` for any of Apparent's shortcuts; `layout_code` is the default key on the
/// active layout.
#[allow(clippy::too_many_arguments)]
pub fn shortcut_matches(
    kind: ShortcutKind,
    cfg: &ShortcutConfig,
    layout_code: u16,
    keycode: u16,
    cmd: bool,
    ctrl: bool,
    alt: bool,
    shift: bool,
) -> bool {
    if cfg.is_unset() {
        return false;
    }
    let want_cmd = (cfg.carbon_modifiers & CARBON_CMD_KEY) != 0;
    let want_ctrl = (cfg.carbon_modifiers & CARBON_CONTROL_KEY) != 0;
    let want_alt = (cfg.carbon_modifiers & CARBON_OPTION_KEY) != 0;
    let want_shift = (cfg.carbon_modifiers & CARBON_SHIFT_KEY) != 0;
    let exact = u32::from(keycode) == cfg.key_code
        && cmd == want_cmd
        && ctrl == want_ctrl
        && alt == want_alt
        && shift == want_shift;
    if exact {
        return true;
    }
    let is_key = keycode == layout_code || keycode == kind.ansi_code();
    cfg.is_default_for(kind) && is_key && alt && (shift || (ctrl && cmd))
}

/// The active layout's key for `kind`'s default letter (Windows' hooks and poller match on it).
#[cfg_attr(target_os = "macos", allow(dead_code))]
pub fn layout_default_keycode(kind: ShortcutKind) -> u16 {
    key_code_for_char(kind.default_char()).unwrap_or(kind.ansi_code())
}

/// The key codes and Carbon modifiers `cfg` registers: itself, plus for a default its aliases
/// (⌃⌥⇧, ⌘⌥⇧, ⌃⌥⌘) on the active layout's key and the ANSI one.
pub(crate) fn hotkey_combos(kind: ShortcutKind, cfg: &ShortcutConfig) -> Vec<(u32, u32)> {
    if cfg.is_unset() {
        return Vec::new();
    }
    let mut combos = vec![(cfg.key_code, cfg.carbon_modifiers)];
    if !cfg.is_default_for(kind) {
        return combos;
    }
    let mut codes = vec![cfg.key_code];
    if cfg.key_code != u32::from(kind.ansi_code()) {
        codes.push(u32::from(kind.ansi_code()));
    }
    for code in codes {
        for mods in [
            CARBON_OPTION_KEY | CARBON_SHIFT_KEY,
            CARBON_CONTROL_KEY | CARBON_OPTION_KEY | CARBON_SHIFT_KEY,
            CARBON_CMD_KEY | CARBON_OPTION_KEY | CARBON_SHIFT_KEY,
            CARBON_CONTROL_KEY | CARBON_OPTION_KEY | CARBON_CMD_KEY,
        ] {
            if !combos.contains(&(code, mods)) {
                combos.push((code, mods));
            }
        }
    }
    combos
}

fn clean_label(input: &str) -> String {
    let squashed = input.split_whitespace().collect::<Vec<_>>().join(" ");
    let trimmed = squashed.trim();
    if trimmed.chars().count() > 44 {
        let prefix: String = trimmed.chars().take(43).collect();
        format!("{}…", prefix.trim_end())
    } else {
        trimmed.to_string()
    }
}

/// Which display to record: the one under `point`, else the one holding the focused window's
/// centre, else the first. Frames and points are global, top-left origin.
pub fn pick_display(
    displays: &[[f64; 4]],
    point: Option<[f64; 2]>,
    focused: Option<[f64; 4]>,
) -> usize {
    let inside = |p: [f64; 2]| {
        displays
            .iter()
            .position(|&[x, y, w, h]| p[0] >= x && p[0] < x + w && p[1] >= y && p[1] < y + h)
    };
    point
        .and_then(inside)
        .or_else(|| focused.and_then(|[x, y, w, h]| inside([x + w / 2.0, y + h / 2.0])))
        .unwrap_or(0)
}

pub fn selectable_window_at(windows: &[TargetInfo], x: f64, y: f64) -> Option<&TargetInfo> {
    windows.iter().find(|window| {
        let f = window.frame;
        x >= f.x && x <= f.x + f.width && y >= f.y && y <= f.y + f.height
    })
}

/// Resolves region metadata from the picker's snapshot, without another SCK query.
pub fn region_target(
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    windows: &[TargetInfo],
) -> TargetInfo {
    let mid_x = x + width * 0.5;
    let mid_y = y + height * 0.5;
    let hit = selectable_window_at(windows, mid_x, mid_y);
    let frontmost = frontmost_app_info();
    // One display per recording: the area's (by its centre), trimmed to that display and at
    // least `MIN_AREA` a side inside it, so this frame is exactly the recorded `sourceRect`.
    let screens = crate::capture::engine::runtime::screens::displays();
    let (display_id, scale, [x, y, width, height]) =
        crate::capture::engine::runtime::screens::area_on_display(&screens, [x, y, width, height]).map_or_else(
            || {
                let min = crate::capture::engine::runtime::screens::MIN_AREA;
                let rect = [x, y, width.max(min), height.max(min)];
                (main_display_id(), MAX_CAPTURE_SCALE, rect)
            },
            |(i, rect)| (screens[i].id, screens[i].scale, rect),
        );
    TargetInfo {
        mode: CaptureMode::Region,
        app: hit
            .and_then(|window| window.app.clone())
            .or_else(|| frontmost.as_ref().map(|(_, name, _)| name.clone())),
        bundle_id: hit
            .and_then(|window| window.bundle_id.clone())
            .or_else(|| frontmost.and_then(|(_, _, bid)| bid)),
        window_title: hit.and_then(|window| window.window_title.clone()),
        window_id: None,
        display_id,
        frame: TargetFrame {
            x,
            y,
            width,
            height,
            scale,
        },
    }
}

/// Native input observations, before normalized storage. No renderer may supply these.
#[cfg(target_os = "linux")]
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum NativeInkObservation {
    Point { first: bool, position: [f64; 2], observed_at_ns: u64, rgb: Option<[u8; 3]> },
    End { accepted: bool, observed_at_ns: u64 },
    ClockUnavailable,
    CapacityExceeded,
}

/// Called synchronously under the input gate; implementations must not reenter
/// tap installation/removal. Removing the exact observer waits for callbacks.
#[cfg(target_os = "linux")]
pub(crate) trait NativeInkObserver: Send + Sync {
    fn observe(&self, observation: NativeInkObservation);
}

#[cfg(target_os = "linux")]
pub(crate) fn native_ink_monotonic_ns() -> Option<u64> {
    let mut time = libc::timespec { tv_sec: 0, tv_nsec: 0 };
    if unsafe { libc::clock_gettime(libc::CLOCK_MONOTONIC, &mut time) } != 0
        || time.tv_sec < 0 || !(0..1_000_000_000).contains(&time.tv_nsec) {
        return None;
    }
    (time.tv_sec as u64).checked_mul(1_000_000_000)?.checked_add(time.tv_nsec as u64)
}

/// Shared state collected by the global input monitor during an active capture session.
pub struct SharedCaptureTelemetry {
    #[cfg(target_os = "linux")]
    native_ink_observer: Mutex<Option<Arc<dyn NativeInkObserver>>>,
    /// Paint projection only; never legacy capture admission or clearance.
    #[cfg(target_os = "linux")]
    pub(crate) native_ink_visible_scope: AtomicBool,
    /// Unclipped desktop ink, never serialized into the recording bundle.
    pub desktop_ink: Mutex<Vec<Stroke>>,
    pub active: AtomicBool,
    pub selecting: AtomicBool,
    pub shift_held: AtomicBool,
    /// The focused note editor owns input; suppress annotation ink while typing.
    pub notes_editing: AtomicBool,
    pub note_ui_pid: AtomicU64,
    next_note_pin: AtomicU64,
    pub capture_mode: AtomicU64,
    /// The record shortcut (`crate::settings` loads and saves it).
    pub shortcut: Mutex<ShortcutConfig>,
    pub paste_shortcut: Mutex<ShortcutConfig>,
    /// Settings is recording a new shortcut: none of Apparent's fire (`pause_shortcuts`).
    pub shortcuts_paused: AtomicBool,
    pub started_at: Mutex<Instant>,
    pub picker_started_at: Mutex<Instant>,
    pub picker_rect: Mutex<Option<([f32; 4], u8)>>,
    pub target_frame: Mutex<TargetFrame>,
    pub pointer_screen: Mutex<[f32; 2]>,
    pub events: Mutex<Vec<InteractionEvent>>,
    pub strokes: Mutex<Vec<Stroke>>,
    pub active_laser: Mutex<Option<Stroke>>,
    pub live_ink: Mutex<Option<Stroke>>,
    /// One process-local native value; config/palette ownership stays with the caller.
    stroke_rgb: AtomicU64,
    pub excluded_window_ids: Arc<Mutex<Vec<u32>>>,
    /// Raised when a click, ink stroke or shortcut starts, so the Screen-mode window log takes
    /// a snapshot right away.
    pub window_log_request: Arc<AtomicBool>,
    pub ui_sender: flume::Sender<LiveOverlayEvent>,
    /// Apparent's windows that let clicks through (the ink overlay), skipped when deciding whether
    /// a click landed on Apparent itself.
    pub passthrough_window_ids: Mutex<Vec<u32>>,
    /// The `apparent-helper` whose window is what's being recorded (the iPhone mirror): its clicks
    /// count, unlike those on other helper windows (Settings, onboarding). 0 when none.
    capture_source_pid: AtomicI32,
    #[cfg(target_os = "macos")]
    dock_bounds: Mutex<Option<[f64; 4]>>,
    /// The last `on_apparent_window` answer (when, where, what), reused for a burst of scrolls.
    apparent_hit: Mutex<Option<(Instant, f64, f64, bool)>>,
    /// macOS's key event tap (`CFMachPortRef`), made once Accessibility is on (`check_key_tap`).
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    tap_port: AtomicU64,
    /// The key event tap thread's run loop (retained), so `check_key_tap` can stop it.
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    tap_run_loop: AtomicU64,
    /// A key tap thread is being started.
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    tap_starting: AtomicBool,
    /// When the last key tap was tried (ms since `UNIX_EPOCH`), to space out retries.
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    tap_tried_ms: AtomicU64,
    /// Whether key presses are arriving (macOS's key tap, Windows' keyboard hook).
    tap_live: AtomicBool,
    /// Esc went down since the UI loop last looked (`take_escape`).
    escape_pressed: AtomicBool,
    /// A Screen recording started straight from the shortcut: the overlay flashes an edge glow.
    pub start_glow: AtomicBool,
    /// Clicks are arriving (macOS's global mouse monitor, Windows' mouse hook). Until then the
    /// poller records clicks from polled button state.
    mouse_live: AtomicBool,
    last_shortcut_ms: AtomicU64,
    drag_start: Mutex<Option<(u64, f32, f32, Option<String>, TargetFrame)>>,
    /// The `agentContext` experiment was on when this capture started: clicks and strokes are
    /// looked up in the Accessibility tree (`crate::ax`, macOS only).
    agent_context: AtomicBool,
    /// A ⇧-press inside the target: when, where (global points) and on which frame.
    shift_press: Mutex<Option<(u64, f64, f64, TargetFrame)>>,
}

#[cfg(target_os="linux")]
pub(crate) struct NativeInkTargetSnapshot {
    prepared:TargetFrame,
    previous:TargetFrame,
    live:Option<Stroke>,
    ink:Vec<Stroke>,
    desktop:Vec<Stroke>,
}

impl SharedCaptureTelemetry {
    #[cfg(target_os = "linux")]
    pub(crate) fn install_native_ink_observer(&self, observer: Arc<dyn NativeInkObserver>) -> bool {
        let mut current = self.native_ink_observer.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        if current.is_some() { return false; }
        *current = Some(observer);
        self.native_ink_visible_scope.store(true, Ordering::Release);
        true
    }

    #[cfg(target_os = "linux")]
    pub(crate) fn remove_native_ink_observer(&self, observer: &Arc<dyn NativeInkObserver>) -> bool {
        let mut current = self.native_ink_observer.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        if !current.as_ref().is_some_and(|installed| Arc::ptr_eq(installed, observer)) { return false; }
        *current = None;
        self.native_ink_visible_scope.store(false, Ordering::Release);
        true
    }

    /// Exclusive native-only preparation; snapshot is retained until commit or
    /// positive rollback. Prior visual stacks are restored; original sealed
    /// facts and legacy capture admission are never rewritten here.
    #[cfg(target_os="linux")]
    pub(crate) fn prepare_native_ink_target(&self,frame:TargetFrame)->Result<NativeInkTargetSnapshot, &'static str>{
        let gate=self.native_ink_observer.lock().map_err(|_|"input-ownership-unresolved")?;
        if gate.is_some() || self.active.load(Ordering::Acquire){return Err("input-already-owned");}
        let mut target=self.target_frame.lock().map_err(|_|"source-unavailable")?;
        let mut live=self.live_ink.lock().map_err(|_|"source-unavailable")?;
        let mut ink=self.strokes.lock().map_err(|_|"source-unavailable")?;
        let mut desktop=self.desktop_ink.lock().map_err(|_|"source-unavailable")?;
        let snapshot=NativeInkTargetSnapshot { prepared:frame,previous:*target,live:live.take(),ink:std::mem::take(&mut *ink),desktop:std::mem::take(&mut *desktop) };
        *target=frame;
        Ok(snapshot)
    }
    #[cfg(target_os="linux")]
    pub(crate) fn restore_native_ink_target(&self,snapshot:&mut NativeInkTargetSnapshot)->Result<(), &'static str>{
        let gate=self.native_ink_observer.lock().map_err(|_|"input-ownership-unresolved")?;
        if gate.is_some() || self.active.load(Ordering::Acquire){return Err("input-ownership-unresolved");}
        let mut target=self.target_frame.lock().map_err(|_|"source-unavailable")?;
        let mut live=self.live_ink.lock().map_err(|_|"source-unavailable")?;
        let mut ink=self.strokes.lock().map_err(|_|"source-unavailable")?;
        let mut desktop=self.desktop_ink.lock().map_err(|_|"source-unavailable")?;
        if *target!=snapshot.prepared {return Err("target-changed");}
        *target=snapshot.previous;
        *live=snapshot.live.take();
        *ink=std::mem::take(&mut snapshot.ink);
        *desktop=std::mem::take(&mut snapshot.desktop);
        Ok(())
    }

    /// Select exact bytes for subsequent accepted strokes. Does not recolor existing strokes.
    /// The caller owns settings serialization and process-scoped apply/readback ordering.
    pub fn set_stroke_rgb(&self, rgb: Option<[u8; 3]>) {
        let value = rgb.map_or(0, |[r, g, b]| (1 << 24) | ((r as u64) << 16) | ((g as u64) << 8) | b as u64);
        self.stroke_rgb.store(value, Ordering::Release);
    }

    pub fn stroke_rgb(&self) -> Option<[u8; 3]> {
        let value = self.stroke_rgb.load(Ordering::Acquire);
        (value & (1 << 24) != 0).then_some([(value >> 16) as u8, (value >> 8) as u8, value as u8])
    }

    pub fn new(ui_sender: flume::Sender<LiveOverlayEvent>) -> Arc<Self> {
        let shortcuts = crate::capture::desktop::settings::Shortcuts::load();
        crate::capture::desktop::settings::note_paste_label(&shortcuts.paste.label);
        Arc::new(Self {
            #[cfg(target_os = "linux")]
            native_ink_observer: Mutex::new(None),
            #[cfg(target_os = "linux")]
            native_ink_visible_scope: AtomicBool::new(false),
            active: AtomicBool::new(false),
            selecting: AtomicBool::new(false),
            shift_held: AtomicBool::new(false),
            notes_editing: AtomicBool::new(false),
            note_ui_pid: AtomicU64::new(0),
            next_note_pin: AtomicU64::new(0),
            capture_mode: AtomicU64::new(0),
            shortcut: Mutex::new(shortcuts.record),
            paste_shortcut: Mutex::new(shortcuts.paste),
            shortcuts_paused: AtomicBool::new(false),
            started_at: Mutex::new(Instant::now()),
            picker_started_at: Mutex::new(Instant::now()),
            picker_rect: Mutex::new(None),
            target_frame: Mutex::new(TargetFrame {
                x: 0.0,
                y: 0.0,
                width: 1440.0,
                height: 900.0,
                scale: 2.0,
            }),
            pointer_screen: Mutex::new([0.0, 0.0]),
            events: Mutex::new(Vec::new()),
            strokes: Mutex::new(Vec::new()),
            desktop_ink: Mutex::new(Vec::new()),
            active_laser: Mutex::new(None),
            live_ink: Mutex::new(None),
            stroke_rgb: AtomicU64::new(0),
            excluded_window_ids: Arc::new(Mutex::new(Vec::new())),
            window_log_request: Arc::new(AtomicBool::new(false)),
            ui_sender,
            passthrough_window_ids: Mutex::new(Vec::new()),
            capture_source_pid: AtomicI32::new(0),
            #[cfg(target_os = "macos")]
            dock_bounds: Mutex::new(None),
            apparent_hit: Mutex::new(None),
            tap_port: AtomicU64::new(0),
            tap_run_loop: AtomicU64::new(0),
            tap_starting: AtomicBool::new(false),
            tap_tried_ms: AtomicU64::new(0),
            tap_live: AtomicBool::new(false),
            escape_pressed: AtomicBool::new(false),
            start_glow: AtomicBool::new(false),
            mouse_live: AtomicBool::new(false),
            last_shortcut_ms: AtomicU64::new(0),
            drag_start: Mutex::new(None),
            agent_context: AtomicBool::new(false),
            shift_press: Mutex::new(None),
        })
    }

    /// Each source (Carbon or `RegisterHotKey`, the key tap or hook) reports the same press within
    /// a few ms; a press after that is a new one, as when S is pressed again to switch modes.
    pub fn emit_capture_shortcut(&self) {
        if self.shortcuts_paused.load(Ordering::Acquire) {
            return;
        }
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        let prev = self.last_shortcut_ms.load(Ordering::Acquire);
        if now_ms.saturating_sub(prev) >= 90
            && self
                .last_shortcut_ms
                .compare_exchange(prev, now_ms, Ordering::AcqRel, Ordering::Acquire)
                .is_ok()
        {
            apparent_log("emit_capture_shortcut");
            let _ = self.ui_sender.try_send(LiveOverlayEvent::CaptureShortcut);
        }
    }

    pub fn emit_paste_shortcut(&self) {
        if self.shortcuts_paused.load(Ordering::Acquire) {
            return;
        }
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        let prev = self.last_shortcut_ms.load(Ordering::Acquire);
        if now_ms.saturating_sub(prev) >= 400
            && self
                .last_shortcut_ms
                .compare_exchange(prev, now_ms, Ordering::AcqRel, Ordering::Acquire)
                .is_ok()
        {
            apparent_log("emit_paste_shortcut -> sending PasteLatestShortcut");
            let _ = self
                .ui_sender
                .try_send(LiveOverlayEvent::PasteLatestShortcut);
        }
    }

    pub fn matches_shortcut(
        &self,
        keycode: u16,
        cmd: bool,
        ctrl: bool,
        alt: bool,
        shift: bool,
    ) -> bool {
        let cfg = self
            .shortcut
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone();
        is_capture_shortcut(&cfg, layout_s_keycode(), keycode, cmd, ctrl, alt, shift)
    }

    /// The record and paste shortcuts.
    pub fn shortcuts(&self) -> (ShortcutConfig, ShortcutConfig) {
        let lock = |m: &Mutex<ShortcutConfig>| {
            m.lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .clone()
        };
        (lock(&self.shortcut), lock(&self.paste_shortcut))
    }

    pub fn set_capture_mode(&self, mode: CaptureMode) {
        let code = match mode {
            CaptureMode::Display => 0,
            CaptureMode::Region => 1,
            CaptureMode::Window => 2,
            CaptureMode::Device => 3,
        };
        self.capture_mode.store(code, Ordering::Release);
    }

    pub fn begin_picker_session(&self) {
        *self
            .picker_started_at
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = Instant::now();
        *self
            .picker_rect
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = None;
        self.active.store(false, Ordering::Release);
        self.selecting.store(true, Ordering::Release);
    }

    pub fn set_picker_rect(&self, rect: Option<([f32; 4], u8)>) {
        *self
            .picker_rect
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = rect;
    }

    pub fn reset_for_session(&self, frame: TargetFrame) {
        // Session admission runs on the UI thread; NSScreen is unavailable to
        // the background input poller. Cache its reserved Dock strip here.
        #[cfg(target_os = "macos")]
        { *self.dock_bounds.lock().unwrap() = crate::shared::windows::dock_rect(frame); }
        self.selecting.store(false, Ordering::Release);
        *self
            .picker_rect
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = None;
        *self
            .started_at
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = Instant::now();
        *self
            .target_frame
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = frame;
        self.events
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clear();
        self.desktop_ink
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clear();
        self.strokes
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clear();
        *self
            .active_laser
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = None;
        *self
            .live_ink
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = None;
        *self
            .drag_start
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = None;
        *self
            .shift_press
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = None;
        self.excluded_window_ids
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clear();
        self.next_note_pin.store(0, Ordering::Release);
        self.shift_held.store(false, Ordering::Release);
        self.window_log_request.store(false, Ordering::Release);
        let agent_context = crate::shared::handoff::experiment(crate::shared::handoff::AGENT_CONTEXT);
        self.agent_context.store(agent_context, Ordering::Release);
        if agent_context {
            crate::capture::engine::accessibility::ax::Prober::shared().begin();
        }
        self.active.store(true, Ordering::Release);
        let clicks = if self.mouse_live.load(Ordering::Acquire) {
            platform::MOUSE_SOURCE
        } else {
            "polled mouse buttons"
        };
        let keys = if self.tap_live.load(Ordering::Acquire) {
            platform::KEY_SOURCE
        } else {
            platform::NO_KEY_SOURCE
        };
        apparent_log(format!("session clicks from {clicks}, keys from {keys}"));
    }

    /// Whether Esc went down since the last call (a pending shortcut or an open picker cancels on it).
    pub fn take_escape(&self) -> bool {
        self.escape_pressed.swap(false, Ordering::AcqRel)
    }

    pub fn elapsed_ms(&self) -> u64 {
        self.started_at
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .elapsed()
            .as_millis() as u64
    }

    pub fn contains_screen_point(&self, screen_x: f64, screen_y: f64) -> bool {
        let frame = *self
            .target_frame
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        frame.width >= 16.0
            && frame.height >= 16.0
            && frame.x > -10_000.0
            && screen_x >= frame.x
            && screen_x <= frame.x + frame.width
            && screen_y >= frame.y
            && screen_y <= frame.y + frame.height
    }

    /// Whether to look up what clicks and strokes land on: `agentContext` is on, the target is
    /// this Mac's screen (not the iPhone mirror) and Accessibility is granted.
    fn probing(&self) -> bool {
        self.agent_context.load(Ordering::Acquire)
            && self.capture_mode.load(Ordering::Acquire) != 3
            && accessibility_granted()
    }

    /// A mouse button went down at a global point.
    fn pointer_down(&self, t_ms: u64, screen_x: f64, screen_y: f64) {
        if self.notes_editing.load(Ordering::Acquire) || !self.contains_screen_point(screen_x, screen_y) {
            return;
        }
        #[cfg(target_os = "macos")]
        {
            let raw = objc2::rc::autoreleasepool(|_| crate::shared::windows::raw_windows());
            if crate::shared::windows::system_prompt_at(&raw, screen_x, screen_y) {
                return;
            }
        }
        let (nx, ny, _, _) = self.normalize_point(screen_x, screen_y);
        self.window_log_request.store(true, Ordering::Release);
        let start_frame = *self
            .target_frame
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        *self
            .drag_start
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) =
            Some((t_ms, nx, ny, None, start_frame));
        if self.probing() {
            crate::capture::engine::accessibility::ax::Prober::shared().probe(
                crate::capture::engine::accessibility::ax::Target::Pointer(t_ms),
                screen_x,
                screen_y,
            );
        }
    }

    /// A mouse button came up: records the click or drag that `pointer_down` began.
    fn pointer_up(&self, t_ms: u64, screen_x: f64, screen_y: f64, right: bool) {
        let Some((t0, x0, y0, start_label, start_frame)) = self
            .drag_start
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .take()
        else {
            return;
        };
        let end_frame = *self
            .target_frame
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if !same_target_frame(start_frame, end_frame) {
            return;
        }
        let (nx, ny, fw, fh) = self.normalize_point(screen_x, screen_y);
        let dist_px = ((nx - x0) * fw as f32).hypot((ny - y0) * fh as f32);
        let _ = self.ui_sender.try_send(LiveOverlayEvent::RequestSnapshot);
        let event = if dist_px < CLICK_SLOP_PT {
            InteractionEvent::Click {
                t: t0,
                x: x0,
                y: y0,
                button: Some(if right { "right" } else { "left" }.into()),
                label: start_label,
                role: None,
            }
        } else {
            InteractionEvent::Drag {
                t: t0,
                t1: t_ms,
                x0,
                y0,
                x1: nx,
                y1: ny,
                label: start_label,
                button: None,
                path: Vec::new(),
            }
        };
        self.events
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .push(event);
    }

    /// The left button went down with only ⇧ held: a pin if it comes up as a click (`shift_up`).
    fn shift_down(&self, t_ms: u64, screen_x: f64, screen_y: f64) {
        if self.notes_editing.load(Ordering::Acquire) || !self.contains_screen_point(screen_x, screen_y) {
            return;
        }
        let frame = *self
            .target_frame
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        *self
            .shift_press
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) =
            Some((t_ms, screen_x, screen_y, frame));
    }

    /// The button of a ⇧-press came up (with or without ⇧ still held). A ⇧-click drops the next
    /// numbered pin where it went down, unless ink was already drawn in this ⇧ hold: a click in
    /// the middle of a drawing belongs to the drawing, so it neither pins nor counts as a click.
    /// A ⇧-drag is left to the ink the poller is drawing. Returns whether a ⇧-press was waiting,
    /// so the release isn't also taken as a click's.
    fn shift_up(&self, t_ms: u64, screen_x: f64, screen_y: f64) -> bool {
        let Some((t0, x0, y0, start_frame)) = self
            .shift_press
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .take()
        else {
            return false;
        };
        let frame = *self
            .target_frame
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if !same_target_frame(start_frame, frame)
            || !is_pin_click((t0, x0, y0), (t_ms, screen_x, screen_y))
        {
            return true;
        }
        {
            let mut live = self
                .live_ink
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            if live.as_ref().is_some_and(|ink| drew_before(ink, t0)) {
                return true;
            }
            // ⇧ draws as it's held, so the live ink is only the click's jitter; further ink
            // starts a new stroke.
            *live = None;
        }
        let (nx, ny, fw, fh) = self.normalize_point(x0, y0);
        let mut strokes = self
            .strokes
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let number = self.next_note_pin.fetch_add(1, Ordering::AcqRel) as u32 + 1;
        strokes.push(Stroke {
            t0,
            t1: t_ms,
            fw,
            fh,
            on: None,
            pin: Some(number),
            laser: false,
            rgb: self.stroke_rgb(),
            pts: vec![
                (nx * SCALE as f32).round() as i32,
                (ny * SCALE as f32).round() as i32,
                0,
            ],
        });
        drop(strokes);
        let _ = self.ui_sender.try_send(LiveOverlayEvent::Note { pin: number, t: t0, x: nx, y: ny, screen_x: x0, screen_y: y0 });
        self.window_log_request.store(true, Ordering::Release);
        let _ = self.ui_sender.try_send(LiveOverlayEvent::RequestSnapshot);
        true
    }

    /// The helper process whose window is the capture target (the iPhone mirror).
    #[cfg_attr(target_os = "windows", allow(dead_code))]
    pub fn set_capture_source_pid(&self, pid: u32) {
        self.capture_source_pid
            .store(i32::try_from(pid).unwrap_or(0), Ordering::Release);
    }

    /// Whether the topmost window at a global point is Apparent's own or a registered UI child's other
    /// than the capture source (ignoring the click-through ink overlay). Asked once per press, and
    /// for scrolls, which come in bursts at one point, at most every 250 ms.
    /// While editing, only the two notes-child windows count as inside. A click on
    /// the capsule or another Apparent surface is still an outside click.
    fn on_capture_input_ui(&self, x: f64, y: f64) -> bool {
        if self.notes_editing.load(Ordering::Acquire) {
            self.notes_window_in(&platform::input_windows(self.note_ui_pid.load(Ordering::Acquire) as u32), x, y)
        } else {
            self.on_apparent_window(x, y)
        }
    }

    #[cfg(target_os = "linux")]
    fn on_note_input_ui(&self, x: f64, y: f64) -> bool {
        self.note_input_ui_in(&platform::input_windows(self.note_ui_pid.load(Ordering::Acquire) as u32), x, y)
    }

    #[cfg(target_os = "linux")]
    fn note_input_ui_in(&self, windows: &[crate::shared::windows::RawWindow], x: f64, y: f64) -> bool {
        if self.notes_editing.load(Ordering::Acquire) || self.notes_window_in(windows, x, y) {
            return self.notes_window_in(windows, x, y);
        }
        let passthrough = self.passthrough_window_ids.lock().unwrap().clone();
        let subject = windows.iter().filter(|w| {
            let [wx, wy, width, height] = w.bounds;
            w.alpha > 0.01 && x >= wx && x <= wx + width && y >= wy && y <= wy + height
        }).find(|w| !passthrough.contains(&w.id))
            .is_some_and(|w| crate::capture::ui_process::settings_subject(w.pid, w.id));
        !subject && self.apparent_window_in(windows, x, y, platform::is_helper_process)
    }

    fn notes_window_in(&self, windows: &[crate::shared::windows::RawWindow], x: f64, y: f64) -> bool {
        let pid = self.note_ui_pid.load(Ordering::Acquire);
        let passthrough = self.passthrough_window_ids.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        #[cfg(target_os = "linux")]
        {
            // Hyprland raises pinned surfaces in its own scene without updating X11's
            // root stacking list. Notes are always-on-top; hit their visible child
            // rects directly rather than mistaking the capsule beneath for the target.
            windows.iter().any(|w| {
                let [wx, wy, width, height] = w.bounds;
                pid > 0 && u64::try_from(w.pid).ok() == Some(pid) && w.alpha > 0.01 && !passthrough.contains(&w.id)
                    && x >= wx && x <= wx + width && y >= wy && y <= wy + height
            })
        }
        #[cfg(target_os = "macos")]
        {
            let mut windows = windows.to_vec();
            crate::shared::windows::constrain_dock(&mut windows, *self.dock_bounds.lock().unwrap());
            pid > 0 && crate::shared::windows::owned_window_at(&windows, x, y, &passthrough, |owner| u64::try_from(owner).ok() == Some(pid))
        }
    }

    fn on_apparent_window(&self, x: f64, y: f64) -> bool {
        let mut hit = self
            .apparent_hit
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some((at, hx, hy, on)) = *hit
            && at.elapsed() < Duration::from_millis(250)
            && (hx - x).abs() <= 2.0
            && (hy - y).abs() <= 2.0
        {
            return on;
        }
        let on = self.apparent_window_in(
            &platform::input_windows(self.note_ui_pid.load(Ordering::Acquire) as u32),
            x,
            y,
            platform::is_helper_process,
        );
        *hit = Some((Instant::now(), x, y, on));
        on
    }

    fn apparent_window_in(
        &self,
        windows: &[crate::shared::windows::RawWindow],
        x: f64,
        y: f64,
        is_helper: impl Fn(i32) -> bool,
    ) -> bool {
        if self.notes_window_in(windows, x, y) { return true; }
        #[cfg(target_os = "macos")]
        let adjusted = {
            let mut raw = windows.to_vec();
            crate::shared::windows::constrain_dock(&mut raw, *self.dock_bounds.lock().unwrap());
            raw
        };
        #[cfg(target_os = "macos")]
        let windows = adjusted.as_slice();
        let passthrough = self
            .passthrough_window_ids
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone();
        let own = std::process::id() as i32;
        let source = self.capture_source_pid.load(Ordering::Acquire);
        let note_pid = self.note_ui_pid.load(Ordering::Acquire);
        crate::shared::windows::owned_window_at(windows, x, y, &passthrough, |pid| {
            pid == own || (note_pid > 0 && u64::try_from(pid).ok() == Some(note_pid))
                || (pid != source && (crate::capture::ui_process::owns(pid) || is_helper(pid)))
        })
    }

    pub fn normalize_point(&self, screen_x: f64, screen_y: f64) -> (f32, f32, u32, u32) {
        let frame = *self
            .target_frame
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let nx = ((screen_x - frame.x) / frame.width.max(1.0)).clamp(0.0, 1.0) as f32;
        let ny = ((screen_y - frame.y) / frame.height.max(1.0)).clamp(0.0, 1.0) as f32;
        (
            nx,
            ny,
            frame.width.round().max(1.0) as u32,
            frame.height.round().max(1.0) as u32,
        )
    }

    pub fn finish_active_laser(&self, _ax_point: Option<(f64, f64)>) {
        if let Some(mut laser) = self
            .active_laser
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .take()
            && !laser.pts.is_empty()
        {
            if let Some(last) = laser.pts.chunks_exact(3).last() {
                let lx = last[0] as f32 / SCALE as f32;
                let ly = last[1] as f32 / SCALE as f32;
                laser.t1 = laser.t0.saturating_add(last[2].max(0) as u64);
                self.events
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner)
                    .push(InteractionEvent::Point {
                        t: laser.t1,
                        x: lx,
                        y: ly,
                        label: None,
                    });
            }
            self.strokes
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .push(laser);
        }
    }

    pub fn finish_session(&self) -> (Vec<InteractionEvent>, Vec<Stroke>) {
        self.active.store(false, Ordering::Release);
        self.selecting.store(false, Ordering::Release);
        *self
            .drag_start
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = None;
        *self
            .shift_press
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = None;
        self.finish_active_laser(None);
        if let Some(ink) = self
            .live_ink
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .take()
            && is_real_ink(&ink)
        {
            self.strokes
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .extend(recording_ink(self, &ink));
        }
        self.desktop_ink
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clear();
        self.shift_held.store(false, Ordering::Release);
        let mut events = std::mem::take(
            &mut *self
                .events
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner),
        );
        let mut strokes = std::mem::take(
            &mut *self
                .strokes
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner),
        );
        if self.agent_context.swap(false, Ordering::AcqRel) {
            let hits = crate::capture::engine::accessibility::ax::Prober::shared().finish();
            crate::capture::engine::accessibility::ax::apply(&hits, &mut events, &mut strokes);
            if self.capture_mode.load(Ordering::Acquire) != 3 {
                let end = crate::shared::clock::now_epoch_ms();
                let start = end.saturating_sub(self.elapsed_ms());
                let page = crate::capture::desktop::workflow::page::between(start, end);
                crate::capture::desktop::workflow::page::apply(
                    &page,
                    start,
                    &mut events,
                    &mut strokes,
                );
            }
        }
        (events, strokes)
    }
}

/// Clicks from the mouse buttons' polled state, while the mouse monitor (or hook) is missing: a
/// press starts a click (unless it lands on Apparent's own window), a release ends it. A ⇧-press may
/// be a pin, as in the mouse monitor's handler.
fn poll_clicks(
    telemetry: &SharedCaptureTelemetry,
    prev: &mut [bool; 2],
    now: [bool; 2],
    (x, y): (f64, f64),
    pure_shift: bool,
    on_apparent: impl Fn(f64, f64) -> bool,
) {
    let was = std::mem::replace(prev, now);
    // The Mac global monitor excludes our own app windows. Poll notes outside
    // clicks regardless of monitor availability; the monitor skips editing input.
    if telemetry.notes_editing.load(Ordering::Acquire) {
        if now.iter().zip(&was).any(|(&down, &before)| down && !before) && !on_apparent(x, y) {
            let _ = telemetry.ui_sender.try_send(LiveOverlayEvent::NoteOutside);
        }
        return;
    }
    if telemetry.mouse_live.load(Ordering::Acquire) { return; }
    for (button, (&down, &before)) in now.iter().zip(&was).enumerate() {
        let left = button == 0;
        if down && !before && !on_apparent(x, y) {
            if !pure_shift {
                telemetry.pointer_down(telemetry.elapsed_ms(), x, y);
            } else if left {
                telemetry.shift_down(telemetry.elapsed_ms(), x, y);
            }
        } else if !down && before {
            let shift_press = left && telemetry.shift_up(telemetry.elapsed_ms(), x, y);
            if !shift_press && !pure_shift {
                telemetry.pointer_up(telemetry.elapsed_ms(), x, y, !left);
            }
        }
    }
}

/// A press that moves less than this (points) before it's let go is a click, not a drag.
const CLICK_SLOP_PT: f32 = 12.0;
/// A ⇧-press held still for longer than this drops no pin.
const PIN_MAX_PRESS_MS: u64 = 1_000;
/// Ink spanning less than this (points) is a stationary ⇧ tap, not a stroke.
const MIN_INK_SPAN_PT: f32 = 6.0;

/// Whether a ⇧-press (`t`, global `x`, `y`) let go at `up` is a ⇧-click, which drops a pin.
fn is_pin_click(down: (u64, f64, f64), up: (u64, f64, f64)) -> bool {
    up.0.saturating_sub(down.0) <= PIN_MAX_PRESS_MS
        && ((up.1 - down.1).hypot(up.2 - down.2) as f32) < CLICK_SLOP_PT
}

/// Whether `stroke`'s points before `before_ms` reach at least `MIN_INK_SPAN_PT` from its start.
fn drew_before(stroke: &Stroke, before_ms: u64) -> bool {
    let Some(first) = stroke.pts.get(0..2) else {
        return false;
    };
    let mut points = 0_usize;
    let mut span = 0.0_f32;
    for p in stroke
        .pts
        .chunks_exact(3)
        .take_while(|p| stroke.t0.saturating_add(p[2].max(0) as u64) < before_ms)
    {
        points += 1;
        let dx = (p[0] - first[0]) as f32 / SCALE as f32 * stroke.fw as f32;
        let dy = (p[1] - first[1]) as f32 / SCALE as f32 * stroke.fh as f32;
        span = span.max(dx.hypot(dy));
    }
    points >= 2 && span >= MIN_INK_SPAN_PT
}

/// Whether finished ink is worth keeping as a stroke.
fn is_real_ink(stroke: &Stroke) -> bool {
    drew_before(stroke, u64::MAX)
}

fn same_target_frame(a: TargetFrame, b: TargetFrame) -> bool {
    (a.x - b.x).abs() <= 0.5
        && (a.y - b.y).abs() <= 0.5
        && (a.width - b.width).abs() <= 0.5
        && (a.height - b.height).abs() <= 0.5
}

/// XWayland output order need not match the compositor layout. Never interpolate
/// between samples on different outputs: that can invent a desktop-wide segment.
/// Retain one desktop gesture for Undo; only its painted/recorded parts are split.
pub(crate) fn ink_output_parts(stroke: &Stroke, frame: TargetFrame, outputs: &[[f64; 4]]) -> Vec<Stroke> {
    let output = |p: &[i32]| {
        let x = frame.x + p[0] as f64 / SCALE as f64 * frame.width;
        let y = frame.y + p[1] as f64 / SCALE as f64 * frame.height;
        outputs.iter().position(|r| screens::contains(*r, [x, y]))
    };
    let mut result = Vec::new();
    let mut start = 0;
    let points: Vec<_> = stroke.pts.chunks_exact(3).collect();
    for i in 1..=points.len() {
        if i == points.len() || output(points[i - 1]) != output(points[i]) {
            let mut part = stroke.clone();
            part.pts = stroke.pts[start * 3..i * 3].to_vec();
            result.push(part);
            start = i;
        }
    }
    result
}

fn recording_ink(telemetry: &SharedCaptureTelemetry, stroke: &Stroke) -> Vec<Stroke> {
    #[cfg(target_os = "linux")]
    {
        let frame = *telemetry.target_frame.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        let outputs: Vec<_> = screens::current().iter().map(|s| s.frame).collect();
        return ink_output_parts(stroke, frame, &outputs).iter().flat_map(clip_recording_ink).collect();
    }
    #[cfg(not(target_os = "linux"))]
    { let _ = telemetry; clip_recording_ink(stroke) }
}

/// A deliberate Shift movement outside the editor returns to annotation.
/// Stationary capital-letter Shift presses and movement inside the editor do not.
#[derive(Default)]
struct NoteDrawGesture {
    start: Option<(f64, f64)>,
    pending: bool,
}
impl NoteDrawGesture {
    fn update(&mut self, editing: bool, shift: bool, at: (f64, f64), mut inside: impl FnMut(f64, f64) -> bool) -> bool {
        if !editing || !shift {
            *self = Self::default();
            return false;
        }
        if self.pending || !at.0.is_finite() || !at.1.is_finite() { return false; }
        let Some(start) = self.start else { self.start = Some(at); return false; };
        if (at.0 - start.0).hypot(at.1 - start.1) < f64::from(MIN_INK_SPAN_PT) { return false; }
        // Window lookup is needed only after real movement. If Shift started in
        // the editor, protect text selection until Shift is released, even if
        // that selection subsequently drags outside its bounds.
        if inside(start.0, start.1) || inside(at.0, at.1) {
            self.pending = true;
            return false;
        }
        self.pending = true;
        true
    }
}
impl SharedCaptureTelemetry {
    fn resume_note_drawing(&self, gesture: &mut NoteDrawGesture, at: (f64, f64), shift: bool) {
        if gesture.update(self.notes_editing.load(Ordering::Acquire), shift, at,
            |x, y| self.on_capture_input_ui(x, y)) {
            let _ = self.ui_sender.try_send(LiveOverlayEvent::NoteResumeDrawing);
        }
    }
}

#[cfg(test)]
mod note_draw_tests {
    use super::NoteDrawGesture;
    #[test]
    fn stationary_shift_typing_does_not_enumerate_native_windows() {
        let mut gesture = NoteDrawGesture::default();
        let lookups = std::cell::Cell::new(0);
        for _ in 0..125 {
            assert!(!gesture.update(true, true, (10.0, 10.0), |_, _| { lookups.set(lookups.get() + 1); false }));
        }
        assert_eq!(lookups.get(), 0);
        assert!(gesture.update(true, true, (20.0, 20.0), |_, _| { lookups.set(lookups.get() + 1); false }));
        assert_eq!(lookups.get(), 2);
    }
    #[test]
    fn drawing_outside_a_note_requires_motion_and_preserves_typing_inside() {
        let mut gesture = NoteDrawGesture::default();
        assert!(!gesture.update(true, true, (10.0, 10.0), |_, _| false));
        assert!(!gesture.update(true, true, (10.0, 10.0), |_, _| false));
        assert!(!gesture.update(true, false, (10.0, 10.0), |_, _| false));
        assert!(!gesture.update(true, true, (10.0, 10.0), |_, _| true));
        assert!(!gesture.update(true, true, (50.0, 50.0), |_, _| true));
        assert!(!gesture.update(true, true, (80.0, 80.0), |_, _| false));
        assert!(!gesture.update(true, false, (80.0, 80.0), |_, _| false));
        assert!(!gesture.update(true, true, (80.0, 80.0), |_, _| false));
        assert!(gesture.update(true, true, (100.0, 100.0), |_, _| false));
        assert!(!gesture.update(true, true, (120.0, 120.0), |_, _| false), "one dismissal until acknowledged");
        assert!(!gesture.update(false, true, (120.0, 120.0), |_, _| false));
        assert!(!gesture.update(true, true, (120.0, 120.0), |_, _| false));
        assert!(gesture.update(true, true, (140.0, 140.0), |_, _| false));
    }
}

/// One poll of desktop Shift ink, using unclamped capture-relative coordinates.
/// Only clipped segments enter the recording; letting go of Shift commits it. `pure_shift` is Shift
/// without other modifiers (and not left over from a chord such as the capture shortcut).
fn track_shift_ink(
    telemetry: &SharedCaptureTelemetry,
    (x, y): (f64, f64),
    pure_shift: bool,
    prev_shift_ink: bool,
) {
    track_shift_ink_observed(telemetry, (x, y), pure_shift, prev_shift_ink, None);
}

pub(crate) fn track_shift_ink_observed(
    telemetry: &SharedCaptureTelemetry,
    (x, y): (f64, f64),
    pure_shift: bool,
    prev_shift_ink: bool,
    _observed_at_ns: Option<u64>,
) {
    #[cfg(target_os = "linux")]
    let native_input = telemetry.native_ink_observer.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    if pure_shift && !telemetry.notes_editing.load(Ordering::Acquire) && x.is_finite() && y.is_finite() {
        telemetry.shift_held.store(true, Ordering::Release);
        let t_ms = telemetry.elapsed_ms();
        let frame = *telemetry
            .target_frame
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let (nx, ny) = (
            ((x - frame.x) / frame.width.max(1.0)) as f32,
            ((y - frame.y) / frame.height.max(1.0)) as f32,
        );
        let (fw, fh) = (
            frame.width.round().max(1.0) as u32,
            frame.height.round().max(1.0) as u32,
        );
        let sx = (nx * SCALE as f32).round() as i32;
        let sy = (ny * SCALE as f32).round() as i32;
        let mut guard = telemetry
            .live_ink
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        #[cfg(target_os = "linux")]
        let first = guard.is_none();
        if guard.is_none() {
            telemetry.window_log_request.store(true, Ordering::Release);
        }
        let stroke = guard.get_or_insert_with(|| Stroke {
            t0: t_ms,
            t1: t_ms,
            fw,
            fh,
            on: None,
            pin: None,
            laser: false,
            rgb: telemetry.stroke_rgb(),
            pts: Vec::new(),
        });
        let dt = t_ms.saturating_sub(stroke.t0) as i32;
        let should_push = stroke.pts.chunks_exact(3).last().is_none_or(|prev| {
            let dx = (sx - prev[0]) as f32 / SCALE as f32 * fw as f32;
            let dy = (sy - prev[1]) as f32 / SCALE as f32 * fh as f32;
            dx.hypot(dy) >= 1.5
        });
        #[cfg(target_os = "linux")]
        let native_capacity_exceeded = should_push && stroke.pts.len() / 3 >= 2_400;
        if should_push && stroke.pts.len() / 3 < 2_400 {
            stroke.pts.extend_from_slice(&[sx, sy, dt]);
            stroke.t1 = t_ms;
            #[cfg(target_os = "linux")]
            if let Some(observer) = native_input.as_ref() {
                observer.observe(match _observed_at_ns {
                    Some(observed_at_ns) => NativeInkObservation::Point {
                        first, position: [x, y], observed_at_ns, rgb: stroke.rgb,
                    },
                    None => NativeInkObservation::ClockUnavailable,
                });
            }
        }
        #[cfg(target_os = "linux")]
        if native_capacity_exceeded {
            // Reaching the donor's cap must not become a silently truncated
            // complete collection. The native source latches unavailable.
            if let Some(observer) = native_input.as_ref() {
                observer.observe(NativeInkObservation::CapacityExceeded);
            }
        }
    } else if !pure_shift && prev_shift_ink {
        telemetry.shift_held.store(false, Ordering::Release);
        let completed = telemetry
            .live_ink
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .take();
        #[cfg(target_os = "linux")]
        if let (Some(stroke), Some(observer)) = (completed.as_ref(), native_input.as_ref()) {
            observer.observe(match _observed_at_ns {
                Some(observed_at_ns) => NativeInkObservation::End { accepted: is_real_ink(stroke), observed_at_ns },
                None => NativeInkObservation::ClockUnavailable,
            });
        }
        if let Some(stroke) = completed
            // Ignore stationary Shift taps (e.g. typing a capital letter without moving the mouse).
            && is_real_ink(&stroke)
        {
            let recorded = recording_ink(telemetry, &stroke);
            if telemetry.probing() && recorded.len() == 1 {
                let stroke = &recorded[0];
                let frame = *telemetry
                    .target_frame
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner);
                if let Some((x, y)) =
                    crate::capture::engine::accessibility::ax::stroke_probe_point(&stroke, frame)
                {
                    crate::capture::engine::accessibility::ax::Prober::shared().probe(
                        crate::capture::engine::accessibility::ax::Target::Stroke(stroke.t0),
                        x,
                        y,
                    );
                }
            }
            telemetry
                .strokes
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .extend(recorded);
            telemetry
                .desktop_ink
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .push(stroke);
            let _ = telemetry
                .ui_sender
                .try_send(LiveOverlayEvent::RequestSnapshot);
        }
    }
}

pub fn is_frontmost_terminal() -> bool {
    let Some((_pid, app, bundle_id)) = frontmost_app_info() else {
        return false;
    };
    let a = app.to_ascii_lowercase();
    let b = bundle_id.unwrap_or_default().to_ascii_lowercase();
    [
        "ghostty",
        "iterm",
        "terminal",
        "kitty",
        "wezterm",
        "alacritty",
        "warp",
        // Windows Terminal, the console host and the shells it runs.
        "windowsterminal",
        "conhost",
        "powershell",
        "pwsh",
        "cmd.exe",
        "mintty",
        // Linux (the window's class): GNOME Terminal and Console, Ptyxis, Konsole, XTerm…
        "konsole",
        "xterm",
        "kgx",
        "org.gnome.console",
        "ptyxis",
        "tilix",
        "terminator",
        "foot",
        "urxvt",
    ]
    .iter()
    .any(|needle| a.contains(needle) || b.contains(needle))
}

/// Writes all bundle artifacts (`apparent.json`, `summary.md`, `contact-sheet.png`, `frames/frame-XX.png`)
/// into a new or specified `.apparent` bundle directory.
pub fn write_bundle_artifacts(
    out_dir: &Path,
    bundle: &crate::shared::model::ApparentBundle,
    annotated_frames: &[(crate::shared::model::Keyframe, RgbaFrame)],
    contact_sheet: &RgbaFrame,
    summary_md: &str,
) -> Result<()> {
    std::fs::create_dir_all(out_dir.join("frames"))
        .with_context(|| format!("could not create {}", out_dir.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(out_dir, std::fs::Permissions::from_mode(0o700));
    }

    thread::scope(|scope| -> Result<()> {
        let workers: Vec<_> = annotated_frames
            .iter()
            .map(|(kf, frame)| {
                scope.spawn(move || -> Result<()> {
                    crate::capture::engine::render::save_png(frame, &out_dir.join(&kf.file))
                })
            })
            .collect();
        crate::capture::engine::render::save_png(
            contact_sheet,
            &out_dir.join(&bundle.contact_sheet),
        )?;
        for worker in workers {
            worker
                .join()
                .map_err(|_| anyhow::anyhow!("PNG encoding worker panicked"))??;
        }
        Ok(())
    })?;

    let manifest_bytes = serde_json::to_vec_pretty(bundle)?;
    std::fs::write(out_dir.join("apparent.json"), manifest_bytes)?;
    std::fs::write(out_dir.join("summary.md"), summary_md.as_bytes())?;

    Ok(())
}

#[cfg(test)]
#[path = "tests.rs"]
mod tests;
