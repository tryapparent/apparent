use super::*;

impl ApparentCoordinator {
    pub(super) fn new(
        telemetry: Arc<SharedCaptureTelemetry>,
        initial_bundle: Option<(PathBuf, ApparentBundle)>,
    ) -> Self {
        crate::playback::warm_up();
        Self {
            telemetry,
            whiteboard: Rc::new(RefCell::new(whiteboard::Board::default())),
            active_recording: None,
            capture_generation: 0,
            #[cfg(any(target_os = "macos", target_os = "linux"))]
            agent_capture_id: None,
            #[cfg(any(target_os = "macos", target_os = "linux"))]
            agent_captures: crate::agent_capture::Registry::default(),
            #[cfg(target_os = "linux")]
            agent_finishing: false,
            last_live_no_words: false,
            playback: None,
            picker_metal_overlay: None,
            native_pill: None,
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
            reveal: crate::shortcut::Reveal::default(),
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
            feedback_capture: false,
            review_feedback: false,
            selected_tab: ReviewTab::Keyframes,
            selected_keyframe: 0,
            iphone: None,
            completed_dir: None,
            completed_note: None,
            last_local_capture_ms: 0,
            inbox: crate::inbox::Inbox::load_default(),
            last_mode: SelectionMode::load_last_used(),
            open_iphone_when_found: false,
            onboarding: None,
            onboarding_editor: crate::settings::Panel::default(),
            settings: None,
            grants: None,
            gate: crate::onboarding::Gate::default(),
            shortcut: crate::shortcut::Shortcut::default(),
            hold_mods: 0,
            lab: false,
        }
    }

    /// Remembers the mode a recording is starting in, so the next picker opens on it.
    pub(super) fn remember_mode(&mut self, mode: SelectionMode) {
        if self.last_mode != mode {
            self.last_mode = mode;
            mode.save_last_used();
        }
    }

    /// Kit opened, copied, pasted or dismissed `dir`, so it leaves the inbox.
    pub(super) fn mark_handled(&mut self, dir: &std::path::Path) {
        if self.inbox.remove(dir) {
            refresh_status_bar(self.inbox.len());
        }
    }

