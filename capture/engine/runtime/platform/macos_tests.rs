#[cfg(test)]
mod tests {
    use super::*;
    use crate::shared::model::TargetFrame;

    // Feed real CoreGraphics events to the production callback without posting
    // input, installing an event tap, or capturing the machine's screen.
    fn shortcut_event(telemetry: &SharedCaptureTelemetry, kind: u32, key: u16, flags: u64, repeat: bool) {
        unsafe extern "C" {
            fn CGEventSetIntegerValueField(event: EventRef, field: u32, value: i64);
            fn CGEventSetType(event: EventRef, kind: u32);
        }
        let event = unsafe { CGEventCreateKeyboardEvent(ptr::null(), key, true) };
        assert!(!event.is_null());
        unsafe {
            CGEventSetType(event, kind);
            CGEventSetFlags(event, flags);
            CGEventSetIntegerValueField(event, KEYBOARD_EVENT_AUTOREPEAT, i64::from(repeat));
            assert_eq!(key_tap_callback(ptr::null_mut(), kind, event,
                std::ptr::from_ref(telemetry).cast_mut().cast()), event);
            CFRelease(event.cast());
        }
    }

    fn option_telemetry() -> (Arc<SharedCaptureTelemetry>, flume::Receiver<LiveOverlayEvent>) {
        let (sender, receiver) = flume::unbounded();
        let telemetry = SharedCaptureTelemetry::new(sender);
        *telemetry.shortcut.lock().unwrap() = ShortcutConfig {
            key_code: 58, carbon_modifiers: 0, label: "Option".into(),
        };
        (telemetry, receiver)
    }

    #[test]
    fn option_callback_triggers_on_either_release_and_can_finish_an_active_recording() {
        for key in [58, 61] {
            for active in [false, true] {
                let (telemetry, events) = option_telemetry();
                telemetry.active.store(active, Ordering::Release);
                shortcut_event(&telemetry, EVENT_FLAGS_CHANGED, key, FLAG_ALTERNATE, false);
                assert!(events.is_empty(), "press must wait for release");
                shortcut_event(&telemetry, EVENT_FLAGS_CHANGED, key, 0, false);
                assert!(matches!(events.try_recv(), Ok(LiveOverlayEvent::CaptureShortcut)));
                shortcut_event(&telemetry, EVENT_FLAGS_CHANGED, key, 0, false);
                assert!(events.is_empty(), "duplicate release must not toggle again");
            }
        }
    }

    #[test]
    fn option_ignores_hid_only_power_key_state_and_still_blocks_held_keys() {
        for option_key in [58, 61] {
            assert!(!another_key_is_held(option_key, true, |_| false, |key| key == 127));
            assert!(another_key_is_held(option_key, true, |_| false, |key| matches!(key, 15 | 127)));
            assert!(another_key_is_held(option_key, true, |key| key == 127, |_| false));
        }
        assert!(another_key_is_held(63, false, |_| false, |key| key == 127));
    }

    #[test]
    fn option_callback_cancels_chords_clicks_other_modifiers_and_paused_selection() {
        for (kind, key, flags, repeat) in [
            (EVENT_KEY_DOWN, 15, FLAG_ALTERNATE, false),
            (EVENT_KEY_DOWN, 15, FLAG_ALTERNATE, true),
            (EVENT_FLAGS_CHANGED, 56, FLAG_ALTERNATE | FLAG_SHIFT, false),
            (EVENT_FLAGS_CHANGED, 57, FLAG_ALTERNATE, false),
            (EVENT_LEFT_MOUSE_DOWN, 0, FLAG_ALTERNATE, false),
            (EVENT_RIGHT_MOUSE_DOWN, 0, FLAG_ALTERNATE, false),
            (25, 0, FLAG_ALTERNATE, false),
            (EVENT_SCROLL_WHEEL, 0, FLAG_ALTERNATE, false),
            (EVENT_SYSTEM_DEFINED, 0, FLAG_ALTERNATE, false),
        ] {
            let (telemetry, events) = option_telemetry();
            shortcut_event(&telemetry, EVENT_FLAGS_CHANGED, 58, FLAG_ALTERNATE, false);
            shortcut_event(&telemetry, kind, key, flags, repeat);
            shortcut_event(&telemetry, EVENT_FLAGS_CHANGED, 58, 0, false);
            assert!(events.is_empty(), "interrupted gesture: {kind}/{key}/{flags}");
        }
        let (telemetry, events) = option_telemetry();
        shortcut_event(&telemetry, EVENT_FLAGS_CHANGED, 58, FLAG_ALTERNATE, false);
        pause_shortcuts(&telemetry, true);
        shortcut_event(&telemetry, EVENT_FLAGS_CHANGED, 58, FLAG_ALTERNATE, false);
        pause_shortcuts(&telemetry, false);
        shortcut_event(&telemetry, EVENT_FLAGS_CHANGED, 58, 0, false);
        assert!(events.is_empty(), "releasing the selected shortcut must not record");
    }

