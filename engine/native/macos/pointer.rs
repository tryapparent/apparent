use std::sync::atomic::Ordering;
use std::sync::{Arc, PoisonError};
use std::thread;
use std::time::{Duration, Instant};

use super::{
    CGEventGetFlags, CGEventGetLocation, CGEventSourceButtonState, CGPoint, EventRef,
    CGEventGetIntegerValueField, EVENT_FLAGS_CHANGED, EVENT_KEY_DOWN, EVENT_LEFT_MOUSE_DOWN,
    EVENT_RIGHT_MOUSE_DOWN, EVENT_SCROLL_WHEEL, EVENT_SYSTEM_DEFINED, EVENT_TAP_DISABLED_BY_TIMEOUT,
    EVENT_TAP_DISABLED_BY_USER_INPUT, KEYBOARD_EVENT_KEYCODE, FLAG_ALTERNATE, FLAG_COMMAND, FLAG_CONTROL, FLAG_SHIFT, SharedCaptureTelemetry, check_key_tap,
    current_mouse_location, modifier_flags, poll_clicks, track_shift_ink,
};

const MOUSE_MOVED: u32 = 5;
const LEFT_MOUSE_DRAGGED: u32 = 6;
const RIGHT_MOUSE_DRAGGED: u32 = 7;
const OTHER_MOUSE_DRAGGED: u32 = 27;
pub(super) const MOTION_MASK: u64 = (1 << MOUSE_MOVED)
    | (1 << LEFT_MOUSE_DRAGGED)
    | (1 << RIGHT_MOUSE_DRAGGED)
    | (1 << OTHER_MOUSE_DRAGGED);

pub(super) fn is_motion_event(kind: u32) -> bool {
    matches!(
        kind,
        MOUSE_MOVED | LEFT_MOUSE_DRAGGED | RIGHT_MOUSE_DRAGGED | OTHER_MOUSE_DRAGGED
    )
}

pub(super) fn invalidate_note_taps(telemetry: &SharedCaptureTelemetry, kind: u32, event: EventRef) {
    if !telemetry.has_note_editor() { return; }
    let blocked = match kind {
        EVENT_FLAGS_CHANGED => !matches!(unsafe { CGEventGetIntegerValueField(event, KEYBOARD_EVENT_KEYCODE) }, 56 | 60),
        EVENT_KEY_DOWN | EVENT_LEFT_MOUSE_DOWN | EVENT_RIGHT_MOUSE_DOWN | 25 | EVENT_SCROLL_WHEEL
        | EVENT_SYSTEM_DEFINED | EVENT_TAP_DISABLED_BY_TIMEOUT | EVENT_TAP_DISABLED_BY_USER_INPUT => true,
        _ => false,
    };
    if blocked { telemetry.block_note_tap(); }
}

pub(super) fn handle_motion_event(telemetry: &SharedCaptureTelemetry, event: EventRef) {
    if !telemetry.active.load(Ordering::Acquire) || !pure_shift(unsafe { CGEventGetFlags(event) }) {
        return;
    }
    let Ok(mut ink) = telemetry.shift_ink.try_lock() else {
        return;
    };
    let at = unsafe { CGEventGetLocation(event) };
    ink.motion(telemetry, modifier_flags(), (at.x, at.y));
}

const MOTION_FALLBACK_DELAY: Duration = Duration::from_millis(48);

#[derive(Default)]
pub(in crate::capture::engine::runtime) struct ShiftInk {
    await_release: bool,
    stroke: Option<StrokeMotion>,
    note: super::super::note_tap::NoteTap,
}

enum StrokeMotion {
    Tap {
        last: (f64, f64),
        missed_since: Option<Instant>,
    },
    Polling,
}

impl ShiftInk {
    fn motion(&mut self, telemetry: &SharedCaptureTelemetry, flags: u64, at: (f64, f64)) {
        if !matches!(self.stroke, Some(StrokeMotion::Polling))
            && !self.await_release
            && pure_shift(flags)
            && telemetry.active.load(Ordering::Acquire)
        {
            self.stroke = Some(StrokeMotion::Tap {
                last: at,
                missed_since: None,
            });
            self.sample(telemetry, at);
        }
    }

