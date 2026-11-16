impl ApparentCoordinator {
    fn new(
        telemetry: Arc<SharedCaptureTelemetry>,
        initial_bundle: Option<(PathBuf, ApparentBundle)>,
    ) -> Self {
        crate::capture::desktop::playback::warm_up();
        Self {
            telemetry,
            note_ui: None,
            admitted_microphone: None,
            whiteboard: Rc::new(RefCell::new(whiteboard::Board::default())),
            active_recording: None,
            capture_generation: 0,
            completion_pending: None,
            capture_local_practice: false,
            recording_activity_attempted: false,
            pending_finalizers: 0,
            #[cfg(any(target_os = "macos", target_os = "linux"))]
            agent_capture_id: None,
            #[cfg(any(target_os = "macos", target_os = "linux"))]
            agent_captures: crate::capture::desktop::workflow::agent_capture::Registry::default(),
            #[cfg(any(target_os = "macos", target_os = "linux"))]
            public_share: crate::capture::desktop::workflow::public_sharing::Controller::default(),
            #[cfg(target_os = "linux")]
            agent_finishing: false,
            last_live_no_words: false,
            playback: None,
            picker_metal_overlay: None,
            native_pill: None,
            #[cfg(any(target_os = "macos", target_os = "linux"))]
            electron_pill: None,
            #[cfg(any(target_os = "macos", target_os = "linux"))]
            electron_pill_failed: false,
            #[cfg(any(target_os = "macos", target_os = "linux"))]
            electron_pill_routed: false,
            #[cfg(target_os="macos")]
            electron_pill_exclusions: Vec::new(),
            iphone_preview: None,
            island_phase: IslandPhase::Hidden,
            island_prev_phase: IslandPhase::Hidden,
            island_phase_since: motion::now(),
            island_dismissed_from: IslandPhase::Hidden,
            island_width: 205.0,
            island_target_width: 205.0,
            island_velocity: 0.0,
            island_scale: 0.92,
            island_scale_velocity: 0.0,
            island_y: -6.0,
            island_y_velocity: 0.0,
            island_opacity: 0.0,
            island_morph: Morph::Phase,
            reveal: crate::capture::desktop::settings::shortcut::Reveal::default(),
            reveal_since: motion::now(),
            reveal_outgoing: None,
            reveal_prev_chips: false,
            reduced_motion: false,
            switch: None,
            island_stepped: Instant::now(),
            island_await_frame: false,
            last_elapsed_ms: 0,
            highlight_prev: None,
            highlight_since: motion::now(),
            selectable_windows: Vec::new(),
            selection_generation: 0,
            windows_loading: false,
            selection_pointer: None,
            hovered_window: None,
            animated_window_rect: None,
            selection_drag: None,
            display_rect: [0.0, 0.0, 1440.0, 900.0],
            paste_drag_start: None,
            recording_shortcut_key: false,
            review_audio_issue: initial_bundle
                .as_ref()
                .and_then(|(dir, bundle)| bundle_audio_issue(dir, bundle)),
            review_bundle: initial_bundle,
            review_status: None,
            selected_tab: ReviewTab::Keyframes,
            selected_keyframe: 0,
            iphone: None,
            completed_dir: None,
            #[cfg(target_os = "linux")]
            auto_paste_target: None,
            completed_note: None,
            share_public: false,
            share_online: false,
            share_probe_at: None,
            share_pending: None,
            share_waiting_account: false,
            share_login: None,
            share_copied: None,
            last_local_capture_ms: 0,
            inbox: crate::capture::desktop::workflow::inbox::Inbox::load_default(),
            last_mode: SelectionMode::load_last_used(),
            open_iphone_when_found: false,
            onboarding: None,
            onboarding_editor: crate::capture::desktop::settings::Panel::default(),
            settings: None,
            grants: None,
            gate: crate::capture::desktop::settings::onboarding::Gate::default(),
            shortcut: crate::capture::desktop::settings::shortcut::Shortcut::default(),
            hold_mods: 0,
            lab: false,
        }
    }

    /// Remembers the mode a recording is starting in, so the next picker opens on it.
    fn remember_mode(&mut self, mode: SelectionMode) {
        if self.last_mode != mode {
            self.last_mode = mode;
            mode.save_last_used();
        }
    }

    /// Kit opened, copied, pasted or dismissed `dir`, so it leaves the inbox.
    fn mark_handled(&mut self, dir: &std::path::Path) {
        if self.inbox.remove(dir) {
            refresh_status_bar(self.inbox.len());
        }
    }

    /// What ⌥⇧V pastes: the bundle on the Completed island, else the newest unhandled iPhone
    /// capture unless this Mac captured something since, else the latest bundle.
    fn take_paste_target(&mut self) -> PathBuf {
        let showing = matches!(self.island_phase, IslandPhase::Completed { .. })
            .then(|| self.completed_dir.clone())
            .flatten();
        let dir = showing
            .or_else(|| {
                self.inbox
                    .newest()
                    .filter(|entry| entry.received_at_ms > self.last_local_capture_ms)
                    .map(|entry| entry.dir.clone())
            })
            .unwrap_or_else(|| PathBuf::from("latest"));
        self.mark_handled(&dir);
        dir
    }

    pub fn paste_latest(&mut self, cx: &mut Context<Self>) {
        // Without Accessibility macOS drops the posted ⌘V (onboarding asks for it, but it can be
        // turned off later); bring the permissions window instead.
        if !crate::capture::engine::runtime::accessibility_granted() {
            apparent_log("⌥⇧V without Accessibility; asking for it");
            self.gate
                .defer(vec![crate::capture::desktop::settings::onboarding::Permission::Accessibility]);
            return;
        }
        let dir = self.take_paste_target();
        if matches!(self.island_phase, IslandPhase::Completed { .. }) {
            self.dismiss_island(cx);
        }
        std::thread::spawn(move || {
            if let Err(err) = crate::shared::handoff::paste_bundle_image_and_text(&dir) {
                apparent_log(format!("paste_bundle_image_and_text error: {err}"));
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

    /// Looks for a cabled iPhone in the background; the picker shows "iPhone" when one is there.
    fn refresh_iphone(&mut self, cx: &mut Context<Self>) {
        cx.spawn(async move |entity, cx| {
            let found = cx
                .background_executor()
                .spawn(async {
                    crate::capture::desktop::helper::devices()
                        .inspect_err(|error| apparent_log(format!("iPhone discovery: {error:#}")))
                        .ok()
                        .and_then(|devices| devices.into_iter().next())
                })
                .await;
            let _ = entity.update(cx, |coord, cx| {
                if coord.iphone != found {
                    coord.iphone = found;
                    cx.notify();
                }
                if std::mem::take(&mut coord.open_iphone_when_found)
                    && coord.iphone.is_some()
                    && matches!(
                        coord.island_phase,
                        IslandPhase::Selecting {
                            mode: SelectionMode::Area | SelectionMode::Iphone
                        }
                    )
                {
                    coord.preview_iphone(cx);
                }
            });
        })
        .detach();
    }

    pub fn is_recording(&self) -> bool {
        self.active_recording.is_some()
    }

    pub fn is_processing(&self) -> bool {
        matches!(self.island_phase, IslandPhase::Processing)
    }

    fn refuse_capture_restart(&self) -> bool {
        if self.capture_busy() {
            let message = "Finish or cancel the capture before restarting Apparent.";
            apparent_log(message);
            if let Ok(mut status) = CAPTURE_STATUS.lock() { *status = Some(message.into()); }
            true
        } else { false }
    }

    fn request_quit(&mut self, cx: &mut Context<Self>) {
        crate::capture::desktop::workflow::shutdown::request();
        self.lab = false;
        self.recording_shortcut_key = false;
        self.iphone_preview.take();
        if self.is_recording() {
            self.finish_recording(cx);
        } else if !self.is_processing() {
            self.cancel_recording(cx);
        }
        self.publish_capture_busy();
        if !self.capture_busy() {
            cx.quit();
        }
    }

    /// Native callbacks cannot borrow the GPUI entity. This is only a copy of the
    /// coordinator-owned admission decision, never separate lifecycle accounting.
    fn publish_capture_busy(&self) {
        crate::capture::desktop::workflow::shutdown::set_phase_busy(self.capture_busy());
    }

    pub fn is_selecting(&self) -> bool {
        matches!(self.island_phase, IslandPhase::Selecting { .. })
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    fn agent_state(&self) -> crate::capture::desktop::workflow::agent_capture::State {
        use crate::capture::desktop::workflow::agent_capture::{Phase, State};
        if matches!(
            self.active_recording.as_ref().map(|recording| &recording.source),
            Some(CaptureSource::Lab)
        ) {
            return State {
                phase: Phase::Idle,
                capture_id: None,
            };
        }
        let phase = if let Some(recording) = &self.active_recording {
            match &recording.source {
                CaptureSource::Screen { session, .. } if !session.has_frames() => Phase::Starting,
                CaptureSource::Phone(session) if !session.has_recording() => Phase::Starting,
                _ => Phase::Recording,
            }
        } else {
            match self.island_phase {
                IslandPhase::Selecting { .. } => Phase::Selecting,
                IslandPhase::Processing => Phase::Processing,
                IslandPhase::Completed { .. } => Phase::Completed,
                _ => Phase::Idle,
            }
        };
        State {
            phase,
            capture_id: self.agent_capture_id.clone(),
        }
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    fn agent_request(&mut self, request: crate::capture::desktop::workflow::agent_capture::Request, cx: &mut Context<Self>) {
        use crate::capture::desktop::workflow::agent_capture::{Action, Outcome};
        if let Some((action @ (Action::PublicShareStart | Action::PublicShareRead | Action::PublicShareDeliver | Action::PublicShareCancel), value)) = &request.action {
            let selected = self.review_bundle.as_ref().and_then(|(path, _)| {
                path.file_name().and_then(|name| name.to_str()).map(|name| (path, name.to_owned()))
            });
            let response = if request.expired() {
                serde_json::json!({"error":"admission_expired"})
            } else {
                match action {
                    Action::PublicShareStart => match selected {
                        Some((path, name)) if name == *value && !self.is_recording() && !self.is_processing() && !self.is_selecting() => {
                            match self.public_share.start(name, path.clone(), self.capture_generation) {
                                Ok(operation) => serde_json::json!({"publicShare":{"operation":operation,"state":"preparing"}}),
                                Err(code) => serde_json::json!({"error":code}),
                            }
                        }
                        _ => serde_json::json!({"error":"conflict"}),
                    },
                    Action::PublicShareRead => match selected {
                        Some((path, name)) => match self.public_share.read(value, &name, path, self.capture_generation) {
                            Ok(state) => serde_json::json!({"publicShare":{"state":state}}),
                            Err(code) => serde_json::json!({"error":code}),
                        },
                        None => { self.public_share.cancel(value); serde_json::json!({"error":"no_selection"}) }
                    },
                    Action::PublicShareDeliver => match selected {
                        Some((path, name)) => match self.public_share.deliver(value, &name, path, self.capture_generation, crate::shared::handoff::copy_string_to_clipboard) {
                            Ok(state) => serde_json::json!({"publicShare":{"state":state}}),
                            Err(code) => serde_json::json!({"error":code}),
                        },
                        None => { self.public_share.cancel(value); serde_json::json!({"error":"no_selection"}) }
                    },
                    Action::PublicShareCancel => { self.public_share.cancel(value); serde_json::json!({"publicShare":{"state":"cancelled"}}) },
                    _ => unreachable!(),
                }
            };
            let _ = request.reply.send(response.to_string());
            return;
        }
        if let Some((action @ (Action::ReferenceRead | Action::ReferenceCopy), expected)) = &request.action {
            let enabled = crate::shared::handoff::experiment("copyCaptureId");
            let response = capture_reference_response(
                self.review_bundle.as_ref().map(|(directory, _)| directory.as_path()),
                (*action == Action::ReferenceCopy).then_some(expected.as_str()),
                enabled,
                request.expired(),
                crate::shared::handoff::copy_string_to_clipboard,
            );
            let _ = request.reply.send(response.to_string());
            return;
        }
        // Report an ended sampler, but never discard another session as a side
        // effect of State, Inspect or a competing Start. Cancellation stays explicit.
        if matches!(self.active_recording.as_ref().map(|r| &r.source),
            Some(CaptureSource::Screen { session, .. }) if session.failed_to_start()) {
            if let Some(id) = &self.agent_capture_id {
                self.agent_captures.set(&id, "failed", None, Some("start_failed"));
            }
        }
        let before = self.agent_state();
        if before.phase == crate::capture::desktop::workflow::agent_capture::Phase::Recording
            && let Some(id) = &before.capture_id {
            self.agent_captures.set(id, "recording", None, None);
        }
        if let Some((Action::Start, id)) = &request.action {
            let occupied = self.lab || self.active_recording.is_some()
                || self.is_selecting() || self.is_processing()
                || self.iphone_preview.is_some() || self.agent_capture_id.is_some()
                || self.recording_shortcut_key || crate::capture::desktop::workflow::shutdown::requested();
            if self.agent_captures.admit(id, occupied, request.expired()) {
                self.agent_capture_id = Some(id.clone());
                self.publish_capture_busy();
                self.record_screen_now(cx);
                if self.active_recording.is_none() {
                    self.agent_capture_id = None;
                    self.agent_captures.set(id, "failed", None, Some("start_failed"));
                }
            }
            let _ = request.reply.send(self.agent_captures.inspect(id).to_string());
            return;
        }
        if let Some((Action::Inspect, id)) = &request.action {
            let _ = request.reply.send(self.agent_captures.inspect(id).to_string());
            return;
        }
        if request.action.is_some() && request.expired() {
            let _ = request.reply.send(serde_json::json!({"error": "admission_expired", "state": before}).to_string());
            return;
        }
        let outcome = request
            .action
            .as_ref()
            .map(|(action, id)| self.agent_captures.decide(&before, *action, id));
        match (&request.action, outcome) {
            (Some((Action::Stop, _)), Some(Outcome::Stopping)) => {
                #[cfg(target_os = "linux")]
                { self.agent_finishing = true; }
                self.finish_recording(cx)
            }
            (Some((Action::Cancel, _)), Some(Outcome::Cancelled)) => self.cancel_recording(cx),
            _ => {}
        }
        let response = match outcome {
            Some(outcome) => {
                let mut response = self.agent_captures.inspect(&request.action.as_ref().unwrap().1);
                // Preserve non-wait Stop/Cancel's existing outcome semantics.
                response["outcome"] = serde_json::json!(outcome);
                response["state"] = serde_json::json!(self.agent_state());
                if outcome == Outcome::AlreadyEnded && response["status"] == "unknown" {
                    response["error"] = serde_json::Value::Null;
                }
                response
            },
            None => crate::capture::desktop::workflow::agent_capture::state_response(&before),
        };
        let _ = request.reply.send(response.to_string());
    }

    pub fn open_onboarding(&mut self, flow: crate::capture::desktop::settings::onboarding::Flow) {
        // Drop the old window before the new one opens.
        self.cancel_onboarding_editor();
        self.onboarding = None;
        let sender = self.telemetry.ui_sender.clone();
        let events = move |event| {
            let _ = sender.send(LiveOverlayEvent::Onboarding(event));
        };
        match crate::capture::desktop::settings::onboarding::Session::open(flow, &self.shortcut_label(), events) {
            Ok(session) => {
                self.onboarding = Some(session);
                self.sync_onboarding_editor();
            }
            Err(error) => apparent_log(format!("onboarding could not open: {error:#}")),
        }
    }

    /// Opens Settings, or brings it forward on `pane`.
    pub fn open_settings(&mut self, pane: Option<crate::capture::desktop::settings::Pane>) {
        if let Some(session) = self.settings.as_mut() {
            session.show(pane);
            return;
        }
        let sender = self.telemetry.ui_sender.clone();
        let events = move |event| {
            let _ = sender.send(LiveOverlayEvent::Settings(event));
        };
        match crate::capture::desktop::settings::Session::open(pane, self.grants.clone(), events) {
            Ok(mut session) => {
                session.sync(&crate::capture::desktop::settings::AppHost {
                    telemetry: &self.telemetry,
                });
                self.settings = Some(session);
            }
            Err(error) => apparent_log(format!("Settings could not open: {error:#}")),
        }
    }

    fn settings_event(&mut self, event: crate::capture::desktop::settings::Event, cx: &mut Context<Self>) {
        use crate::capture::desktop::settings::{Effect, Event};
        let Some(event) = self.settings.as_ref().and_then(|session| session.current_event(event)) else {
            return;
        };
        #[cfg(target_os = "linux")]
        if self.defer_update_restart(&event) {
            // Check before Session spawns its relaunch helper. Capture admission
            // and this decision run on the same UI thread.
            apparent_log("Update restart deferred until capture is idle");
            crate::capture::desktop::linux::shell::notify("Update ready", "Finish or cancel the capture before restarting Apparent.");
            return;
        }
        if let Event::Grants(grants) = &event {
            self.note_grants(grants);
        }
        let Some(session) = self.settings.as_mut() else {
            return;
        };
        let mut host = crate::capture::desktop::settings::AppHost {
            telemetry: &self.telemetry,
        };
        let effect = session.event(event, &mut host);
        let shortcut = self.shortcut_label();
        if let Some(onboarding) = self.onboarding.as_mut() {
            onboarding.shortcut_changed(&shortcut);
        }
        match effect {
            Effect::Close => {
                self.settings = None;
                self.cancel_share_login();
                if let Some((_, _, active)) = self.share_pending.take() {
                    active.store(false, std::sync::atomic::Ordering::SeqCst);
                }
                self.share_waiting_account = false;
            }
            Effect::ConnectHosted if self.share_waiting_account => self.reserve_completed_link(true, cx),
            Effect::ConnectHosted => {
                if self.share_login.is_none() && crate::shared::handoff::experiment(crate::connect::hosted::HOSTED_SHARING) {
                    let active = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(true));
                    self.share_login = Some(active.clone());
                    cx.spawn(async move |entity, cx| {
                        let worker_active = active.clone();
                        let result = cx.background_executor().spawn(async move {
                            crate::connect::hosted::connect_sharing(&|| worker_active.load(std::sync::atomic::Ordering::SeqCst))
                        }).await;
                        let _ = entity.update(cx, |coord, _| {
                            if coord.finish_share_login(&active, result.is_ok()) { crate::connect::hosted::start_worker(); }
                        });
                    }).detach();
                }
            }
            Effect::ManageSharedLinks => {
                if let Some(url) = crate::connect::hosted::shared_links_url() {
                    let _ = crate::shared::handoff::open_path(std::path::Path::new(&url));
                }
            }
            Effect::Tour => {
                use crate::capture::desktop::settings::onboarding::{Flow, Progress, Step};
                if self.capture_busy() {
                    let message = "Finish or cancel the capture before replaying the welcome tour.";
                    apparent_log(message);
                    if let Ok(mut status) = CAPTURE_STATUS.lock() { *status = Some(message.into()); }
                    return;
                }
                let mut progress = Progress::load();
                progress.reset_for_replay();
                if let Err(error) = progress.save_to(&crate::shared::handoff::default_config_path()) {
                    let message = format!("Could not save welcome tour progress: {error:#}");
                    apparent_log(&message);
                    if let Ok(mut status) = CAPTURE_STATUS.lock() { *status = Some(message); }
                    return;
                }
                self.open_onboarding(Flow::tour(Step::Welcome, self.grants.clone()));
            }
            Effect::Relaunch => {
                if self.refuse_capture_restart() { return; }
                self.settings = None;
                crate::capture::desktop::settings::onboarding::relaunch();
                cx.quit();
            }
            Effect::QuitForUpdate => {
                self.settings = None;
                cx.quit();
            }
            _ => {}
        }
    }

    #[cfg(target_os = "linux")]
    fn defer_update_restart(&self, event: &crate::capture::desktop::settings::Event) -> bool {
        matches!(event, crate::capture::desktop::settings::Event::Action(crate::capture::desktop::settings::Action::UpdateNow))
            && self.capture_busy()
    }

    /// UI-thread snapshot for restart/termination admission, not just visible UI.
    pub(crate) fn capture_busy(&self) -> bool {
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        if self.agent_capture_id.is_some() { return true; }
        self.pending_finalizers > 0 || self.lab || self.active_recording.is_some()
            || self.is_selecting() || self.is_processing() || self.iphone_preview.is_some()
            || self.recording_shortcut_key
    }

    fn capture_finalizer_started(&mut self) {
        self.pending_finalizers += 1;
    }

    fn capture_finalizer_finished(&mut self) {
        self.pending_finalizers = self.pending_finalizers.checked_sub(1)
            .expect("finalizer completion must own a pending worker");
    }

    fn cancel_share_login(&mut self) {
        if let Some(active) = self.share_login.take() {
            active.store(false, std::sync::atomic::Ordering::SeqCst);
        }
    }

    fn finish_share_login(&mut self, active: &std::sync::Arc<std::sync::atomic::AtomicBool>, succeeded: bool) -> bool {
        // A cancelled request can finish after Settings has started another login.
        // Only its owner may clear the cancellation handle or start the worker.
        if !self.share_login.as_ref().is_some_and(|current| std::sync::Arc::ptr_eq(current, active)) {
            return false;
        }
        self.share_login = None;
        succeeded && active.load(std::sync::atomic::Ordering::SeqCst)
    }

    /// Keeps a fresh read of the grants and remembers what was granted. (The key tap follows
    /// Accessibility by itself, in the HID poller.)
    fn note_grants(&mut self, grants: &crate::capture::desktop::settings::onboarding::Grants) {
        use crate::capture::desktop::settings::onboarding::Progress;
        let mut progress = Progress::load();
        if progress.note(grants) {
            progress.save();
        }
        self.grants = Some(grants.clone());
    }

    /// Required permissions that keep a capture from starting now.
    fn missing_to_record(&mut self, microphone: bool) -> Vec<crate::capture::desktop::settings::onboarding::Permission> {
        use crate::capture::desktop::settings::onboarding::{Permission, missing_to_record};
        let screen = crate::capture::engine::runtime::screen_capture_usable(false);
        let accessibility = crate::capture::engine::runtime::accessibility_granted();
        let mut missing = missing_to_record(self.grants.as_ref(), screen, accessibility);
        if !microphone { missing.retain(|p| *p != Permission::Microphone); }
        // The last read may be old; read again before standing in the way.
        if missing.contains(&Permission::Microphone)
            && let Some(fresh) = crate::capture::desktop::settings::onboarding::read_grants()
        {
            self.note_grants(&fresh);
            return missing_to_record(self.grants.as_ref(), screen, accessibility);
        }
        missing
    }

    /// Whether this may go on: with a required permission off it starts nothing, and the
    /// permissions window comes forward once the modifiers are up.
    fn ready_to_record(&mut self) -> bool {
        if self.lab {
            return true;
        }
        if self.setup_blocks_capture() { return false; }
        let microphone = crate::capture::engine::runtime::audio::mic::enabled();
        let missing = self.missing_to_record(microphone);
        if missing.is_empty() {
            self.admitted_microphone = Some(microphone);
            return true;
        }
        apparent_log(format!(
            "Not recording: {missing:?} off; opening onboarding"
        ));
        self.gate.defer(missing);
        false
    }

    /// Whether `permission`, asked for on first use (Camera, Accessibility), is on. If not, its
    /// window comes forward once the modifiers are up.
    fn ready_for(&mut self, permission: crate::capture::desktop::settings::onboarding::Permission) -> bool {
        let granted = |g: &crate::capture::desktop::settings::onboarding::Grants| g.granted(permission);
        if self.lab || self.grants.as_ref().is_none_or(granted) {
            return true;
        }
        if let Some(fresh) = crate::capture::desktop::settings::onboarding::read_grants() {
            self.note_grants(&fresh);
            if granted(&fresh) {
                return true;
            }
        }
        apparent_log(format!("{permission:?} is off; asking for it"));
        self.gate.defer(vec![permission]);
        false
    }

    /// Polled while the gate holds a request: shows the permissions window once ⌥⇧ is up.
    pub(in crate::capture::desktop) fn tick_onboarding_practice(&mut self,cx:&mut Context<Self>) {
        if let Some(session) = self.onboarding.as_mut() {
            session.observe_shortcut_modifiers(crate::capture::engine::runtime::modifier_flags());
        }
        if !self.onboarding.as_ref().is_some_and(|s|s.practice_active()) {return;}
        #[cfg(target_os="macos")]
        let anchor=if self.onboarding.as_ref().is_some_and(|s|s.practice_locating()) {crate::capture::desktop::ui::macos::status_bar_anchor()} else {self.native_pill.as_ref().and_then(|p|p.coach_anchor())};
        #[cfg(target_os="linux")]
        let anchor=crate::capture::desktop::ui::linux::coach_anchor();
        #[cfg(not(any(target_os="macos",target_os="linux")))]
        let anchor=None;
        #[cfg(any(target_os="macos",target_os="linux"))]
        let anchor = if self.electron_pill_routed
            && !(cfg!(target_os="macos") && self.onboarding.as_ref().is_some_and(|s| s.practice_locating())) {
            self.electron_pill.as_ref().and_then(|pill| pill.note_badge_anchor())
                .map(|rect| rect.map(|value| value as f32))
        } else { anchor };
        if let Some(session)=self.onboarding.as_mut(){session.practice_anchor(anchor);}
        if !self.is_recording() {self.whiteboard.borrow_mut().presentation=None;}
        let board_frame=whiteboard::frame(&self.whiteboard,cx);
        let board_view={let board=self.whiteboard.borrow();board.presentation.as_ref().map(|(id,_)|serde_json::json!({"id":id,"strokes":board.strokes,"color":board.color}))};
        if let Some(session)=self.onboarding.as_mut(){session.board_view(board_view);}
        let board=self.whiteboard.borrow().strokes.iter().any(|s|!s.is_empty());
        let screen=self.telemetry.strokes.lock().unwrap_or_else(std::sync::PoisonError::into_inner).iter().filter(|s|!s.laser && !s.pts.is_empty()).count();
        let processing=self.is_processing();
        let note_saved=self.note_ui.as_ref().is_some_and(|notes|notes.has_saved_note());
        let was_desktop=self.onboarding.as_ref().unwrap().practice_desktop_stage();
        if let Some(session)=self.onboarding.as_mut() {
            session.practice_note_saved(note_saved);
            session.observe_practice_surface(board,screen,processing,board_frame);
        }
        if !was_desktop && self.onboarding.as_ref().is_some_and(|s|s.practice_desktop_stage()) {self.whiteboard.borrow_mut().presentation=None;cx.defer(whiteboard::close);}
    }

    pub fn tick_gate(&mut self) {
        use crate::capture::desktop::settings::onboarding::{Flow, Input, Mode, Permission};
        let Some(asks) = self.gate.tick(crate::capture::engine::runtime::modifier_flags() != 0) else {
            return;
        };
        let required = asks.iter().any(|p| p.required());
        match self.onboarding.as_mut() {
            Some(session) if session.mode() == Mode::Tour && required => {
                session.input(Input::Blocked);
            }
            _ => {
                let asks = if required {
                    Permission::REQUIRED.to_vec()
                } else {
                    asks
                };
                self.open_onboarding(Flow::fix(asks, self.grants.clone()));
            }
        }
    }

    fn onboarding_event(&mut self, event: crate::capture::desktop::settings::onboarding::Event, cx: &mut Context<Self>) {
        use crate::capture::desktop::settings::onboarding::{Effect, Event, Progress};
        let Some(event) = event.for_current_session(self.onboarding.as_ref().map(|s|s.source())) else {return;};
        let Some(event) = event.for_current_transport(self.onboarding.as_ref().map(|s|s.transport_generation())) else {return;};
        let effect = match event {
            Event::Session { .. } | Event::Transport { .. } => Effect::None,
            Event::Launch(grants) => {
                self.note_grants(&grants);
                let mut progress = Progress::load();
                if progress.prepare_current_tour() { progress.save(); }
                let plan = crate::capture::desktop::settings::onboarding::launch_plan(&progress, &grants);
                if std::mem::take(&mut progress.reopen_fix) {
                    progress.save();
                }
                if self.onboarding.is_none()
                    && let Some(flow) = plan
                {
                    self.open_onboarding(flow);
                }
                Effect::None
            }
            Event::Grants(grants) => {
                self.note_grants(&grants);
                // A single app-wide Mac poller feeds both windows and the capture gate.
                #[cfg(target_os = "macos")]
                if let Some(session) = self.settings.as_mut() {
                    session.event(
                        crate::capture::desktop::settings::Event::Grants(grants.clone()),
                        &mut crate::capture::desktop::settings::AppHost {
                            telemetry: &self.telemetry,
                        },
                    );
                }
                self.onboarding
                    .as_mut()
                    .map_or(Effect::None, |session| session.grants(grants))
            }
            Event::Board(value) => {
                if self.is_recording() && self.onboarding.as_ref().is_some_and(|s|s.electron_practice()) {
                    let mut board=self.whiteboard.borrow_mut();
                    if board.presentation.as_ref().is_some_and(|(id,_)|value["id"].as_str()==Some(id.as_str())) {
                        board.apply_input(&value);
                    }
                    drop(board);if matches!(value["operation"].as_str(),Some("end"|"undo"|"clear")){self.request_immediate_frame();}
                }
                Effect::None
            }
            Event::Action(action) if matches!(action.as_str(), "use-desktop-shortcut" | "use-current-shortcut") => {
                let host = crate::capture::desktop::settings::AppHost { telemetry: &self.telemetry };
                let editor = self.onboarding_editor.record_shortcut(&host);
                let accepted = !editor.recording && editor.error.is_none()
                    && action == "use-desktop-shortcut" && editor.externally_managed;
                if accepted
                    && let Some(session) = self.onboarding.as_mut()
                {
                    session.input(crate::capture::desktop::settings::onboarding::Input::ShortcutChosen);
                }
                Effect::None
            }
            Event::Action(action) => self
                .onboarding
                .as_mut()
                .map_or(Effect::None, |session| session.action(&action)),
            Event::Shortcut(action) => {
                if self
                    .onboarding
                    .as_ref()
                    .is_some_and(|session| session.editing_shortcut() ||
                        (session.choosing_shortcut() && matches!(action, crate::capture::desktop::settings::Action::ResetShortcut { .. })))
                    && matches!(
                        action,
                        crate::capture::desktop::settings::Action::Shortcut {
                            kind: crate::capture::engine::runtime::ShortcutKind::Record,
                            ..
                        } | crate::capture::desktop::settings::Action::ResetShortcut {
                            kind: crate::capture::engine::runtime::ShortcutKind::Record
                        } | crate::capture::desktop::settings::Action::CancelShortcut
                    )
                {
                    let mut host = crate::capture::desktop::settings::AppHost {
                        telemetry: &self.telemetry,
                    };
                    let choosing = matches!(action, crate::capture::desktop::settings::Action::Shortcut { .. })
                        && self.onboarding_editor.record_shortcut(&host).recording;
                    self.onboarding_editor.on(action, &mut host);
                    let editor = self.onboarding_editor.record_shortcut(&host);
                    if choosing && !editor.recording && editor.error.is_none()
                        && let Some(session) = self.onboarding.as_mut()
                    {
                        session.input(crate::capture::desktop::settings::onboarding::Input::ShortcutChosen);
                    }
                    self.sync_onboarding_editor();
                }
                Effect::None
            }
            Event::Exited => {
                let board_was_open=self.whiteboard.borrow_mut().detach_presentation();
                if board_was_open && self.is_recording(){let coord=cx.entity();cx.defer(move |cx|whiteboard::open(&coord,cx));}
                if self.onboarding.as_mut().is_some_and(|session| session.restore_native()) {
                    self.sync_onboarding_editor();
                    return;
                }
                if let Some(session) = self.onboarding.as_ref() {
                    session.leave(true);
                }
                self.cancel_onboarding_editor();
                self.onboarding = None;
                Effect::None
            }
        };
        match effect {
            Effect::EditShortcut => {
                let mut host = crate::capture::desktop::settings::AppHost {
                    telemetry: &self.telemetry,
                };
                self.onboarding_editor.on(
                    crate::capture::desktop::settings::Action::RecordShortcut {
                        kind: crate::capture::engine::runtime::ShortcutKind::Record,
                    },
                    &mut host,
                );
                self.sync_onboarding_editor();
            }
            Effect::Close | Effect::Settings => {
                if let Some(session) = self.onboarding.as_ref() {
                    session.leave(false);
                }
                self.cancel_onboarding_editor();
                if effect == Effect::Settings {
                    self.open_settings(None);
                }
                self.onboarding = None;
            }
            Effect::Relaunch { resume } => {
                if self.refuse_capture_restart() { return; }
                self.cancel_onboarding_editor();
                apparent_log(format!(
                    "Screen Recording granted but not usable here; relaunching (resume {resume:?})"
                ));
                let mut progress = Progress::load();
                progress.relaunching(resume, crate::capture::desktop::settings::onboarding::unix_ms());
                progress.save();
                self.onboarding = None;
                crate::capture::desktop::settings::onboarding::relaunch();
                cx.quit();
            }
            _ => {}
        }
        if self
            .onboarding
            .as_ref()
            .is_some_and(|session| !session.editing_shortcut())
        {
            self.cancel_onboarding_editor();
        }
    }

    fn sync_onboarding_editor(&mut self) {
        use crate::capture::desktop::settings::Host as _;
        let host = crate::capture::desktop::settings::AppHost {
            telemetry: &self.telemetry,
        };
        if let Some(session) = self.onboarding.as_mut() {
            session.shortcut_changed(&host.shortcuts().record.label);
            session.shortcut_editor(&self.onboarding_editor.record_shortcut(&host));
        }
    }

    fn cancel_onboarding_editor(&mut self) {
        let mut host = crate::capture::desktop::settings::AppHost {
            telemetry: &self.telemetry,
        };
        self.onboarding_editor
            .on(crate::capture::desktop::settings::Action::CancelShortcut, &mut host);
    }

    fn activity(&self) -> crate::capture::desktop::settings::shortcut::Activity {
        use crate::capture::desktop::settings::shortcut::Activity;
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

    fn begin_playback(&mut self) {
        if !self.lab && self.playback.is_none() {
            self.playback = crate::capture::desktop::playback::Guard::start();
        }
    }

    fn onboarding_shortcut_policy(&mut self) -> crate::capture::desktop::settings::onboarding::ShortcutPolicy {
        use crate::capture::desktop::settings::onboarding::{Flow, Progress, ShortcutPolicy, Step};
        if self.lab { return ShortcutPolicy::Record; }
        if let Some(session) = self.onboarding.as_ref() { return session.shortcut_policy(); }
        if !crate::shared::handoff::experiment("onboardingFirstCapture") { return ShortcutPolicy::Record; }
        if self.onboarding.is_none() {
            let mut progress = Progress::load();
            if progress.prepare_current_tour() { progress.save(); }
            if !progress.seen {
                self.open_onboarding(Flow::tour(progress.resume.unwrap_or(Step::Welcome), self.grants.clone()));
                return ShortcutPolicy::Block;
            }
        }
        self.onboarding.as_ref().map_or(ShortcutPolicy::Record, |s| s.shortcut_policy())
    }

    /// Shared by real-start admission and the picker/iPhone entry points.
    /// Only the guided shortcut may own the first-capture start; Finish is unaffected.
    fn setup_blocks_capture(&mut self) -> bool {
        use crate::capture::desktop::settings::onboarding::ShortcutPolicy;
        if self.lab { return false; }
        let blocked = self.onboarding_shortcut_policy() != ShortcutPolicy::Record
            || self.onboarding.as_ref().is_some_and(|s| !s.allows_capture_start());
        if blocked {
            if let Some(session) = self.onboarding.as_mut() { session.show(); }
        }
        blocked
    }

    /// Consume the release as a setup trial, never as a recording request.
    fn consume_setup_shortcut(&mut self) -> bool {
        use crate::capture::desktop::settings::onboarding::{Input, ShortcutPolicy};
        let policy = self.onboarding_shortcut_policy();
        if policy == ShortcutPolicy::Record { return false; }
        if let Some(session) = self.onboarding.as_mut() {
            if policy == ShortcutPolicy::Trial { session.input(Input::ShortcutTriggered); }
            session.show();
        }
        true
    }

    /// The capture shortcut went down (from Carbon, the event tap or the HID poller).
    pub fn press_shortcut(&mut self, cx: &mut Context<Self>) {
        #[cfg(target_os="linux")]
        if let Some(session)=self.onboarding.as_mut().filter(|session|session.editing_shortcut()) {
            // A permanent compositor binding consumes Copilot before Electron
            // receives it. Forward that native callback as binding metadata;
            // the shared TypeScript recorder owns selection, never capture.
            session.desktop_shortcut_pressed();
            return;
        }
        let activity = self.activity();
        if self.gate.is_pending() {
            return;
        }
        if !self.shortcut.is_pending() && activity == crate::capture::desktop::settings::shortcut::Activity::Free {
            use crate::capture::desktop::settings::onboarding::{Input, ShortcutPolicy};
            match self.onboarding_shortcut_policy() {
                ShortcutPolicy::Block => {
                    if let Some(session) = self.onboarding.as_mut() { session.show(); }
                    return;
                }
                ShortcutPolicy::Trial => {
                    if let Some(session) = self.onboarding.as_mut() { session.input(Input::ShortcutTrialStarted); }
                    self.hold_mods = crate::capture::engine::runtime::modifier_flags();
                    self.telemetry.take_escape();
                    let action = self.shortcut.press(activity);
                    self.apply_shortcut(action, cx);
                    return;
                }
                ShortcutPolicy::Record => {}
            }
            // No picker or overlay before the permissions are on: they sit above
            // macOS's permission prompts and take the clicks meant for them.
            let missing = self.missing_to_record(crate::capture::engine::runtime::audio::mic::enabled());
            if !self.gate.press(missing) {
                apparent_log("Shortcut held back: a required permission is off");
                return;
            }
            self.begin_playback();
            self.hold_mods = crate::capture::engine::runtime::modifier_flags();
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
            let mods = crate::capture::engine::runtime::modifier_flags();
            let held = self.hold_mods != 0 && mods & self.hold_mods == self.hold_mods;
            self.shortcut.tick(held)
        };
        self.apply_shortcut(action, cx);
    }

    fn apply_shortcut(&mut self, action: crate::capture::desktop::settings::shortcut::Action, cx: &mut Context<Self>) {
        use crate::capture::desktop::settings::shortcut::Action;
        if action != Action::None {
            apparent_log(format!("shortcut -> {action:?}"));
        }
        match action {
            Action::None => {}
            Action::Cancel => {
                if let Some(session) = self.onboarding.as_mut() {
                    session.input(crate::capture::desktop::settings::onboarding::Input::CaptureEnded { completed: false });
                }
                // Esc can cancel before the picker or a recording exists.
                self.playback.take();
            }
            Action::RecordScreen => {
                if self.consume_setup_shortcut() { return; }
                if let Some(session) = self.onboarding.as_mut() {
                    session.input(crate::capture::desktop::settings::onboarding::Input::ShortcutTriggered);
                }
                self.record_screen_now(cx);
            }
            Action::RecordSelected => {
                if self.consume_setup_shortcut() { return; }
                if let Some(session) = self.onboarding.as_mut() {
                    session.input(crate::capture::desktop::settings::onboarding::Input::ShortcutTriggered);
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

    /// Records the display under the cursor straight away (no picker), auto-cropped.
    pub fn record_screen_now(&mut self, cx: &mut Context<Self>) {
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
    fn reveal_activity(&self) -> usize {
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

    /// macOS and lab tap starts reveal switch chips; ordinary Linux starts keep controls.
    fn show_reveal(&mut self, cx: &mut Context<Self>) {
        // Linux exposes one full-display capture path. Keep the native fallback
        // consistent with Electron even when a renderer cannot start.
        #[cfg(target_os = "linux")]
        if !self.lab {
            return;
        }
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
    fn fold_reveal(&mut self) {
        if self.reveal.is_open() {
            self.reveal.close();
            self.play_fold();
        }
    }

    fn play_fold(&mut self) {
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
        // Native lifetime guard: a stale child action must not discard an
        // active full-display capture to reopen the retired Linux picker.
        #[cfg(target_os = "linux")]
        if !self.lab && mode != SelectionMode::Screen {
            return;
        }
        if mode == SelectionMode::Window {
            self.report_window_recording_disabled(cx);
            return;
        }
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
    fn discard_recording(&mut self) -> Option<(TargetInfo, Option<LaserOverlay>)> {
        if let Some(rec) = &self.active_recording
            && !matches!(rec.source, CaptureSource::Lab)
            && let Err(error) = crate::capture::engine::bundle::recover::cancel(&rec.bundle_dir)
        {
            apparent_log(format!("Could not persist cancellation; capture is still active: {error:#}"));
            return None;
        }
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        if let Some(id) = self.agent_capture_id.take() {
            self.agent_captures.set(&id, "cancelled", None, None);
        }
        let rec = self.active_recording.take()?;
        self.note_ui = None;
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
        if let Err(error) = crate::capture::engine::bundle::recover::delete_cancelled(&rec.bundle_dir) {
            apparent_log(format!("Cancelled assets could not be deleted at {}: {error:#}; recovery remains forbidden", rec.bundle_dir.display()));
        }
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
        self.public_share.cancel_all();
        self.review_audio_issue = bundle_audio_issue(&bundle.0, &bundle.1);
        self.review_bundle = Some(bundle);
        self.review_status = status;
        self.selected_tab = ReviewTab::Keyframes;
        self.selected_keyframe = 0;
    }

    fn sync_picker_overlay(&self) {
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

    fn report_window_recording_disabled(&self, cx: &mut Context<Self>) {
        let message = crate::capture::engine::runtime::WINDOW_RECORDING_DISABLED;
        apparent_log(message);
        if let Ok(mut status) = CAPTURE_STATUS.lock() {
            *status = Some(message.into());
        }
        cx.notify();
    }

    pub fn set_selection_mode(&mut self, mode: SelectionMode, cx: &mut Context<Self>) {
        if mode == SelectionMode::Window {
            self.report_window_recording_disabled(cx);
            return;
        }
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
        if !self.ready_for(crate::capture::desktop::settings::onboarding::Permission::Camera) {
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
                SelectionMode::Area => SelectionMode::Screen,
                SelectionMode::Window | SelectionMode::Screen | SelectionMode::Iphone => {
                    SelectionMode::Area
                }
            };
            self.set_selection_mode(next, cx);
        }
    }

    fn selection_mode(&self) -> Option<SelectionMode> {
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
            "q" => self.request_quit(cx),
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
        let record_key = crate::capture::engine::runtime::shortcut_parts(&label).1;
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
