use super::*;

impl ApparentCoordinator {
    /// Moves the island to `phase`, triggering a `.blurReplace` cross-transition on the inner content
    /// while the outer shell springs its width smoothly (`stiffness: 400, damping: 30` equivalent).
    pub(super) fn set_island_phase(&mut self, phase: IslandPhase) {
        use crate::onboarding::Input;
        if matches!(phase, IslandPhase::Recording | IslandPhase::Hidden | IslandPhase::Dismissing) {
            // A new recording or dismissal revokes detached workers' UI ownership.
            // Their finalized bundles remain on disk; stale results must not copy to
            // the clipboard, replace the current review, or finish a newer practice.
            self.capture_generation = self.capture_generation.wrapping_add(1);
        }
        let capture = match (self.island_phase, phase) {
            (IslandPhase::Recording, IslandPhase::Recording) => None,
            (_, IslandPhase::Recording) => Some(Input::CaptureStarted),
            (IslandPhase::Recording | IslandPhase::Processing, IslandPhase::Completed { .. }) => {
                Some(Input::CaptureEnded { completed: true })
            }
            // Startup can fail before Recording is presented. Clear the shortcut attempt
            // then too, so a later menu capture cannot inherit it.
            (_, IslandPhase::Hidden | IslandPhase::Dismissing) => {
                Some(Input::CaptureEnded { completed: false })
            }
            _ => None,
        };
        if let Some(input) = capture
            && let Some(session) = self.onboarding.as_mut()
        {
            session.input(input);
        }
        let changed = std::mem::discriminant(&self.island_phase) != std::mem::discriminant(&phase);
        if changed {
            // A new phase replaces the whole content; the chips go with it, and the outgoing
            // Recording content keeps showing them while it blurs away.
            self.reveal_prev_chips = self.reveal.is_open();
            self.reveal.close();
            self.reveal_outgoing = None;
            self.island_morph = Morph::Phase;
            self.switch = None;
            self.highlight_prev = None;
            if matches!(self.island_phase, IslandPhase::Hidden) {
                self.island_stepped = Instant::now();
            }
            self.island_prev_phase = self.island_phase;
            if matches!(phase, IslandPhase::Dismissing) {
                self.island_dismissed_from = self.island_phase;
            } else if matches!(self.island_phase, IslandPhase::Hidden) {
                self.island_scale = 0.92;
                self.island_scale_velocity = 0.0;
                self.island_y = -6.0;
                self.island_y_velocity = 0.0;
            }
            self.island_phase_since = motion::now();
            motion::trace_event(format!("phase:{}", phase.trace_name()));
        }
        let appearing = matches!(
            self.island_phase,
            IslandPhase::Hidden | IslandPhase::Dismissing
        );
        self.island_phase = phase;
        let place = changed
            && (appearing
                || matches!(
                    phase,
                    IslandPhase::Selecting { .. } | IslandPhase::Recording
                ));
        if crate::handoff::native_pill() {
            if !matches!(phase, IslandPhase::Hidden) {
                self.ensure_native_pill();
            }
            if place {
                self.place_capsule();
            }
            self.sync_native_pill();
        } else if place {
            self.place_capsule();
        }
    }

    /// Puts the capsule on the pointer's display during screen recording or selection,
    /// else the one under the pointer (the phone mirror places its capsule separately).
    pub(super) fn place_capsule(&self) {
        let centre = |[x, y, w, h]: [f64; 4]| [x + w / 2.0, y + h / 2.0];
        let anchor = match self.island_phase {
            IslandPhase::Recording => self
                .active_recording
                .as_ref()
                .filter(|rec| rec.target.mode != CaptureMode::Device)
                .map(|_| centre(self.display_rect.map(f64::from))),
            IslandPhase::Selecting { .. } => Some(centre(self.display_rect.map(f64::from))),
            _ => None,
        };
        let Some(point) = anchor.or_else(crate::screens::pointer) else {
            return;
        };
        match self.native_pill {
            Some(ref pill) => pill.place_on(point),
            None => platform::place_hud_pill(point),
        }
    }

