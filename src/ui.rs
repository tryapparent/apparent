use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};
use std::{cell::RefCell, rc::Rc};

use gpui::{
    AnyElement, App, Application, Bounds, BoxShadow, Context, Div, Entity, FocusHandle, FontWeight,
    Image, ImageFormat, IntoElement, KeyDownEvent, Keystroke, MouseButton, MouseDownEvent,
    MouseMoveEvent, MouseUpEvent, Pixels, Point, Render, SharedString, Size, TextRun, Window,
    WindowBackgroundAppearance, WindowBounds, WindowKind, WindowOptions, div, img, point,
    prelude::*, px, relative, rgb, rgba, size, svg,
};

// The operating system around the shared UI: the menu bar or notification area menu, native
// window levels and styles, and the pill's native shell. Each module provides the same items.
#[cfg_attr(target_os = "macos", path = "ui/macos.rs")]
#[cfg_attr(target_os = "windows", path = "ui/windows.rs")]
#[cfg_attr(target_os = "linux", path = "ui/linux.rs")]
mod platform;
mod whiteboard;
#[cfg(target_os = "linux")]
pub(crate) use platform::set_app_icon;
use platform::{
    PillChrome, install_status_bar, pointer_on_hud_pill, reduce_motion, set_status_inbox_count,
    set_status_text,
};
#[cfg(target_os = "windows")]
pub(crate) use platform::{gpui_display_for, hwnd_of, set_app_icon};

use crate::audio::{AudioRecorder, InputWarning};
use crate::capture::{
    LiveOverlayEvent, ScreenCaptureSession, SharedCaptureTelemetry, apparent_log,
    current_mouse_screen, discover_target, install_global_hotkeys, list_selectable_windows,
    record_external_frontmost_app, region_target, selectable_window_at, shortcut_from_key_and_mods,
    start_global_input_tap, update_global_shortcut,
};
use crate::helper::PhoneDevice;
#[cfg(target_os = "macos")]
use crate::laser_overlay::MetalLaserOverlay as LaserOverlay;
#[cfg(target_os = "linux")]
use crate::linux::overlay::InkOverlay as LaserOverlay;
use crate::model::{ApparentBundle, CaptureMode, TargetFrame, TargetInfo, format_clock};
use crate::phone::PhoneSession;
use crate::sketch::timeline;
#[cfg(target_os = "windows")]
use crate::win::overlay::InkOverlay as LaserOverlay;

const SIDEBAR_BG: u32 = 0x111111;
const CANVAS_BG: u32 = 0x161616;
const SURFACE_BG: u32 = 0x1d1d1d;
const SURFACE_HOVER: u32 = 0x252525;
const SURFACE_SELECTED: u32 = 0x2e2e2e;
const LINE_COLOR: u32 = 0x2a2a2a;
const TEXT_COLOR: u32 = 0xf2f2f2;
const TEXT_SOFT: u32 = 0xd0d0d0;
const MUTED_COLOR: u32 = 0x969696;
const ACCENT_COLOR: u32 = 0x3b5cf6;
const ACCENT_HOVER: u32 = 0x4b6bff;
const INK_RED: u32 = 0xff3b30;

// Dynamic Island capsule geometry. GPUI boxes are border-box, so the hairline border is part of
// the inset: R_outer (20) = R_chip (16) + border (1) + pad (3), on every side.
const ISLAND_H: f32 = 40.0;
/// Width the recording pill opens from when a recording starts without the picker.
const ISLAND_OPEN_FROM_W: f32 = 120.0;
const ISLAND_RADIUS: f32 = ISLAND_H / 2.0;
const ISLAND_INSET: f32 = 4.0;
const ISLAND_PAD: f32 = ISLAND_INSET - 1.0;
const CHIP_H: f32 = ISLAND_H - 2.0 * ISLAND_INSET;
const CHIP_RADIUS: f32 = CHIP_H / 2.0;
const CHIP_PX: f32 = 12.0;
const CHIP_GAP: f32 = 2.0;
const LIVE_WARNING_END_PAD: f32 = 16.0;
const DIVIDER_MX: f32 = 6.0;
const LEAD_TRAIL: f32 = 8.0;
const HUD_TEXT: f32 = 13.0;
// Selection-mode segments: line icon, then label.
const SEG_PX: f32 = 10.0;
const SEG_ICON: f32 = 14.0;
const SEG_ICON_GAP: f32 = 5.0;
// The live warning and optional input meter need room without clipping Finish.
const PILL_WINDOW_W: f32 = 640.0;
#[cfg(target_os = "linux")]
const EQUALIZER_W: f32 = 28.0;
#[cfg(target_os = "linux")]
fn recording_equalizer_enabled() -> bool {
    true
}
const PILL_WINDOW_H: f32 = 84.0;

mod lab;
pub(crate) mod motion;
pub(crate) mod pill_theme;
use pill_theme::{PillTheme, SIGNAL, SIGNAL_HOVER, WARNING};