    #[test]
    fn default_fn_does_not_enable_option_or_change_its_release_gesture() {
        let (sender, events) = flume::unbounded();
        let telemetry = SharedCaptureTelemetry::new(sender);
        assert!(telemetry.shortcuts().0.is_fn_only());
        shortcut_event(&telemetry, EVENT_FLAGS_CHANGED, 58, FLAG_ALTERNATE, false);
        shortcut_event(&telemetry, EVENT_FLAGS_CHANGED, 58, 0, false);
        assert!(events.is_empty(), "Option is inactive until selected");
        shortcut_event(&telemetry, EVENT_FLAGS_CHANGED, 63, FLAG_SECONDARY_FN, false);
        for kind in [EVENT_LEFT_MOUSE_DOWN, EVENT_SCROLL_WHEEL, EVENT_SYSTEM_DEFINED] {
            shortcut_event(&telemetry, kind, 0, FLAG_SECONDARY_FN, false);
        }
        shortcut_event(&telemetry, EVENT_FLAGS_CHANGED, 63, 0, false);
        assert!(matches!(events.try_recv(), Ok(LiveOverlayEvent::CaptureShortcut)));
    }

    #[test]
    fn shortcut_keys_are_named_by_the_layout_not_their_qwerty_position() {
        // Dvorak puts B where QWERTY has N (45) and T where QWERTY has K (40).
        let dvorak = |code: u16| match code {
            45 => Some('b'),
            40 => Some('t'),
            13 => Some(','),
            _ => None,
        };
        assert_eq!(key_name(45, dvorak).as_deref(), Some("B"));
        assert_eq!(key_name(40, dvorak).as_deref(), Some("T"));
        assert_eq!(key_name(13, dvorak).as_deref(), Some(","));
        // Keys that type nothing keep fixed names whatever the layout says.
        let odd = |_| Some('x');
        assert_eq!(key_name(36, odd).as_deref(), Some("↩"));
        assert_eq!(key_name(123, odd).as_deref(), Some("←"));
        assert_eq!(key_name(122, odd).as_deref(), Some("F1"));
        assert_eq!(key_name(53, odd).as_deref(), Some("Esc"));
    }

    #[test]
    fn shortcut_keys_fall_back_to_ansi_positions_without_a_layout() {
        let none = |_| None;
        assert_eq!(key_name(45, none).as_deref(), Some("N"));
        assert_eq!(key_name(17, none).as_deref(), Some("T"));
        assert_eq!(key_name(0, none).as_deref(), Some("A"));
        assert_eq!(key_name(47, none).as_deref(), Some("."));
        assert_eq!(key_name(29, none).as_deref(), Some("0"));
        assert_eq!(key_name(10, none), None);
        assert_eq!(key_name(200, none), None);
    }