    /// The iPhone's mirror window can be dragged to another display mid-recording: the ink
    /// overlay and the capsule go with it.
    pub(super) fn follow_phone_mirror(&mut self) {
        let Some(ActiveRecording {
            source: CaptureSource::Phone(_),
            _metal_overlay: Some(overlay),
            ..
        }) = self.active_recording.as_mut()
        else {
            return;
        };
        let f = *self
            .telemetry
            .target_frame
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if f.x <= -10_000.0 {
            return;
        }
        let centre = [f.x + f.width / 2.0, f.y + f.height / 2.0];
        if crate::screens::contains(overlay.screen(), centre)
            || !overlay.move_to([f.x, f.y, f.width, f.height])
        {
            return;
        }
        self.display_rect = overlay.screen().map(|v| v as f32);
        if let Some(ref pill) = self.native_pill {
            pill.place_on(centre);
        }
    }

    /// Follow the pointer with Linux controls, not with the capture source. On Mac,
    /// a dragged capsule must stay where it was dropped for the whole recording.
    #[cfg(target_os = "linux")]
    pub(super) fn follow_recording_pointer(&mut self) {
        if !matches!(self.island_phase, IslandPhase::Recording)
            || !self
                .active_recording
                .as_ref()
                .is_some_and(|rec| rec.target.mode != CaptureMode::Device)
        {
            return;
        }
        let Some(pointer) = current_mouse_screen() else {
            return;
        };
        let current = self.display_rect.map(f64::from);
        if crate::screens::contains(current, pointer.map(f64::from)) {
            return;
        }
        let screens = crate::screens::current();
        if let Some(frame) =
            recording_pointer_destination(current, pointer.map(f64::from), &screens)
        {
            if let Some(overlay) = self
                .active_recording
                .as_mut()
                .and_then(|rec| rec._metal_overlay.as_mut())
            {
                overlay.move_to(frame);
            }
            self.display_rect = frame.map(|v| v as f32);
            // A manually dragged Linux capsule remains where it was dropped.
            // Continue following with the ink overlay, but leave the pill alone.
            if !platform::pill_user_moved() {
                self.place_capsule();
            }
        }
    }

    /// While picking, the picker (its window, overlay and the capsule) follows the pointer to
    /// whichever display it's on, unless an area is being dragged (an area stays on one display).
    pub(super) fn follow_pointer_display(&mut self, pointer: [f32; 2], cx: &mut Context<Self>) {
        // The iPhone's mirror window stays where it is, and so does the highlight around it.
        if self.selection_drag.is_some()
            || self.lab
            || self.selection_mode() == Some(SelectionMode::Iphone)
        {
            return;
        }
        let p = pointer.map(f64::from);
        let current = self.display_rect.map(f64::from);
        if crate::screens::contains(current, p) {
            return;
        }
        let screens = crate::screens::current();
        let Some(i) = crate::screens::index_at(&screens, p) else {
            return;
        };
        let frame = screens[i].frame;
        if (0..4).all(|k| (frame[k] - current[k]).abs() < 1.0) {
            return;
        }
        apparent_log(format!("picker follows the pointer to display {frame:?}"));
        self.display_rect = frame.map(|v| v as f32);
        if let Some(ref mut overlay) = self.picker_metal_overlay {
            overlay.move_to(frame);
        }
        platform::move_picker_window(frame, cx);
        self.place_capsule();
        self.sync_picker_overlay();
        // The picker draws relative to `display_rect`; with the native capsule nothing else
        // redraws it, and a same-size display doesn't resize its window.
        cx.notify();
    }

    /// The picker's mouse-up, inside its window or not: ends an area drag.
    pub(super) fn picker_mouse_up(&mut self, event: &MouseUpEvent, cx: &mut Context<Self>) {
        let [sx, sy] = current_mouse_screen()
            .unwrap_or([f32::from(event.position.x), f32::from(event.position.y)]);
        if let Some((start, _)) = self.selection_drag.take() {
            if let Some([x, y, w, h]) = area_rect(start, [sx, sy], self.display_rect) {
                let target = region_target(x, y, w, h, &self.selectable_windows);
                self.start_recording_with_target(target, cx);
            } else {
                self.sync_picker_overlay();
                cx.notify();
            }
        }
    }

