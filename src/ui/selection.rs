use super::*;

impl ApparentCoordinator {
    pub(super) fn activity(&self) -> crate::shortcut::Activity {
        use crate::shortcut::Activity;
        if let Some(rec) = &self.active_recording {
            Activity::Recording {
                elapsed_ms: rec.started.elapsed().as_millis() as u64,
            }
        } else if self.is_processing() {
            Activity::Processing
        } else if self.is_selecting() {
            Activity::Picker
        } else {
            Activity::Free
        }
    }

    pub(super) fn begin_playback(&mut self) {
        if !self.lab && self.playback.is_none() {
            self.playback = crate::playback::Guard::start();
        }
    }

    /// The capture shortcut went down (from Carbon, the event tap or the HID poller).
    pub fn press_shortcut(&mut self, cx: &mut Context<Self>) {
        let activity = self.activity();
        if self.gate.is_pending() {
            return;
        }
        if !self.shortcut.is_pending() && activity == crate::shortcut::Activity::Free {
            // No picker or overlay before the permissions are on: they sit above
            // macOS's permission prompts and take the clicks meant for them.
            let missing = self.missing_to_record();
            if !self.gate.press(missing) {
                apparent_log("Shortcut held back: a required permission is off");
                return;
            }
            self.begin_playback();
            self.hold_mods = crate::capture::modifier_flags();
            // An Esc from before this press doesn't cancel it.
            self.telemetry.take_escape();
        }
        let action = self.shortcut.press(activity);
        self.apply_shortcut(action, cx);
    }

    /// Polled from the UI loop while a press is pending: watches for ⌥⇧ coming up and Esc,
    /// whichever app or window has focus.
    pub fn tick_shortcut(&mut self, cx: &mut Context<Self>) {
        if !self.shortcut.is_pending() {
            return;
        }
        let action = if self.telemetry.take_escape() {
            self.shortcut.escape()
        } else {
            let mods = crate::capture::modifier_flags();
            let held = self.hold_mods != 0 && mods & self.hold_mods == self.hold_mods;
            self.shortcut.tick(held)
        };
        self.apply_shortcut(action, cx);
    }

    pub(super) fn apply_shortcut(&mut self, action: crate::shortcut::Action, cx: &mut Context<Self>) {
        use crate::shortcut::Action;
        if action != Action::None {
            apparent_log(format!("shortcut -> {action:?}"));
        }
        match action {
            Action::None => {}
            Action::Cancel => {
                if let Some(session) = self.onboarding.as_mut() {
                    session.input(crate::onboarding::Input::CaptureEnded { completed: false });
                }
                // Esc can cancel before the picker or a recording exists.
                self.playback.take();
            }
            Action::RecordScreen => {
                if let Some(session) = self.onboarding.as_mut() {
                    session.input(crate::onboarding::Input::ShortcutTriggered);
                }
                self.record_screen_now(cx);
            }
            Action::RecordSelected => {
                if let Some(session) = self.onboarding.as_mut() {
                    session.input(crate::onboarding::Input::ShortcutTriggered);
                }
                self.record_selected_mode(cx);
            }
            Action::Finish => self.finish_recording(cx),
        }
    }

    /// The menu's Record Screen item, the review window's Record button and `app --record`.
    pub fn record_or_finish(&mut self, cx: &mut Context<Self>) {
        if self.is_recording() {
            self.finish_recording(cx);
        } else if self.is_selecting() {
            self.record_selected_mode(cx);
        } else if !self.is_processing() {
            self.record_screen_now(cx);
        }
    }

    /// The feedback entry point records immediately, then opens a local review.
    pub fn record_feedback(&mut self, cx: &mut Context<Self>) {
        if self.is_recording() || self.is_selecting() || self.is_processing() {
            return;
        }
        self.record_screen_now(cx);
        self.feedback_capture = self.is_recording();
    }

    /// Records the display under the cursor straight away (no picker), auto-cropped.
    pub fn record_screen_now(&mut self, cx: &mut Context<Self>) {
        self.feedback_capture = false;
        let target = if self.lab {
            lab::target()
        } else {
            discover_target(None)
        };
        self.start_recording_with_target(target, cx);
        if self.is_recording() {
            self.show_reveal(cx);
        }
    }