pub use lab::{Options as LabOptions, Scene as LabScene, run as run_lab};
pub(crate) use motion::{TuneAction, tune_command};

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Spring {
    /// Visual duration in seconds.
    response: f32,
    bounce: f32,
}

impl Spring {
    /// Kit's duration + bounce: ω = 2π / duration, ζ = 1 − bounce.
    const fn visual(duration: f32, bounce: f32) -> Self {
        Self {
            response: duration,
            bounce,
        }
    }
}

// The capsule's springs and durations live in `motion::Tune` (defaults in `Tune::DEFAULT`, live
// overrides from `~/.config/apparent/tune.json` in debug builds; `apparent tune`).
//
// Switch chips on a tap-started recording (`crate::shortcut::Reveal`). One shape: the recording
// pill grows into the chip row and folds back. The width leads the morph palette (.42/.16 open,
// .38/.08 close) on a slightly faster spring; the lead (dot + clock) stays pinned to the left
// edge, and each trailing item fades in as the moving edge uncovers it, on the same frame. The
// chips ↔ controls swap fades in place with a sine blur pulse (sharp at both ends) and no content
// scale, so the pinned lead never travels.

/// Which width spring the current morph uses.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Morph {
    /// A phase change (`Tune::island`).
    Phase,
    /// The switch chips opening (`Tune::reveal_open`).
    RevealOpen,
    /// The switch chips folding back (`Tune::reveal_close`).
    RevealClose,
    /// A switch chip turning the recording into the picker (`Tune::switch_width`).
    Switch,
}

impl Morph {
    fn spring(self, tune: &motion::Tune) -> Spring {
        match self {
            Self::Phase => tune.island,
            Self::RevealOpen => tune.reveal_open,
            Self::RevealClose => tune.reveal_close,
            Self::Switch => tune.switch_width,
        }
    }
}

/// Reduced motion: no width travel, the groups only cross-fade over this long.
const REDUCED_FADE_S: f32 = 0.18;
/// The picker's highlight moving from one mode to another cross-fades over this long.
const HIGHLIGHT_FADE_S: f32 = 0.18;

/// A switch chip turning the recording into the picker (`switch_recording`). The capsule stays
/// one shape: the chips are the picker's chips, so the picker row starts where they were and
/// slides to its place on `Tune::switch_slide` while the width springs on `Tune::switch_width`
/// (a touch faster, so it leads). The lead (dot and clock, frozen) and its divider ride along in
/// front of the row and leave under the capsule's left edge; Record, the divider and ✕ ride
/// behind it and fade in as the right edge uncovers them.
#[derive(Clone, Copy, Debug)]
struct SwitchMorph {
    /// The row's offset from its resting place and its velocity, in points. Measured by the
    /// first frame that draws it (text widths need the window).
    slide: Option<(f32, f32)>,
}

/// Advances a damped spring with fixed 4ms sub-steps so long frames stay stable.
fn spring_step(value: f32, velocity: f32, target: f32, dt: f32, spring: Spring) -> (f32, f32) {
    let omega = std::f32::consts::TAU / spring.response;
    let stiffness = omega * omega;
    let damping = 2.0 * (1.0 - spring.bounce) * omega;
    let steps = (dt / 0.004).ceil().max(1.0) as usize;
    let h = dt / steps as f32;
    let (mut x, mut v) = (value, velocity);
    for _ in 0..steps {
        v += ((target - x) * stiffness - v * damping) * h;
        x += v * h;
    }
    (x, v)
}

fn with_alpha(color: u32, alpha: f32) -> gpui::Rgba {
    rgba((color << 8) | (alpha.clamp(0.0, 1.0) * 255.0).round() as u32)
}

pub(crate) fn ease_out_cubic(t: f32) -> f32 {
    1.0 - (1.0 - t.clamp(0.0, 1.0)).powi(3)
}

fn tabular_nums() -> gpui::FontFeatures {
    gpui::FontFeatures(Arc::new(vec![("tnum".into(), 1)]))
}

fn tabular_font(weight: FontWeight) -> gpui::Font {
    gpui::Font {
        family: ".SystemUIFont".into(),
        features: tabular_nums(),
        fallbacks: None,
        weight,
        style: gpui::FontStyle::Normal,
    }
}

fn measure_text(window: &Window, text: &str, size: f32, weight: FontWeight) -> f32 {
    let mut font = window.text_style().font();
    font.weight = weight;
    font.features = tabular_nums();
    let run = TextRun {
        len: text.len(),
        font,
        color: gpui::black(),
        background_color: None,
        underline: None,
        strikethrough: None,
    };
    let line = window.text_system().shape_line(
        SharedString::from(text.to_string()),
        px(size),
        &[run],
        None,
    );
    f32::from(line.width).ceil()
}

fn chip_width(window: &Window, label: &str, weight: FontWeight) -> f32 {
    measure_text(window, label, HUD_TEXT, weight) + 2.0 * CHIP_PX
}

