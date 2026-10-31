use super::*;
use crate::capture::capture_size;
use crate::model::TargetInfo;

/// Clicks on `apparent-helper`'s windows (the SwiftUI capsule, Settings, onboarding) are
/// Apparent's own, except on the iPhone mirror, which is what's being recorded.
#[test]
fn helper_windows_are_apparent_s_except_the_capture_source() {
    let (sender, _receiver) = flume::unbounded();
    let telemetry = SharedCaptureTelemetry::new(sender);
    let window = |id, pid, bounds| crate::windows::RawWindow {
        id,
        pid,
        owner: String::new(),
        title: String::new(),
        bounds,
        layer: 0,
        alpha: 1.0,
    };
    let own = std::process::id() as i32;
    let (settings, mirror, app) = (own + 1, own + 2, own + 3);
    let windows = [
        window(1, own, [0.0, 0.0, 1728.0, 1117.0]), // the ink overlay, click-through
        window(2, settings, [100.0, 100.0, 600.0, 400.0]),
        window(3, mirror, [1300.0, 100.0, 300.0, 650.0]),
        window(4, app, [0.0, 0.0, 1728.0, 1117.0]),
    ];
    telemetry.passthrough_window_ids.lock().unwrap().push(1);
    telemetry.set_capture_source_pid(mirror as u32);
    let helper = |pid| pid == settings || pid == mirror;
    let at = |x, y| telemetry.apparent_window_in(&windows, x, y, helper);
    assert!(at(300.0, 300.0), "Settings");
    assert!(!at(1400.0, 400.0), "the iPhone mirror");
    assert!(!at(1000.0, 900.0), "the app under the ink overlay");
    telemetry.set_capture_source_pid(0);
    assert!(at(1400.0, 400.0), "a helper that isn't the source");
}

/// Kit's Screen capture on the Pro: the old listen-only event tap was off (no Input
/// Monitoring), so his clicks on OpenCode's composer never reached the bundle. Clicks now
/// come from the mouse monitor; polled button state stands in if it couldn't be installed.
#[test]
fn clicks_are_recorded_from_polled_buttons_while_the_mouse_monitor_is_missing() {
    let (sender, _receiver) = flume::unbounded();
    let telemetry = SharedCaptureTelemetry::new(sender);
    telemetry.reset_for_session(TargetFrame {
        x: 0.0,
        y: 0.0,
        width: 1728.0,
        height: 1117.0,
        scale: 2.0,
    });
    assert!(!telemetry.mouse_live.load(Ordering::Acquire));
    let mut prev = [false; 2];
    let not_apparent = |_: f64, _: f64| false;
    let composer = (778.0, 1050.0);
    // A ⇧-click is a pin, not a click.
    poll_clicks(
        &telemetry,
        &mut prev,
        [true, false],
        composer,
        true,
        not_apparent,
    );
    poll_clicks(
        &telemetry,
        &mut prev,
        [false, false],
        composer,
        true,
        not_apparent,
    );
    // A click on the composer.
    poll_clicks(
        &telemetry,
        &mut prev,
        [true, false],
        composer,
        false,
        not_apparent,
    );
    poll_clicks(
        &telemetry,
        &mut prev,
        [true, false],
        composer,
        false,
        not_apparent,
    );
    poll_clicks(
        &telemetry,
        &mut prev,
        [false, false],
        composer,
        false,
        not_apparent,
    );
    // Then the stop button, which is Apparent's own.
    let stop = (860.0, 20.0);
    poll_clicks(&telemetry, &mut prev, [true, false], stop, false, |_, _| {
        true
    });
    poll_clicks(
        &telemetry,
        &mut prev,
        [false, false],
        stop,
        false,
        |_, _| true,
    );
    // While the mouse monitor is installed it reports clicks itself.
    telemetry.mouse_live.store(true, Ordering::Release);
    poll_clicks(
        &telemetry,
        &mut prev,
        [true, false],
        composer,
        false,
        not_apparent,
    );
    poll_clicks(
        &telemetry,
        &mut prev,
        [false, false],
        composer,
        false,
        not_apparent,
    );

    let (events, _) = telemetry.finish_session();
    assert_eq!(events.len(), 1, "{events:?}");
    let InteractionEvent::Click { x, y, button, .. } = &events[0] else {
        panic!("{events:?}");
    };
    assert!(
        (x - 0.45).abs() < 0.01 && (y - 0.94).abs() < 0.01,
        "{x}, {y}"
    );
    assert_eq!(button.as_deref(), Some("left"));
}