    /// The mouse monitor's AppKit calls pass objc2's encoding checks (which debug builds, the
    /// installed app included, run on every message), and a monitored click is recorded.
    #[test]
    fn the_mouse_monitor_reads_cg_events_from_appkit_events() {
        use objc2::msg_send;
        use objc2::runtime::{AnyClass, AnyObject};
        let class = AnyClass::get(c"NSEvent").expect("NSEvent");
        let point = CGPoint { x: 100.0, y: 200.0 };
        let cg = unsafe { CGEventCreateMouseEvent(ptr::null(), EVENT_LEFT_MOUSE_DOWN, point, 0) };
        assert!(!cg.is_null());
        let event: Option<objc2::rc::Retained<AnyObject>> =
            unsafe { msg_send![class, eventWithCGEvent: cg.cast::<OpaqueCgEvent>()] };
        let event = event.expect("an NSEvent");
        let back: *mut OpaqueCgEvent = unsafe { msg_send![&*event, CGEvent] };
        assert!(!back.is_null());
        assert_eq!(unsafe { CGEventGetType(back.cast()) }, EVENT_LEFT_MOUSE_DOWN);

        let (sender, _receiver) = flume::unbounded();
        let telemetry = SharedCaptureTelemetry::new(sender);
        telemetry.reset_for_session(TargetFrame {
            x: 0.0,
            y: 0.0,
            width: 1000.0,
            height: 1000.0,
            scale: 2.0,
        });
        mouse_event(&telemetry, back.cast(), |_, _| false);
        let up = unsafe { CGEventCreateMouseEvent(ptr::null(), EVENT_LEFT_MOUSE_UP, point, 0) };
        mouse_event(&telemetry, up, |_, _| false);
        unsafe {
            CFRelease(up.cast());
            CFRelease(cg.cast());
        }
        let (events, _) = telemetry.finish_session();
        assert!(
            matches!(events[..], [InteractionEvent::Click { x, y, .. }] if (x - 0.1).abs() < 1e-3 && (y - 0.2).abs() < 1e-3),
            "{events:?}"
        );
        assert_eq!(MOUSE_MONITOR_MASK & (1 << EVENT_KEY_DOWN), 0, "keys need Accessibility");
    }

