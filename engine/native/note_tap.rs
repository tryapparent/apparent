use super::super::{LiveOverlayEvent, SCALE, SharedCaptureTelemetry, Stroke};
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

include!(concat!(env!("OUT_DIR"), "/note-gesture.rs"));

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

    pub(crate) fn request_note_at(&self, t_ms: u64, screen_x: f64, screen_y: f64) {
        if self.active.load(Ordering::Acquire)
            && self.has_note_editor()
            && !self.notes_editing.load(Ordering::Acquire)
            && self.contains_screen_point(screen_x, screen_y)
            && !self.on_capture_input_ui(screen_x, screen_y)
        {
            self.place_note(t_ms, t_ms, screen_x, screen_y);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
