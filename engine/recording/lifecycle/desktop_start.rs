include!("pending_desktop_start.rs");

impl ApparentCoordinator {
    pub fn start_recording_with_target(&mut self, target: impl FnOnce(bool) -> TargetInfo, cx: &mut Context<Self>) {
        self.start_recording_from(
            target,
            None,
            #[cfg(target_os = "linux")]
            None,
            #[cfg(target_os = "linux")]
            true,
            cx,
        );
    }

    fn choose_system_display(&mut self, cx: &mut Context<Self>) -> bool {
        if self.lab || self.agent_capture_id.is_some()
            || !display_selection::requested()
        {
            return false;
        }
        if crate::capture::desktop::workflow::shutdown::requested()
            || self.is_recording() || self.source_is_stopping()
        {
            return true;
        }
        let Some(picker) = self.begin_system_display_picker() else { return true; };
        cx.spawn(async move |entity, cx| {
            let selected = picker.acquire(|| cx.background_executor().timer(Duration::from_millis(100))).await;
            let _ = entity.update(cx, |coord, cx| match selected {
                Some(selected) => coord.start_recording_from(
                    |_| selected.target,
                    Some(selected.source),
                    #[cfg(target_os = "linux")]
                    selected.storage,
                    #[cfg(target_os = "linux")]
                    false,
                    cx,
                ),
                None => coord.cancel_recording(cx),
            });
        }).detach();
        true
    }

    fn discard_recording(&mut self) -> Option<(TargetInfo, Option<LaserOverlay>)> {
        #[cfg(target_os = "linux")]
        use crate::capture::engine::runtime::recording::recorder::{fd_path, verify_directory};
        #[cfg(target_os = "linux")]
        let storage = self.active_recording.as_ref().and_then(|recording| match &recording.source {
            CaptureSource::Screen { session, .. } => session.storage_dir.as_ref(),
            _ => None,
        });
        if let Some(rec) = &self.active_recording
            && !matches!(rec.source, CaptureSource::Lab)
        {
            #[cfg(target_os = "linux")]
            let pinned_path = storage.map(fd_path);
            #[cfg(not(target_os = "linux"))]
            let pinned_path: Option<std::path::PathBuf> = None;
            let directory = pinned_path.as_deref().unwrap_or(&rec.bundle_dir);
            if let Err(error) = crate::capture::engine::bundle::recover::cancel(directory) {
                apparent_log(format!("Could not persist cancellation; capture is still active: {error:#}"));
                return None;
            }
        }
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        if let Some(id) = self.agent_capture_id.take() {
            self.agent_captures.set(&id, "cancelled", None, None);
        }
        self.report_capture = false;
        let rec = self.active_recording.take()?;
        self.note_ui = None;
        let _ = self.telemetry.finish_session();
        #[cfg(target_os = "linux")]
        let mut storage = None;
        match rec.source {
            CaptureSource::Screen { session, audio, .. } => {
                #[cfg(target_os = "linux")]
                let session = {
                    let mut session = session;
                    storage = session.storage_dir.take();
                    session
                };
                let _ = session.stop();
                if let Some(audio) = audio {
                    let _ = audio.stop();
                }
            }
            CaptureSource::Phone(session) => session.cancel(),
            CaptureSource::Lab => return Some((rec.target, rec._metal_overlay)),
        }
        #[cfg(target_os = "linux")]
        if let Some(storage) = storage
            && let Err(error) = verify_directory(&storage, &rec.bundle_dir)
        {
            apparent_log(format!("Cancelled capture storage changed; skipped path cleanup: {error:#}"));
            return Some((rec.target, rec._metal_overlay));
        }
        if let Err(error) = crate::capture::engine::bundle::recover::delete_cancelled(&rec.bundle_dir) {
            apparent_log(format!("Cancelled assets could not be deleted at {}: {error:#}; recovery remains forbidden", rec.bundle_dir.display()));
        }
        Some((rec.target, rec._metal_overlay))
    }

