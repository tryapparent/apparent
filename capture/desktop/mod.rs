pub(crate) mod demo;
#[cfg(target_os = "macos")]
pub(crate) mod helper;
// replacing Linux's in-process provider or claiming macOS permission acceptance.
#[cfg(all(test, target_os = "linux"))]
#[path = "helper.rs"]
mod mac_helper_contracts;
#[cfg(target_os = "linux")]
pub(crate) use linux::helper;
pub(crate) mod icons;
pub(crate) mod ingest_http;
#[cfg(not(target_os = "macos"))]
pub(crate) mod ink_view;
#[cfg(target_os = "linux")]
pub(crate) mod linux;
pub(crate) mod native;
pub(crate) mod playback;
pub(crate) mod settings;
#[cfg(target_os = "macos")]
pub(crate) mod sparkle;
pub(crate) mod ui;
pub(crate) mod web;
pub(crate) mod workflow;

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

// Desktop UI implementation and its platform adapters.
#[cfg(target_os = "macos")]
use ui::macos as platform;
#[cfg(target_os = "linux")]
use ui::linux as platform;
use ui::{desktop_completion, lab, motion, recording_completion, whiteboard};
#[cfg(target_os = "linux")]
pub(crate) use platform::set_app_icon;
use platform::{
    install_status_bar, reduce_motion, set_status_inbox_count,
    set_status_text,
};

use crate::capture::engine::runtime::audio::audio::{AudioRecorder, InputWarning};
use crate::capture::engine::runtime::{
    LiveOverlayEvent, ScreenCaptureSession, SharedCaptureTelemetry, apparent_log,
    current_mouse_screen, discover_start_target, install_global_hotkeys,
    list_selectable_windows, record_external_frontmost_app, region_target, selectable_window_at,
    shortcut_from_key_and_mods, start_global_input_tap, update_global_shortcut,
};
use crate::capture::desktop::helper::PhoneDevice;
#[cfg(target_os = "macos")]
use crate::capture::desktop::native::laser_overlay::MetalLaserOverlay as LaserOverlay;
#[cfg(target_os = "linux")]
use crate::capture::desktop::linux::overlay::InkOverlay as LaserOverlay;
use crate::shared::model::{ApparentBundle, CaptureMode, TargetFrame, TargetInfo, format_clock};
use crate::capture::engine::runtime::phone::PhoneSession;
use crate::capture::engine::sketch::timeline;

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

pub use ui::lab::{Options as LabOptions, Scene as LabScene, run as run_lab};
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

fn clock_template(clock: &str) -> String {
    clock
        .chars()
        .map(|c| if c.is_ascii_digit() { '0' } else { c })
        .collect()
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
    transcript: &crate::shared::model::TranscriptData,
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
    if bundle.context.get("microphoneCapture").is_some_and(|v| v == "off") { return None; }
    completed_audio_issue(
        bundle.source.as_deref(),
        &bundle.transcript,
        bundle.has_microphone_samples(dir),
    )
}

/// The switch chips' clock: the animation clock, so they stay open as long in slow motion
/// (`motion::time_scale`).
fn reveal_clock_ms() -> u64 {
    (motion::now() * 1000.0) as u64
}

#[derive(Clone, Debug, Eq, PartialEq)]
enum MenuAction {
    #[cfg(target_os = "linux")]
    Controls(Box<MenuAction>),
    ToggleCapture,
    ToggleMicrophone,
    #[cfg(not(target_os = "linux"))]
    ChooseTarget,
    OpenLatest,
    OpenInbox(PathBuf),
    ExportVideo,
    Settings,
    CheckForUpdates,
    Quit,
}

