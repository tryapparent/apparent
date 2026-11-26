fn shortcut_event(
    telemetry: &SharedCaptureTelemetry,
    kind: u32,
    key: u16,
    flags: u64,
    repeat: bool,
) {
    shortcut_event_with_focus(telemetry, kind, key, flags, repeat, |_| false);
}

fn shortcut_event_with_focus(
    telemetry: &SharedCaptureTelemetry,
    kind: u32,
    key: u16,
    flags: u64,
    repeat: bool,
    focused: impl FnOnce(i32) -> bool,
) {
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
        assert_eq!(
            handle_key_tap_event(
                kind,
                event,
                std::ptr::from_ref(telemetry).cast_mut().cast(),
                focused
            ),
            event
        );
        CFRelease(event.cast());
    }
}

fn option_telemetry() -> (
    Arc<SharedCaptureTelemetry>,
    flume::Receiver<LiveOverlayEvent>,
) {
    let (sender, receiver) = flume::unbounded();
    let telemetry = SharedCaptureTelemetry::new(sender);
    *telemetry.shortcut.lock().unwrap() = ShortcutConfig {
        key_code: 58,
        carbon_modifiers: 0,
        label: "Option".into(),
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
            assert!(matches!(
                events.try_recv(),
                Ok(LiveOverlayEvent::CaptureShortcut)
            ));
            shortcut_event(&telemetry, EVENT_FLAGS_CHANGED, key, 0, false);
            assert!(events.is_empty(), "duplicate release must not toggle again");
        }
    }
}

#[test]
fn option_ignores_hid_only_power_key_state_and_still_blocks_held_keys() {
    for option_key in [58, 61] {
        assert!(!another_key_is_held(
            option_key,
            true,
            |_| false,
            |key| key == 127
        ));
        assert!(another_key_is_held(
            option_key,
            true,
            |_| false,
            |key| matches!(key, 15 | 127)
        ));
        assert!(another_key_is_held(
            option_key,
            true,
            |key| key == 127,
            |_| false
        ));
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
        assert!(
            events.is_empty(),
            "interrupted gesture: {kind}/{key}/{flags}"
        );
    }
    let (telemetry, events) = option_telemetry();
    shortcut_event(&telemetry, EVENT_FLAGS_CHANGED, 58, FLAG_ALTERNATE, false);
    pause_shortcuts(&telemetry, true);
    shortcut_event(&telemetry, EVENT_FLAGS_CHANGED, 58, FLAG_ALTERNATE, false);
    pause_shortcuts(&telemetry, false);
    shortcut_event(&telemetry, EVENT_FLAGS_CHANGED, 58, 0, false);
    assert!(
        events.is_empty(),
        "releasing the selected shortcut must not record"
    );
}

#[test]
fn default_fn_does_not_enable_option_or_change_its_release_gesture() {
    let (sender, events) = flume::unbounded();
    let telemetry = SharedCaptureTelemetry::new(sender);
    assert!(telemetry.shortcuts().0.is_fn_only());
    shortcut_event(&telemetry, EVENT_FLAGS_CHANGED, 58, FLAG_ALTERNATE, false);
    shortcut_event(&telemetry, EVENT_FLAGS_CHANGED, 58, 0, false);
    assert!(events.is_empty(), "Option is inactive until selected");
    shortcut_event(
        &telemetry,
        EVENT_FLAGS_CHANGED,
        63,
        FLAG_SECONDARY_FN,
        false,
    );
    for kind in [
        EVENT_LEFT_MOUSE_DOWN,
        EVENT_SCROLL_WHEEL,
        EVENT_SYSTEM_DEFINED,
    ] {
        shortcut_event(&telemetry, kind, 0, FLAG_SECONDARY_FN, false);
    }
    shortcut_event(&telemetry, EVENT_FLAGS_CHANGED, 63, 0, false);
    assert!(matches!(
        events.try_recv(),
        Ok(LiveOverlayEvent::CaptureShortcut)
    ));
}

#[test]
fn onboarding_selects_fn_after_release_from_the_current_focused_editor() {
    let (telemetry, events) = option_telemetry();
    let pid = 1234;
    let tap = |down, frontmost| {
        shortcut_event_with_focus(
            &telemetry,
            EVENT_FLAGS_CHANGED,
            MACOS_FN_KEY_CODE as u16,
            if down { FLAG_SECONDARY_FN } else { 0 },
            false,
            |target| target == frontmost,
        );
    };
    telemetry.shortcuts_paused.store(true, Ordering::Release);
    tap(true, pid);
    telemetry.set_onboarding_fn_editor(Some(pid));
    tap(false, pid);
    assert!(events.is_empty());

    tap(true, pid + 1);
    tap(false, pid);
    tap(true, pid);
    tap(false, pid + 1);
    tap(true, pid);
    shortcut_event(&telemetry, EVENT_KEY_DOWN, 15, FLAG_SECONDARY_FN, false);
    tap(false, pid);
    assert!(events.is_empty());

    tap(true, pid);
    assert!(events.is_empty());
    tap(false, pid);
    let LiveOverlayEvent::OnboardingFnSelected(generation) = events.try_recv().unwrap() else {
        panic!("Fn must select the shortcut without requesting capture");
    };
    assert!(telemetry.accepts_onboarding_fn(pid, generation, |target| target == pid));
    assert!(!telemetry.accepts_onboarding_fn(pid, generation, |_| false));
    telemetry.set_onboarding_fn_editor(None);
    telemetry.set_onboarding_fn_editor(Some(pid));
    assert!(!telemetry.accepts_onboarding_fn(pid, generation, |_| true));
    tap(false, pid);
    assert!(events.is_empty());
}