fn clock_template(clock: &str) -> String {
    clock
        .chars()
        .map(|c| if c.is_ascii_digit() { '0' } else { c })
        .collect()
}

/// Lead text of the Completed island: local captures were copied (or sent, as `note` says);
/// iPhone ones count the inbox.
fn completed_label(inbox_count: usize, note: Option<&str>) -> String {
    match inbox_count {
        0 => note.unwrap_or("Copied").to_owned(),
        1 => "From iPhone".to_owned(),
        n => format!("{n} from iPhone"),
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum CompletedAudioIssue {
    NoAudio,
    NoWords,
    TranscriptionUnavailable,
}

impl CompletedAudioIssue {
    fn label(self) -> &'static str {
        match self {
            Self::NoAudio => "No audio",
            Self::NoWords => "No words",
            Self::TranscriptionUnavailable => "Transcript unavailable",
        }
    }
}

fn completed_audio_issue(
    source: Option<&str>,
    transcript: &crate::model::TranscriptData,
    audio_saved: bool,
) -> Option<CompletedAudioIssue> {
    if source == Some("iphone") {
        return None;
    }
    if !audio_saved {
        return Some(CompletedAudioIssue::NoAudio);
    }
    if !transcript.text.trim().is_empty() {
        return None;
    }
    if transcript.missing.is_some() || transcript.source == "none" {
        return Some(CompletedAudioIssue::TranscriptionUnavailable);
    }
    Some(CompletedAudioIssue::NoWords)
}

fn bundle_audio_issue(
    dir: &std::path::Path,
    bundle: &ApparentBundle,
) -> Option<CompletedAudioIssue> {
    completed_audio_issue(
        bundle.source.as_deref(),
        &bundle.transcript,
        bundle.has_microphone_samples(dir),
    )
}

fn completed_status_label(
    inbox_count: usize,
    note: Option<&str>,
    issue: Option<CompletedAudioIssue>,
) -> String {
    let label = completed_label(inbox_count, note);
    if let Some(issue) = issue {
        format!("{label} · {}", issue.label())
    } else {
        label
    }
}

/// Inner width of the Selecting row: mode segments, an optional Record chip, divider, and ✕.
fn selecting_row_width(label_widths: &[f32], record_width: Option<f32>) -> f32 {
    let segments: f32 = label_widths
        .iter()
        .map(|label| label + 2.0 * SEG_PX + SEG_ICON + SEG_ICON_GAP)
        .sum();
    let items = label_widths.len() + usize::from(record_width.is_some()) + 2;
    segments
        + record_width.unwrap_or(0.0)
        + 1.0
        + 2.0 * DIVIDER_MX
        + CHIP_H
        + (items - 1) as f32 * CHIP_GAP
}

fn segment_width(window: &Window, mode: SelectionMode) -> f32 {
    measure_text(window, mode.label(), HUD_TEXT, FontWeight::MEDIUM)
        + 2.0 * SEG_PX
        + SEG_ICON
        + SEG_ICON_GAP
}

/// Widths of the items after a Recording capsule's divider: the switch chips while the reveal
/// is open (`crate::shortcut::Reveal`), else Cancel · Finish.
fn recording_trail_widths(window: &Window, chips: bool, iphone: bool) -> Vec<f32> {
    if chips {
        SelectionMode::available(iphone)
            .iter()
            .map(|&mode| segment_width(window, mode))
            .collect()
    } else {
        let mut widths = vec![chip_width(window, "Cancel", FontWeight::MEDIUM)];
        if whiteboard_enabled() {
            widths.push(chip_width(window, "Whiteboard", FontWeight::MEDIUM));
        }
        widths.push(chip_width(window, "Finish", FontWeight::SEMIBOLD));
        widths
    }
}

fn whiteboard_enabled() -> bool {
    true
}

/// Trace names for a Recording capsule's trailing group, with each item's opacity.
fn trail_keys(
    chips: bool,
    iphone: bool,
    alphas: &[f32],
    prefix: &str,
) -> Vec<Option<(String, f32)>> {
    let names: Vec<String> = if chips {
        SelectionMode::available(iphone)
            .iter()
            .map(|m| format!("chip:{}", m.label()))
            .collect()
    } else {
        let mut names = vec!["cancel".to_string()];
        if whiteboard_enabled() {
            names.push("whiteboard".to_string());
        }
        names.push("finish".to_string());
        names
    };
    names
        .into_iter()
        .enumerate()
        .map(|(i, n)| {
            Some((
                format!("{prefix}{n}"),
                alphas.get(i).copied().unwrap_or(1.0),
            ))
        })
        .collect()
}

/// Left edges of a trailing group's items, starting at `x0`.
fn trail_offsets(x0: f32, widths: &[f32]) -> Vec<f32> {
    widths
        .iter()
        .scan(x0, |x, w| {
            let left = *x;
            *x += w + CHIP_GAP;
            Some(left)
        })
        .collect()
}

/// How much of an item at `x` (width `w`) the capsule's moving right edge has uncovered, eased:
/// trailing items fade in as the pill grows into them and out as it folds over them.
fn edge_alpha(inner_now: f32, x: f32, w: f32) -> f32 {
    let t = ((inner_now - x) / w.max(1.0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// The switch chips' clock: the animation clock, so they stay open as long in slow motion
/// (`motion::time_scale`).
fn reveal_clock_ms() -> u64 {
    (motion::now() * 1000.0) as u64
}

/// An item of the picker row sliding in from under the capsule's right edge (`outer`, the
/// shell's outer edge): invisible while the edge would still cut into its middle, opaque once
/// it is clear, so nothing shows half cut.
fn uncover_alpha(outer: f32, x: f32, w: f32) -> f32 {
    let inside = (outer - x) / w.max(1.0);
    let t = ((inside - 0.7) / 0.4).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// Intrinsic outer width of the capsule for a phase, mirroring the layout in `HudPillWindow`.
/// `chips`: a Recording capsule showing its switch chips.
fn island_content_width(
    window: &Window,
    phase: IslandPhase,
    clock: &str,
    iphone: bool,
    chips: bool,
    warning: Option<InputWarning>,
    completed_note: Option<&str>,
    completed_issue: Option<CompletedAudioIssue>,
    live_no_words: bool,
) -> f32 {
    let divider = 1.0 + 2.0 * DIVIDER_MX;
    let inner = match phase {
        IslandPhase::Selecting { mode } => {
            let labels: Vec<f32> = SelectionMode::available(iphone)
                .iter()
                .map(|m| measure_text(window, m.label(), HUD_TEXT, FontWeight::MEDIUM))
                .collect();
            let record = mode
                .shows_record()
                .then(|| chip_width(window, "Record", FontWeight::SEMIBOLD));
            selecting_row_width(&labels, record)
        }
        IslandPhase::Recording => {
            let trail = recording_trail_widths(window, chips, iphone);
            let warning_w = warning.map_or(0.0, |warning| {
                measure_text(window, warning.label(), HUD_TEXT, FontWeight::MEDIUM)
                    + 2.0 * CHIP_PX
                    + divider
                    + 2.0 * CHIP_GAP
            });
            #[cfg(target_os = "linux")]
            let meter_w = if recording_equalizer_enabled() {
                EQUALIZER_W + CHIP_GAP
            } else {
                0.0
            };
            #[cfg(not(target_os = "linux"))]
            let meter_w = 0.0;
            CHIP_H
                + measure_text(
                    window,
                    &clock_template(clock),
                    HUD_TEXT,
                    FontWeight::SEMIBOLD,
                )
                + LEAD_TRAIL
                + divider
                + warning_w
                + meter_w
                + trail.iter().sum::<f32>()
                + (trail.len() + 1) as f32 * CHIP_GAP
                + if live_no_words {
                    divider
                        + CHIP_GAP
                        + measure_text(window, "⚠ No words yet", HUD_TEXT, FontWeight::SEMIBOLD)
                        + LIVE_WARNING_END_PAD
                } else {
                    0.0
                }
        }
        IslandPhase::Processing => {
            CHIP_H
                + 6.0
                + measure_text(window, "Processing…", HUD_TEXT, FontWeight::SEMIBOLD)
                + CHIP_PX
        }
        IslandPhase::Completed { inbox_count, .. } => {
            CHIP_H
                + 8.0
                + measure_text(
                    window,
                    &completed_status_label(inbox_count, completed_note, completed_issue),
                    HUD_TEXT,
                    FontWeight::SEMIBOLD,
                )
                + LEAD_TRAIL
                + divider
                + chip_width(window, "Paste", FontWeight::SEMIBOLD)
                + chip_width(window, "Inspect", FontWeight::MEDIUM)
                + CHIP_H
                + 3.0 * CHIP_GAP
        }
        IslandPhase::Hidden | IslandPhase::Dismissing => return ISLAND_H,
    };
    inner + 2.0 * ISLAND_INSET
}

#[derive(Clone, Debug, Eq, PartialEq)]
enum MenuAction {
    ToggleCapture,
    GiveFeedback,
    ChooseTarget,
    OpenLatest,
    OpenInbox(PathBuf),
    ExportVideo,
    Settings,
    CheckForUpdates,
    Quit,
}

/// A public issue form, never a URL containing a capture, transcript or local path.
fn feedback_issue_url() -> String {
    "https://github.com/tryapparent/apparent/issues/new?template=bug_report.yml".into()
}

/// Text beside the menu bar icon while a video export runs (`None` goes back to the inbox count).
static EXPORT_STATUS: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);
/// Remains visible beside the menu icon until the next recording; a failed capture has no paper tile.
static CAPTURE_STATUS: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);
static EXPORTING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

fn status_bar_text(export: Option<String>, capture: Option<String>) -> Option<String> {
    export.or(capture)
}

fn current_status_bar_text() -> Option<String> {
    let export = EXPORT_STATUS.lock().ok().and_then(|status| status.clone());
    let capture = CAPTURE_STATUS.lock().ok().and_then(|status| status.clone());
    // Linux retains the last export result in the menu. A capture failure must
    // still be visible when no export is running.
    #[cfg(target_os = "linux")]
    if !EXPORTING.load(std::sync::atomic::Ordering::Acquire) && capture.is_some() {
        return capture;
    }
    status_bar_text(export, capture)
}

fn refresh_status_bar(inbox_count: usize) {
    if let Some(text) = current_status_bar_text() {
        set_status_text(&text);
    } else {
        set_status_inbox_count(inbox_count);
    }
}

/// Export the newest bundle off the main thread. Linux asks for a destination;
/// macOS keeps its automatic Movies/Apparent destination. Report and reveal the result.
fn start_video_export() {
    use std::sync::atomic::Ordering;
    if EXPORTING.swap(true, Ordering::SeqCst) {
        return;
    }
    let say = |text: Option<String>| {
        if let Ok(mut status) = EXPORT_STATUS.lock() {
            *status = text;
        }
    };
    #[cfg(target_os = "linux")]
    say(Some("Choosing export destination…".into()));
    #[cfg(not(target_os = "linux"))]
    say(Some("Exporting…".into()));
    let spawned = std::thread::Builder::new()
        .name("apparent-export".into())
        .spawn(move || {
            let result = crate::handoff::load_bundle(std::path::Path::new("latest")).and_then(
                |(dir, bundle)| {
                    #[cfg(target_os = "linux")]
                    let out = match platform::choose_export_destination(
                        &crate::export::default_output(&dir),
                    )? {
                        Some(path) => Some(path),
                        None => return Ok(None),
                    };
                    #[cfg(not(target_os = "linux"))]
                    let out = None;
                    let options = crate::export::Options {
                        out,
                        background: true,
                        audio: crate::export::AudioPolicy::RecordedIfAvailable,
                        ..Default::default()
                    };
                    crate::export::export(&dir, &bundle, &options, &mut |fraction| {
                        say(Some(format!("Exporting {}%", (fraction * 100.0) as u32)));
                    })
                    .map(Some)
                },
            );
            match result {
                Ok(Some(exported)) => {
                    apparent_log(format!("Exported {}", crate::export::describe(&exported)));
                    say(Some("Exported".into()));
                    #[cfg(target_os = "linux")]
                    crate::linux::shell::notify(
                        "Video exported",
                        &format!("Saved {}", exported.path.display()),
                    );
                    let _ = crate::handoff::reveal_path(&exported.path);
                }
                Ok(None) => say(Some("Export cancelled".into())),
                Err(error) => {
                    apparent_log(format!("Video export failed: {error:#}"));
                    #[cfg(target_os = "linux")]
                    {
                        let detail = format!("{error:#}");
                        say(Some(format!(
                            "Export failed: {}",
                            detail.chars().take(120).collect::<String>()
                        )));
                        crate::linux::shell::notify("Video export failed", &detail);
                    }
                    #[cfg(not(target_os = "linux"))]
                    say(Some("Export failed".into()));
                }
            }
            #[cfg(not(target_os = "linux"))]
            {
                std::thread::sleep(Duration::from_secs(4));
                say(None);
            }
            EXPORTING.store(false, Ordering::SeqCst);
        });
    if let Err(error) = spawned {
        #[cfg(target_os = "linux")]
        {
            say(Some("Export failed: could not start worker; retry".into()));
            crate::linux::shell::notify(
                "Video export failed",
                &format!("Could not start export worker: {error}"),
            );
        }
        #[cfg(not(target_os = "linux"))]
        say(None);
        EXPORTING.store(false, Ordering::SeqCst);
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SelectionMode {
    Area,
    Window,
    /// The whole display the picker covers.
    Screen,
    Iphone,
}

impl SelectionMode {
    const ALL: [SelectionMode; 4] = [Self::Area, Self::Window, Self::Screen, Self::Iphone];

    fn key(self) -> &'static str {
        match self {
            Self::Area => "area",
            Self::Window => "window",
            Self::Screen => "screen",
            Self::Iphone => "iphone",
        }
    }

    fn from_key(key: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|mode| mode.key() == key.trim())
    }

    fn last_used_path() -> Option<PathBuf> {
        crate::handoff::builtin_captures_dir()
            .parent()
            .map(|dir| dir.join("last-mode"))
    }

    /// The mode the last recording used; the picker opens on it.
    fn load_last_used() -> Self {
        Self::last_used_path()
            .and_then(|path| std::fs::read_to_string(path).ok())
            .and_then(|text| Self::from_key(&text))
            .unwrap_or(Self::Area)
    }

    fn save_last_used(self) {
        if let Some(path) = Self::last_used_path() {
            let _ = std::fs::write(path, self.key());
        }
    }

    /// Modes shown in the HUD, in order; iPhone only while one is cabled.
    pub(crate) fn available(has_iphone: bool) -> &'static [SelectionMode] {
        // A cabled iPhone's screen is an AVFoundation capture device, which only macOS has.
        if has_iphone && cfg!(target_os = "macos") {
            &Self::ALL
        } else {
            &Self::ALL[..3]
        }
    }

    pub(crate) fn label(self) -> &'static str {
        match self {
            Self::Area => "Area",
            Self::Window => "Window",
            Self::Screen => "Screen",
            Self::Iphone => "iPhone",
        }
    }

    pub(crate) fn icon(self) -> &'static str {
        match self {
            Self::Area => crate::icons::AREA,
            Self::Window => crate::icons::WINDOW,
            Self::Screen => crate::icons::SCREEN,
            Self::Iphone => crate::icons::IPHONE,
        }
    }

    fn chip_id(self) -> &'static str {
        match self {
            Self::Area => "sel-area",
            Self::Window => "sel-window",
            Self::Screen => "sel-screen",
            Self::Iphone => "sel-iphone",
        }
    }

    /// Screen and iPhone need no pointer gesture, so the HUD offers a Record chip for them.
    pub(crate) fn shows_record(self) -> bool {
        matches!(self, Self::Screen | Self::Iphone)
    }

    /// `1`–`4` pick a mode by its position in the HUD.
    fn from_digit(key: &str, has_iphone: bool) -> Option<Self> {
        let index = key.parse::<usize>().ok()?.checked_sub(1)?;
        Self::available(has_iphone).get(index).copied()
    }

    /// The neighbouring mode in HUD order, wrapping at either end.
    fn cycled(self, forward: bool, has_iphone: bool) -> Self {
        let modes = Self::available(has_iphone);
        let Some(index) = modes.iter().position(|m| *m == self) else {
            return if forward {
                modes[0]
            } else {
                modes[modes.len() - 1]
            };
        };
        let next = if forward {
            (index + 1) % modes.len()
        } else {
            (index + modes.len() - 1) % modes.len()
        };
        modes[next]
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum IslandPhase {
    Hidden,
    Selecting {
        mode: SelectionMode,
    },
    Recording,
    Processing,
    Completed {
        finished_at: Instant,
        frame_count: usize,
        duration_ms: u64,
        /// Unhandled iPhone captures including this one; 0 for a local capture.
        inbox_count: usize,
    },
    Dismissing,
}

impl IslandPhase {
    fn trace_name(self) -> &'static str {
        match self {
            Self::Hidden => "hidden",
            Self::Selecting { .. } => "selecting",
            Self::Recording => "recording",
            Self::Processing => "processing",
            Self::Completed { .. } => "completed",
            Self::Dismissing => "dismissing",
        }
    }
}