    /// A left click from the mouse monitor: down at `from` with `flags`, up at `to` with `up_flags`.
    fn click(t: &SharedCaptureTelemetry, from: (f64, f64), to: (f64, f64), flags: [u64; 2]) {
        for (kind, (x, y), flags) in [
            (EVENT_LEFT_MOUSE_DOWN, from, flags[0]),
            (EVENT_LEFT_MOUSE_UP, to, flags[1]),
        ] {
            let cg = unsafe { CGEventCreateMouseEvent(ptr::null(), kind, CGPoint { x, y }, 0) };
            assert!(!cg.is_null());
            unsafe { CGEventSetFlags(cg, flags) };
            mouse_event(t, cg, |_, _| false);
            unsafe { CFRelease(cg.cast()) };
        }
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

    /// Issue #9: ⇧-click is documented to drop a numbered pin, but the mouse monitor skipped
    /// every ⇧ press (as ink) and nothing else made pins, so none ever landed.
    #[test]
    fn a_shift_click_drops_numbered_pins_and_is_not_a_click() {
        let telemetry = session(1000.0, 1000.0);
        let shift = [FLAG_SHIFT; 2];
        // A few points of trackpad jitter.
        click(&telemetry, (100.0, 200.0), (103.0, 202.0), shift);
        click(&telemetry, (500.0, 500.0), (500.0, 500.0), shift);
        // ⇧ let go before the button still drops the pin.
        click(&telemetry, (700.0, 300.0), (700.0, 300.0), [FLAG_SHIFT, 0]);
        // A ⇧-drag is ink (the poller's), not a pin; ⇧ with ⌘ is neither.
        click(&telemetry, (100.0, 800.0), (300.0, 800.0), shift);
        let cmd_shift = [FLAG_SHIFT | FLAG_COMMAND; 2];
        click(&telemetry, (900.0, 900.0), (900.0, 900.0), cmd_shift);

        let (events, strokes) = telemetry.finish_session();
        let pins: Vec<_> = strokes
            .iter()
            .map(|s| (s.pin, s.normalized_points()[0]))
            .collect();
        assert_eq!(
            pins,
            vec![
                (Some(1), [0.1, 0.2]),
                (Some(2), [0.5, 0.5]),
                (Some(3), [0.7, 0.3])
            ]
        );
        let shape = crate::capture::engine::sketch::shape_of(&strokes[0]);
        assert_eq!(shape, crate::shared::model::Shape::Pin);
        // Only the ⌘⇧-click is an ordinary click.
        assert!(
            matches!(events[..], [InteractionEvent::Click { x, .. }] if (x - 0.9).abs() < 1e-3),
            "{events:?}"
        );
    }

    /// The helper's windows (the SwiftUI capsule's Finish, Settings, onboarding) reach the mouse
    /// monitor like another app's: 87 captures ended "clicked text “Finish”", with a keyframe and
    /// a ripple for it. Presses, ⇧-presses and scrolls there are dropped; the app's are kept.
    #[test]
    fn presses_and_scrolls_on_apparent_s_helper_windows_are_not_recorded() {
        unsafe extern "C" {
            fn CGEventSetType(event: EventRef, kind: u32);
            fn CGEventSetLocation(event: EventRef, at: CGPoint);
            fn CGEventSetIntegerValueField(event: EventRef, field: u32, value: i64);
        }
        let telemetry = session(1000.0, 1000.0);
        // Settings covers the right half.
        let on_apparent = |x: f64, _: f64| x >= 500.0;
        let send = |kind, (x, y), flags| {
            let cg = unsafe { CGEventCreateMouseEvent(ptr::null(), kind, CGPoint { x, y }, 0) };
            unsafe { CGEventSetFlags(cg, flags) };
            mouse_event(&telemetry, cg, on_apparent);
            unsafe { CFRelease(cg.cast()) };
        };
        let scroll = |(x, y)| {
            let cg = unsafe { CGEventCreate(ptr::null()) };
            unsafe {
                CGEventSetType(cg, EVENT_SCROLL_WHEEL);
                CGEventSetLocation(cg, CGPoint { x, y });
                CGEventSetIntegerValueField(cg, SCROLL_WHEEL_DELTA_AXIS_1, -3);
            }
            mouse_event(&telemetry, cg, on_apparent);
            unsafe { CFRelease(cg.cast()) };
        };
        for at in [(700.0, 100.0), (100.0, 100.0)] {
            send(EVENT_LEFT_MOUSE_DOWN, at, 0);
            send(EVENT_LEFT_MOUSE_UP, at, 0);
            send(EVENT_LEFT_MOUSE_DOWN, at, FLAG_SHIFT);
            send(EVENT_LEFT_MOUSE_UP, at, FLAG_SHIFT);
            scroll(at);
        }
        // A drag from the app that ends over Settings is still the app's.
        send(EVENT_LEFT_MOUSE_DOWN, (300.0, 500.0), 0);
        send(EVENT_LEFT_MOUSE_UP, (800.0, 500.0), 0);

        let (events, strokes) = telemetry.finish_session();
        assert!(
            matches!(
                events[..],
                [
                    InteractionEvent::Click { x: cx, .. },
                    InteractionEvent::Scroll { x: sx, .. },
                    InteractionEvent::Drag { x0, .. },
                ] if (cx - 0.1).abs() < 1e-3 && (sx - 0.1).abs() < 1e-3 && (x0 - 0.3).abs() < 1e-3
            ),
            "{events:?}"
        );
        let pins: Vec<_> = strokes.iter().map(|s| s.normalized_points()[0]).collect();
        assert_eq!(pins, vec![[0.1, 0.1]]);
    }

    #[test]
    fn helper_processes_are_known_by_their_executable() {
        let own = std::process::id() as i32;
        let exe = std::fs::canonicalize(std::env::current_exe().unwrap()).unwrap();
        assert_eq!(process_path(own), Some(exe));
        assert!(!is_helper_process(own));
        assert!(!is_helper_process(1), "launchd");
        assert_eq!(process_path(-1), None);
        let mut child = std::process::Command::new("/bin/sleep")
            .arg("30")
            .spawn()
            .unwrap();
        let path = process_path(child.id() as i32);
        let _ = child.kill();
        let _ = child.wait();
        assert_eq!(path, Some(PathBuf::from("/bin/sleep")));
    }

    #[test]
    fn the_mouse_monitor_installs_without_a_permission() {
        let (sender, _receiver) = flume::unbounded();
        assert!(install_mouse_monitor(SharedCaptureTelemetry::new(sender)));
    }
}