    /// Activity that means the user got to work: clicks, drags, scrolls and strokes. Clicks on
    /// Apparent's own windows (the capsule and its chips) are never recorded, so they don't count.
    pub(super) fn reveal_activity(&self) -> usize {
        use std::sync::PoisonError;
        let t = &self.telemetry;
        t.events
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .len()
            + t.strokes
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .len()
            + usize::from(
                t.live_ink
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner)
                    .is_some(),
            )
    }

    /// The recording just started from a tap: the capsule opens onto the switch chips.
    pub(super) fn show_reveal(&mut self, cx: &mut Context<Self>) {
        // The iPhone chip shows only while one is cabled (a USB registry read, no prompt).
        if !self.lab {
            self.refresh_iphone(cx);
        }
        self.reduced_motion = reduce_motion();
        let activity = self.reveal_activity();
        self.reveal.show(reveal_clock_ms(), activity);
        self.reveal_since = motion::now();
        self.reveal_outgoing = None;
        self.island_morph = Morph::RevealOpen;
        if self.reduced_motion {
            self.island_scale = 1.0;
            self.island_scale_velocity = 0.0;
            self.island_y = 0.0;
            self.island_y_velocity = 0.0;
        }
        self.sync_native_pill();
        cx.notify();
    }

    /// The chips fold back into the recording pill (timeout, work started, or a chip chosen).
    pub(super) fn fold_reveal(&mut self) {
        if self.reveal.is_open() {
            self.reveal.close();
            self.play_fold();
        }
    }

    pub(super) fn play_fold(&mut self) {
        self.reveal_since = motion::now();
        self.reveal_outgoing = Some(true);
        self.island_morph = Morph::RevealClose;
        self.sync_native_pill();
    }

    /// A switch chip on a tap-started recording. Screen keeps it. Anything else drops the few
    /// seconds recorded so far and starts over on the new target, exactly as if it had been
    /// chosen first: Window and Area morph the capsule into the picker (hover and click a window,
    /// or drag an area), iPhone goes straight into the phone's mirror.
    pub fn switch_recording(&mut self, mode: SelectionMode, cx: &mut Context<Self>) {
        if !self.is_recording() {
            return;
        }
        if mode == SelectionMode::Screen {
            self.fold_reveal();
            cx.notify();
            return;
        }
        apparent_log(format!("switch_recording -> {mode:?}"));
        // The morph continues the chips, so it needs them on screen.
        let chips_shown = self.reveal.is_open();
        let Some((_, overlay)) = self.discard_recording() else {
            return;
        };
        if mode == SelectionMode::Iphone {
            // Recording → Recording: the chips fold into the pill as the phone starts.
            self.fold_reveal();
            drop(overlay);
            self.start_recording_iphone(cx);
            return;
        }
        // Window and Area: the chips stay up while the capsule morphs into the picker.
        // The recording's overlay becomes the picker's (moved if the picker opens on another
        // display), so the border never swaps windows (as the picker → recording path does).
        self.picker_metal_overlay = overlay;
        self.open_picker(Some(mode), cx);
        if self.is_selecting() && chips_shown && !self.reduced_motion {
            // The chips showed Screen; the picker shows `mode`.
            self.highlight_prev = Some(SelectionMode::Screen);
            self.highlight_since = motion::now();
            self.island_morph = Morph::Switch;
            self.switch = Some(SwitchMorph { slide: None });
        }
    }

    /// Stops the active recording and deletes its bundle, leaving the island as it is. Returns
    /// its target and overlay.
    pub(super) fn discard_recording(&mut self) -> Option<(TargetInfo, Option<LaserOverlay>)> {
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        if let Some(id) = self.agent_capture_id.take() {
            self.agent_captures.set(&id, "cancelled", None, None);
        }
        let rec = self.active_recording.take()?;
        let _ = self.telemetry.finish_session();
        match rec.source {
            CaptureSource::Screen { session, audio, .. } => {
                let _ = session.stop();
                if let Some(audio) = audio {
                    let _ = audio.stop();
                }
            }
            CaptureSource::Phone(session) => session.cancel(),
            CaptureSource::Lab => return Some((rec.target, rec._metal_overlay)),
        }
        let _ = std::fs::remove_dir_all(rec.bundle_dir);
        Some((rec.target, rec._metal_overlay))
    }

    pub fn is_island_visible(&self) -> bool {
        !matches!(self.island_phase, IslandPhase::Hidden)
    }

    pub fn shortcut_label(&self) -> String {
        self.telemetry
            .shortcut
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .label
            .clone()
    }

    pub fn set_review_bundle(&mut self, bundle: (PathBuf, ApparentBundle), status: Option<String>) {
        self.review_audio_issue = bundle_audio_issue(&bundle.0, &bundle.1);
        self.review_bundle = Some(bundle);
        self.review_status = status;
        self.review_feedback = false;
        self.selected_tab = ReviewTab::Keyframes;
        self.selected_keyframe = 0;
    }

    pub(super) fn sync_picker_overlay(&self) {
        let rect = match self.island_phase {
            IslandPhase::Selecting {
                mode: SelectionMode::Area,
            } => self.selection_drag.and_then(|(a, b)| {
                let [a, b] = [a, b].map(|p| clamp_point(p, self.display_rect));
                let w = (a[0] - b[0]).abs();
                let h = (a[1] - b[1]).abs();
                (w >= 1.0 && h >= 1.0).then_some(([a[0].min(b[0]), a[1].min(b[1]), w, h], 1))
            }),
            IslandPhase::Selecting {
                mode: SelectionMode::Window,
            } => self.hovered_window.as_ref().map(|t| {
                (
                    [
                        t.frame.x as f32,
                        t.frame.y as f32,
                        t.frame.width as f32,
                        t.frame.height as f32,
                    ],
                    2,
                )
            }),
            IslandPhase::Selecting {
                mode: SelectionMode::Screen,
            } => Some((self.display_rect, 2)),
            IslandPhase::Selecting {
                mode: SelectionMode::Iphone,
            } => self
                .iphone_preview
                .as_ref()
                .and_then(PhoneSession::rect)
                .map(|r| (r, 3)),
            _ => None,
        };
        self.telemetry.set_picker_rect(rect);
    }

    pub fn set_selection_mode(&mut self, mode: SelectionMode, cx: &mut Context<Self>) {
        self.open_iphone_when_found = false;
        if let IslandPhase::Selecting { mode: prev_mode } = self.island_phase {
            if prev_mode != mode {
                // Crisp tactile Dynamic Island scale micro-pulse when Space toggles camera/crosshair mode.
                self.island_scale_velocity += 1.25;
            }
            if mode != SelectionMode::Iphone
                && let Some(ref mut preview) = self.iphone_preview
            {
                preview.hide_preview();
            }
            self.island_phase = IslandPhase::Selecting { mode };
            self.selection_drag = None;
            if let Some(pos) = current_mouse_screen().or(self.selection_pointer) {
                self.selection_pointer = Some(pos);
                if mode == SelectionMode::Window {
                    self.hovered_window = selectable_window_at(
                        &self.selectable_windows,
                        f64::from(pos[0]),
                        f64::from(pos[1]),
                    )
                    .cloned();
                    self.animated_window_rect = self.hovered_window.as_ref().map(|w| {
                        [
                            w.frame.x as f32,
                            w.frame.y as f32,
                            w.frame.width as f32,
                            w.frame.height as f32,
                        ]
                    });
                } else {
                    self.animated_window_rect = None;
                }
            }
            self.sync_picker_overlay();
            cx.notify();
        }
    }

    /// Opens the live iPhone mirror window in preview mode so the user can see their phone before
    /// starting a recording. Clicking `iPhone` a second time or clicking `Record` starts recording.
    pub fn preview_iphone(&mut self, cx: &mut Context<Self>) {
        if self.is_recording() || self.is_processing() {
            return;
        }
        apparent_log("preview_iphone invoked");
        // The mirror would raise the camera prompt under the picker, which takes its clicks.
        if !self.ready_for(crate::onboarding::Permission::Camera) {
            self.cancel_recording(cx);
            return;
        }
        self.set_selection_mode(SelectionMode::Iphone, cx);
        if let Some(ref mut preview) = self.iphone_preview {
            preview.show_preview();
        } else {
            let dev_id = self.iphone.as_ref().map(|d| d.id.as_str());
            match PhoneSession::start_preview(dev_id, false, Some(Arc::clone(&self.telemetry))) {
                Ok(session) => {
                    self.iphone_preview = Some(session);
                }
                Err(error) => {
                    apparent_log(format!("iPhone preview could not start: {error:#}"));
                    self.set_selection_mode(SelectionMode::Area, cx);
                    return;
                }
            }
        }
        self.sync_picker_overlay();
        cx.notify();
    }

    pub fn toggle_selection_mode(&mut self, cx: &mut Context<Self>) {
        if let IslandPhase::Selecting { mode } = self.island_phase {
            let next = match mode {
                SelectionMode::Area => SelectionMode::Window,
                SelectionMode::Window | SelectionMode::Screen | SelectionMode::Iphone => {
                    SelectionMode::Area
                }
            };
            self.set_selection_mode(next, cx);
        }
    }

    pub(super) fn selection_mode(&self) -> Option<SelectionMode> {
        match self.island_phase {
            IslandPhase::Selecting { mode } => Some(mode),
            _ => None,
        }
    }

    /// Switches the picker to `mode`; choosing iPhone opens its live preview.
    pub fn choose_selection_mode(&mut self, mode: SelectionMode, cx: &mut Context<Self>) {
        if self.selection_mode().is_none() {
            return;
        }
        if mode == SelectionMode::Iphone {
            self.preview_iphone(cx);
        } else {
            self.set_selection_mode(mode, cx);
        }
    }

    /// A HUD segment click: picks the mode, or records when Screen/iPhone is already selected.
    pub fn click_selection_mode(&mut self, mode: SelectionMode, cx: &mut Context<Self>) {
        if self.selection_mode() == Some(mode) && mode.shows_record() {
            self.record_selected_mode(cx);
        } else {
            self.choose_selection_mode(mode, cx);
        }
    }

    /// Return, `s`, the capture shortcut, or Record: iPhone records the phone, anything else
    /// records the full screen.
    pub fn record_selected_mode(&mut self, cx: &mut Context<Self>) {
        match self.selection_mode() {
            Some(SelectionMode::Iphone) => self.start_recording_iphone(cx),
            Some(_) => self.start_recording_full_screen(cx),
            None => {}
        }
    }

    /// Picker keyboard map, shared by the picker window and the HUD pill. Returns whether the
    /// key was handled.
    /// ⌘Q and ⌘, in Apparent's own windows: a menu bar (accessory) app has no main menu to
    /// carry them (Ctrl+Q and Ctrl+, on Windows).
    pub fn handle_app_key(&mut self, keystroke: &Keystroke, cx: &mut Context<Self>) -> bool {
        let mods = keystroke.modifiers;
        // `secondary` is ⌘ on macOS and Ctrl elsewhere; the other of the two must be up.
        if !mods.secondary() || (mods.control && mods.platform) || mods.alt || mods.shift {
            return false;
        }
        match keystroke.key.as_str() {
            "q" => cx.quit(),
            "," => {
                if self.is_selecting() {
                    self.cancel_recording(cx);
                }
                self.open_settings(None);
            }
            _ => return false,
        }
        true
    }

    /// `repeat`: the key is held and repeating, which never records.
    pub fn handle_selection_key(
        &mut self,
        keystroke: &Keystroke,
        repeat: bool,
        cx: &mut Context<Self>,
    ) -> bool {
        let Some(mode) = self.selection_mode() else {
            return false;
        };
        let mods = keystroke.modifiers;
        // Esc cancels even with ⌥⇧ still held from the shortcut.
        if keystroke.key == "escape" {
            self.cancel_recording(cx);
            return true;
        }
        if self.handle_app_key(keystroke, cx) {
            return true;
        }
        // The shortcut itself, if it reaches a picker window instead of Carbon.
        if let Some(cfg) = shortcut_from_key_and_mods(
            &keystroke.key,
            mods.platform,
            mods.control,
            mods.alt,
            mods.shift,
        ) && self.telemetry.matches_shortcut(
            cfg.key_code as u16,
            mods.platform,
            mods.control,
            mods.alt,
            mods.shift,
        ) {
            if !repeat {
                self.telemetry.emit_capture_shortcut();
            }
            return true;
        }
        if mods.platform || mods.control || mods.alt {
            return false;
        }
        let has_iphone = self.iphone.is_some();
        // The record shortcut's key ("S") also records on its own while the picker is up.
        let label = self.shortcut_label();
        let record_key = crate::capture::shortcut_parts(&label).1;
        let records = |key: &str| key == "enter" || key.eq_ignore_ascii_case(record_key);
        match keystroke.key.as_str() {
            key if repeat && records(key) => {}
            "space" | " " => self.toggle_selection_mode(cx),
            "escape" => self.cancel_recording(cx),
            "enter" => self.record_selected_mode(cx),
            key if key.eq_ignore_ascii_case(record_key) => self.record_selected_mode(cx),
            "tab" => self.choose_selection_mode(mode.cycled(!mods.shift, has_iphone), cx),
            "right" => self.choose_selection_mode(mode.cycled(true, has_iphone), cx),
            "left" => self.choose_selection_mode(mode.cycled(false, has_iphone), cx),
            key => match SelectionMode::from_digit(key, has_iphone) {
                Some(next) => self.choose_selection_mode(next, cx),
                None => return false,
            },
        }
        true
    }

    pub fn undo_stroke(&mut self, cx: &mut Context<Self>) {
        let mut strokes = self
            .telemetry
            .strokes
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some(idx) = strokes.iter().rposition(|s| !s.laser) {
            strokes.remove(idx);
        }
        drop(strokes);
        cx.notify();
    }

    pub fn request_immediate_frame(&self) {
        if let Some(ActiveRecording {
            source: CaptureSource::Screen { session, .. },
            ..
        }) = &self.active_recording
        {
            session.request_immediate_frame();
        }
    }

}