#[cfg(target_os = "linux")]
fn admit_controls_action(action: MenuAction, busy: bool) -> Option<MenuAction> {
    match action {
        MenuAction::Controls(action) if !busy => Some(*action),
        MenuAction::Controls(_) => None,
        action => Some(action),
    }
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
            let result = crate::shared::handoff::load_bundle(std::path::Path::new("latest")).and_then(
                |(dir, bundle)| {
                    #[cfg(target_os = "linux")]
                    let out = match platform::choose_export_destination(
                        &crate::capture::engine::export::default_output(&dir),
                    )? {
                        Some(path) => Some(path),
                        None => return Ok(None),
                    };
                    #[cfg(not(target_os = "linux"))]
                    let out = None;
                    let options = crate::capture::engine::export::Options {
                        out,
                        background: true,
                        audio: crate::capture::engine::export::AudioPolicy::RecordedIfAvailable,
                        ..Default::default()
                    };
                    crate::capture::engine::export::export(&dir, &bundle, &options, &mut |fraction| {
                        say(Some(format!("Exporting {}%", (fraction * 100.0) as u32)));
                    })
                    .map(Some)
                },
            );
            match result {
                Ok(Some(exported)) => {
                    apparent_log(format!("Exported {}", crate::capture::engine::export::describe(&exported)));
                    say(Some("Exported".into()));
                    #[cfg(target_os = "linux")]
                    crate::capture::desktop::linux::shell::notify(
                        "Video exported",
                        &format!("Saved {}", exported.path.display()),
                    );
                    let _ = crate::shared::handoff::reveal_path(&exported.path);
                }
                Ok(None) => say(Some("Export cancelled".into())),
                Err(error) => {
                    apparent_log(format!("Video export failed: {error:#}"));
                    workflow::error_reporting::report(workflow::error_reporting::Failure::VideoExport);
                    #[cfg(target_os = "linux")]
                    {
                        let detail = format!("{error:#}");
                        say(Some(format!(
                            "Export failed: {}",
                            detail.chars().take(120).collect::<String>()
                        )));
                        crate::capture::desktop::linux::shell::notify("Video export failed", &detail);
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
            crate::capture::desktop::linux::shell::notify(
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
    const ALL: [SelectionMode; 3] = [Self::Area, Self::Screen, Self::Iphone];

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
        crate::shared::handoff::builtin_captures_dir()
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
            &Self::ALL[..2]
        }
    }

    /// Screen and iPhone need no pointer gesture, so the HUD offers a Record chip for them.
    pub(crate) fn shows_record(self) -> bool {
        matches!(self, Self::Screen | Self::Iphone)
    }

    /// Digits pick a mode by its position in the HUD.
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

#[derive(Clone, Copy, Debug)]
pub enum PillAction {
    SelectMode(SelectionMode),
    RecordSelected,
    Cancel,
    Whiteboard,
    Notes,
    Finish,
    Paste(Option<[f32; 2]>),
    CopyLink,
    CopyPublicLink,
    Inspect,
    SettingsAgents,
    DismissCompleted,
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
}

enum CaptureSource {
    Screen {
        session: ScreenCaptureSession,
        audio: Option<AudioRecorder>,
        /// Screen mode only: which windows were where, for `apparent autocrop`.
        windows: Option<crate::shared::windows::WindowLogger>,
    },
    /// The helper's mirror window records the phone's native video and the narration.
    Phone(PhoneSession),
    /// `apparent lab pill`: nothing is captured.
    Lab,
}

struct ActiveRecording {
    performance: Option<workflow::performance::RecordingPerformance>,
    started: Instant,
    target: TargetInfo,
    bundle_dir: PathBuf,
    source: CaptureSource,
    _metal_overlay: Option<LaserOverlay>,
    microphone_enabled: bool,
}

impl ActiveRecording {
    fn mic_warning(&self) -> Option<InputWarning> {
        if !self.microphone_enabled { return None; }
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
    note_ui: Option<workflow::notes::Session>,
    admitted_microphone: Option<bool>,
    whiteboard: Rc<RefCell<whiteboard::Board>>,
    active_recording: Option<ActiveRecording>,
    capture_generation: u64,
    /// Prevent repeated publication callbacks from scheduling a second clipboard write.
    completion_pending: Option<u64>,
    capture_local_practice: bool,
    report_capture: bool,
    report_finalizing_generation: Option<u64>,
    recording_activity_attempted: bool,
    /// Media workers outlive their capsule and still own unfinished bundles.
    pending_finalizers: usize,
    stopping_source: Option<u64>,
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    agent_capture_id: Option<String>,
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    agent_captures: crate::capture::desktop::workflow::agent_capture::Registry,
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    public_share: crate::capture::desktop::workflow::public_sharing::Controller,
    #[cfg(target_os = "linux")]
    agent_finishing: bool,
    playback: Option<crate::capture::desktop::playback::Guard>,
    picker_metal_overlay: Option<LaserOverlay>,
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    electron_pill: Option<ui::electron_pill::Session>,
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    electron_pill_retry_at: Option<Instant>,
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    electron_pill_routed: bool,
    #[cfg(target_os="macos")]
    electron_pill_exclusions: Vec<u32>,
    #[cfg(target_os = "macos")]
    electron_pill_exclusion_wait: Option<Instant>,
    iphone_preview: Option<PhoneSession>,
    island_phase: IslandPhase,
    /// Switch chips on a tap-started recording (`crate::capture::desktop::settings::shortcut::Reveal`).
    reveal: crate::capture::desktop::settings::shortcut::Reveal,
    reduced_motion: bool,
    /// The recording clock last shown, so the lead keeps its time while it leaves.
    last_elapsed_ms: u64,
    selectable_windows: Vec<TargetInfo>,
    selection_generation: u64,
    windows_loading: bool,
    selection_pointer: Option<[f32; 2]>,
    hovered_window: Option<TargetInfo>,
    animated_window_rect: Option<[f32; 4]>,
    selection_drag: Option<([f32; 2], [f32; 2])>,
    /// Global frame of the display the picker covers, highlighted in `SelectionMode::Screen`.
    display_rect: [f32; 4],
    recording_shortcut_key: bool,
    review_bundle: Option<(PathBuf, ApparentBundle)>,
    /// Read the WAV once when selecting a bundle, never on the capsule's animation tick.
    review_audio_issue: Option<CompletedAudioIssue>,
    review_status: Option<String>,
    selected_tab: ReviewTab,
    selected_keyframe: usize,
    /// A cabled iPhone, refreshed each time the picker opens.
    iphone: Option<PhoneDevice>,
    /// The bundle the Completed island is showing.
    completed_dir: Option<PathBuf>,
    auto_paste: ui::desktop_completion::AutoPaste,
    /// The Completed island's lead text.
    completed_note: Option<String>,
    share_public: bool,
    share_online: bool,
    share_probe_at: Option<Instant>,
    share_pending: Option<(PathBuf, u64, std::sync::Arc<std::sync::atomic::AtomicBool>)>,
    share_waiting_account: bool,
    share_login: Option<std::sync::Arc<std::sync::atomic::AtomicBool>>,
    share_copied: Option<PathBuf>,
    /// When this Mac last finished a capture, so ⌥⇧V prefers it over older inbox items.
    last_local_capture_ms: u64,
    inbox: crate::capture::desktop::workflow::inbox::Inbox,
    /// The mode the last recording used; the picker opens on it.
    last_mode: SelectionMode,
    /// The picker opened on Area because the last recording was the iPhone and no phone had been
    /// seen yet: switch to the phone when discovery finds one, unless Kit picked a mode himself.
    open_iphone_when_found: bool,
    /// The welcome window, while it's open (`crate::onboarding`).
    onboarding: Option<crate::capture::desktop::settings::onboarding::Session>,
    onboarding_editor: crate::capture::desktop::settings::Panel,
    /// The Settings window, while it's open (`crate::settings`).
    settings: Option<crate::capture::desktop::settings::Session>,
    /// The last fresh read of what macOS has granted (at launch, then while onboarding is open).
    grants: Option<crate::capture::desktop::settings::onboarding::Grants>,
    /// Holds the permissions window until the shortcut's modifiers are up.
    gate: crate::capture::desktop::settings::onboarding::Gate,
    /// ⌥⇧S waiting for its keys to come up (`crate::shortcut`).
    shortcut: crate::capture::desktop::settings::shortcut::Shortcut,
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

// Textual modules preserve the coordinator’s existing privacy and item scope.
include!("coordinator/setup.rs");
include!("coordinator/recording.rs");
include!("coordinator/pill.rs");
include!("coordinator/review.rs");
include!("coordinator/windows.rs");
include!("coordinator/tests.rs");