enum CaptureSource {
    Screen {
        session: ScreenCaptureSession,
        audio: Option<AudioRecorder>,
        /// Screen mode only: which windows were where, for `apparent autocrop`.
        windows: Option<crate::windows::WindowLogger>,
    },
    /// The helper's mirror window records the phone's native video and the narration.
    Phone(PhoneSession),
    /// `apparent lab pill`: nothing is captured.
    Lab,
}

struct ActiveRecording {
    started: Instant,
    target: TargetInfo,
    bundle_dir: PathBuf,
    source: CaptureSource,
    _metal_overlay: Option<LaserOverlay>,
}

impl ActiveRecording {
    fn mic_warning(&self) -> Option<InputWarning> {
        match &self.source {
            CaptureSource::Screen {
                audio: Some(audio), ..
            } => audio.warning(),
            CaptureSource::Screen { audio: None, .. } => Some(InputWarning::Unavailable),
            CaptureSource::Phone(_) | CaptureSource::Lab => None,
        }
    }

    fn elapsed_ms(&self) -> u64 {
        match &self.source {
            CaptureSource::Screen { session, .. } => session.elapsed_ms(),
            CaptureSource::Phone(session) => session.elapsed_ms(),
            CaptureSource::Lab => self.started.elapsed().as_millis() as u64,
        }
    }
}