/// Clicks and ink on a display left of, right of or above the laptop normalize into that
/// display, and land on the recording's pixels at its own scale.
#[test]
fn input_on_an_external_display_normalizes_into_it() {
    let (sender, _receiver) = flume::unbounded();
    let telemetry = SharedCaptureTelemetry::new(sender);
    let left = [-1920.0, 37.0, 1920.0, 1080.0];
    let right = [1728.0, 0.0, 1920.0, 1080.0];
    let above = [0.0, -1440.0, 2560.0, 1440.0];
    let small_left = [-1280.0, -100.0, 1280.0, 800.0];
    let below = [0.0, 1117.0, 1920.0, 1080.0];
    // (display, scale, global point, expected normalized point, recording size)
    let cases = [
        // 1x displays are recorded at their own pixels
        (left, 1.0, [-960.0, 577.0], (0.5, 0.5), (1920, 1080)),
        (right, 1.0, [2208.0, 270.0], (0.25, 0.25), (1920, 1080)),
        (below, 1.0, [480.0, 1387.0], (0.25, 0.25), (1920, 1080)),
        // 2x ones at the 2560 px long edge
        (above, 2.0, [640.0, -360.0], (0.25, 0.75), (2560, 1440)),
        (small_left, 2.0, [-320.0, 500.0], (0.75, 0.75), (2560, 1600)),
    ];
    for (rect, scale, point, expected, size) in cases {
        let frame = crate::screens::with_scale(rect, scale);
        let target = TargetInfo {
            mode: CaptureMode::Display,
            app: None,
            bundle_id: None,
            window_title: None,
            window_id: None,
            display_id: 2,
            frame,
        };
        // Windows frames are pixels already and never upscaled.
        if cfg!(target_os = "macos") {
            assert_eq!(capture_size(&target, 2560.0), size, "{rect:?}");
        }
        telemetry.reset_for_session(frame);
        assert!(telemetry.contains_screen_point(point[0], point[1]));
        // The laptop's centre is outside this target.
        assert!(!telemetry.contains_screen_point(864.0, 558.0));
        let (nx, ny, fw, fh) = telemetry.normalize_point(point[0], point[1]);
        assert_eq!((nx, ny), expected, "{rect:?}");
        assert_eq!((fw, fh), (rect[2] as u32, rect[3] as u32));
        // A click there is recorded at those coordinates.
        telemetry.pointer_down(10, point[0], point[1]);
        telemetry.pointer_up(20, point[0], point[1], false);
        let (events, _) = telemetry.finish_session();
        assert!(
            matches!(events[..], [InteractionEvent::Click { x, y, .. }] if (x, y) == (nx, ny)),
            "{events:?}"
        );
    }
    // In recording pixels: the left 1x display's centre is (960, 540).
    let frame = crate::screens::with_scale([-1920.0, 37.0, 1920.0, 1080.0], 1.0);
    telemetry.reset_for_session(frame);
    let (nx, ny, _, _) = telemetry.normalize_point(-960.0, 577.0);
    assert_eq!((nx * 1920.0, ny * 1080.0), (960.0, 540.0));
    // Above 2x: (640, -360) is a quarter in → (640, 1080) px of 2560×1440.
    let frame = crate::screens::with_scale([0.0, -1440.0, 2560.0, 1440.0], 2.0);
    telemetry.reset_for_session(frame);
    let (nx, ny, _, _) = telemetry.normalize_point(640.0, -360.0);
    assert_eq!((nx * 2560.0, ny * 1440.0), (640.0, 1080.0));
    telemetry.finish_session();
}

fn session(width: f64, height: f64) -> Arc<SharedCaptureTelemetry> {
    let (sender, _receiver) = flume::unbounded();
    let telemetry = SharedCaptureTelemetry::new(sender);
    telemetry.reset_for_session(TargetFrame {
        x: 0.0,
        y: 0.0,
        width,
        height,
        scale: 2.0,
    });
    telemetry
}

