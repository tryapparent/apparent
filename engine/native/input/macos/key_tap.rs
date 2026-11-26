const MACOS_LEGACY_POWER_KEY_CODE: u16 = 127;

fn another_key_is_held(
    gesture_keycode: u16,
    option_only: bool,
    combined_key_down: impl Fn(u16) -> bool,
    hid_key_down: impl Fn(u16) -> bool,
) -> bool {
    (0_u16..128).any(|key| {
        key != gesture_keycode
            && (combined_key_down(key)
                || ((!option_only || key != MACOS_LEGACY_POWER_KEY_CODE) && hid_key_down(key)))
    })
}

#[derive(Default)]
pub(crate) struct OnboardingFnEditor {
    pid: Option<i32>,
    generation: u64,
    candidate: bool,
}

pub(crate) fn is_frontmost(pid: i32) -> bool {
    objc2::rc::autoreleasepool(|_| {
        objc2_app_kit::NSWorkspace::sharedWorkspace()
            .frontmostApplication()
            .is_some_and(|app| app.processIdentifier() == pid)
    })
}

impl SharedCaptureTelemetry {
    fn emit_fn_shortcut(&self) {
        self.emit_capture_shortcut_after(400);
    }

    pub(crate) fn set_onboarding_fn_editor(&self, pid: Option<i32>) {
        let mut editor = self
            .onboarding_fn_editor
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if editor.pid != pid {
            editor.pid = pid;
            editor.generation += 1;
            editor.candidate = false;
        }
    }

    pub(crate) fn accepts_onboarding_fn(
        &self,
        pid: i32,
        generation: u64,
        focused: impl FnOnce(i32) -> bool,
    ) -> bool {
        let editor = self
            .onboarding_fn_editor
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        self.shortcuts_paused.load(Ordering::Acquire)
            && editor.generation == generation
            && editor.pid == Some(pid)
            && focused(pid)
    }

    fn cancel_onboarding_fn_gesture(&self) {
        self.onboarding_fn_editor
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .candidate = false;
    }

    fn observe_onboarding_fn(&self, keycode: u16, flags: u64, focused: impl FnOnce(i32) -> bool) {
        let mut editor = self
            .onboarding_fn_editor
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let Some(pid) = editor.pid else {
            return;
        };
        let is_fn = u32::from(keycode) == MACOS_FN_KEY_CODE;
        let other_modifiers =
            flags & (FLAG_COMMAND | FLAG_CONTROL | FLAG_ALTERNATE | FLAG_SHIFT) != 0;
        let other_key = is_fn
            && another_key_is_held(
                keycode,
                false,
                |key| unsafe { CGEventSourceKeyState(0, key) },
                |key| unsafe { CGEventSourceKeyState(1, key) },
            );
        let paused = !self.shortcuts_paused.load(Ordering::Acquire) || (is_fn && !focused(pid));
        let (candidate, selected) = fn_gesture_transition(
            editor.candidate,
            is_fn,
            flags & FLAG_SECONDARY_FN != 0,
            other_key,
            other_modifiers,
            paused,
        );
        editor.candidate = candidate;
        if selected {
            let _ = self
                .ui_sender
                .try_send(LiveOverlayEvent::OnboardingFnSelected(editor.generation));
        }
    }
}

unsafe extern "C" fn key_tap_callback(
    _proxy: *mut c_void,
    event_type: u32,
    event: EventRef,
    user_info: *mut c_void,
) -> EventRef {
    unsafe { handle_key_tap_event(event_type, event, user_info, is_frontmost) }
}