    /// What ⌥⇧V pastes: the bundle on the Completed island, else the newest unhandled iPhone
    /// capture unless this Mac captured something since, else the latest bundle.
    pub(super) fn take_paste_target(&mut self) -> PathBuf {
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
        if !crate::capture::accessibility_granted() {
            apparent_log("⌥⇧V without Accessibility; asking for it");
            self.gate
                .defer(vec![crate::onboarding::Permission::Accessibility]);
            return;
        }
        let dir = self.take_paste_target();
        if matches!(self.island_phase, IslandPhase::Completed { .. }) {
            self.dismiss_island(cx);
        }
        std::thread::spawn(move || {
            if let Err(err) = crate::handoff::paste_bundle_image_and_text(&dir) {
                apparent_log(format!("paste_bundle_image_and_text error: {err}"));
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

    /// Looks for a cabled iPhone in the background; the picker shows "iPhone" when one is there.
    pub(super) fn refresh_iphone(&mut self, cx: &mut Context<Self>) {
        cx.spawn(async move |entity, cx| {
            let found = cx
                .background_executor()
                .spawn(async {
                    crate::helper::devices()
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

    pub fn is_selecting(&self) -> bool {
        matches!(self.island_phase, IslandPhase::Selecting { .. })
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    pub(super) fn agent_state(&self) -> crate::agent_capture::State {
        use crate::agent_capture::{Phase, State};
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
    pub(super) fn agent_request(&mut self, request: crate::agent_capture::Request, cx: &mut Context<Self>) {
        use crate::agent_capture::{Action, Outcome};
        // Report an ended sampler, but never discard another session as a side
        // effect of State, Inspect or a competing Start. Cancellation stays explicit.
        if matches!(self.active_recording.as_ref().map(|r| &r.source),
            Some(CaptureSource::Screen { session, .. }) if session.failed_to_start()) {
            if let Some(id) = &self.agent_capture_id {
                self.agent_captures.set(&id, "failed", None, Some("start_failed"));
            }
        }
        let before = self.agent_state();
        if before.phase == crate::agent_capture::Phase::Recording
            && let Some(id) = &before.capture_id {
            self.agent_captures.set(id, "recording", None, None);
        }
        if let Some((Action::Start, id)) = &request.action {
            let occupied = self.lab || self.active_recording.is_some()
                || self.is_selecting() || self.is_processing()
                || self.iphone_preview.is_some() || self.agent_capture_id.is_some()
                || self.recording_shortcut_key;
            if self.agent_captures.admit(id, occupied, request.expired()) {
                self.agent_capture_id = Some(id.clone());
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
            None => serde_json::json!({"state": before}),
        };
        let _ = request.reply.send(response.to_string());
    }

    pub fn open_onboarding(&mut self, flow: crate::onboarding::Flow) {
        // Drop the old window before the new one opens.
        self.cancel_onboarding_editor();
        self.onboarding = None;
        let sender = self.telemetry.ui_sender.clone();
        let events = move |event| {
            let _ = sender.send(LiveOverlayEvent::Onboarding(event));
        };
        match crate::onboarding::Session::open(flow, &self.shortcut_label(), events) {
            Ok(session) => {
                self.onboarding = Some(session);
                self.sync_onboarding_editor();
            }
            Err(error) => apparent_log(format!("onboarding could not open: {error:#}")),
        }
    }

    /// Opens Settings, or brings it forward on `pane`.
    pub fn open_settings(&mut self, pane: Option<crate::settings::Pane>) {
        if let Some(session) = self.settings.as_mut() {
            session.show(pane);
            return;
        }
        let sender = self.telemetry.ui_sender.clone();
        let events = move |event| {
            let _ = sender.send(LiveOverlayEvent::Settings(event));
        };
        match crate::settings::Session::open(pane, self.grants.clone(), events) {
            Ok(mut session) => {
                session.sync(&crate::settings::AppHost {
                    telemetry: &self.telemetry,
                });
                self.settings = Some(session);
            }
            Err(error) => apparent_log(format!("Settings could not open: {error:#}")),
        }
    }

    pub(super) fn settings_event(&mut self, event: crate::settings::Event, cx: &mut Context<Self>) {
        use crate::settings::{Effect, Event};
        if let Event::Grants(grants) = &event {
            self.note_grants(grants);
        }
        let Some(session) = self.settings.as_mut() else {
            return;
        };
        let mut host = crate::settings::AppHost {
            telemetry: &self.telemetry,
        };
        let effect = session.event(event, &mut host);
        let shortcut = self.shortcut_label();
        if let Some(onboarding) = self.onboarding.as_mut() {
            onboarding.shortcut_changed(&shortcut);
        }
        match effect {
            Effect::Close => self.settings = None,
            Effect::Tour => self.open_onboarding(crate::onboarding::Flow::tour(
                crate::onboarding::Step::Welcome,
                self.grants.clone(),
            )),
            Effect::Relaunch => {
                self.settings = None;
                crate::onboarding::relaunch();
                cx.quit();
            }
            Effect::QuitForUpdate => {
                self.settings = None;
                cx.quit();
            }
            _ => {}
        }
    }

    /// Keeps a fresh read of the grants and remembers what was granted. (The key tap follows
    /// Accessibility by itself, in the HID poller.)
    pub(super) fn note_grants(&mut self, grants: &crate::onboarding::Grants) {
        use crate::onboarding::Progress;
        let mut progress = Progress::load();
        if progress.note(grants) {
            progress.save();
        }
        self.grants = Some(grants.clone());
    }

    /// Required permissions that keep a capture from starting now.
    pub(super) fn missing_to_record(&mut self) -> Vec<crate::onboarding::Permission> {
        use crate::onboarding::{Permission, missing_to_record};
        let screen = crate::capture::screen_capture_usable(false);
        let accessibility = crate::capture::accessibility_granted();
        let missing = missing_to_record(self.grants.as_ref(), screen, accessibility);
        // The last read may be old; read again before standing in the way.
        if missing.contains(&Permission::Microphone)
            && let Some(fresh) = crate::onboarding::read_grants()
        {
            self.note_grants(&fresh);
            return missing_to_record(self.grants.as_ref(), screen, accessibility);
        }
        missing
    }

    /// Whether this may go on: with a required permission off it starts nothing, and the
    /// permissions window comes forward once the modifiers are up.
    pub(super) fn ready_to_record(&mut self) -> bool {
        if self.lab {
            return true;
        }
        let missing = self.missing_to_record();
        if missing.is_empty() {
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
    pub(super) fn ready_for(&mut self, permission: crate::onboarding::Permission) -> bool {
        let granted = |g: &crate::onboarding::Grants| g.granted(permission);
        if self.lab || self.grants.as_ref().is_none_or(granted) {
            return true;
        }
        if let Some(fresh) = crate::onboarding::read_grants() {
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
    pub fn tick_gate(&mut self) {
        use crate::onboarding::{Flow, Input, Mode, Permission};
        let Some(asks) = self.gate.tick(crate::capture::modifier_flags() != 0) else {
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

    pub(super) fn onboarding_event(&mut self, event: crate::onboarding::Event, cx: &mut Context<Self>) {
        use crate::onboarding::{Effect, Event, Progress};
        let effect = match event {
            Event::Launch(grants) => {
                self.note_grants(&grants);
                let mut progress = Progress::load();
                let plan = crate::onboarding::launch_plan(&progress, &grants);
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
                        crate::settings::Event::Grants(grants.clone()),
                        &mut crate::settings::AppHost {
                            telemetry: &self.telemetry,
                        },
                    );
                }
                self.onboarding
                    .as_mut()
                    .map_or(Effect::None, |session| session.grants(grants))
            }
            Event::Action(action) if action == "use-desktop-shortcut" => {
                let host = crate::settings::AppHost { telemetry: &self.telemetry };
                if self.onboarding_editor.record_shortcut(&host).externally_managed
                    && let Some(session) = self.onboarding.as_mut()
                {
                    session.input(crate::onboarding::Input::ShortcutChosen);
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
                    .is_some_and(|session| session.editing_shortcut())
                    && matches!(
                        action,
                        crate::settings::Action::Shortcut {
                            kind: crate::capture::ShortcutKind::Record,
                            ..
                        } | crate::settings::Action::ResetShortcut {
                            kind: crate::capture::ShortcutKind::Record
                        } | crate::settings::Action::CancelShortcut
                    )
                {
                    let mut host = crate::settings::AppHost {
                        telemetry: &self.telemetry,
                    };
                    let choosing = matches!(action, crate::settings::Action::Shortcut { .. })
                        && self.onboarding_editor.record_shortcut(&host).recording;
                    self.onboarding_editor.on(action, &mut host);
                    let editor = self.onboarding_editor.record_shortcut(&host);
                    if choosing && !editor.recording && editor.error.is_none()
                        && let Some(session) = self.onboarding.as_mut()
                    {
                        session.input(crate::onboarding::Input::ShortcutChosen);
                    }
                    self.sync_onboarding_editor();
                }
                Effect::None
            }
            Event::Exited => {
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
                let mut host = crate::settings::AppHost {
                    telemetry: &self.telemetry,
                };
                self.onboarding_editor.on(
                    crate::settings::Action::RecordShortcut {
                        kind: crate::capture::ShortcutKind::Record,
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
                self.cancel_onboarding_editor();
                apparent_log(format!(
                    "Screen Recording granted but not usable here; relaunching (resume {resume:?})"
                ));
                let mut progress = Progress::load();
                progress.relaunching(resume, crate::onboarding::unix_ms());
                progress.save();
                self.onboarding = None;
                crate::onboarding::relaunch();
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

    pub(super) fn sync_onboarding_editor(&mut self) {
        use crate::settings::Host as _;
        let host = crate::settings::AppHost {
            telemetry: &self.telemetry,
        };
        if let Some(session) = self.onboarding.as_mut() {
            session.shortcut_changed(&host.shortcuts().record.label);
            session.shortcut_editor(&self.onboarding_editor.record_shortcut(&host));
        }
    }

    pub(super) fn cancel_onboarding_editor(&mut self) {
        let mut host = crate::settings::AppHost {
            telemetry: &self.telemetry,
        };
        self.onboarding_editor
            .on(crate::settings::Action::CancelShortcut, &mut host);
    }

}
