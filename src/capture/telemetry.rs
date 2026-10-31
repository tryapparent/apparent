//! Desktop-facing input telemetry and UI events, not recorder session data.
//! Settings/onboarding, shortcut configuration, AX and page attribution stay here.
use std::sync::atomic::{AtomicBool, AtomicI32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use super::{
    ShortcutConfig, accessibility_granted, apparent_log, is_capture_shortcut, layout_s_keycode,
    platform,
};
use crate::model::{CaptureMode, InteractionEvent, SCALE, Stroke, TargetFrame};

/// Live UI events emitted by the global input monitor to drive Apparent's HUD & Review windows.
#[derive(Clone, Debug)]
pub enum LiveOverlayEvent {
    /// ⌥⇧S (or the configured shortcut) went down; `shortcut::Shortcut` decides what it means.
    CaptureShortcut,
    PasteLatestShortcut,
    UndoStroke,
    RequestSnapshot,
    /// The iPhone mirror ended on its own (unplugged, never found, or access denied).
    PhoneEnded,
    /// The welcome window: a button, fresh permission states, or the helper exiting.
    Onboarding(crate::onboarding::Event),
    /// The initial permission check is finished, including when grants are unavailable.
    OnboardingInitialized,
    /// The Settings window: an action, fresh permission states, or the helper exiting.
    Settings(crate::settings::Event),
}

/// Shared state collected by the global input monitor during an active capture session.
pub struct SharedCaptureTelemetry {
    pub active: AtomicBool,
    pub selecting: AtomicBool,
    pub shift_held: AtomicBool,
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
    /// The last `on_apparent_window` answer (when, where, what), reused for a burst of scrolls.
    apparent_hit: Mutex<Option<(Instant, f64, f64, bool)>>,
    /// macOS's key event tap (`CFMachPortRef`), made once Accessibility is on (`check_key_tap`).
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    pub(super) tap_port: AtomicU64,
    /// The key event tap thread's run loop (retained), so `check_key_tap` can stop it.
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    pub(super) tap_run_loop: AtomicU64,
    /// A key tap thread is being started.
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    pub(super) tap_starting: AtomicBool,
    /// When the last key tap was tried (ms since `UNIX_EPOCH`), to space out retries.
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    pub(super) tap_tried_ms: AtomicU64,
    /// Whether key presses are arriving (macOS's key tap, Windows' keyboard hook).
    pub(super) tap_live: AtomicBool,
    /// Esc went down since the UI loop last looked (`take_escape`).
    pub(super) escape_pressed: AtomicBool,
    /// A Screen recording started straight from the shortcut: the overlay flashes an edge glow.
    pub start_glow: AtomicBool,
    /// Clicks are arriving (macOS's global mouse monitor, Windows' mouse hook). Until then the
    /// poller records clicks from polled button state.
    pub(super) mouse_live: AtomicBool,
    last_shortcut_ms: AtomicU64,
    drag_start: Mutex<Option<(u64, f32, f32, Option<String>, TargetFrame)>>,
    /// The `agentContext` experiment was on when this capture started: clicks and strokes are
    /// looked up in the Accessibility tree (`crate::ax`, macOS only).
    agent_context: AtomicBool,
    /// A ⇧-press inside the target: when, where (global points) and on which frame.
    shift_press: Mutex<Option<(u64, f64, f64, TargetFrame)>>,
}

impl SharedCaptureTelemetry {
    pub fn new(ui_sender: flume::Sender<LiveOverlayEvent>) -> Arc<Self> {
        let shortcuts = crate::settings::Shortcuts::load();
        crate::settings::note_paste_label(&shortcuts.paste.label);
        Arc::new(Self {
            active: AtomicBool::new(false),
            selecting: AtomicBool::new(false),
            shift_held: AtomicBool::new(false),
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
            active_laser: Mutex::new(None),
            live_ink: Mutex::new(None),
            excluded_window_ids: Arc::new(Mutex::new(Vec::new())),
            window_log_request: Arc::new(AtomicBool::new(false)),
            ui_sender,
            passthrough_window_ids: Mutex::new(Vec::new()),
            capture_source_pid: AtomicI32::new(0),
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
        self.shift_held.store(false, Ordering::Release);
        self.window_log_request.store(false, Ordering::Release);
        let agent_context = crate::handoff::experiment(crate::handoff::AGENT_CONTEXT);
        self.agent_context.store(agent_context, Ordering::Release);
        if agent_context {
            crate::ax::Prober::shared().begin();
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
    pub(super) fn pointer_down(&self, t_ms: u64, screen_x: f64, screen_y: f64) {
        if !self.contains_screen_point(screen_x, screen_y) {
            return;
        }
        #[cfg(target_os = "macos")]
        {
            let raw = objc2::rc::autoreleasepool(|_| crate::windows::raw_windows());
            if crate::windows::system_prompt_at(&raw, screen_x, screen_y) {
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
            crate::ax::Prober::shared().probe(crate::ax::Target::Pointer(t_ms), screen_x, screen_y);
        }
    }

    /// A mouse button came up: records the click or drag that `pointer_down` began.
    pub(super) fn pointer_up(&self, t_ms: u64, screen_x: f64, screen_y: f64, right: bool) {
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
    pub(super) fn shift_down(&self, t_ms: u64, screen_x: f64, screen_y: f64) {
        if !self.contains_screen_point(screen_x, screen_y) {
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
    pub(super) fn shift_up(&self, t_ms: u64, screen_x: f64, screen_y: f64) -> bool {
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
        let number = strokes.iter().filter(|s| s.pin.is_some()).count() as u32 + 1;
        strokes.push(Stroke {
            t0,
            t1: t_ms,
            fw,
            fh,
            on: None,
            pin: Some(number),
            laser: false,
            pts: vec![
                (nx * SCALE as f32).round() as i32,
                (ny * SCALE as f32).round() as i32,
                0,
            ],
        });
        drop(strokes);
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

    /// Whether the topmost window at a global point is Apparent's own or a `apparent-helper`'s other
    /// than the capture source (ignoring the click-through ink overlay). Asked once per press, and
    /// for scrolls, which come in bursts at one point, at most every 250 ms.
    pub(super) fn on_apparent_window(&self, x: f64, y: f64) -> bool {
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
            &platform::raw_windows_now(),
            x,
            y,
            platform::is_helper_process,
        );
        *hit = Some((Instant::now(), x, y, on));
        on
    }

    fn apparent_window_in(
        &self,
        windows: &[crate::windows::RawWindow],
        x: f64,
        y: f64,
        is_helper: impl Fn(i32) -> bool,
    ) -> bool {
        let passthrough = self
            .passthrough_window_ids
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone();
        let own = std::process::id() as i32;
        let source = self.capture_source_pid.load(Ordering::Acquire);
        crate::windows::owned_window_at(windows, x, y, &passthrough, |pid| {
            pid == own || (pid != source && is_helper(pid))
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
            && ink.pts.len() >= 3
        {
            self.strokes
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .push(ink);
        }
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
            let hits = crate::ax::Prober::shared().finish();
            crate::ax::apply(&hits, &mut events, &mut strokes);
            if self.capture_mode.load(Ordering::Acquire) != 3 {
                let end = crate::now_epoch_ms();
                let start = end.saturating_sub(self.elapsed_ms());
                let page = crate::page::between(start, end);
                crate::page::apply(&page, start, &mut events, &mut strokes);
            }
        }
        (events, strokes)
    }
}

/// Clicks from the mouse buttons' polled state, while the mouse monitor (or hook) is missing: a
/// press starts a click (unless it lands on Apparent's own window), a release ends it. A ⇧-press may
/// be a pin, as in the mouse monitor's handler.
pub(super) fn poll_clicks(
    telemetry: &SharedCaptureTelemetry,
    prev: &mut [bool; 2],
    now: [bool; 2],
    (x, y): (f64, f64),
    pure_shift: bool,
    on_apparent: impl Fn(f64, f64) -> bool,
) {
    let was = std::mem::replace(prev, now);
    if telemetry.mouse_live.load(Ordering::Acquire) {
        return;
    }
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

/// One poll of the Shift ink: holding Shift alone and moving the cursor inside the capture
/// target draws a persistent stroke; letting go of Shift commits it. `pure_shift` is Shift
/// without other modifiers (and not left over from a chord such as the capture shortcut).
pub(super) fn track_shift_ink(
    telemetry: &SharedCaptureTelemetry,
    (x, y): (f64, f64),
    pure_shift: bool,
    prev_shift_ink: bool,
) {
    let inside_target = telemetry.contains_screen_point(x, y);
    if pure_shift && inside_target {
        telemetry.shift_held.store(true, Ordering::Release);
        let t_ms = telemetry.elapsed_ms();
        let (nx, ny, fw, fh) = telemetry.normalize_point(x, y);
        let sx = (nx * SCALE as f32).round() as i32;
        let sy = (ny * SCALE as f32).round() as i32;
        let mut guard = telemetry
            .live_ink
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
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
            pts: Vec::new(),
        });
        let dt = t_ms.saturating_sub(stroke.t0) as i32;
        let should_push = stroke.pts.chunks_exact(3).last().is_none_or(|prev| {
            let dx = (sx - prev[0]) as f32 / SCALE as f32 * fw as f32;
            let dy = (sy - prev[1]) as f32 / SCALE as f32 * fh as f32;
            dx.hypot(dy) >= 1.5
        });
        if should_push && stroke.pts.len() / 3 < 2_400 {
            stroke.pts.extend_from_slice(&[sx, sy, dt]);
            stroke.t1 = t_ms;
        }
    } else if !pure_shift && prev_shift_ink {
        telemetry.shift_held.store(false, Ordering::Release);
        if let Some(stroke) = telemetry
            .live_ink
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .take()
            // Ignore stationary Shift taps (e.g. typing a capital letter without moving the mouse).
            && is_real_ink(&stroke)
        {
            if telemetry.probing() {
                let frame = *telemetry
                    .target_frame
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner);
                if let Some((x, y)) = crate::ax::stroke_probe_point(&stroke, frame) {
                    crate::ax::Prober::shared().probe(crate::ax::Target::Stroke(stroke.t0), x, y);
                }
            }
            telemetry
                .strokes
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .push(stroke);
            let _ = telemetry
                .ui_sender
                .try_send(LiveOverlayEvent::RequestSnapshot);
        }
    }
}

#[cfg(test)]
#[path = "tests_telemetry.rs"]
mod tests;
