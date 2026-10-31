use super::*;

impl ApparentCoordinator {
    /// The menu bar's picker, opening on the mode the last recording used.
    pub fn begin_target_selection(&mut self, cx: &mut Context<Self>) {
        if self.ready_to_record() {
            self.feedback_capture = false;
            self.open_picker(None, cx);
        }
    }

    /// Opens the picker on `mode`, else on the mode the last recording used.
    pub(super) fn open_picker(&mut self, mode: Option<SelectionMode>, cx: &mut Context<Self>) {
        if self.is_recording() || self.is_processing() {
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
        let screens = crate::screens::current();
        if let Some(i) =
            crate::screens::pointer().and_then(|p| crate::screens::index_at(&screens, p))
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
            self.island_phase = IslandPhase::Hidden;
        }
        // Open on the mode the last recording used. The phone needs a live preview, started once
        // the picker is up; Window starts on Area's crosshair until the window list arrives.
        let opening = match mode.unwrap_or(self.last_mode) {
            SelectionMode::Iphone => SelectionMode::Area,
            mode => mode,
        };
        self.set_island_phase(IslandPhase::Selecting { mode: opening });
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
        let target = if self.lab {
            lab::target()
        } else {
            crate::capture::discover_target_at(None, Some(centre))
        };
        self.start_recording_with_target(target, cx);
    }