    pub(crate) fn ensure_native_pill(&mut self) {
        if !crate::handoff::native_pill() || self.native_pill.is_some() {
            return;
        }
        match crate::native::pill::NativePill::open() {
            Ok(pill) => {
                if !crate::handoff::experiment("movableRecordingControls") {
                    self.telemetry.excluded_window_ids.lock()
                        .unwrap_or_else(std::sync::PoisonError::into_inner)
                        .push(pill.window_number());
                }
                self.native_pill = Some(pill);
            }
            Err(err) => {
                apparent_log(format!("NativePill::open error: {err}"));
            }
        }
    }

    pub(super) fn completed_audio_issue(&self) -> Option<CompletedAudioIssue> {
        match (&self.completed_dir, &self.review_bundle) {
            (Some(dir), Some((review_dir, _))) if dir == review_dir => self.review_audio_issue,
            _ => None,
        }
    }

    pub(super) fn recording_has_no_words(&self) -> bool {
        matches!(
            self.active_recording.as_ref().map(|rec| &rec.source),
            Some(CaptureSource::Screen { audio: Some(audio), .. })
                if audio.live_word_state() == Some(crate::live_word_warning::State::NoWords)
        )
    }

    pub(super) fn pill_snapshot(&self) -> crate::native::pill::PillSnapshot {
        use crate::native::pill::{PillSnapshot, PillStyle, model::Pres};
        let recording_ms = self
            .active_recording
            .as_ref()
            .map(ActiveRecording::elapsed_ms);
        let elapsed_ms = recording_ms.unwrap_or(self.last_elapsed_ms);
        let clock = format_clock(elapsed_ms);
        let has_iphone = self.iphone.is_some();

        let pres = match self.island_phase {
            IslandPhase::Hidden | IslandPhase::Dismissing => Pres::Hidden,
            IslandPhase::Selecting { mode } => Pres::Selecting { mode, has_iphone },
            IslandPhase::Recording if self.recording_has_no_words() && !self.reveal.is_open() => {
                Pres::RecordingWarning {
                    chips: false,
                    has_iphone,
                }
            }
            IslandPhase::Recording => Pres::Recording {
                chips: self.reveal.is_open(),
                has_iphone,
            },
            IslandPhase::Processing => Pres::Processing,
            IslandPhase::Completed { inbox_count, .. } => {
                let issue = self.completed_audio_issue();
                Pres::Completed {
                    warning: issue.is_some(),
                    label: completed_status_label(
                        inbox_count,
                        self.completed_note.as_deref(),
                        issue,
                    ),
                    routes: Vec::new(),
                }
            }
        };
        PillSnapshot {
            pres,
            clock,
            mic_warning: self
                .active_recording
                .as_ref()
                .and_then(ActiveRecording::mic_warning),
            reduced_motion: self.reduced_motion,
            style: PillStyle::current(),
        }
    }

    pub(crate) fn sync_native_pill(&mut self) {
        if self.native_pill.is_some() {
            let snap = self.pill_snapshot();
            if let Some(ref pill) = self.native_pill {
                pill.sync(snap);
            }
        }
    }

    pub(super) fn apply_pill_action(
        &mut self,
        action: crate::native::pill::PillAction,
        cx: &mut Context<Self>,
    ) {
        use crate::native::pill::PillAction;
        match action {
            PillAction::SelectMode(mode) => self.click_selection_mode(mode, cx),
            PillAction::SwitchRecording(mode) => self.switch_recording(mode, cx),
            PillAction::RecordSelected => self.record_selected_mode(cx),
            PillAction::Cancel => self.cancel_recording(cx),
            PillAction::Whiteboard => {
                let coord = cx.entity().clone();
                cx.defer(move |cx| whiteboard::open(&coord, cx));
            }
            PillAction::Finish => self.finish_recording(cx),
            PillAction::Paste(target) => self.paste_completed_bundle(target, cx),
            PillAction::Inspect => self.inspect_completed_bundle(cx),
            PillAction::DismissCompleted => self.dismiss_completed_bundle(cx),
            PillAction::Route(_) => {}
        }
    }