/// Shared coordinator owned by the GPUI app.
pub struct ApparentCoordinator {
    telemetry: Arc<SharedCaptureTelemetry>,
    whiteboard: Rc<RefCell<whiteboard::Board>>,
    active_recording: Option<ActiveRecording>,
    /// Identifies the recording whose finalization may update the current UI.
    capture_generation: u64,
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    agent_capture_id: Option<String>,
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    agent_captures: crate::agent_capture::Registry,
    #[cfg(target_os = "linux")]
    agent_finishing: bool,
    last_live_no_words: bool,
    playback: Option<crate::playback::Guard>,
    picker_metal_overlay: Option<LaserOverlay>,
    native_pill: Option<crate::native::pill::NativePill>,
    iphone_preview: Option<PhoneSession>,
    island_phase: IslandPhase,
    island_prev_phase: IslandPhase,
    /// `motion::now()` when the phase last changed.
    island_phase_since: f64,
    island_dismissed_from: IslandPhase,
    island_width: f32,
    island_target_width: f32,
    island_velocity: f32,
    island_scale: f32,
    island_scale_velocity: f32,
    island_y: f32,
    island_y_velocity: f32,
    island_opacity: f32,
    /// Which width spring the current morph uses.
    island_morph: Morph,
    /// Switch chips on a tap-started recording (`crate::shortcut::Reveal`).
    reveal: crate::shortcut::Reveal,
    /// When the chips last opened or folded, for the in-place swap of the trailing group.
    reveal_since: f64,
    /// The trailing group fading out after that change: `Some(true)` the chips, `Some(false)` the
    /// controls, `None` when the capsule opened straight into its state (nothing to swap).
    reveal_outgoing: Option<bool>,
    /// The chips were open when the island last changed phase, so a Recording capsule that is
    /// blurring out or dismissing keeps them.
    reveal_prev_chips: bool,
    /// macOS Reduce motion, read when a reveal starts.
    reduced_motion: bool,
    switch: Option<SwitchMorph>,
    /// When the springs were last advanced (`step_island`).
    island_stepped: Instant,
    /// A new capsule window has drawn its first frame and not its second (which comes late):
    /// only its frames advance the springs, so the hitch slows the opening instead of eating it.
    island_await_frame: bool,
    /// The recording clock last shown, so the lead keeps its time while it leaves.
    last_elapsed_ms: u64,
    /// The highlighted mode before the last change and when it changed (`HIGHLIGHT_FADE_S`).
    highlight_prev: Option<SelectionMode>,
    highlight_since: f64,
    selectable_windows: Vec<TargetInfo>,
    selection_generation: u64,
    windows_loading: bool,
    selection_pointer: Option<[f32; 2]>,
    hovered_window: Option<TargetInfo>,
    animated_window_rect: Option<[f32; 4]>,
    selection_drag: Option<([f32; 2], [f32; 2])>,
    /// Global frame of the display the picker covers, highlighted in `SelectionMode::Screen`.
    display_rect: [f32; 4],
    paste_drag_start: Option<[f32; 2]>,
    recording_shortcut_key: bool,
    review_bundle: Option<(PathBuf, ApparentBundle)>,
    /// Read the WAV once when selecting a bundle, never on the capsule's animation tick.
    review_audio_issue: Option<CompletedAudioIssue>,
    review_status: Option<String>,
    feedback_capture: bool,
    review_feedback: bool,
    selected_tab: ReviewTab,
    selected_keyframe: usize,
    /// A cabled iPhone, refreshed each time the picker opens.
    iphone: Option<PhoneDevice>,
    /// The bundle the Completed island is showing.
    completed_dir: Option<PathBuf>,
    /// The Completed island's lead text.
    completed_note: Option<String>,
    /// When this Mac last finished a capture, so ⌥⇧V prefers it over older inbox items.
    last_local_capture_ms: u64,
    inbox: crate::inbox::Inbox,
    /// The mode the last recording used; the picker opens on it.
    last_mode: SelectionMode,
    /// The picker opened on Area because the last recording was the iPhone and no phone had been
    /// seen yet: switch to the phone when discovery finds one, unless Kit picked a mode himself.
    open_iphone_when_found: bool,
    /// The welcome window, while it's open (`crate::onboarding`).
    onboarding: Option<crate::onboarding::Session>,
    onboarding_editor: crate::settings::Panel,
    /// The Settings window, while it's open (`crate::settings`).
    settings: Option<crate::settings::Session>,
    /// The last fresh read of what macOS has granted (at launch, then while onboarding is open).
    grants: Option<crate::onboarding::Grants>,
    /// Holds the permissions window until the shortcut's modifiers are up.
    gate: crate::onboarding::Gate,
    /// ⌥⇧S waiting for its keys to come up (`crate::shortcut`).
    shortcut: crate::shortcut::Shortcut,
    /// The modifiers held when the shortcut went down; releasing any of them starts the recording.
    hold_mods: u64,
    /// `apparent lab pill`: recordings are pretend (`CaptureSource::Lab`), the picker takes no
    /// input and opens no overlay, and nothing looks for windows or phones.
    lab: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ReviewTab {
    ContactSheet,
    Keyframes,
}



fn review_neighbor<'a>(
    history: &'a [PathBuf],
    current: &std::path::Path,
    older: bool,
) -> Option<&'a PathBuf> {
    let index = history.iter().position(|path| path == current)?;
    if older {
        history.get(index + 1)
    } else {
        index.checked_sub(1).and_then(|index| history.get(index))
    }
}