    pub fn start_recording_with_target(&mut self, target: TargetInfo, cx: &mut Context<Self>) {
        if self.is_recording() || self.is_processing() {
            return;
        }
        if self.lab {
            self.start_lab_recording(target, cx);
            return;
        }
        // No surprise prompt mid-capture: the permissions are granted in onboarding.
        if !self.ready_to_record() {
            self.cancel_recording(cx);
            return;
        }
        #[cfg(target_os = "linux")]
        if let Some(warning) = crate::linux::media::encoder_warning() {
            apparent_log(&warning);
            crate::linux::shell::notify("Apparent setup: H.264 encoder missing", &warning);
            self.cancel_recording(cx);
            return;
        }
        whiteboard::reset_for_capture(&self.whiteboard);
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        {
            let Ok(id) = self.agent_capture_id.clone().map_or_else(crate::agent_capture::new_id, Ok) else {
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
        // Without the picker the start needs its own cue: the overlay flashes an edge glow.
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
        let id = crate::make_bundle_id();
        let root = std::env::var_os("APPARENT_BENCH_START")
            .map(PathBuf::from)
            .unwrap_or_else(crate::handoff::default_captures_dir);
        let bundle_dir = root.join(format!("{id}.apparent"));
        if let Err(error) = crate::recover::begin_screen_capture(&bundle_dir) {
            apparent_log(format!("Capture could not protect raw video: {error:#}"));
            self.cancel_recording(cx);
            if let Ok(mut status) = CAPTURE_STATUS.lock() {
                *status = Some("Capture failed — could not protect raw video".into());
            }
            return;
        }
        let video_path = bundle_dir.join("recording.mp4");

        self.telemetry.set_capture_mode(target.mode);
        self.telemetry.reset_for_session(target.frame);
        // The picker stays open until present_recording_island defers its close.
        // Keep it out of the first ScreenCaptureKit frames after the session reset.
        #[cfg(target_os = "macos")]
        restore_picker_exclusion(
            &mut self.telemetry.excluded_window_ids.lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner),
            platform::picker_window_number(),
        );
        let stage = Instant::now();
        // Reuse the continuous 120Hz Metal overlay opened in `begin_target_selection` so the
        // cutout and border never swap windows or jump a single pixel when recording starts.
        // It moves to the target's display if that's another one (a window picked there).
        let f = target.frame;
        let target_rect = [f.x, f.y, f.width, f.height];
        let screens = crate::screens::current();
        self.display_rect =
            crate::screens::index_at(&screens, [f.x + f.width / 2.0, f.y + f.height / 2.0])
                .map_or(target_rect, |i| screens[i].frame)
                .map(|v| v as f32);
        if let Some(ref pill) = self.native_pill {
            pill.place_on([f.x + f.width / 2.0, f.y + f.height / 2.0]);
        }
        #[cfg(target_os = "macos")]
        {
            platform::cancel_pill_drag();
            if self.native_pill.is_none() {
                platform::place_hud_pill([f.x + f.width / 2.0, f.y + f.height / 2.0]);
            }
        }
        #[cfg(target_os = "linux")]
        {
            platform::cancel_pill_drag();
            platform::place_hud_pill([f.x + f.width / 2.0, f.y + f.height / 2.0]);
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
        start_metric("metal_open_ms", stage);
        let stage = Instant::now();
        let audio_recorder = AudioRecorder::start().ok();
        start_metric("audio_start_ms", stage);
        let stage = Instant::now();
        let screen_session = ScreenCaptureSession::start(
            target.clone(),
            Some(video_path),
            Arc::clone(&self.telemetry.excluded_window_ids),
        );
        start_metric("sck_start_ms", stage);
        let window_log = (target.mode == CaptureMode::Display).then(|| {
            let started_at = *self
                .telemetry
                .started_at
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            crate::windows::WindowLogger::start(
                target.frame,
                started_at,
                Arc::clone(&self.telemetry.window_log_request),
            )
        });
        self.active_recording = Some(ActiveRecording {
            started: Instant::now(),
            target,
            bundle_dir,
            source: CaptureSource::Screen {
                session: screen_session,
                audio: audio_recorder,
                windows: window_log,
            },
            _metal_overlay: metal_overlay,
        });
        self.present_recording_island(cx);
        start_metric("recording_start_ms", started);
    }

    /// The island turns into the recording pill: from the picker it morphs, from nothing it opens
    /// from a compact capsule so the shell springs out to its width, Dynamic Island style.
    pub(super) fn present_recording_island(&mut self, cx: &mut Context<Self>) {
        if matches!(self.island_phase, IslandPhase::Hidden) {
            self.island_width = ISLAND_OPEN_FROM_W;
            self.island_velocity = 0.0;
            self.island_scale = 0.92;
            self.island_scale_velocity = 0.0;
            self.island_y = -6.0;
            self.island_y_velocity = 0.0;
        }
        self.set_island_phase(IslandPhase::Recording);
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
    pub(super) fn start_lab_recording(&mut self, target: TargetInfo, cx: &mut Context<Self>) {
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
            source: CaptureSource::Lab,
            _metal_overlay: None,
        });
        self.present_recording_island(cx);
    }

    /// Mirrors the cabled iPhone in the helper's window and records its native video. The
    /// window's on-screen rect is the capture target, so the laser, ink, pins and clicks over it
    /// normalize straight into phone-screen coordinates (kept current as the window moves).
    pub fn start_recording_iphone(&mut self, cx: &mut Context<Self>) {
        if self.is_recording() || self.is_processing() {
            return;
        }
        if let Ok(mut status) = CAPTURE_STATUS.lock() {
            *status = None;
        }
        apparent_log("start_recording_iphone invoked");
        if self.lab {
            self.start_lab_recording(crate::phone::phone_target("iPhone", None, None, 0, 0), cx);
            return;
        }
        if !self.ready_for(crate::onboarding::Permission::Camera) {
            self.cancel_recording(cx);
            return;
        }
        whiteboard::reset_for_capture(&self.whiteboard);
        self.begin_playback();
        self.remember_mode(SelectionMode::Iphone);
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        {
            let Ok(id) = crate::agent_capture::new_id() else {
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
        let bundle_dir = crate::handoff::default_captures_dir()
            .join(format!("{}.apparent", crate::make_bundle_id()));
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
        let target = crate::phone::phone_target(&name, None, None, 0, 0);
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
        });
        self.present_recording_island(cx);
    }

    /// The mirror ended without being asked: keep what was recorded, or drop an empty capture.
    pub(super) fn phone_ended(&mut self, cx: &mut Context<Self>) {
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
        cx.defer(whiteboard::close);
        self.dismiss_island(cx);
    }

    /// Cancellation must also work before a visible island or recording exists.
    pub(super) fn cancel_capture_attempt(&mut self) {
        // dismiss_island is a no-op while Hidden: startup failure must revoke the
        // shortcut attempt here, not wait for a visible phase transition.
        if let Some(session) = self.onboarding.as_mut() {
            session.input(crate::onboarding::Input::CaptureEnded { completed: false });
        }
        self.playback.take();
        apparent_log("cancel_recording invoked");
        self.feedback_capture = false;
        self.discard_recording();
    }

    pub fn finish_recording(&mut self, cx: &mut Context<Self>) {
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
        let feedback_capture = std::mem::take(&mut self.feedback_capture);
        #[cfg(target_os = "linux")]
        let auto_active = !std::mem::take(&mut self.agent_finishing)
            && crate::handoff::experiment(crate::linux::auto_paste::EXPERIMENT)
            && crate::linux::hyprland::running()
            && crate::linux::wayland_session()
            && !self.lab
            && !feedback_capture
            && matches!(&rec.source, CaptureSource::Screen { .. });
        #[cfg(not(target_os = "linux"))]
        let auto_active = false;
        let (events, strokes) = self.telemetry.finish_session();
        let bundle_dir = rec.bundle_dir;
        let target = rec.target;
        let source = rec.source;
        // Drop the Metal overlay immediately on the main thread so the screen frame clears,
        // and morph the Dynamic Island into the compact spinning "Processing…" state while
        // media teardown, transcription, and PNG encoding run on a background worker.
        drop(rec._metal_overlay);
        self.set_island_phase(IslandPhase::Processing);
        let generation = self.capture_generation;
        self.completed_note = None;
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
                    coord.set_island_phase(IslandPhase::Completed {
                        finished_at: Instant::now(),
                        frame_count: 6,
                        duration_ms,
                        inbox_count: 0,
                    });
                    cx.notify();
                });
            })
            .detach();
            return;
        }

        let final_whiteboard = whiteboard::finish_snapshot(&self.whiteboard, || whiteboard::close(cx));

        cx.spawn(async move |entity, cx| {
            let result = cx
                .background_executor()
                .spawn(async move {
                    let (screen_session, audio_recorder, window_log) = match source {
                        CaptureSource::Screen {
                            session,
                            audio,
                            windows,
                        } => (session, audio, windows),
                        CaptureSource::Phone(session) => {
                            let finalized = session.stop().and_then(|recording| {
                                crate::phone::finalize_live_capture(
                                    &bundle_dir,
                                    recording,
                                    events,
                                    strokes,
                                    None,
                                )
                            }).map(|(dir, bundle, summary)| {
                                let (bundle, summary) = whiteboard::finish_handoff(
                                    &dir, bundle, summary, &final_whiteboard,
                                );
                                (dir, bundle, summary)
                            });
                            if let Err(error) = &finalized {
                                apparent_log(format!("iPhone capture failed: {error:#}"));
                            }
                            let duration_ms =
                                finalized.as_ref().map_or(0, |(_, b, _)| b.duration_ms);
                            return (finalized, duration_ms);
                        }
                        CaptureSource::Lab => {
                            return (Err(anyhow::anyhow!("a lab recording has no bundle")), 0);
                        }
                    };
                    let stop_started = Instant::now();
                    let (recording, recorded_audio, mut activity) = std::thread::scope(|s| {
                        let screen_handle = s.spawn(|| screen_session.stop());
                        let win_handle = s.spawn(|| {
                            window_log
                                .map(crate::windows::WindowLogger::stop)
                                .unwrap_or_default()
                        });
                        let audio = audio_recorder.and_then(|r| r.stop().ok());
                        (
                            screen_handle.join().unwrap(),
                            audio,
                            win_handle.join().unwrap_or_default(),
                        )
                    });
                    activity.stop_started = Some(stop_started);
                    activity.stop_ms = Some(stop_started.elapsed().as_millis() as u64);
                    let duration_ms = recording.duration_ms;
                    let finalized = crate::finalize_capture_bundle(
                        &bundle_dir,
                        target,
                        recording,
                        strokes,
                        events,
                        recorded_audio,
                        None,
                        activity,
                        None,
                    )
                    .map(|(dir, bundle, summary)| {
                        let (bundle, summary) = whiteboard::finish_handoff(
                            &dir, bundle, summary, &final_whiteboard,
                        );
                        (dir, bundle, summary)
                    });
                    (finalized, duration_ms)
                })
                .await;

            let _ = entity
                .update(cx, |coord, cx| {
                    let (finalized, duration_ms) = result;
                    coord.receive_capture_result(
                        generation,
                        #[cfg(any(target_os = "macos", target_os = "linux"))]
                        finishing_id.as_deref(),
                        feedback_capture,
                        finalized,
                        |dir| {
                            #[cfg(any(target_os = "macos", target_os = "linux"))]
                            crate::hosted::completed(dir);
                        },
                        |coord, finalized| {
                            coord.completed_dir = None;
                            let (dir, bundle, _) = match finalized {
                                Ok(capture) => capture,
                                Err(error) => {
                                    apparent_log(format!("Capture failed: {error:#}"));
                                    #[cfg(target_os = "linux")]
                                    crate::linux::shell::notify("Capture failed", &error.to_string());
                                    if let Ok(mut status) = CAPTURE_STATUS.lock() {
                                        *status = Some(if error.to_string().starts_with("No screen frames were captured") {
                                            "Capture failed — no screen frames".into()
                                        } else {
                                            "Capture failed".into()
                                        });
                                    }
                                    coord.set_island_phase(IslandPhase::Dismissing);
                                    cx.notify();
                                    return;
                                }
                            };
                            let frame_count = bundle.keyframes.len();
                            if let Ok(mut status) = CAPTURE_STATUS.lock() {
                                *status = None;
                            }
                            #[cfg(target_os = "linux")]
                            if let Ok(summary) = std::fs::read_to_string(dir.join("summary.md")) {
                                if summary.contains("Image quality: ") {
                                    crate::linux::shell::notify(
                                        "Capture used smaller keyframes",
                                        "Full-quality MP4 decoding failed. Open summary.md for details and Settings › Recording for decoder setup.",
                                    );
                                }
                            }
                            // Feedback stays local until the user explicitly copies or attaches it.
                            // For the blocked automatic trial, leave only text on Ctrl+V even if
                            // the independent clipboardImage experiment is enabled.
                            let clipboard_ready = !feedback_capture
                                && (if auto_active {
                                    #[cfg(target_os = "linux")]
                                    { crate::handoff::copy_bundle_text_to_clipboard(&dir) }
                                    #[cfg(not(target_os = "linux"))]
                                    { crate::handoff::copy_bundle_to_clipboard(&dir) }
                                } else {
                                    crate::handoff::copy_bundle_to_clipboard(&dir)
                                })
                                .map_err(|error| apparent_log(format!("Copy handoff failed: {error:#}")))
                                .is_ok();
                            #[cfg(target_os = "linux")]
                            if auto_active && clipboard_ready {
                                // Do not dispatch a paste until the receiver can prove its
                                // draft identity and acknowledge the image attachment.
                                if let Err(error) = crate::linux::auto_paste::auto_receiver_preflight() {
                                    apparent_log(format!("Automatic draft paste skipped: {error:#}"));
                                    crate::linux::shell::notify(
                                        "Draft paste skipped",
                                        &format!("{error:#}. Press Ctrl+V for the text; attach contact-sheet.png from {} if needed", dir.display()),
                                    );
                                }
                            } else if auto_active {
                                crate::linux::shell::notify("Draft paste skipped", "Could not copy the handoff. Use the saved bundle from the paper tile.");
                            }
                            coord.completed_dir = Some(dir.clone());
                            coord.last_local_capture_ms = crate::now_epoch_ms();
                            if feedback_capture {
                                // No automatic clipboard write: the completed pill must not claim
                                // that this private capture was copied.
                                coord.completed_note = Some("Saved · review".into());
                            }
                            #[cfg(target_os = "linux")]
                            if auto_active {
                                // No receiver receipt: keep the manual handoff visible.
                                coord.completed_note = Some(crate::linux::auto_paste::completion_note(clipboard_ready).into());
                            }
                            coord.set_review_bundle((dir, bundle), coord.completed_note.clone());
                            if feedback_capture {
                                coord.review_feedback = true;
                                coord.review_status = Some("Review before sharing publicly. Nothing is uploaded automatically.".into());
                                let entity = entity.clone();
                                cx.defer(move |cx| {
                                    close_capture_windows(cx);
                                    if let Some(entity) = entity.upgrade() {
                                        open_review_window(&entity, cx);
                                    }
                                });
                            }
                            coord.set_island_phase(IslandPhase::Completed {
                                finished_at: Instant::now(),
                                frame_count,
                                duration_ms,
                                inbox_count: 0,
                            });
                            cx.notify();
                        },
                    );
                });
        })
        .detach();
    }

    /// Dispatches a finalizer receipt separately from effects on the current capture UI.
    pub(super) fn receive_capture_result(
        &mut self,
        generation: u64,
        #[cfg(any(target_os = "macos", target_os = "linux"))] finishing_id: Option<&str>,
        feedback_capture: bool,
        finalized: anyhow::Result<(PathBuf, ApparentBundle, String)>,
        on_completed: impl FnOnce(&std::path::Path),
        on_current: impl FnOnce(&mut Self, anyhow::Result<(PathBuf, ApparentBundle, String)>),
    ) {
        // The worker still owns its exact ID's receipt after dismissal. Only its
        // UI/clipboard/onboarding effects lose ownership when a new capture starts.
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        if let Some(id) = finishing_id {
            self.agent_captures.finish(id, finalized.as_ref()
                .map(|(dir, _, _)| dir.as_path())
                .map_err(|error| format!("{error:#}")));
        }
        // A saved ordinary capture completes independently of its pill. Hosted
        // admission rechecks current consent; feedback and failed takes stay local.
        if !feedback_capture {
            if let Ok((dir, _, _)) = &finalized {
                on_completed(dir);
            }
        }
        if !self.accepts_capture_result(generation) {
            return;
        }
        on_current(self, finalized);
    }

    pub(super) fn accepts_capture_result(&self, generation: u64) -> bool {
        generation == self.capture_generation && self.is_processing()
    }

}