    pub fn dismiss_island(&mut self, cx: &mut Context<Self>) {
        if !self.is_recording() {
            self.playback.take();
        }
        if matches!(
            self.island_phase,
            IslandPhase::Hidden | IslandPhase::Dismissing
        ) {
            return;
        }
        self.telemetry
            .selecting
            .store(false, std::sync::atomic::Ordering::Release);
        self.telemetry.set_picker_rect(None);
        self.picker_metal_overlay = None;
        self.iphone_preview = None;
        self.selection_drag = None;
        self.hovered_window = None;
        self.animated_window_rect = None;
        self.set_island_phase(IslandPhase::Dismissing);
        cx.defer(close_picker_window);
        cx.notify();
    }

    pub fn dismiss_completed_bundle(&mut self, cx: &mut Context<Self>) {
        if let Some(dir) = self.completed_dir.clone() {
            self.mark_handled(&dir);
        }
        self.dismiss_island(cx);
    }

    pub fn inspect_completed_bundle(&mut self, cx: &mut Context<Self>) {
        if let Some(dir) = self.completed_dir.clone() {
            self.mark_handled(&dir);
        }
        self.set_island_phase(IslandPhase::Hidden);
        self.island_opacity = 0.0;
        let entity = cx.entity().clone();
        cx.defer(move |cx| {
            close_capture_windows(cx);
            open_review_window(&entity, cx);
        });
        cx.notify();
    }

    pub fn paste_completed_bundle(
        &mut self,
        click_target: Option<[f32; 2]>,
        cx: &mut Context<Self>,
    ) {
        let dir = self
            .completed_dir
            .clone()
            .unwrap_or_else(|| PathBuf::from("latest"));
        self.dismiss_island(cx);
        if !crate::capture::accessibility_granted() {
            apparent_log("Paste chip without Accessibility; asking for it");
            self.gate
                .defer(vec![crate::onboarding::Permission::Accessibility]);
            return;
        }
        self.mark_handled(&dir);
        std::thread::spawn(move || {
            if let Err(err) = crate::handoff::paste_bundle_at_target(&dir, click_target) {
                apparent_log(format!("paste_bundle_at_target error: {err}"));
                #[cfg(target_os = "linux")]
                crate::linux::shell::notify(
                    "Paste stopped",
                    &format!(
                        "{err:#}. Manually attach the contact sheet and paste summary.md from {}",
                        dir.display()
                    ),
                );
            }
        });
    }

    /// The UI loop's tick: advances the springs unless a new capsule window awaits its second
    /// frame (`island_await_frame`).
    pub fn island_tick(&mut self, cx: &mut Context<Self>) {
        #[cfg(any(target_os = "linux", target_os = "macos"))]
        if matches!(self.island_phase, IslandPhase::Recording) {
            platform::tick_pill_drag();
        }
        let live_no_words = self.recording_has_no_words();
        if live_no_words != self.last_live_no_words {
            self.last_live_no_words = live_no_words;
            self.sync_native_pill();
            cx.notify();
        }
        if self.island_await_frame {
            // Ask for the frame that ends the wait.
            cx.notify();
        } else {
            self.step_island(cx);
        }
    }