fn review_notice(
    history_error: Option<&str>,
    status: Option<&str>,
    feedback: bool,
) -> Option<String> {
    status
        .filter(|message| feedback || message.starts_with("Could not open capture:"))
        .map(str::to_owned)
        .or_else(|| history_error.map(|error| format!("Could not read captures: {error}")))
}

/// Pair the frame with its words; stack them when the window cannot fit both.
fn review_workspace_widths(window_width: f32) -> (f32, f32) {
    if window_width < 800.0 {
        ((window_width - 40.0).max(1.0), window_width)
    } else {
        let words = (window_width * 0.4).clamp(320.0, 520.0);
        ((window_width - words - 40.0).max(1.0), words)
    }
}

fn review_frame_speech<'a>(frames: &[Option<&'a str>], selected: usize) -> &'a str {
    frames
        .get(selected)
        .and_then(|said| *said)
        .filter(|said| !said.trim().is_empty())
        .unwrap_or("No words at this moment.")
}

fn review_speech_status(no_words: bool, missing_reason: Option<&str>) -> Option<String> {
    if let Some(reason) = missing_reason {
        Some(format!("Transcription unavailable: {reason}"))
    } else if no_words {
        Some("No words transcribed. Your audio was saved—check it or try again closer to the microphone.".into())
    } else {
        None
    }
}

