use super as platform;
use super::super::{LiveOverlayEvent, SCALE, SharedCaptureTelemetry, Stroke};
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

include!(concat!(env!("OUT_DIR"), "/note-gesture.rs"));

fn window_blocks_note(owned: bool, settings: bool) -> bool {
    BLOCKS_NOTE[usize::from(owned) | (usize::from(settings) << 1)]
}

#[derive(Default)]
pub(crate) struct NoteTap {
    press: Option<(Instant, (f64, f64), u64)>,
    previous: Option<(Instant, u64)>,
}

impl NoteTap {
    pub(crate) fn reset(&mut self) {
        self.press = None;
        self.previous = None;
    }

    pub(crate) fn is_pressed(&self) -> bool {
        self.press.is_some()
    }

    pub(crate) fn observe(
        &mut self,
        now: Instant,
        at: Option<(f64, f64)>,
        pure: bool,
        drew: bool,
        epoch: u64,
    ) -> Option<(f64, f64)> {
        match (pure, self.press) {
            (true, None) => {
                if let Some(at) = at {
                    self.press = Some((now, at, epoch));
                }
                None
            }
            (false, Some((down, down_at, down_epoch))) => {
                let up = at.unwrap_or(down_at);
                let moved = (up.0 - down_at.0).hypot(up.1 - down_at.1);
                let held = u64::try_from(now.saturating_duration_since(down).as_millis())
                    .unwrap_or(u64::MAX);
                self.press = None;
                let clean = !drew && down_epoch == epoch;
                let within_hold = held <= HOLD_MS;
                let within_movement = moved < POINTER_LIMIT;
                let within_pair = self.previous.is_some_and(|(previous, previous_epoch)| {
                    previous_epoch == epoch
                        && now.saturating_duration_since(previous) <= Duration::from_millis(PAIR_MS)
                });
                let index = usize::from(clean)
                    | (usize::from(within_hold) << 1)
                    | (usize::from(within_movement) << 2)
                    | (usize::from(within_pair) << 3);
                let result = RELEASE[index];
                self.previous = (result == 1).then_some((now, epoch));
                (result == 2).then_some(up)
            }
            _ => None,
        }
    }
}

impl SharedCaptureTelemetry {
    pub(in crate::capture::engine::runtime) fn apparent_window_in(
        &self,
        windows: &[crate::shared::windows::RawWindow],
        x: f64,
        y: f64,
        is_helper: impl Fn(i32) -> bool,
    ) -> bool {
        self.apparent_window_in_for(windows, x, y, is_helper, false)
    }

    fn note_blocked_by_window(&self, x: f64, y: f64) -> bool {
        let windows = platform::input_windows(self.note_ui_pid.load(Ordering::Acquire) as u32);
        self.apparent_window_in_for(&windows, x, y, platform::is_helper_process, true)
    }