#[test]
fn a_long_still_shift_press_drops_no_pin() {
    let down = (1_000, 10.0, 10.0);
    let slop = f64::from(CLICK_SLOP_PT);
    assert!(is_pin_click(down, (1_150, 14.0, 13.0)));
    assert!(is_pin_click(down, (1_000 + PIN_MAX_PRESS_MS, 10.0, 10.0)));
    assert!(!is_pin_click(down, (2_500, 10.0, 10.0)));
    assert!(!is_pin_click(down, (1_100, 10.0, 10.0 + slop)));
}

/// The poller draws ink while ⇧ is held. A ⇧-click after ink was drawn in the same hold is
/// part of the drawing: no pin, and the stroke carries on whole. A ⇧-click with nothing drawn
/// first (only its own jitter) drops a pin and leaves no stroke.
#[test]
fn a_shift_click_mid_drawing_drops_no_pin() {
    let telemetry = session(1000.0, 1000.0);
    let ink = |pts: &[(i32, i32, i32)]| Stroke {
        t0: 0,
        t1: 0,
        fw: 1000,
        fh: 1000,
        on: None,
        pin: None,
        laser: false,
        pts: pts.iter().flat_map(|&(x, y, t)| [x, y, t]).collect(),
    };
    let press = telemetry.elapsed_ms() + 50;
    let p = press as i32;
    let s = SCALE;
    // A line drawn while ⇧ was held, then a click at its end.
    let line = ink(&[
        (s / 10, s / 2, 0),
        (s / 5, s / 2, p - 20),
        (s / 5 + s / 500, s / 2, p + 5),
    ]);
    *telemetry.live_ink.lock().unwrap() = Some(line.clone());
    telemetry.shift_down(press, 200.0, 500.0);
    assert!(telemetry.shift_up(press + 80, 201.0, 500.0));
    assert_eq!(telemetry.live_ink.lock().unwrap().as_ref(), Some(&line));
    // Letting go of ⇧ commits it as one stroke.
    let at = (200.0, 500.0);
    track_shift_ink(&telemetry, at, false, true);

    // Drawn long before the press still counts: the hold is a drawing.
    *telemetry.live_ink.lock().unwrap() = Some(ink(&[(s / 10, s / 10, 0), (s / 5, s / 10, 1)]));
    let t = telemetry.elapsed_ms() + 5_000;
    telemetry.shift_down(t, 200.0, 100.0);
    assert!(telemetry.shift_up(t + 60, 200.0, 100.0));
    *telemetry.live_ink.lock().unwrap() = None;

    // A ⇧-click with only its own few points of jitter is a pin.
    let jitter = ink(&[(s / 2, s / 2, 0), (s / 2 + 2, s / 2, 30)]);
    *telemetry.live_ink.lock().unwrap() = Some(jitter);
    let t = telemetry.elapsed_ms();
    telemetry.shift_down(t, 500.0, 500.0);
    assert!(telemetry.shift_up(t + 60, 500.0, 500.0));
    assert!(telemetry.live_ink.lock().unwrap().is_none());

    let (events, strokes) = telemetry.finish_session();
    assert!(events.is_empty(), "{events:?}");
    let kinds: Vec<_> = strokes.iter().map(|s| (s.pin, s.pts.len() / 3)).collect();
    assert_eq!(kinds, vec![(None, 3), (Some(1), 1)]);
}

#[test]
fn shift_clicks_drop_pins_from_polled_buttons_too() {
    let telemetry = session(1000.0, 1000.0);
    let mut prev = [false; 2];
    // ⇧-clicks at a point, the second on Apparent's own window.
    for (at, on_apparent) in [((250.0, 750.0), false), ((400.0, 400.0), true)] {
        for buttons in [[true, false], [false, false]] {
            poll_clicks(&telemetry, &mut prev, buttons, at, true, |_, _| on_apparent);
        }
    }
    let (events, strokes) = telemetry.finish_session();
    assert!(events.is_empty(), "{events:?}");
    assert_eq!(strokes.len(), 1);
    assert_eq!(strokes[0].pin, Some(1));
    assert_eq!(strokes[0].normalized_points(), vec![[0.25, 0.75]]);
}