/// A point dragged past the picker's display (global points), pulled back onto its edge: an
/// area belongs to the display the drag started on, which the picker stays on while dragging.
fn clamp_point([x, y]: [f32; 2], [dx, dy, dw, dh]: [f32; 4]) -> [f32; 2] {
    [x.clamp(dx, dx + dw), y.clamp(dy, dy + dh)]
}

/// A dragged area in global points, kept on the picker's `display` (so the cutout, the size
/// badge and the recording agree), if it's big enough to record.
fn area_rect(a: [f32; 2], b: [f32; 2], display: [f32; 4]) -> Option<[f64; 4]> {
    let [a, b] = [a, b].map(|p| clamp_point(p, display));
    let w = (a[0] - b[0]).abs();
    let h = (a[1] - b[1]).abs();
    (w >= MIN_AREA_SIDE && h >= MIN_AREA_SIDE)
        .then(|| [a[0].min(b[0]), a[1].min(b[1]), w, h].map(f64::from))
}

fn recording_pointer_destination(
    current: [f64; 4],
    pointer: [f64; 2],
    screens: &[crate::screens::Screen],
) -> Option<[f64; 4]> {
    if crate::screens::contains(current, pointer) {
        return None;
    }
    let frame = screens
        .get(crate::screens::index_at(screens, pointer)?)?
        .frame;
    ((0..4).any(|i| (frame[i] - current[i]).abs() >= 1.0)).then_some(frame)
}