    fn poll(
        &mut self,
        telemetry: &SharedCaptureTelemetry,
        flags: u64,
        location: Option<CGPoint>,
        now: Instant,
    ) {
        if flags & FLAG_SHIFT == 0 {
            self.await_release = false;
        } else if !pure_shift(flags) {
            self.await_release = true;
        }
        if !telemetry.active.load(Ordering::Acquire) {
            self.stroke = None;
            self.note.reset();
            return;
        }
        let at = location.map(|at| (at.x, at.y));
        if self.await_release || flags & (FLAG_COMMAND | FLAG_CONTROL | FLAG_ALTERNATE) != 0 {
            self.note.reset();
        } else {
            super::super::observe_note_tap(&mut self.note, at, now, pure_shift(flags), telemetry);
        }
        if !pure_shift(flags) || self.await_release {
            if self.stroke.take().is_some() {
                track_shift_ink(telemetry, (0.0, 0.0), false, true);
            }
            return;
        }
        let Some(at) = location.map(|at| (at.x, at.y)) else {
            return;
        };
        match &mut self.stroke {
            Some(StrokeMotion::Tap { last, missed_since }) => {
                if telemetry.tap_live.load(Ordering::Acquire) {
                    if (at.0 - last.0).hypot(at.1 - last.1) <= 0.5 {
                        *missed_since = None;
                        return;
                    }
                    let since = *missed_since.get_or_insert(now);
                    if now.duration_since(since) < MOTION_FALLBACK_DELAY {
                        return;
                    }
                }
                self.stroke = Some(StrokeMotion::Polling);
            }
            None => {
                self.stroke = Some(if telemetry.tap_live.load(Ordering::Acquire) {
                    StrokeMotion::Tap {
                        last: at,
                        missed_since: None,
                    }
                } else {
                    StrokeMotion::Polling
                });
            }
            Some(StrokeMotion::Polling) => {}
        }
        self.sample(telemetry, at);
    }

    fn sample(&self, telemetry: &SharedCaptureTelemetry, at: (f64, f64)) {
        if telemetry.notes_editing.load(Ordering::Acquire)
            || !telemetry.contains_screen_point(at.0, at.1)
        {
            telemetry.shift_held.store(false, Ordering::Release);
        } else {
            track_shift_ink(telemetry, at, true, false);
        }
    }
}

fn pure_shift(flags: u64) -> bool {
    flags & (FLAG_SHIFT | FLAG_COMMAND | FLAG_CONTROL | FLAG_ALTERNATE) == FLAG_SHIFT
}