    fn observe_recording_activity(&mut self) {
        #[cfg(any(target_os = "linux", target_os = "macos"))]
        if let Some(ActiveRecording { performance: Some(performance), .. }) = self.active_recording.as_mut()
            && performance.needs_pill()
            && let Some((flushed, reported)) = self.electron_pill.as_ref().and_then(|pill| pill.recording_pill_timing(self.capture_generation, false))
        {
            performance.pill_reported(flushed, reported);
        }
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        if let Some(ActiveRecording { performance: Some(performance), .. }) = self.active_recording.as_mut()
            && performance.needs_red_pill()
            && let Some((flushed, reported)) = self.electron_pill.as_ref().and_then(|pill| pill.recording_pill_timing(self.capture_generation, true))
        {
            performance.red_pill_reported(flushed, reported);
        }
        if let Some(ActiveRecording { performance: Some(performance), source: CaptureSource::Screen { session, .. }, .. }) = self.active_recording.as_mut()
            && performance.needs_ready() && session.has_frames()
        {
            performance.live();
        }
        if let Some(practice) = self.take_recording_start() {
            crate::connect::hosted::observe_recording_start(practice);
        }
    }

    fn start_recording_from(
        &mut self,
        target: impl FnOnce(bool) -> TargetInfo,
        prepared_source: Option<PreparedSource>,
        #[cfg(target_os = "linux")]
        picker_storage: Option<crate::capture::engine::runtime::recording::recorder::ChooserStorage>,
        #[cfg(target_os = "linux")] allow_early_pill: bool,
        cx: &mut Context<Self>,
    ) {
        let recording_entered = Instant::now();
        if display_selection::pending() { return; }
        if crate::capture::desktop::workflow::shutdown::requested() { return; }
        if self.is_recording() || self.source_is_stopping() {
            return;
        }
        if let Err(admission) = self.recording_start_admission(prepared_source.is_some()) {
            #[cfg(any(target_os = "macos", target_os = "linux"))]
            let request_id = self.agent_capture_id.clone();
            self.cancel_recording(cx);
            #[cfg(any(target_os = "macos", target_os = "linux"))]
            if let Some(id) = request_id {
                self.agent_captures.fail_start_permissions(&id, admission);
            }
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
            crate::capture::desktop::linux::shell::notify("Apparent: H.264 preflight failed", &warning);
            self.cancel_recording(cx);
            return;
        }
        self.whiteboard.borrow_mut().reset();
        let user_started = self.agent_capture_id.is_none();
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
        #[cfg(target_os = "linux")]
        {
            let shortcut = self.telemetry.shortcut.lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner).label.clone();
            workflow::electron::desktop_frog::hide_for_capture(cx, &shortcut);
        }
        self.begin_playback();
        if let Ok(mut status) = CAPTURE_STATUS.lock() {
            *status = None;
        }
        let started = Instant::now();
        let performance = if self.report_capture
            || self.onboarding.as_ref().is_some_and(|session| session.local_practice())
        {
            None
        } else {
            workflow::performance::RecordingPerformance::begin(recording_entered)
        };
        use workflow::performance::StartupPoint;
        let startup = performance.as_ref().map(|performance| performance.startup().clone());
        if let Some(trace) = &startup {
            trace.record_at(StartupPoint::Entry, recording_entered);
            trace.record_at(StartupPoint::ContextReady, started);
        }
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
        let admitted = self.admitted_microphone.take();
        let microphone_enabled = admitted.unwrap_or_else(crate::capture::engine::runtime::audio::mic::enabled);
        let (target_rect, display_rect, centre) = ScreenCaptureSession::placement(target.frame);
        self.display_rect = display_rect;
        #[cfg(target_os = "linux")]
        let early_pill = allow_early_pill && user_started && quick && target.mode == CaptureMode::Display
            && prepared_source.is_none() && picker_storage.is_none()
            && self.onboarding.is_none() && !self.report_capture;
        #[cfg(target_os = "linux")]
        let preparation = ScreenCaptureSession::prepare_picker_start(picker_storage, &bundle_dir, microphone_enabled, early_pill);
        #[cfg(not(target_os = "linux"))]
        let preparation = ScreenCaptureSession::prepare_start(&bundle_dir, microphone_enabled);
        let Ok(preparation) = preparation.inspect_err(|error| self.refuse_raw_protection(error, cx)) else { return; };
        #[cfg(target_os = "linux")]
        let cancellation = preparation.pending_cancellation.clone();
        #[cfg(target_os = "linux")]
        if let Some(cancellation) = &cancellation {
            self.stopping_source = SourceTransition::Starting(cancellation.clone());
            StartupPoint::PillRequested.record_in(startup.as_ref());
            self.show_recording_island(cx);
        }
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
        #[cfg(target_os = "macos")]
        restore_picker_exclusion(
            &mut self.telemetry.excluded_window_ids.lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner),
            platform::picker_window_number(),
        );
        let stage = Instant::now();
        #[cfg(target_os = "linux")]
        platform::cancel_pill_drag();
        if let Some(session) = &self.electron_pill {
            session.place(centre);
        }
        let metal_overlay = self.picker_metal_overlay.take().map(|mut overlay| {
            overlay.move_to(target_rect);
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
        let draft = DesktopScreenStart {
            target, bundle_dir, overlay: metal_overlay, microphone: microphone_enabled,
            user_started, allow_notes: cfg!(target_os = "linux") || prepared_source.is_none(),
            started, performance, startup,
        };
        #[cfg(target_os = "linux")]
        if let Some(cancellation) = cancellation {
            self.start_screen_in_background(draft, preparation, cancellation, cx);
            return;
        }
        let Ok(preparation) = preparation.protect(&draft.bundle_dir).inspect_err(|error| self.refuse_raw_protection(error, cx)) else { return; };
        #[cfg(target_os = "linux")]
        if workflow::shutdown::requested() {
            if let Err(error) = preparation.abandon(&draft.bundle_dir) {
                apparent_log(format!("Failed startup shutdown cleanup: {error:#}"));
            }
            self.cancel_recording(cx);
            return;
        }
        self.publish_capture_busy();
        let stream_admission = crate::shared::handoff::experiment_preference("labs.localStreamingTranscription")
            .then(workflow::local_transcription::admission);
        StartupPoint::TracksEnter.record_in(draft.startup.as_ref());
        let tracks = ScreenCaptureSession::start_tracks(
            &draft.target, &draft.bundle_dir, &self.telemetry, draft.microphone, stream_admission,
            #[cfg(target_os = "linux")]
            preparation,
            prepared_source,
            draft.startup.as_ref(),
        );
        self.complete_screen_start(draft, tracks, false, cx);
    }

    fn complete_screen_start(
        &mut self,
        draft: DesktopScreenStart,
        tracks: Result<ScreenTracks, StartError>,
        shown: bool,
        cx: &mut Context<Self>,
    ) {
        use workflow::performance::StartupPoint;
        let DesktopScreenStart {
            target, bundle_dir, overlay, microphone, user_started, allow_notes, started, performance, startup,
        } = draft;
        let (screen_session, audio_recorder, window_log) = match tracks {
            Ok(tracks) => tracks,
            Err(error) => {
                use workflow::error_reporting::Failure;
                let (message, failure) = match error {
                    #[cfg(target_os = "linux")]
                    StartError::Cancelled => {
                        self.cancel_recording(cx);
                        return;
                    }
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
        if let Some(trace) = &startup {
            trace.record(StartupPoint::TracksReturn);
        }
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
            user_started,
            performance,
            started: stage,
            target,
            bundle_dir,
            source: CaptureSource::Screen {
                session: screen_session,
                audio: audio_recorder,
                windows: window_log,
            },
            _metal_overlay: overlay,
            microphone_enabled: microphone,
        });
        if let Some(trace) = &startup {
            trace.record(StartupPoint::NotesReady);
        }
        if shown {
            self.confirm_recording_started();
            self.observe_recording_activity();
            self.sync_electron_pill();
            cx.notify();
        } else {
            StartupPoint::PillRequested.record_in(startup.as_ref());
            self.present_recording_island(cx);
        }
        start_metric("recording_start_ms", started);
    }

}
