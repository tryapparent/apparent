use ui::electron_pill::{self as pill_state, Event as PillEvent};

use crate::capture::engine::runtime::recording::recorder::{PreparedSource, selection as display_selection};

impl ApparentCoordinator {
    fn apply_pill_event(&mut self, event: PillEvent) {
        let began_capture = matches!(event, PillEvent::CaptureStarted);
        let reopened_picker = matches!(event, PillEvent::PickerOpened { .. });
        let Some((phase, reveal)) = self.observe_pill_event(event) else { return };
        self.reveal.facts = None;
        let previous_reveal = std::mem::replace(&mut self.reveal.chips, reveal);
        let changed = std::mem::discriminant(&self.island_phase) != std::mem::discriminant(&phase);
        if !changed && !began_capture && !reopened_picker {
            self.island_phase = phase;
            if previous_reveal && !reveal {
                self.play_fold();
            }
            return;
        }
        use crate::capture::desktop::settings::onboarding::Input;
        if matches!(phase, IslandPhase::Selecting { .. } | IslandPhase::Processing | IslandPhase::Recording | IslandPhase::Hidden | IslandPhase::Dismissing) {
            self.public_share.cancel_all();
        }
        if matches!(phase, IslandPhase::Recording | IslandPhase::Hidden | IslandPhase::Dismissing) {
            if let Some((_, _, active)) = self.share_pending.take() {
                active.store(false, std::sync::atomic::Ordering::SeqCst);
            }
            self.share_waiting_account = false;
            self.share_copied = None;
            self.reveal.observed_upload_progress = None;
            self.share_probe_at = None;
            // A new recording or dismissal revokes detached workers' UI ownership.
            // Their finalized bundles remain on disk; stale results must not copy to
            // the clipboard, replace the current review, or finish a newer practice.
            self.capture_generation = self.capture_generation.wrapping_add(1);
        }
        if matches!(phase, IslandPhase::Hidden | IslandPhase::Dismissing)
            && self.active_recording.is_none()
        {
            self.report_capture = false;
        }
        if matches!(phase, IslandPhase::Recording) && !matches!(self.island_phase, IslandPhase::Recording) {
            self.recording_activity_attempted = false;
            self.capture_local_practice = self.onboarding.as_ref().is_some_and(|session| session.local_practice());
        }
        let capture = match (self.island_phase, phase) {
            (IslandPhase::Recording, IslandPhase::Recording) => None,
            (_, IslandPhase::Selecting { .. }) => Some(Input::CaptureSelecting),
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
        if changed {
            // A new phase replaces the whole content; the chips go with it, and the outgoing
            // Recording content keeps showing them while it blurs away.
            self.reveal_prev_chips = previous_reveal;
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
        self.publish_capture_busy();
        let place = changed
            && (appearing
                || matches!(
                    phase,
                    IslandPhase::Selecting { .. } | IslandPhase::Recording
                ));
        if crate::shared::handoff::native_pill() {
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
    pub(crate) fn place_capsule(&self) {
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
        let Some(point) = anchor.or_else(crate::capture::engine::runtime::screens::pointer) else {
            return;
        };
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        if let Some(session) = &self.electron_pill { session.place(point); }
        match self.native_pill {
            Some(ref pill) => pill.place_on(point),
            None => platform::place_hud_pill(point),
        }
    }

    /// The iPhone's mirror window can be dragged to another display mid-recording: the ink
    /// overlay and the capsule go with it.
    fn follow_phone_mirror(&mut self) {
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
        if crate::capture::engine::runtime::screens::contains(overlay.screen(), centre)
            || !overlay.move_to([f.x, f.y, f.width, f.height])
        {
            return;
        }
        self.display_rect = overlay.screen().map(|v| v as f32);
        if let Some(ref pill) = self.native_pill {
            pill.place_on(centre);
        }
        #[cfg(any(target_os="macos",target_os="linux"))]
        if let Some(session)=&self.electron_pill {session.place(centre);}
    }

    /// Follow the pointer with Linux controls, not with the capture source. On Mac,
    /// a dragged capsule must stay where it was dropped for the whole recording.
    #[cfg(target_os = "linux")]
    fn follow_recording_pointer(&mut self) {
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
        if crate::capture::engine::runtime::screens::contains(current, pointer.map(f64::from)) {
            return;
        }
        let screens = crate::capture::engine::runtime::screens::current();
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
            if !platform::pill_user_moved() && !self.electron_pill.as_ref().is_some_and(|s|s.moved()) {
                self.place_capsule();
            }
        }
    }

    /// While picking, the picker (its window, overlay and the capsule) follows the pointer to
    /// whichever display it's on, unless an area is being dragged (an area stays on one display).
    fn follow_pointer_display(&mut self, pointer: [f32; 2], cx: &mut Context<Self>) {
        // The iPhone's mirror window stays where it is, and so does the highlight around it.
        if self.selection_drag.is_some()
            || self.lab
            || self.selection_mode() == Some(SelectionMode::Iphone)
        {
            return;
        }
        let p = pointer.map(f64::from);
        let current = self.display_rect.map(f64::from);
        if crate::capture::engine::runtime::screens::contains(current, p) {
            return;
        }
        let screens = crate::capture::engine::runtime::screens::current();
        let Some(i) = crate::capture::engine::runtime::screens::index_at(&screens, p) else {
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
    fn picker_mouse_up(&mut self, event: &MouseUpEvent, cx: &mut Context<Self>) {
        let [sx, sy] = current_mouse_screen()
            .unwrap_or([f32::from(event.position.x), f32::from(event.position.y)]);
        if let Some((start, _)) = self.selection_drag.take() {
            if let Some([x, y, w, h]) = area_rect(start, [sx, sy], self.display_rect) {
                let target = region_target(x, y, w, h, &self.selectable_windows);
                self.start_recording_with_target(|_| target, cx);
            } else {
                self.sync_picker_overlay();
                cx.notify();
            }
        }
    }

    pub(crate) fn ensure_native_pill(&mut self) {
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        if self.electron_pill_routed { return; }
        if !crate::shared::handoff::native_pill() || self.native_pill.is_some() {
            return;
        }
        match crate::capture::desktop::native::pill::NativePill::open() {
            Ok(pill) => {
                if !crate::shared::handoff::experiment("movableRecordingControls") {
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

    pub(in crate::capture::desktop) fn recording_has_no_words(&self) -> bool {
        matches!(
            self.active_recording.as_ref().map(|rec| &rec.source),
            Some(CaptureSource::Screen { audio: Some(audio), .. })
                if audio.live_word_state() == Some(crate::capture::engine::runtime::audio::transcription::live_word_warning::State::NoWords)
        )
    }

    fn pill_snapshot(&self) -> crate::capture::desktop::native::pill::PillSnapshot {
        use crate::capture::desktop::native::pill::{PillSnapshot, PillStyle, model::Pres};
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
            IslandPhase::Recording if self.reveal.presentation.no_words => {
                Pres::RecordingWarning {
                    chips: false,
                    has_iphone,
                }
            }
            IslandPhase::Recording => Pres::Recording {
                chips: self.reveal.chips,
                has_iphone,
            },
            IslandPhase::Processing => Pres::Processing,
            IslandPhase::Completed { .. } => {
                Pres::Completed {
                    share: self.fallback_share(),
                    warning: self.reveal.completed_presentation.completed_warning,
                    label: self.reveal.completed_presentation.label.clone(),
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
            input_waveform: matches!(self.island_phase, IslandPhase::Recording).then(|| {
                self.active_recording.as_ref().and_then(|recording| match &recording.source {
                    CaptureSource::Screen { audio: Some(audio), .. } =>
                        Some(audio.input_waveform().unwrap_or([0.0; 24])),
                    _ => None,
                })
            }).flatten(),
            reduced_motion: self.reduced_motion,
            style: PillStyle::current(),
        }
    }

    pub(crate) fn sync_native_pill(&mut self) {
        self.refresh_pill_presentation();
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        self.sync_electron_pill();
        if self.native_pill.is_some() {
            let snap = self.pill_snapshot();
            if let Some(ref pill) = self.native_pill {
                pill.sync(snap);
            }
        }
    }

    fn apply_pill_action(
        &mut self,
        action: crate::capture::desktop::native::pill::PillAction,
        cx: &mut Context<Self>,
    ) {
        use crate::capture::desktop::native::pill::PillAction;
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
            PillAction::Notes => {
                if self.is_recording() {
                    let (focus, owner) = platform::note_focus();
                    if let Some(ui) = &self.note_ui { ui.show_list(focus, owner); }
                }
            },
            PillAction::Paste(target) => self.paste_completed_bundle(target, cx),
            PillAction::CopyLink => self.copy_completed_link(cx),
            PillAction::CopyPublicLink => self.copy_completed_link_with_consent(true, cx),
            PillAction::Inspect => self.inspect_completed_bundle(cx),
            PillAction::SettingsAgents => self.open_settings(Some(settings::Pane::Agents)),
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
        self.apply_pill_event(PillEvent::Dismiss);
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
        self.apply_pill_event(PillEvent::Hide);
        self.island_opacity = 0.0;
        let entity = cx.entity().clone();
        cx.defer(move |cx| {
            close_capture_windows(cx);
            open_review_window(&entity, cx);
        });
        cx.notify();
    }

    fn tick_hosted_sharing(&mut self, cx: &mut Context<Self>) {
        if self.share_pending.is_some() {
            if let Some(percent) = crate::connect::hosted::foreground_progress() {
                if self.reveal.observed_upload_progress != Some(percent) {
                    self.reveal.observed_upload_progress = Some(percent);
                    self.show_completion_text(pill_state::CompletionCopy::Uploading, format!("Uploading… {percent}%"));
                    self.sync_native_pill();
                    cx.notify();
                }
                return;
            }
        }
        if !crate::shared::handoff::experiment(crate::connect::hosted::HOSTED_SHARING)
            || !matches!(self.island_phase, IslandPhase::Completed { .. })
            || self.share_probe_at.is_some_and(|at| at.elapsed() < Duration::from_secs(5)) {
            return;
        }
        self.share_probe_at = Some(Instant::now());
        let generation = self.capture_generation;
        let copied = self.share_copied.clone();
        cx.spawn(async move |entity, cx| {
            let (online, progress) = cx.background_executor().spawn(async move {
                (crate::connect::hosted::sharing_online(), copied.as_deref().map(crate::connect::hosted::sharing_progress))
            }).await;
            let _ = entity.update(cx, |coord, cx| {
                if coord.capture_generation != generation || !matches!(coord.island_phase, IslandPhase::Completed { .. }) { return; }
                coord.share_online = online;
                if coord.share_pending.is_none() {
                    if let Some(progress) = progress {
                        coord.show_completion_text(pill_state::CompletionCopy::ShareReceipt, progress);
                    } else if !online {
                        let configured = crate::connect::hosted::sharing_server().is_some();
                        let (kind, text) = if configured {
                            (pill_state::CompletionCopy::Offline, "Connect to the internet to share")
                        } else {
                            (pill_state::CompletionCopy::Ordinary, "Configure Hosted account in Settings")
                        };
                        coord.show_completion_text(kind, text);
                    } else {
                        coord.apply_pill_event(PillEvent::OnlineObserved);
                    }
                }
                coord.sync_native_pill();
                cx.notify();
            });
        }).detach();
    }

    fn cancel_completed_foreground_share(&mut self) -> bool {
        let Some((_, _, active)) = self.share_pending.take() else { return false };
        active.store(false, std::sync::atomic::Ordering::SeqCst);
        self.show_completion_text(
            pill_state::CompletionCopy::UploadStopped,
            "Upload cancelled · recording saved locally",
        );
        self.apply_pill_event(PillEvent::ShareEnded { renew: true });
        true
    }

    fn admit_completed_share_result(
        &mut self, bundle: &std::path::Path, generation: u64,
        active: &std::sync::Arc<std::sync::atomic::AtomicBool>, foreground: bool,
    ) -> bool {
        if !active.load(std::sync::atomic::Ordering::SeqCst)
            || !self.share_pending.as_ref().is_some_and(|(_, _, current)| std::sync::Arc::ptr_eq(current, active))
            || self.capture_generation != generation
            || self.completed_dir.as_deref() != Some(bundle)
            || !matches!(self.island_phase, IslandPhase::Completed { .. }) { return false; }
        self.share_pending = None;
        self.apply_pill_event(PillEvent::ShareEnded { renew: foreground });
        true
    }

    pub fn copy_completed_link(&mut self, cx: &mut Context<Self>) {
        self.copy_completed_link_with_consent(false, cx);
    }

    fn copy_completed_link_with_consent(&mut self, public: bool, cx: &mut Context<Self>) {
        if crate::connect::hosted::foreground_progress().is_some() {
            if self.cancel_completed_foreground_share() {
                self.sync_native_pill();
                cx.notify();
            }
            return;
        }
        if !crate::shared::handoff::experiment(crate::connect::hosted::HOSTED_SHARING)
            || !matches!(self.island_phase, IslandPhase::Completed { .. })
            || !self.share_online || self.share_pending.is_some() { return; }
        let Some(bundle) = self.completed_dir.clone() else { return };
        self.share_public = public;
        self.share_pending = Some((bundle, self.capture_generation, std::sync::Arc::new(std::sync::atomic::AtomicBool::new(true))));
        self.reveal.observed_upload_progress = None;
        self.apply_pill_event(PillEvent::ShareStarted);
        if !crate::connect::hosted::sharing_connected() {
            self.share_waiting_account = true;
            self.show_completion_text(pill_state::CompletionCopy::Ordinary, "Connect Hosted account to share");
            self.open_settings(Some(crate::capture::desktop::settings::Pane::General));
        } else {
            self.reserve_completed_link(false, cx);
        }
        self.sync_native_pill();
        cx.notify();
    }

    fn reserve_completed_link(&mut self, connect: bool, cx: &mut Context<Self>) {
        let Some((bundle, generation, active)) = self.share_pending.clone() else { return };
        self.share_waiting_account = false;
        let foreground = crate::connect::hosted::foreground_enabled();
        let public = self.share_public;
        self.show_completion_text(pill_state::CompletionCopy::Ordinary, if connect { "Approve hosted upload in your browser…" } else { "Reserving link…" });
        cx.spawn(async move |entity, cx| {
            let worker_bundle = bundle.clone();
            let worker_active = active.clone();
            let result = cx.background_executor().spawn(async move {
                let allowed = || worker_active.load(std::sync::atomic::Ordering::SeqCst)
                    && crate::shared::handoff::experiment(crate::connect::hosted::HOSTED_SHARING);
                if connect { crate::connect::hosted::connect_sharing(&allowed)?; }
                if public { crate::connect::hosted::prepare_public_link_handoff(&worker_bundle, &allowed, foreground) }
                else { crate::connect::hosted::copy_link_handoff(&worker_bundle, &allowed, foreground) }
            }).await;
            let _ = entity.update(cx, |coord, cx| {
                if !coord.admit_completed_share_result(&bundle, generation, &active, foreground) { return; }
                let mut copy = pill_state::CompletionCopy::ShareReceipt;
                let text = match result {
                    Ok(link) if link.authorized() => match crate::shared::handoff::copy_string_to_clipboard(&link.text) {
                        Ok(()) => {
                            if foreground { "Link copied".into() }
                            else { coord.share_copied = Some(bundle.clone()); crate::connect::hosted::sharing_progress(&bundle) }
                        }
                        Err(_) => "Copy failed · click Public link to retry".into(),
                    },
                    Ok(_) | Err(_) => if foreground {
                        copy = pill_state::CompletionCopy::UploadStopped;
                        "Upload failed · recording saved locally".into()
                    }
                        else { "Sharing stopped · click Public link to retry".into() },
                };
                coord.show_completion_text(copy, text);
                coord.sync_native_pill();
                cx.notify();
            });
        }).detach();
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
        if !crate::capture::engine::runtime::accessibility_granted() {
            apparent_log("Paste chip without Accessibility; asking for it");
            self.gate
                .defer(vec![crate::permission_facts::Permission::Accessibility]);
            return;
        }
        self.mark_handled(&dir);
        std::thread::spawn(move || {
            if let Err(err) = crate::shared::handoff::paste_bundle_at_target(&dir, click_target) {
                apparent_log(format!("paste_bundle_at_target error: {err}"));
                #[cfg(target_os = "linux")]
                crate::capture::desktop::linux::shell::notify(
                    "Paste stopped",
                    &format!(
                        "{err:#}. Manually attach the contact sheet and paste summary.md from {}",
                        dir.display()
                    ),
                );
            }
        });
    }

    /// Observe the native producer once; policy consumes the practice fact in TypeScript.
    fn take_recording_start(&mut self) -> Option<bool> {
        if self.recording_activity_attempted || self.agent_state().phase != crate::capture::desktop::workflow::agent_capture::Phase::Recording { return None; }
        self.recording_activity_attempted = true;
        if self.report_capture { None } else { Some(self.capture_local_practice) }
    }

    fn observe_recording_activity(&mut self) {
        if let Some(practice) = self.take_recording_start() {
            crate::connect::hosted::observe_recording_start(practice);
        }
    }

    /// Advance the UI without waiting on activity transport.
    pub fn island_tick(&mut self, cx: &mut Context<Self>) {
        self.observe_recording_activity();
        #[cfg(target_os = "macos")]
        if let Some(finish) = self.active_recording.as_ref().and_then(|recording| match &recording.source {
            CaptureSource::Screen { session, .. } => session.system_completion(),
            _ => None,
        }) {
            if finish { self.finish_recording(cx); } else { self.cancel_recording(cx); }
            return;
        }
        #[cfg(target_os = "linux")]
        if self.discard_failed_screen_start() {
            cx.defer(whiteboard::close);
            self.dismiss_island(cx);
            return;
        }
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        self.tick_electron_pill(cx);
        self.tick_hosted_sharing(cx);
        #[cfg(any(target_os = "linux", target_os = "macos"))]
        if matches!(self.island_phase, IslandPhase::Recording) {
            platform::tick_pill_drag();
        }
        if self.note_ui.is_some() {
            if let Some(ui) = self.note_ui.as_mut() { ui.set_embedded(self.electron_pill_routed); }
            let anchor = self.native_pill.as_ref().and_then(|p| p.note_badge_anchor());
            #[cfg(any(target_os = "linux", target_os = "macos"))]
            let anchor = self.electron_pill.as_ref().filter(|_| self.electron_pill_routed)
                .and_then(|pill| pill.note_badge_anchor()).or(anchor);
            #[cfg(target_os = "linux")]
            let anchor = anchor.or_else(|| platform::note_badge_anchor(self.island_width * self.island_scale, self.island_y + (PILL_WINDOW_H - ISLAND_H * self.island_scale) / 2.0));
            if let (Some(ui), Some(point)) = (self.note_ui.as_mut(), anchor) { ui.position_badge(point); }
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

    #[cfg(target_os = "linux")]
    fn discard_failed_screen_start(&mut self) -> bool {
        self.discard_failed_screen_start_notifying(crate::capture::desktop::linux::shell::notify)
    }

    #[cfg(target_os = "linux")]
    fn discard_failed_screen_start_notifying(&mut self, notify: impl FnOnce(&str, &str)) -> bool {
        // Inspect the current session synchronously: a late failure from an old
        // producer must never cancel its successor. A pending portal is not failure.
        if matches!(self.active_recording.as_ref().map(|r| &r.source),
            Some(CaptureSource::Screen { session, .. }) if session.failed_to_start()) {
            let failed_id = self.agent_capture_id.clone();
            self.cancel_capture_attempt();
            // Cancellation can fail to persist its tombstone; keep that session
            // active in that case rather than admitting another capture over it.
            if self.active_recording.is_none() {
                notify(
                    "Screen recording could not start",
                    "Try again and choose the screen under Outputs if the sharing dialog appears. No recording was saved.",
                );
                if let Some(id) = failed_id {
                    self.agent_captures.set(&id, "failed", None, Some("start_failed"));
                }
                return true;
            }
        }
        false
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
        self.advance_pill_deadlines();

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

        if self.reveal.chips {
            let activity = self.telemetry.reveal_activity();
            let on_pill = self
                .native_pill
                .as_ref()
                .map_or_else(pointer_on_hud_pill, |p| p.pointer_on_pill());
            #[cfg(any(target_os = "macos", target_os = "linux"))]
            let on_pill = self.electron_pill.as_ref().filter(|s| s.ready()).map_or(on_pill, |s| s.hovered());
            if on_pill != self.reveal.pointer_inside {
                self.reveal.pointer_inside = on_pill;
                self.apply_pill_event(PillEvent::PointerChanged { inside: on_pill });
            }
            if activity != self.reveal.activity_count {
                self.reveal.activity_count = activity;
                self.apply_pill_event(PillEvent::ActivityObserved { activity: activity as u32 });
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
            self.apply_pill_event(PillEvent::SurfaceHidden);
            self.island_opacity = 0.0;
            cx.defer(close_capture_windows);
        }
        if self.native_pill.is_none() {
            cx.notify();
        }
    }

    /// The menu bar's picker on platforms that still expose target selection.
    #[cfg(not(target_os = "linux"))]
    pub fn begin_target_selection(&mut self, cx: &mut Context<Self>) {
        self.open_picker(None, cx);
    }

    /// Opens the picker on `mode`, else on the mode the last recording used.
    fn open_picker(&mut self, mode: Option<SelectionMode>, cx: &mut Context<Self>) {
        if display_selection::pending() { return; }
        if mode == Some(SelectionMode::Window) {
            self.report_window_recording_disabled(cx);
            return;
        }
        if self.is_recording() || self.is_processing() {
            return;
        }
        if !self.ready_to_record(false) {
            return;
        }
        apparent_log(format!("open_picker invoked (mode: {mode:?})"));
        let started = Instant::now();
        self.recording_shortcut_key = false;
        self.selectable_windows.clear();
        self.hovered_window = None;
        self.animated_window_rect = None;
        self.selection_pointer = current_mouse_screen();
        // The picker opens on the display under the pointer and follows it there
        // (`follow_pointer_display`); Screen mode highlights all of it.
        let screens = crate::capture::engine::runtime::screens::current();
        if let Some(i) =
            crate::capture::engine::runtime::screens::pointer().and_then(|p| crate::capture::engine::runtime::screens::index_at(&screens, p))
        {
            self.display_rect = screens[i].frame.map(|v| v as f32);
        }
        if let Some(ref mut overlay) = self.picker_metal_overlay {
            overlay.move_to(self.display_rect.map(f64::from));
        }
        self.selection_generation += 1;
        self.windows_loading = !self.lab;
        if !self.lab {
            self.refresh_iphone(cx);
        }
        let generation = self.selection_generation;
        cx.spawn(async move |entity, cx| {
            if entity.read_with(cx, |coord, _| coord.lab).unwrap_or(true) {
                return;
            }
            let windows = cx
                .background_executor()
                .spawn(async { list_selectable_windows() })
                .await;
            let _ = entity.update(cx, |coord, cx| {
                // A previous picker request must not overwrite a reopened picker or recording.
                if coord.selection_generation != generation || !coord.is_selecting() {
                    return;
                }
                coord.windows_loading = false;
                let ptr = current_mouse_screen().or(coord.selection_pointer);
                coord.selection_pointer = ptr;
                coord.hovered_window = ptr
                    .and_then(|[x, y]| selectable_window_at(&windows, f64::from(x), f64::from(y)))
                    .cloned();
                if matches!(
                    coord.island_phase,
                    IslandPhase::Selecting {
                        mode: SelectionMode::Window
                    }
                ) {
                    coord.animated_window_rect = coord.hovered_window.as_ref().map(|w| {
                        [
                            w.frame.x as f32,
                            w.frame.y as f32,
                            w.frame.width as f32,
                            w.frame.height as f32,
                        ]
                    });
                }
                coord.selectable_windows = windows;
                coord.sync_picker_overlay();
                start_metric("picker_ready_ms", started);
                cx.notify();
            });
        })
        .detach();
        self.selection_drag = None;
        if matches!(
            self.island_phase,
            IslandPhase::Hidden | IslandPhase::Dismissing
        ) {
            // Enter near full size (0.92 -> 1.0) at full intrinsic layout width so inner buttons
            // are never clipped.
            self.island_width = self.island_target_width.max(195.0);
            self.island_velocity = 0.0;
            self.island_scale = 0.92;
            self.island_scale_velocity = 0.0;
            self.island_y = -6.0;
            self.island_y_velocity = 0.0;
            self.island_opacity = 0.0;
        }
        // Open on the mode the last recording used. The phone needs a live preview, started once
        // the picker is up; Window starts on Area's crosshair until the window list arrives.
        let opening = match mode.unwrap_or(self.last_mode) {
            SelectionMode::Iphone => SelectionMode::Area,
            mode => mode,
        };
        self.apply_pill_event(PillEvent::PickerOpened { mode: opening.into() });
        self.open_iphone_when_found = false;
        if mode.is_none() && self.last_mode == SelectionMode::Iphone {
            if self.iphone.is_some() {
                self.preview_iphone(cx);
            } else {
                self.open_iphone_when_found = true;
            }
        }
        self.telemetry.begin_picker_session();
        self.sync_picker_overlay();
        if self.picker_metal_overlay.is_none() && !self.lab {
            let [x, y, w, h] = self.display_rect.map(f64::from);
            let overlay =
                platform::open_overlay(Arc::clone(&self.telemetry), Some([x, y, w, h]), cx)
                    .map_err(|error| apparent_log(format!("Metal overlay failed: {error}")))
                    .ok();
            if let Some(ref ov) = overlay {
                self.telemetry
                    .excluded_window_ids
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner)
                    .push(ov.window_number());
                self.telemetry
                    .passthrough_window_ids
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner)
                    .push(ov.window_number());
            }
            self.picker_metal_overlay = overlay;
        }

        let entity = cx.entity().clone();
        cx.defer(move |cx| {
            close_review_window(cx);
            open_picker_windows(&entity, cx);
            start_metric("picker_open_ms", started);
        });
        cx.notify();
        start_metric("picker_prep_ms", started);
    }

    /// From the picker: the full screen it highlights.
    pub fn start_recording_full_screen(&mut self, cx: &mut Context<Self>) {
        let [x, y, w, h] = self.display_rect;
        let centre = [f64::from(x + w / 2.0), f64::from(y + h / 2.0)];
        self.start_recording_with_target(|lab| {
            if lab { lab::target() } else { crate::capture::engine::runtime::discover_target_at(None, Some(centre)) }
        }, cx);
    }

    fn choose_system_display(&mut self, cx: &mut Context<Self>) -> bool {
        if self.lab || self.agent_capture_id.is_some()
            || !display_selection::requested()
        {
            return false;
        }
        if crate::capture::desktop::workflow::shutdown::requested()
            || self.is_recording() || self.is_processing()
        {
            return true;
        }
        let Some(picker) = self.begin_system_display_picker() else { return true; };
        cx.spawn(async move |entity, cx| {
            let selected = picker.acquire(|| cx.background_executor().timer(Duration::from_millis(100))).await;
            let _ = entity.update(cx, |coord, cx| match selected {
                Some((target, source)) => coord.start_recording_from(|_| target, Some(source), cx),
                None => coord.cancel_recording(cx),
            });
        }).detach();
        true
    }

    fn start_recording_from(
        &mut self,
        target: impl FnOnce(bool) -> TargetInfo,
        prepared_source: Option<PreparedSource>,
        cx: &mut Context<Self>,
    ) {
        if display_selection::pending() { return; }
        #[cfg(any(target_os="macos",target_os="linux"))]
        self.reconcile_electron_pill();
        if crate::capture::desktop::workflow::shutdown::requested() { return; }
        if self.is_recording() || self.is_processing() {
            return;
        }
        if !self.ready_to_record(prepared_source.is_some()) {
            self.cancel_recording(cx);
            return;
        }
        let target = target(self.lab);
        if crate::capture::engine::runtime::ensure_recording_mode(target.mode).is_err() {
            self.report_window_recording_disabled(cx);
            return;
        }
        if self.lab {
            self.start_lab_recording(target, cx);
            return;
        }
        #[cfg(target_os = "linux")]
        if let Some(warning) = crate::capture::desktop::linux::media::encoder_warning() {
            apparent_log(&warning);
            crate::capture::desktop::linux::shell::notify("Apparent setup: H.264 encoder missing", &warning);
            self.cancel_recording(cx);
            return;
        }
        whiteboard::reset_for_capture(&self.whiteboard);
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        {
            let Ok(id) = self.agent_capture_id.clone().map_or_else(crate::capture::desktop::workflow::agent_capture::new_id, Ok) else {
                apparent_log("Could not create capture identity; refusing an untracked recording");
                self.cancel_recording(cx);
                return;
            };
            self.agent_captures.begin(&id);
            self.agent_capture_id = Some(id);
        }
        self.begin_playback();
        if let Ok(mut status) = CAPTURE_STATUS.lock() {
            *status = None;
        }
        let started = Instant::now();
        apparent_log(format!(
            "start_recording_with_target invoked: mode={:?} frame={:?}",
            target.mode, target.frame
        ));
        let quick = !self.is_selecting();
        self.telemetry.start_glow.store(
            quick && target.mode == CaptureMode::Display,
            std::sync::atomic::Ordering::Release,
        );
        if let IslandPhase::Selecting { mode } = self.island_phase {
            self.remember_mode(mode);
        }
        self.recording_shortcut_key = false;
        self.iphone_preview = None;
        self.selection_drag = None;
        self.hovered_window = None;
        self.animated_window_rect = None;
        let id = crate::shared::ids::make_bundle_id();
        let bundle_dir = crate::shared::handoff::default_captures_dir().join(format!("{id}.apparent"));
        let microphone_enabled = self.admitted_microphone.take().unwrap_or_else(crate::capture::engine::runtime::audio::mic::enabled);
        let Ok(preparation) = ScreenCaptureSession::prepare_start(&bundle_dir, microphone_enabled)
            .inspect_err(|error| self.refuse_raw_protection(error, cx)) else { return; };
        self.telemetry.set_capture_mode(target.mode);
        self.telemetry.reset_for_session(target.frame);
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        ui::electron_pill::restore_capture_exclusion(
            &mut self.telemetry.excluded_window_ids.lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner),
            self.electron_pill.as_ref().and_then(ui::electron_pill::Session::window_number),
            cfg!(target_os = "linux") || !crate::shared::handoff::experiment("movableRecordingControls"));
        #[cfg(target_os="macos")]
        self.telemetry.excluded_window_ids.lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .append(&mut self.electron_pill_exclusions);
        // The picker stays open until present_recording_island defers its close.
        // Keep it out of the first ScreenCaptureKit frames after the session reset.
        #[cfg(target_os = "macos")]
        restore_picker_exclusion(
            &mut self.telemetry.excluded_window_ids.lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner),
            platform::picker_window_number(),
        );
        let stage = Instant::now();
        let (target_rect, display_rect, centre) = ScreenCaptureSession::placement(target.frame);
        self.display_rect = display_rect;
        if let Some(pill) = &self.native_pill {
            pill.place_on(centre);
        }
        #[cfg(any(target_os = "linux", target_os = "macos"))]
        {
            platform::cancel_pill_drag();
            if cfg!(target_os = "linux") || self.native_pill.is_none() {
                platform::place_hud_pill(centre);
            }
        }
        let metal_overlay = self.picker_metal_overlay.take().map(|mut overlay| {
            overlay.move_to(target_rect);
            // reset_for_session cleared the picker's exclusion. Reusing its window
            // must not turn the ink layer into captured screen content on macOS.
            self.telemetry.excluded_window_ids.lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .push(overlay.window_number());
            overlay
        });
        let metal_overlay = metal_overlay.or_else(|| {
            let ov = platform::open_overlay(Arc::clone(&self.telemetry), Some(target_rect), cx)
                .map_err(|error| apparent_log(format!("Metal overlay failed: {error}")))
                .ok();
            if let Some(ref o) = ov {
                self.telemetry
                    .excluded_window_ids
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner)
                    .push(o.window_number());
                self.telemetry
                    .passthrough_window_ids
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner)
                    .push(o.window_number());
            }
            ov
        });
        #[cfg(target_os = "linux")]
        self.telemetry.set_native_note_window(
            if linux::wayland_session() && linux::hyprland::ink_fade_available() {
                metal_overlay.as_ref().map(|overlay| overlay.window_number())
            } else { None }
        );
        start_metric("metal_open_ms", stage);
        let Ok(preparation) = preparation.protect(&bundle_dir).inspect_err(|error| self.refuse_raw_protection(error, cx)) else { return; };
        self.publish_capture_busy();
        let stream_admission = crate::shared::handoff::experiment("localStreamingTranscription")
            .then(workflow::local_transcription::admission);
        let allow_notes = cfg!(target_os = "linux") || prepared_source.is_none();
        use crate::capture::engine::runtime::recording::recorder::StartError;
        let (screen_session, audio_recorder, window_log) = match ScreenCaptureSession::start_tracks(
            &target, &bundle_dir, &self.telemetry, microphone_enabled, stream_admission,
            #[cfg(target_os = "linux")]
            preparation.audio,
            prepared_source,
        ) {
            Ok(tracks) => tracks,
            Err(error) => {
                use workflow::error_reporting::Failure;
                let (message, failure) = match error {
                    StartError::MicrophoneIntent(error) => (format!("Could not preserve silent capture intent: {error}"), None),
                    StartError::Audio(error) => (format!("Capture refused: narration could not be saved: {error:#}"), Some(Failure::AudioStart)),
                    StartError::Screen(error) => (format!("Capture refused: {error:#}"), Some(Failure::ScreenStart)),
                };
                if let Some(failure) = failure { workflow::error_reporting::report(failure); }
                apparent_log(&message);
                self.cancel_recording(cx);
                if matches!(failure, Some(Failure::AudioStart)) {
                    if let Ok(mut status) = CAPTURE_STATUS.lock() { *status = Some(message); }
                }
                return;
            }
        };
        let stage = Instant::now();
        match allow_notes.then(|| workflow::notes::Session::start(&bundle_dir, Arc::clone(&self.telemetry), target.frame)) {
            Some(Ok(session)) => self.note_ui = Some(session),
            unavailable => {
                if let Some(Err(error)) = unavailable { apparent_log(format!("Notes UI unavailable: {error:#}")); }
                if let Ok(mut status) = CAPTURE_STATUS.lock() { *status = Some("Typed notes unavailable · recording continues".into()); }
            },
        }
        start_metric("notes_start_ms", stage);
        self.active_recording = Some(ActiveRecording {
            started: stage,
            target,
            bundle_dir,
            source: CaptureSource::Screen {
                session: screen_session,
                audio: audio_recorder,
                windows: window_log,
            },
            _metal_overlay: metal_overlay,
            microphone_enabled,
        });
        self.present_recording_island(cx);
        start_metric("recording_start_ms", started);
    }

    fn refuse_raw_protection(&mut self, error: &anyhow::Error, cx: &mut Context<Self>) {
        apparent_log(format!("Capture could not protect raw video: {error:#}"));
        workflow::error_reporting::report(workflow::error_reporting::Failure::ProtectRecording);
        self.cancel_recording(cx);
        if let Ok(mut status) = CAPTURE_STATUS.lock() {
            *status = Some("Capture failed — could not protect raw video".into());
        }
    }

    /// The island turns into the recording pill: from the picker it morphs, from nothing it opens
    /// from a compact capsule so the shell springs out to its width, Dynamic Island style.
    fn present_recording_island(&mut self, cx: &mut Context<Self>) {
        if matches!(self.island_phase, IslandPhase::Hidden) {
            self.island_width = ISLAND_OPEN_FROM_W;
            self.island_velocity = 0.0;
            self.island_scale = 0.92;
            self.island_scale_velocity = 0.0;
            self.island_y = -6.0;
            self.island_y_velocity = 0.0;
        }
        if !self.lab {
            crate::capture::desktop::settings::onboarding::Progress::recording_started();
            if self.onboarding.as_ref().is_some_and(|session| {
                session.mode() == crate::capture::desktop::settings::onboarding::Mode::Tour
                    && !session.local_practice()
            }) {
                self.cancel_onboarding_editor();
                self.onboarding = None;
            }
        }
        self.apply_pill_event(PillEvent::CaptureStarted);
        let entity = cx.entity().clone();
        cx.defer(move |cx| {
            close_review_window(cx);
            close_picker_window(cx);
            ensure_hud_pill_open(&entity, cx);
        });
        cx.notify();
    }

    /// `apparent lab pill`: a pretend recording with no capture, microphone, files or overlay, so
    /// the capsule goes through exactly the states a real one does.
    fn start_lab_recording(&mut self, target: TargetInfo, cx: &mut Context<Self>) {
        whiteboard::reset_for_capture(&self.whiteboard);
        if let IslandPhase::Selecting { mode } = self.island_phase {
            motion::trace_event(format!("record:{}", mode.label()));
        }
        self.iphone_preview = None;
        self.selection_drag = None;
        self.hovered_window = None;
        self.animated_window_rect = None;
        self.active_recording = Some(ActiveRecording {
            started: Instant::now(),
            target,
            bundle_dir: PathBuf::new(),
            microphone_enabled: false,
            source: CaptureSource::Lab,
            _metal_overlay: None,
        });
        self.present_recording_island(cx);
    }

    /// Mirrors the cabled iPhone in the helper's window and records its native video. The
    /// window's on-screen rect is the capture target, so the laser, ink, pins and clicks over it
    /// normalize straight into phone-screen coordinates (kept current as the window moves).
    pub fn start_recording_iphone(&mut self, cx: &mut Context<Self>) {
        if display_selection::pending() { return; }
        if self.is_recording() || self.is_processing() {
            return;
        }
        if let Ok(mut status) = CAPTURE_STATUS.lock() {
            *status = None;
        }
        apparent_log("start_recording_iphone invoked");
        if self.lab {
            self.start_lab_recording(crate::capture::engine::runtime::phone::phone_target("iPhone", None, None, 0, 0), cx);
            return;
        }
        if !self.ready_for(crate::permission_facts::Permission::Camera) {
            self.cancel_recording(cx);
            return;
        }
        whiteboard::reset_for_capture(&self.whiteboard);
        self.begin_playback();
        self.remember_mode(SelectionMode::Iphone);
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        {
            let Ok(id) = crate::capture::desktop::workflow::agent_capture::new_id() else {
                apparent_log("Could not create capture identity; refusing an untracked recording");
                self.cancel_recording(cx);
                return;
            };
            self.agent_captures.begin(&id);
            self.agent_capture_id = Some(id);
        }
        self.recording_shortcut_key = false;
        self.selection_drag = None;
        self.hovered_window = None;
        self.animated_window_rect = None;
        let bundle_dir = crate::shared::handoff::default_captures_dir()
            .join(format!("{}.apparent", crate::shared::ids::make_bundle_id()));
        let _ = std::fs::create_dir_all(&bundle_dir);
        let movie_path = bundle_dir.join("recording.mov");
        let existing_preview = self.iphone_preview.take();
        if let Some(dev) = existing_preview.as_ref().and_then(PhoneSession::device) {
            self.iphone = Some(dev);
        }
        let device = self.iphone.clone();
        let name = device
            .as_ref()
            .map_or("iPhone", |d| d.name.as_str())
            .to_owned();
        let target = crate::capture::engine::runtime::phone::phone_target(&name, None, None, 0, 0);
        let initial_frame = existing_preview
            .as_ref()
            .and_then(PhoneSession::rect)
            .map_or(
                TargetFrame {
                    x: -100_000.0,
                    y: -100_000.0,
                    width: 1.0,
                    height: 1.0,
                    scale: 2.0,
                },
                |[rx, ry, rw, rh]| TargetFrame {
                    x: f64::from(rx),
                    y: f64::from(ry),
                    width: f64::from(rw),
                    height: f64::from(rh),
                    scale: 2.0,
                },
            );
        self.telemetry.set_capture_mode(CaptureMode::Device);
        self.telemetry.reset_for_session(initial_frame);
        // Hold interaction telemetry inactive until the helper's `recording` event arrives.
        self.telemetry
            .active
            .store(false, std::sync::atomic::Ordering::Release);
        let session = if let Some(mut preview) = existing_preview {
            preview.begin_recording(&movie_path);
            preview
        } else {
            let dev_id = device.as_ref().map(|d| d.id.as_str());
            match PhoneSession::start(&movie_path, dev_id, Some(Arc::clone(&self.telemetry))) {
                Ok(session) => session,
                Err(error) => {
                    apparent_log(format!("iPhone capture could not start: {error:#}"));
                    workflow::error_reporting::report(workflow::error_reporting::Failure::PhoneStart);
                    #[cfg(any(target_os = "macos", target_os = "linux"))]
                    {
                        if let Some(id) = self.agent_capture_id.take() {
                            self.agent_captures.set(&id, "failed", None, Some("start_failed"));
                        }
                    }
                    self.telemetry.finish_session();
                    let _ = std::fs::remove_dir_all(&bundle_dir);
                    self.dismiss_island(cx);
                    return;
                }
            }
        };
        // Over the mirror window's display (the pointer's until the window reports its rect).
        let mirror = (initial_frame.x > -10_000.0).then_some([
            initial_frame.x,
            initial_frame.y,
            initial_frame.width,
            initial_frame.height,
        ]);
        let metal_overlay = self.picker_metal_overlay.take().or_else(|| {
            platform::open_overlay(Arc::clone(&self.telemetry), mirror, cx)
                .map_err(|error| apparent_log(format!("Metal overlay failed: {error}")))
                .ok()
        });
        self.active_recording = Some(ActiveRecording {
            started: Instant::now(),
            target,
            bundle_dir,
            source: CaptureSource::Phone(session),
            _metal_overlay: metal_overlay,
            microphone_enabled: true,
        });
        self.present_recording_island(cx);
    }

    /// The mirror ended without being asked: keep what was recorded, or drop an empty capture.
    fn phone_ended(&mut self, cx: &mut Context<Self>) {
        if self.iphone_preview.is_some() {
            self.iphone_preview = None;
            self.set_selection_mode(SelectionMode::Area, cx);
            return;
        }
        let recorded = match &self.active_recording {
            Some(ActiveRecording {
                source: CaptureSource::Phone(session),
                ..
            }) => session.has_recording(),
            _ => return,
        };
        if recorded {
            self.finish_recording(cx);
        } else {
            self.cancel_recording(cx);
        }
    }

    pub fn cancel_recording(&mut self, cx: &mut Context<Self>) {
        self.cancel_capture_attempt();
        self.present_capture_cancellation(cx);
    }

    fn present_capture_cancellation(&mut self, cx: &mut Context<Self>) {
        if self.is_recording() { return; }
        cx.defer(whiteboard::close);
        self.dismiss_island(cx);
    }

    /// Cancellation must also work before a visible island or recording exists.
    fn cancel_capture_attempt(&mut self) {
        display_selection::cancel();
        // dismiss_island is a no-op while Hidden: startup failure must revoke the
        // shortcut attempt here, not wait for a visible phase transition.
        if let Some(session) = self.onboarding.as_mut() {
            session.input(crate::capture::desktop::settings::onboarding::Input::CaptureEnded { completed: false });
        }
        self.playback.take();
        apparent_log("cancel_recording invoked");
        self.discard_recording();
    }

    /// Native producer admission: a pending Linux source has nothing to finalize.
    /// Use durable cancellation, including its refusal path, before releasing ownership.
    #[cfg(target_os = "linux")]
    fn cancel_pending_screen_finish(&mut self) -> bool {
        self.cancel_pending_screen_finish_notifying(crate::capture::desktop::linux::shell::notify)
    }

    #[cfg(target_os = "linux")]
    fn cancel_pending_screen_finish_notifying(&mut self, notify: impl FnOnce(&str, &str)) -> bool {
        if matches!(self.active_recording.as_ref().map(|r| &r.source),
            Some(CaptureSource::Screen { session, .. }) if !session.has_frames()) {
            self.cancel_capture_attempt();
            if self.active_recording.is_none() {
                notify("Recording ended before it started",
                    "No recording was saved. Try again, choose the screen under Outputs if asked, and wait for screen sharing to start before Finish.");
            }
            return true;
        }
        false
    }

    pub fn finish_recording(&mut self, cx: &mut Context<Self>) {
        self.observe_recording_activity();
        #[cfg(target_os = "linux")]
        if self.cancel_pending_screen_finish() {
            self.present_capture_cancellation(cx);
            return;
        }
        self.playback.take();
        apparent_log("finish_recording invoked");
        let Some(rec) = self.active_recording.take() else {
            return;
        };
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        let finishing_id = self.agent_capture_id.take();
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        if let Some(id) = &finishing_id {
            self.agent_captures.set(id, "processing", None, None);
        }
        #[cfg(target_os = "linux")]
        let agent_requested = std::mem::take(&mut self.agent_finishing);
        #[cfg(not(target_os = "linux"))]
        let agent_requested = false;
        let completion_source = if matches!(&rec.source, CaptureSource::Phone(_)) { "phone" } else { "screen" };
        // Keep the capture-local receipt alive while Finish drains already queued Saves.
        let note_receipt = self.note_ui.as_ref().map(workflow::notes::Session::saved_note_receipt);
        let notes_finished = self.note_ui.take().map(workflow::notes::Session::finish);
        let (events, strokes) = self.telemetry.finish_session();
        let bundle_dir = rec.bundle_dir;
        let target = rec.target;
        let source = rec.source;
        let report = self.report_capture;
        // Drop the Metal overlay immediately on the main thread so the screen frame clears,
        // and morph the Dynamic Island into the compact spinning "Processing…" state while
        // media teardown, transcription, and PNG encoding run on a background worker.
        drop(rec._metal_overlay);
        self.apply_pill_event(PillEvent::CaptureSealed);
        let generation = self.capture_generation;
        let completion_facts = desktop_completion::Facts {
            capture: desktop_completion::Capture {
                generation: generation.to_string(),
                capture_id: finishing_id.clone().unwrap_or_default(),
                request_id: finishing_id.clone(),
            },
            platform: if cfg!(target_os = "linux") { "linux" } else { "macos" }.into(),
            source: completion_source.into(),
            agent_requested,
            automatic_trial_enabled: desktop_completion::auto_paste_enabled(self.capture_local_practice),
            image_quality_warning: None, // Filled from the finalizer's immutable result.
            lab: self.lab,
            #[cfg(target_os = "linux")]
            hyprland: linux::hyprland::running(),
            #[cfg(not(target_os = "linux"))]
            hyprland: false,
            #[cfg(target_os = "linux")]
            wayland: crate::capture::desktop::linux::wayland_session(),
            #[cfg(not(target_os = "linux"))]
            wayland: false,
        };
        #[cfg(target_os = "linux")]
        {
            self.auto_paste_target = if completion_facts.automatic_trial_enabled && completion_facts.hyprland && completion_facts.wayland {
                linux::hyprland::focused_window().ok().map(|target| (generation, target))
            } else { None };
        }
        // Freeze practice policy with the worker, independent of window/UI lifetime.
        let local_practice = self.capture_local_practice;
        cx.notify();
        if matches!(source, CaptureSource::Lab) {
            cx.defer(whiteboard::close);
            let duration_ms = rec.started.elapsed().as_millis() as u64;
            let wait = Duration::from_secs_f32(lab::PROCESSING_S / motion::time_scale());
            cx.spawn(async move |entity, cx| {
                cx.background_executor().timer(wait).await;
                let _ = entity.update(cx, |coord, cx| {
                    if !coord.accepts_capture_result(generation) {
                        return;
                    }
                    coord.apply_pill_event(PillEvent::CaptureSaved { recovery: false, text: None, frame_count: 6, duration_ms });
                    cx.notify();
                });
            })
            .detach();
            return;
        }

        let final_whiteboard = whiteboard::finish_snapshot(&self.whiteboard, || whiteboard::close(cx));

        self.capture_finalizer_started();
        self.publish_capture_busy();
        cx.spawn(async move |entity, cx| {
            let result = cx
                .background_executor()
                .spawn(async move {

                    recording_completion::finalize(
                        source, target, bundle_dir, events, strokes, final_whiteboard, notes_finished,
                    )
                })
                .await;

            let _ = entity
                .update(cx, |coord, cx| {
                    let (finalized, duration_ms) = result;
                    if finalized.is_err() {
                        crate::capture::desktop::workflow::shutdown::clear_request();
                    }
                    // Release the worker even when its capsule was dismissed or
                    // a newer capture owns the UI. A completion never auto-quits.
                    coord.capture_finalizer_finished();
                    coord.publish_capture_busy();
                    coord.receive_capture_result(
                        generation,
                        !local_practice && !report,
                        #[cfg(any(target_os = "macos", target_os = "linux"))]
                        finishing_id.as_deref(),
                        finalized,
                        |dir| {
                            if !local_practice && !report { desktop_completion::connect_completed(dir); }
                        },
                        |coord, finalized| {
                            if report {
                                coord.dismiss_island(cx);
                                return;
                            }
                            // receive_capture_result admits only this generation's active UI.
                            if finalized.is_ok() {
                                if let Some(session) = coord.onboarding.as_mut() {
                                    session.practice_note_saved(note_receipt.as_ref().is_some_and(|receipt| receipt.load(std::sync::atomic::Ordering::Acquire)));
                                }
                            }
                            coord.present_capture_result(
                                finalized, duration_ms, completion_facts, cx,
                            );
                        },
                    );
                });
        })
        .detach();
    }

    fn accepts_capture_result(&self, generation: u64) -> bool {
        generation == self.capture_generation && self.is_processing()
    }
}