unsafe fn handle_key_tap_event(
    event_type: u32,
    event: EventRef,
    user_info: *mut c_void,
    focused: impl FnOnce(i32) -> bool,
) -> EventRef {
    if user_info.is_null() || event.is_null() {
        return event;
    }
    let telemetry = unsafe { &*user_info.cast::<SharedCaptureTelemetry>() };
    pointer::invalidate_note_taps(telemetry, event_type, event);
    if event_type == EVENT_TAP_DISABLED_BY_TIMEOUT || event_type == EVENT_TAP_DISABLED_BY_USER_INPUT
    {
        telemetry.fn_candidate.store(false, Ordering::Release);
        telemetry.cancel_onboarding_fn_gesture();
        let tap = telemetry.tap_port.load(Ordering::Acquire) as *mut c_void;
        if !tap.is_null() {
            unsafe { CGEventTapEnable(tap, true) };
        }
        return event;
    }
    if pointer::is_motion_event(event_type) {
        pointer::handle_motion_event(telemetry, event);
        return event;
    }
    if matches!(
        event_type,
        EVENT_LEFT_MOUSE_DOWN
            | EVENT_RIGHT_MOUSE_DOWN
            | 25
            | EVENT_SCROLL_WHEEL
            | EVENT_SYSTEM_DEFINED
    ) {
        if event_type != EVENT_SYSTEM_DEFINED && telemetry.shortcuts_paused.load(Ordering::Acquire)
        {
            telemetry.cancel_onboarding_fn_gesture();
        }
        if telemetry
            .shortcut
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .is_option_only()
        {
            telemetry.fn_candidate.store(false, Ordering::Release);
        }
        return event;
    }
    if event_type == EVENT_FLAGS_CHANGED {
        let keycode = unsafe { CGEventGetIntegerValueField(event, KEYBOARD_EVENT_KEYCODE) } as u16;
        let flags = unsafe { CGEventGetFlags(event) };
        if telemetry.shortcuts_paused.load(Ordering::Acquire) {
            telemetry.fn_candidate.store(false, Ordering::Release);
            telemetry.observe_onboarding_fn(keycode, flags, focused);
            return event;
        }
        let record = telemetry.shortcuts().0;
        let option = record.is_option_only();
        let gesture_key = if option {
            matches!(keycode, 58 | 61)
        } else {
            u32::from(keycode) == MACOS_FN_KEY_CODE
        };
        let gesture_flag = if option {
            FLAG_ALTERNATE
        } else {
            FLAG_SECONDARY_FN
        };
        let fn_down = flags & gesture_flag != 0;
        let other_modifiers = (option && !gesture_key)
            || flags
                & ((FLAG_COMMAND | FLAG_CONTROL | FLAG_ALTERNATE | FLAG_SHIFT | FLAG_SECONDARY_FN)
                    & !gesture_flag)
                != 0;
        let fn_event = gesture_key && record.is_standalone_modifier();
        let other_key = fn_event
            && ((option
                && (0_u32..5).any(|button| unsafe {
                    CGEventSourceButtonState(0, button) || CGEventSourceButtonState(1, button)
                }))
                || another_key_is_held(
                    keycode,
                    option,
                    |key| unsafe { CGEventSourceKeyState(0, key) },
                    |key| unsafe { CGEventSourceKeyState(1, key) },
                ));
        let (candidate, trigger) = fn_gesture_transition(
            telemetry.fn_candidate.load(Ordering::Acquire),
            fn_event,
            fn_down,
            other_key,
            other_modifiers,
            telemetry.shortcuts_paused.load(Ordering::Acquire),
        );
        telemetry.fn_candidate.store(candidate, Ordering::Release);
        if trigger {
            telemetry.emit_fn_shortcut();
        }
        return event;
    }
    if event_type != EVENT_KEY_DOWN {
        return event;
    }

    let flags = unsafe { CGEventGetFlags(event) };
    let cmd = (flags & FLAG_COMMAND) != 0;
    let ctrl = (flags & FLAG_CONTROL) != 0;
    let alt = (flags & FLAG_ALTERNATE) != 0;
    let shift = (flags & FLAG_SHIFT) != 0;
    let keycode = unsafe { CGEventGetIntegerValueField(event, KEYBOARD_EVENT_KEYCODE) } as u16;
    if telemetry.shortcuts_paused.load(Ordering::Acquire) && u32::from(keycode) != MACOS_FN_KEY_CODE
    {
        telemetry.cancel_onboarding_fn_gesture();
    }
    let (candidate, _) = fn_gesture_transition(
        telemetry.fn_candidate.load(Ordering::Acquire),
        false,
        false,
        u32::from(keycode) != MACOS_FN_KEY_CODE,
        false,
        telemetry.shortcuts_paused.load(Ordering::Acquire),
    );
    telemetry.fn_candidate.store(candidate, Ordering::Release);
    if !telemetry.shortcuts().0.is_standalone_modifier()
        && telemetry.matches_shortcut(keycode, cmd, ctrl, alt, shift)
    {
        if unsafe { CGEventGetIntegerValueField(event, KEYBOARD_EVENT_AUTOREPEAT) } == 0 {
            telemetry.emit_capture_shortcut();
        }
        return event;
    }
    if keycode == KEY_ESCAPE && !cmd && !ctrl {
        telemetry.escape_pressed.store(true, Ordering::Release);
    }
    if !telemetry.active.load(Ordering::Acquire) || telemetry.notes_editing.load(Ordering::Acquire)
    {
        return event;
    }

    let t_ms = telemetry.elapsed_ms();
    if cmd && !ctrl && !alt && !shift && (keycode == layout_z_keycode() || keycode == KEY_Z) {
        let _ = telemetry.ui_sender.try_send(LiveOverlayEvent::UndoStroke);
    } else if cmd || ctrl {
        if let Some(key_name) = shortcut_key_name(keycode) {
            let mut chord = String::new();
            if ctrl {
                chord.push('⌃');
            }
            if alt {
                chord.push('⌥');
            }
            if shift {
                chord.push('⇧');
            }
            if cmd {
                chord.push('⌘');
            }
            chord.push_str(&key_name);
            telemetry.window_log_request.store(true, Ordering::Release);
            telemetry.observe_key_context(t_ms);
            telemetry
                .events
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .push(InteractionEvent::Key {
                    t: t_ms,
                    shortcut: chord,
                });
        }
    }
    event
}