pub(super) fn run_hid_poller(telemetry: Arc<SharedCaptureTelemetry>) {
    let mut prev_buttons = [false; 2];
    let mut last_tap_check: Option<Instant> = None;
    loop {
        thread::sleep(Duration::from_millis(8));
        if last_tap_check.is_none_or(|at| at.elapsed() >= Duration::from_millis(500)) {
            check_key_tap(&telemetry);
            last_tap_check = Some(Instant::now());
        }

        let active = telemetry.active.load(Ordering::Acquire);
        let location = active.then(current_mouse_location).flatten();
        let flags = {
            let mut ink = telemetry
                .shift_ink
                .lock()
                .unwrap_or_else(PoisonError::into_inner);
            let flags = modifier_flags();
            ink.poll(&telemetry, flags, location, Instant::now());
            flags
        };
        let buttons = unsafe {
            [
                CGEventSourceButtonState(1, 0) || CGEventSourceButtonState(0, 0),
                CGEventSourceButtonState(1, 1) || CGEventSourceButtonState(0, 1),
            ]
        };
        if !active {
            prev_buttons = buttons;
            continue;
        }
        if let Some(at) = location {
            poll_clicks(
                &telemetry,
                &mut prev_buttons,
                buttons,
                (at.x, at.y),
                pure_shift(flags),
                |x, y| telemetry.on_capture_input_ui(x, y),
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::capture::engine::runtime::LiveOverlayEvent;
    use crate::shared::model::TargetFrame;

    #[test]
    fn motion_keeps_event_corners_and_poll_releases_the_stroke() {
        let (sender, _) = flume::unbounded();
        let telemetry = SharedCaptureTelemetry::new(sender);
        *telemetry.target_frame.lock().unwrap() = TargetFrame {
            x: 0.0,
            y: 0.0,
            width: 100.0,
            height: 100.0,
            scale: 1.0,
        };
        telemetry.active.store(true, Ordering::Release);
        telemetry.tap_live.store(true, Ordering::Release);
        let mut ink = ShiftInk::default();
        let now = Instant::now();
        ink.poll(
            &telemetry,
            FLAG_SHIFT,
            Some(CGPoint { x: 10.0, y: 10.0 }),
            now,
        );
        ink.motion(&telemetry, FLAG_SHIFT, (30.0, 20.0));
        ink.poll(
            &telemetry,
            FLAG_SHIFT,
            Some(CGPoint { x: 60.0, y: 70.0 }),
            now,
        );
        ink.motion(&telemetry, FLAG_SHIFT, (10.0, 30.0));
        ink.poll(&telemetry, 0, None, now);
        assert_eq!(
            telemetry.strokes.lock().unwrap()[0].normalized_points(),
            [[0.1, 0.1], [0.3, 0.2], [0.1, 0.3]]
        );
        assert!(!telemetry.shift_held.load(Ordering::Acquire));
        assert!(telemetry.live_ink.lock().unwrap().is_none());

        ink.poll(&telemetry, FLAG_SHIFT | FLAG_COMMAND, None, now);
        ink.motion(&telemetry, FLAG_SHIFT, (10.0, 30.0));
        assert!(telemetry.live_ink.lock().unwrap().is_none());

        ink.poll(&telemetry, 0, None, now);
        ink.motion(&telemetry, FLAG_SHIFT, (10.0, 10.0));
        let missed = Some(CGPoint { x: 60.0, y: 70.0 });
        ink.poll(&telemetry, FLAG_SHIFT, missed, now);
        ink.poll(&telemetry, FLAG_SHIFT, missed, now + MOTION_FALLBACK_DELAY);
        ink.motion(&telemetry, FLAG_SHIFT, (30.0, 30.0));
        ink.poll(&telemetry, 0, None, now + MOTION_FALLBACK_DELAY);
        assert_eq!(
            telemetry.strokes.lock().unwrap()[1].normalized_points(),
            [[0.1, 0.1], [0.6, 0.7]]
        );
    }

    #[test]
    fn two_quick_shift_taps_open_one_note() {
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
        telemetry.note_ui_pid.store(1, Ordering::Release);
        let mut ink = ShiftInk::default();
        let at = Some(CGPoint { x: -8_960.0, y: -8_960.0 });
        let now = Instant::now();
        ink.poll(&telemetry, FLAG_SHIFT, at, now);
        ink.poll(&telemetry, 0, at, now + Duration::from_millis(60));
        ink.poll(&telemetry, FLAG_SHIFT, at, now + Duration::from_millis(140));
        ink.poll(&telemetry, 0, at, now + Duration::from_millis(200));
        let notes = receiver
            .drain()
            .filter(|event| matches!(event, LiveOverlayEvent::Note { .. }))
            .count();
        assert_eq!(notes, 1);
    }

    #[test]
    fn two_slow_shift_presses_open_no_note() {
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
        telemetry.note_ui_pid.store(1, Ordering::Release);
        let mut ink = ShiftInk::default();
        let at = Some(CGPoint { x: -8_960.0, y: -8_960.0 });
        let now = Instant::now();
        ink.poll(&telemetry, FLAG_SHIFT, at, now);
        ink.poll(&telemetry, 0, at, now + Duration::from_millis(400));
        ink.poll(&telemetry, FLAG_SHIFT, at, now + Duration::from_millis(600));
        ink.poll(&telemetry, 0, at, now + Duration::from_millis(1_000));
        let notes = receiver
            .drain()
            .filter(|event| matches!(event, LiveOverlayEvent::Note { .. }))
            .count();
        assert_eq!(notes, 0);
    }
}