    /// Advances the capsule's springs to now. The UI loop calls it every few ms to keep frames
    /// coming, and the capsule calls it as it draws, so every frame shows its own moment rather
    /// than the loop's last tick (up to 8 ms stale, which made the steps uneven).
    pub fn step_island(&mut self, cx: &mut Context<Self>) {
        if let Some(actions) = self.native_pill.as_ref().map(|p| p.drain_actions()) {
            for action in actions {
                self.apply_pill_action(action, cx);
            }
        }
        let tune = motion::tune();
        let real = self.island_stepped.elapsed().as_secs_f32();
        if real < 0.0002 {
            return;
        }
        self.island_stepped = Instant::now();
        // A late frame slows the motion rather than skipping it ahead (a new window's second
        // frame comes ~50 ms after its first).
        let dt = (real * motion::time_scale()).min(0.025);
        if let IslandPhase::Completed { finished_at, .. } = self.island_phase
            && finished_at.elapsed() >= Duration::from_millis(25_000)
            && !matches!(
                self.completed_note.as_deref(),
                Some("Saved · paste manually" | "Saved · open bundle (copy failed)")
            )
        {
            self.set_island_phase(IslandPhase::Dismissing);
        }

        if let IslandPhase::Selecting { mode } = self.island_phase {
            if let Some(pos) = current_mouse_screen() {
                self.follow_pointer_display(pos, cx);
                self.selection_pointer = Some(pos);
                if mode == SelectionMode::Area
                    && let Some((start, _)) = self.selection_drag
                {
                    self.selection_drag = Some((start, pos));
                }
                if mode == SelectionMode::Window && !self.windows_loading {
                    self.hovered_window = selectable_window_at(
                        &self.selectable_windows,
                        f64::from(pos[0]),
                        f64::from(pos[1]),
                    )
                    .cloned();
                }
            }
            if mode == SelectionMode::Window
                && let Some(ref win) = self.hovered_window
            {
                let target_rect = [
                    win.frame.x as f32,
                    win.frame.y as f32,
                    win.frame.width as f32,
                    win.frame.height as f32,
                ];
                self.animated_window_rect = Some(target_rect);
            } else {
                self.animated_window_rect = None;
            }
            self.sync_picker_overlay();
        }
        self.follow_phone_mirror();
        #[cfg(target_os = "linux")]
        self.follow_recording_pointer();

        // Keep layout width at `island_target_width` during open and dismiss so the capsule never
        // clips its inner chips; open/dismiss use a restrained 0.92 <-> 1.0 scale.
        let (target_w, target_scale, target_y, target_opacity, fade_rate) = match self.island_phase
        {
            IslandPhase::Hidden => return,
            IslandPhase::Dismissing => (self.island_target_width, 0.92, -6.0, 0.0, 18.0),
            _ => (self.island_target_width, 1.0, 0.0, 1.0, 20.0),
        };

        if self.reveal.is_open() {
            let activity = self.reveal_activity();
            let on_pill = self
                .native_pill
                .as_ref()
                .map_or_else(pointer_on_hud_pill, |p| p.pointer_on_pill());
            if self.reveal.tick(reveal_clock_ms(), on_pill, activity) {
                self.play_fold();
            }
        }

        let (width, velocity) = if self.reduced_motion && self.island_morph != Morph::Phase {
            // Reduce motion: the reveal's groups fade in place with no width travel; a shrink
            // waits for the outgoing chips to fade so none are clipped while visible.
            let fading =
                self.reveal_outgoing.is_some() && motion::age(self.reveal_since) < REDUCED_FADE_S;
            if fading && target_w < self.island_width {
                (self.island_width, 0.0)
            } else {
                (target_w, 0.0)
            }
        } else {
            spring_step(
                self.island_width,
                self.island_velocity,
                target_w,
                dt,
                self.island_morph.spring(&tune),
            )
        };
        let (scale, s_vel) = spring_step(
            self.island_scale,
            self.island_scale_velocity,
            target_scale,
            dt,
            tune.island_scale,
        );
        let (y_off, y_vel) = spring_step(
            self.island_y,
            self.island_y_velocity,
            target_y,
            dt,
            tune.island_scale,
        );
        if let Some(morph) = self.switch.as_mut()
            && let Some((x, v)) = morph.slide
        {
            let (x, v) = spring_step(x, v, 0.0, dt, tune.switch_slide);
            morph.slide = Some((x, v));
            if x.abs() < 0.2 && v.abs() < 2.0 {
                self.switch = None;
            }
        }
        self.island_width = width.clamp(120.0, PILL_WINDOW_W - 16.0);
        self.island_velocity = velocity;
        self.island_scale = scale.clamp(0.35, 1.18);
        self.island_scale_velocity = s_vel;
        self.island_y = y_off.clamp(-18.0, 14.0);
        self.island_y_velocity = y_vel;
        self.island_opacity += (target_opacity - self.island_opacity) * (fade_rate * dt).min(1.0);
        self.sync_native_pill();

        let dismiss_done = if let Some(ref pill) = self.native_pill {
            pill.is_fully_hidden()
        } else {
            self.island_opacity < 0.03
        };
        if matches!(self.island_phase, IslandPhase::Dismissing) && dismiss_done {
            self.set_island_phase(IslandPhase::Hidden);
            self.island_opacity = 0.0;
            cx.defer(close_capture_windows);
        }
        if self.native_pill.is_none() {
            cx.notify();
        }
    }

}