    pub(in crate::capture::engine::runtime) fn apparent_window_in_for(
        &self,
        windows: &[crate::shared::windows::RawWindow],
        x: f64,
        y: f64,
        is_helper: impl Fn(i32) -> bool,
        placing_note: bool,
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
            let owned = pid == own || (note_pid > 0 && u64::try_from(pid).ok() == Some(note_pid))
                || (pid != source && (crate::capture::ui_process::owns(pid) || is_helper(pid)));
            if placing_note {
                window_blocks_note(owned, owned && crate::capture::ui_process::owns_settings(pid))
            } else {
                owned
            }
        })
    }


    pub(crate) fn has_note_editor(&self) -> bool {
        self.note_ui_pid.load(Ordering::Acquire) != 0
    }

    pub(crate) fn block_note_tap(&self) {
        self.note_tap_epoch.fetch_add(1, Ordering::AcqRel);
    }

    pub(crate) fn note_tap_epoch(&self) -> u64 {
        self.note_tap_epoch.load(Ordering::Acquire)
    }

    pub(in crate::capture::engine::runtime) fn place_note(
        &self,
        t0: u64,
        t_ms: u64,
        x0: f64,
        y0: f64,
    ) {
        let (nx, ny, fw, fh) = self.normalize_point(x0, y0);
        let mut strokes = self
            .strokes
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let number = self.next_note_pin.fetch_add(1, Ordering::AcqRel) as u32 + 1;
        strokes.push(Stroke {
            color: Some(crate::shared::handoff::pen::rgb()),
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
        #[cfg(target_os = "linux")]
        if self.probing() && self.capture_mode.load(Ordering::Acquire) <= 1 {
            crate::capture::engine::accessibility::ax::Prober::shared().pin(number, t0, t_ms, x0, y0);
        }
        let _ = self.ui_sender.try_send(LiveOverlayEvent::Note {
            pin: number,
            t: t0,
            x: nx,
            y: ny,
            screen_x: x0,
            screen_y: y0,
        });
        self.window_log_request.store(true, Ordering::Release);
        let _ = self.ui_sender.try_send(LiveOverlayEvent::RequestSnapshot);
    }

    pub(crate) fn request_note_at(&self, t_ms: u64, screen_x: f64, screen_y: f64) -> bool {
        if self.active.load(Ordering::Acquire)
            && self.has_note_editor()
            && !self.notes_editing.load(Ordering::Acquire)
            && self.contains_screen_point(screen_x, screen_y)
            && !self.note_blocked_by_window(screen_x, screen_y)
        {
            self.place_note(t_ms, t_ms, screen_x, screen_y);
            return true;
        }
        false
    }
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
pub(crate) fn observe_note_tap(
    tap: &mut NoteTap,
    at: Option<(f64, f64)>,
    now: std::time::Instant,
    pure: bool,
    telemetry: &SharedCaptureTelemetry,
) -> bool {
    use std::sync::atomic::Ordering;
    if !telemetry.has_note_editor() || telemetry.notes_editing.load(Ordering::Acquire) {
        tap.reset();
        return false;
    }
    if !pure && !tap.is_pressed() {
        return false;
    }
    if at.is_none_or(|(x, y)| !telemetry.contains_screen_point(x, y)) {
        tap.reset();
        return false;
    }
    let drew = !pure && tap.is_pressed()
        && telemetry.live_ink.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
            .as_ref().is_some_and(super::super::is_real_ink);
    if let Some((x, y)) = tap.observe(now, at, pure, drew, telemetry.note_tap_epoch()) {
        return telemetry.request_note_at(telemetry.elapsed_ms(), x, y);
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn separate_settings_window_is_owned_only_while_its_exact_child_is_alive() {
        use crate::capture::ui_process::UiChild;
        let (sender, _receiver) = flume::unbounded();
        let telemetry = SharedCaptureTelemetry::new(sender);
        let spawn = || std::process::Command::new("sh").args(["-c", "exec sleep 30"]).spawn().unwrap();
        let raw = spawn();
        let pid = raw.id() as i32;
        let windows = [crate::shared::windows::RawWindow {
            id: 42, pid, owner: "Electron".into(), title: "Apparent Settings".into(),
            bounds: [0.0, 0.0, 600.0, 400.0], layer: 0, alpha: 1.0,
        }];
        let at = || telemetry.apparent_window_in(&windows, 100.0, 100.0, |_| false);
        assert!(!at(), "an unregistered Electron process is not ours");
        let mut child = UiChild::settings(raw);
        assert!(at(), "the separate Settings window excludes presses and scrolls");
        let placement = |windows: &[crate::shared::windows::RawWindow]| {
            telemetry.apparent_window_in_for(windows, 100.0, 100.0, |_| false, true)
        };
        assert!(!placement(&windows));
        let mut control = windows[0].clone();
        control.pid = std::process::id() as i32;
        assert!(placement(&[control, windows[0].clone()]));
        telemetry.set_capture_source_pid(pid as u32);
        assert!(!at(), "explicit capture sources retain their interaction telemetry");
        telemetry.set_capture_source_pid(0);
        child.kill().unwrap();
        child.wait().unwrap();
        assert!(!at(), "a reaped PID is not owned even before its registration is dropped");
        let next = spawn();
        let next_pid = next.id() as i32;
        let mut next = UiChild::new(next);
        drop(child);
        assert!(crate::capture::ui_process::owns(next_pid), "old cleanup cannot retire a new session");
        next.kill().unwrap();
        next.wait().unwrap();
        drop(next);
        assert!(!crate::capture::ui_process::owns(next_pid));
    }

    fn base() -> Instant {
        Instant::now()
    }

    #[cfg(any(target_os = "linux", target_os = "macos"))]
    #[test]
    fn double_tap_uses_the_active_note_editor() {
        use crate::shared::model::TargetFrame;
        let (sender, receiver) = flume::unbounded();
        let telemetry = SharedCaptureTelemetry::new(sender);
        *telemetry.target_frame.lock().unwrap() = TargetFrame {
            x: -9_000.0,
            y: -9_000.0,
            width: 100.0,
            height: 100.0,
            scale: 1.0,
        };
        telemetry.active.store(true, Ordering::Release);
        let mut tap = NoteTap::default();
        let at = Some((-8_960.0, -8_960.0));
        let now = base();
        let mut double_tap = |start| {
            for (offset, pure) in [(0, true), (60, false), (140, true), (200, false)] {
                super::super::observe_note_tap(
                    &mut tap, at, start + Duration::from_millis(offset), pure, &telemetry,
                );
            }
        };
        double_tap(now);
        assert!(receiver.is_empty());

        telemetry.note_ui_pid.store(1, Ordering::Release);
        double_tap(now + Duration::from_millis(300));
        let notes = receiver
            .drain()
            .filter(|event| matches!(event, LiveOverlayEvent::Note { .. }))
            .count();
        assert_eq!(notes, 1);
    }

    #[test]
    fn two_quick_taps_open_one_note_at_the_pointer() {
        let mut tap = NoteTap::default();
        let t0 = base();
        assert_eq!(tap.observe(t0, Some((10.0, 10.0)), true, false, 0), None);
        assert_eq!(
            tap.observe(
                t0 + Duration::from_millis(60),
                Some((10.0, 10.0)),
                false,
                false,
                0
            ),
            None
        );
        assert_eq!(
            tap.observe(
                t0 + Duration::from_millis(140),
                Some((30.0, 40.0)),
                true,
                false,
                0
            ),
            None
        );
        assert_eq!(
            tap.observe(
                t0 + Duration::from_millis(200),
                Some((30.0, 40.0)),
                false,
                false,
                0
            ),
            Some((30.0, 40.0))
        );
    }

    #[test]
    fn a_key_between_taps_cancels_the_note() {
        let mut tap = NoteTap::default();
        let t0 = base();
        tap.observe(t0, Some((10.0, 10.0)), true, false, 0);
        tap.observe(
            t0 + Duration::from_millis(60),
            Some((10.0, 10.0)),
            false,
            false,
            0,
        );
        tap.observe(
            t0 + Duration::from_millis(140),
            Some((10.0, 10.0)),
            true,
            false,
            1,
        );
        assert_eq!(
            tap.observe(
                t0 + Duration::from_millis(200),
                Some((10.0, 10.0)),
                false,
                false,
                1
            ),
            None
        );
    }

    #[test]
    fn a_hold_or_a_drag_is_not_a_tap() {
        let mut tap = NoteTap::default();
        let t0 = base();
        tap.observe(t0, Some((10.0, 10.0)), true, false, 0);
        assert_eq!(
            tap.observe(
                t0 + Duration::from_millis(400),
                Some((10.0, 10.0)),
                false,
                false,
                0
            ),
            None
        );
        tap.observe(
            t0 + Duration::from_millis(500),
            Some((10.0, 10.0)),
            true,
            false,
            0,
        );
        assert_eq!(
            tap.observe(
                t0 + Duration::from_millis(560),
                Some((10.0, 40.0)),
                false,
                false,
                0
            ),
            None
        );
        tap.observe(
            t0 + Duration::from_millis(600),
            Some((10.0, 10.0)),
            true,
            true,
            0,
        );
        assert_eq!(
            tap.observe(
                t0 + Duration::from_millis(660),
                Some((10.0, 10.0)),
                false,
                true,
                0
            ),
            None
        );
    }
}