fn clip_rect([x, y, w, h]: [f32; 4], [sw, sh]: [f32; 2]) -> [f32; 4] {
    let x0 = x.clamp(0.0, sw);
    let y0 = y.clamp(0.0, sh);
    let x1 = (x + w).clamp(0.0, sw);
    let y1 = (y + h).clamp(0.0, sh);
    [x0, y0, x1 - x0, y1 - y0]
}

/// Positions a badge of `size` relative to `rect`, keeping it fully on screen.
fn place_badge(
    [x, y, w, h]: [f32; 4],
    [bw, bh]: [f32; 2],
    [sw, sh]: [f32; 2],
    anchor: BadgeAnchor,
) -> [f32; 2] {
    let (bx, by) = match anchor {
        BadgeAnchor::BelowTrailing => {
            let below = y + h + BADGE_GAP;
            let above = y - BADGE_GAP - bh;
            let by = if below + bh <= sh - BADGE_MARGIN {
                below
            } else if above >= BADGE_MARGIN {
                above
            } else {
                y + h - BADGE_GAP - bh
            };
            (x + w - bw, by)
        }
        BadgeAnchor::Center => (x + (w - bw) / 2.0, y + (h - bh) / 2.0),
    };
    let max_x = (sw - BADGE_MARGIN - bw).max(BADGE_MARGIN);
    let max_y = (sh - BADGE_MARGIN - bh).max(BADGE_MARGIN);
    [
        bx.clamp(BADGE_MARGIN, max_x).round(),
        by.clamp(BADGE_MARGIN, max_y).round(),
    ]
}


// UI responsibilities share coordinator state without changing its public API.
mod coordinator;
mod selection;
mod island;
mod recording;
mod hud;
mod picker;
mod review;
mod window_host;
mod app;
#[cfg(test)]
mod tests;
pub use hud::HudPillWindow;
#[cfg(target_os = "linux")]
use hud::InputEqualizer;
#[cfg(test)]
use hud::SwitchLayout;
use hud::camera_cursor_badge;
pub use picker::TargetPickerWindow;
#[cfg(test)]
use picker::BADGE_H;
use picker::BADGE_GAP;
use picker::BADGE_MARGIN;
use picker::BadgeAnchor;
use picker::MIN_AREA_SIDE;
pub use review::BundleReviewWindow;
#[cfg(test)]
use review::split_timeline_line;
#[cfg(any(test, target_os = "macos"))]
use window_host::restore_picker_exclusion;
use window_host::open_picker_windows;

use window_host::ensure_hud_pill_open;
use window_host::close_picker_window;
use window_host::close_capture_windows;
use window_host::close_review_window;
use window_host::open_review_capture;
use window_host::open_review_window;
pub use app::run_start_benchmark;
pub use app::run_app;
pub(crate) use window_host::start_metric;
