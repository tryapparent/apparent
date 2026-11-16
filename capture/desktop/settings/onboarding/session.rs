impl Session {
    /// State-only transport: tests exercise coordinator lifecycle without a window or user config.
    #[cfg(test)]
    pub(crate) fn for_test(flow: Flow) -> Self {
        Self {
            source: next_session_source(),
            transport_generation: next_session_source(),
            flow,
            fallback: None,
            fallback_pending: false,
            transport: Transport::InProcess(None),
            permission_adapter: None,
            polling: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
            last_view: String::new(),
            shortcut_label: String::new(),
            shortcut_state: None,
            shortcut_choice_down: false,
            saved_resume: None,
            saved_tutorial: None,
            saved_shortcut_chosen: false,
            saved_shortcut_tested_for: None,
            saved_first_capture_completed: false,
            clock: std::time::Instant::now(),
            practice: None,
            anchor: None,
            practice_board: None,
            board_view: None,
            practice_completed:false,practice_bundle:None,practice_receipt:None,editor:None,pen_picker: false,pen_selected:false,pen_error:false,pen_save_id:None,
        }
    }

    pub fn open(
        flow: Flow,
        shortcut: &str,
        events: impl Fn(Event) + Send + Sync + Clone + 'static,
    ) -> anyhow::Result<Self> {
        use std::sync::atomic::AtomicBool;
        #[cfg(not(target_os = "macos"))]
        use std::sync::atomic::Ordering;

        let source = next_session_source();
        let transport_generation = next_session_source();
        let events = Self::scope_events(source, events);
        let polling = std::sync::Arc::new(AtomicBool::new(true));
        let event_alive = polling.clone();
        let events = move |event| {
            if event_alive.load(std::sync::atomic::Ordering::Acquire) { events(event); }
        };
        let native_events = events.clone();
        let native_shortcut = shortcut.to_owned();
        let native = move |generation| {
            let native_events = Self::scope_transport(generation, native_events.clone());
            if cfg!(target_os = "macos") {
                Self::spawn_helper(&native_shortcut, native_events.clone())
            } else {
                let (sender, receiver) = flume::unbounded();
                let window_events = native_events.clone();
                crate::capture::desktop::settings::onboarding_window::request_open(
                    receiver, native_shortcut.clone(),
                    std::sync::Arc::new(move |event| window_events(event)),
                );
                Ok(Transport::InProcess(Some(sender)))
            }
        };
        let attempted = match super::presentation::onboarding_assets() {
            Err(stage) => {
                crate::capture::engine::runtime::apparent_log(format!(
                    "onboarding renderer unavailable stage={}",
                    stage.stage()
                ));
                None
            }
            Ok((app, runtime)) => {
                let mut command = super::presentation::onboarding_command(runtime, app);
                match Self::spawn_renderer_transport(&mut command, transport_generation, events.clone()) {
                    Ok(transport) => Some(transport),
                    Err(error) => {
                        let kind = error.downcast_ref::<std::io::Error>()
                            .map(|error| format!("io_{:?}", error.kind()))
                            .unwrap_or_else(|| "other".to_owned());
                        crate::capture::engine::runtime::apparent_log(format!(
                            "onboarding renderer unavailable stage=spawn_error kind={kind}"
                        ));
                        None
                    }
                }
            }
        };
        let shell = attempted.is_some();
        let (transport, fallback) = match attempted {
            Some(transport) => (transport, Some(Box::new(native) as Box<dyn Fn(u64) -> anyhow::Result<Transport>>)),
            None => (native(transport_generation)?, None),
        };

        #[cfg(not(target_os = "macos"))]
        let alive = std::sync::Arc::clone(&polling);
        #[cfg(not(target_os = "macos"))]
        std::thread::spawn(move || {
            while alive.load(Ordering::Acquire) {
                if let Some(grants) = read_grants()
                    && alive.load(Ordering::Acquire)
                {
                    events(Event::Grants(grants));
                }
                std::thread::sleep(std::time::Duration::from_millis(500));
            }
        });

        let progress = Progress::load();
        let allowed = relaunch_allowed(&progress, unix_ms());
        let mut session = Self {
            source,
            transport_generation,
            flow: flow
                .with_auto_relaunch(allowed)
                .with_tutorial(progress.tutorial)
                .with_first_capture(
                    crate::shared::handoff::experiment("onboardingFirstCapture"),
                    progress.shortcut_chosen,
                    progress.tested_shortcut(shortcut),
                    progress.first_capture_completed,
                ),
            transport,
            permission_adapter: None,
            fallback,
            fallback_pending: false,
            polling,
            last_view: String::new(),
            shortcut_label: String::new(),
            shortcut_state: None,
            shortcut_choice_down: true,
            saved_resume: None,
            saved_tutorial: progress.tutorial,
            saved_shortcut_chosen: progress.shortcut_chosen,
            saved_shortcut_tested_for: progress.shortcut_tested_for,
            saved_first_capture_completed: progress.first_capture_completed,
            clock: std::time::Instant::now(),
            practice: shell.then(super::practice::Practice::default),
            anchor: None,
            practice_board: None,
            board_view: None,
            practice_completed:false,practice_bundle:None,practice_receipt:None,editor:None,pen_picker: false,pen_selected:false,pen_error:false,pen_save_id:None,
        };
        session.shortcut_changed(shortcut);
        session.sync();
        Ok(session)
    }

    pub fn source(&self) -> u64 { self.source }
    pub fn transport_generation(&self) -> u64 { self.transport_generation }

    fn scope_transport(generation: u64, events: impl Fn(Event) + Send + Sync + Clone + 'static)
        -> impl Fn(Event) + Send + Sync + Clone + 'static
    {
        move |event| events(Event::Transport { generation, event: Box::new(event) })
    }

    fn scope_events(source: u64, events: impl Fn(Event) + Send + Sync + Clone + 'static)
        -> impl Fn(Event) + Send + Sync + Clone + 'static
    {
        move |event| events(Event::Session { source, event: Box::new(event) })
    }

    fn spawn_helper(
        shortcut: &str,
        events: impl Fn(Event) + Send + Sync + Clone + 'static,
    ) -> anyhow::Result<Transport> {
        use std::process::{Command, Stdio};

        let mut command = Command::new(crate::capture::desktop::helper::path()?);
        command
            .args(["onboarding", "--shortcut", shortcut, "--paste"])
            .arg(crate::capture::desktop::settings::paste_label())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        let dev_icon = concat!(env!("CARGO_MANIFEST_DIR"), "/capture/desktop/assets/app-icon.png");
        if Path::new(dev_icon).is_file() {
            command.args(["--icon", dev_icon]);
        }
        Self::spawn_transport(&mut command, events)
    }

    fn spawn_renderer_transport(
        command: &mut std::process::Command,
        generation: u64,
        events: impl Fn(Event) + Send + Sync + Clone + 'static,
    ) -> anyhow::Result<Transport> {
        let events = Self::scope_transport(generation, events);
        command.stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::null());
        let mut child = command.spawn()?;
        let stdin = child.stdin.take().ok_or_else(|| anyhow::anyhow!("missing onboarding input"))?;
        let lost = events.clone();
        let input = match pipe::Input::new(stdin, move || lost(Event::Exited)) {
            Ok(input) => input,
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(error.into());
            }
        };
        if let Some(stdout) = child.stdout.take() { Self::read_actions(stdout, events); }
        Ok(Transport::Renderer { child: crate::capture::ui_process::UiChild::new(child), input })
    }

    fn spawn_transport(command: &mut std::process::Command, events: impl Fn(Event) + Send + Sync + Clone + 'static) -> anyhow::Result<Transport> {
        command.stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::null());
        let mut child = command.spawn()?;
        let stdin = child.stdin.take();
        if let Some(stdout) = child.stdout.take() { Self::read_actions(stdout, events); }
        Ok(Transport::Helper { child: crate::capture::ui_process::UiChild::new(child), stdin })
    }

    fn read_actions(stdout: std::process::ChildStdout, events: impl Fn(Event)+Send+Sync+Clone+'static) {
        std::thread::spawn(move || {
            let mut closed = false;
            {
                let mut reader = std::io::BufReader::new(stdout);
                loop {
                    let mut line = Vec::new();
                    let read = read_protocol_line(&mut reader, &mut line);
                    if !matches!(read, Ok(n) if n > 0 && n <= 65_536) { break; }
                    let Ok(line) = std::str::from_utf8(&line) else { continue; };
                    let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) else {
                        continue;
                    };
                    if value.get("action").and_then(|v| v.as_str()) == Some("board") {
                        events(Event::Board(value));
                        continue;
                    }
                    let Some(action) = value.get("action").and_then(|v| v.as_str()) else {
                        continue;
                    };
                    let action = action.to_owned();
                    #[cfg(target_os="linux")]
                    if action=="resolve-copilot" {
                        // Chromium's XF86Assistant event has no key/code on the
                        // X1 keymap. Resolve only a currently held native key,
                        // never an arbitrary unidentified renderer event.
                        let pressed = native_shortcut_press().unwrap_or(crate::capture::desktop::settings::Pressed {
                            key_code: 0, modifiers: 0, key: String::new(), reserved: false,
                        });
                        events(Event::Shortcut(crate::capture::desktop::settings::Action::Shortcut {
                            kind: crate::capture::engine::runtime::ShortcutKind::Record, pressed,
                        }));
                        continue;
                    }
                    #[cfg(target_os="linux")]
                    if action=="shortcut-key" {
                        if let (Some(key),Some(modifiers))=(value["key"].as_str(),value["modifiers"].as_u64()) {
                            if key.len()<=32 && modifiers & !0x1b00 == 0 {
                                if let Some(key_code)=crate::capture::desktop::settings::settings_window::key_code(key) {
                                    events(Event::Shortcut(crate::capture::desktop::settings::Action::Shortcut {
                                        kind:crate::capture::engine::runtime::ShortcutKind::Record,
                                        pressed:crate::capture::desktop::settings::Pressed {key_code,modifiers:modifiers as u32,key:key.to_owned(),reserved:false},
                                    }));
                                }
                            }
                        }
                        continue;
                    }
                    if matches!(
                        action.as_str(),
                        "shortcut" | "cancel-shortcut" | "reset-shortcut"
                    ) {
                        let mut value = value;
                        if action == "reset-shortcut" && value.get("kind").is_none() {
                            value["kind"] = "record".into();
                        }
                        if let Ok(mut action) = serde_json::from_value(value) {
                            #[cfg(target_os = "macos")]
                            if let super::settings::Action::Shortcut { pressed, .. } = &mut action {
                                pressed.reserved = native_shortcut_reserved(pressed.key_code, pressed.modifiers);
                            }
                            events(Event::Shortcut(action));
                        }
                        continue;
                    }
                    let action = match value.get("permission").and_then(|v| v.as_str()) {
                        Some(permission) => format!("{action}:{permission}"),
                        None => action.to_owned(),
                    };
                    closed |= action == "close";
                    events(Event::Action(action));
                }
            }
            if !closed {
                crate::capture::engine::runtime::apparent_log("onboarding renderer transport stdout closed");
                events(Event::Exited);
            }
        });
    }

    pub fn restore_native(&mut self) -> bool {
        // Invalidate queued actions/EOF before dropping the old child's input.
        if self.fallback.is_some() { self.transport_generation = next_session_source(); }
        if self.fallback.is_some() && self.flow.hidden {
            // A replacement native window may map before a queued hide reaches it.
            // Defer creating any replacement until capture completion reveals the flow.
            self.fallback_pending = true;
            let old = std::mem::replace(&mut self.transport, Transport::InProcess(None));
            retire_transport(old);
            return true;
        }
        self.fallback_pending = false;
        let Some(fallback) = self.fallback.take() else { return false; };
        crate::capture::engine::runtime::apparent_log("onboarding native fallback requested");
        if let Some(adapter) = self.permission_adapter.take() { retire_transport(adapter); }
        let old = std::mem::replace(&mut self.transport, Transport::InProcess(None));
        retire_transport(old);
        match fallback(self.transport_generation) {
            Ok(transport) => {
                self.transport = transport;
                // The native fallback has its own optional/required practice presentation.
                self.practice = None;
                self.pen_picker = false;
                self.last_view.clear();
                let label = self.shortcut_label.clone();
                self.shortcut_changed(&label);
                if let Some(editor) = self.shortcut_state.clone() { self.send(&editor); }
                self.sync();
                if self.flow.hidden { self.send(&serde_json::json!({"type": "hide"})); }
                true
            }
            Err(error) => {
                let kind = error
                    .downcast_ref::<std::io::Error>()
                    .map(|error| format!("io_{:?}", error.kind()))
                    .unwrap_or_else(|| "other".to_owned());
                crate::capture::engine::runtime::apparent_log(format!(
                    "onboarding native fallback failed kind={kind}"
                ));
                false
            }
        }
    }

    pub fn mode(&self) -> Mode {
        self.flow.mode()
    }

    pub fn leave(&self, exited: bool) {
        // A helper crash was not a completed tour before this experiment either.
        if exited && !self.flow.first_capture_required {
            return;
        }
        let mut progress = Progress::load();
        progress.leave(&self.flow);
        progress.save();
    }

    /// Feeds the flow and carries out what the window can do itself. Returns what needs the
    /// app: `Close` or `Relaunch`.
    pub fn input(&mut self, input: Input) -> Effect {
        if matches!(&input, Input::ShortcutChosen) { self.shortcut_choice_down = true; }
        if self.practice.is_some() && self.flow.step()==Step::TryIt && !self.fallback_pending {
            match &input {
                Input::CaptureSelecting => self.practice.as_mut().unwrap().selecting(),
                Input::CaptureStarted => {
                    self.practice_completed=false;
                    self.practice_bundle=None;
                    self.practice_receipt=None;
                    self.practice=Some(super::practice::Practice::default());
                },
                Input::CaptureEnded { completed:true } => {
                    self.practice_completed=self.flow.practice_recording;
                    // A finished capture owns no live shortcut/hidden state. Coaching
                    // keeps its own eligibility until the person finishes the lesson.
                    self.flow.on(Input::CaptureEnded{completed:false});
                    self.sync();return Effect::None;
                },
                Input::CaptureEnded { completed:false } => self.practice.as_mut().unwrap().cancelled(),
                _=>{},
            }
        }
        let started=matches!(input,Input::CaptureStarted);
        let effect = self.flow.on(input);
        if started && self.flow.practice_recording {if let Some(p)=self.practice.as_mut(){p.started();}}
        // The in-process window feeds the flow on every refresh: log only what changed.
        static LAST: std::sync::Mutex<String> = std::sync::Mutex::new(String::new());
        let line = format!("onboarding: {:?} -> {effect:?}", self.flow.step());
        let mut last = LAST.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        if *last != line {
            crate::capture::engine::runtime::apparent_log(&line);
            *last = line;
        }
        drop(last);
        let result = match effect {
            // Attributed to whichever process asks, so Apparent itself asks.
            Effect::Request(Permission::ScreenRecording) => {
                crate::capture::engine::runtime::request_screen_capture();
                Effect::None
            }
            Effect::Request(permission) => {
                self.permission_action("request", permission);
                Effect::None
            }
            Effect::OpenSettings(permission) => {
                self.permission_action("open-settings", permission);
                Effect::None
            }
            Effect::Hide => {
                self.send(&serde_json::json!({"type": "hide"}));
                Effect::None
            }
            Effect::Show => {
                self.show();
                Effect::None
            }
            Effect::ConfirmScreen => {
                std::thread::spawn(|| {
                    // After macOS's own questions (System Settings' "Quit & Reopen") are
                    // answered and this window is back in front with its note, so the one
                    // question comes up by itself, over the explanation.
                    #[cfg(target_os = "macos")]
                    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(300);
                    #[cfg(target_os = "macos")]
                    while std::time::Instant::now() < deadline
                        && crate::shared::windows::macos_is_asking(&objc2::rc::autoreleasepool(|_| {
                            crate::shared::windows::raw_windows()
                        }))
                    {
                        std::thread::sleep(std::time::Duration::from_millis(300));
                    }
                    std::thread::sleep(std::time::Duration::from_millis(1_200));
                    let result = crate::capture::engine::runtime::screen_capture_probe();
                    crate::capture::engine::runtime::apparent_log(format!(
                        "onboarding: listed the screen once for macOS's window picker question: {result:?}"
                    ));
                });
                Effect::None
            }
            other => other,
        };
        self.sync();
        result
    }

    /// An action string from the helper as an `Input`.
    pub fn action(&mut self, action: &str) -> Effect {
        // TypeScript owns the choice-as-first-practice policy. This adapter
        // admits only the current native selection after release, never capture.
        // The existing native progress writer remains authoritative.
        if let Some(label) = action.strip_prefix("accept-shortcut-choice:") {
            if self.practice.is_some() && self.fallback.is_some() && !self.fallback_pending
                && self.flow.step() == Step::Shortcut
                && self.flow.shortcut_chosen && !self.flow.shortcut_editing
                && !self.shortcut_choice_down && !label.is_empty() && label == self.shortcut_label
                && !self.editor.as_ref().is_some_and(|editor| editor.recording)
            { return self.input(Input::ShortcutTriggered); }
            return Effect::None;
        }
        if self.practice.is_some() && self.flow.step()==Step::Welcome {
            if action=="back" && self.pen_picker {self.pen_picker=false;self.sync();return Effect::None;}
            if action=="continue" && !self.pen_picker {self.pen_picker=true;self.sync();return Effect::None;}
            if let Some(name)=action.strip_prefix("pen:") {
                if self.pen_picker {
                    let (name, receipt) = name.split_once(':').map_or((name, None), |(name, id)| (name, Some(id)));
                    if receipt.is_some_and(|id| id.len()!=36 || !id.bytes().all(|c| c.is_ascii_hexdigit() || c==b'-')) {return Effect::None;}
                    self.pen_error=crate::shared::handoff::pen::save(name).is_err();
                    self.pen_selected=!self.pen_error;
                    // Echo only after the authoritative config writer has returned.
                    self.pen_save_id=receipt.map(str::to_owned);
                    self.sync();
                }
                return Effect::None;
            }
            if action=="continue" && !self.pen_selected {return Effect::None;}
        }

        if action.starts_with("practice-") {
            if let Some(practice)=self.practice.as_mut() {
                if practice.action(action) && action=="practice-finish" && self.practice_completed {
                    self.flow.first_capture_completed=true;
                    self.flow.step=Step::Done;
                    self.sync();
                    return self.input(Input::Continue);
                }
            }
            self.sync();return Effect::None;
        }
        let input = match action {
            "continue" => Input::Continue,
            "back" => Input::Back,
            "later" => Input::Later,
            "close" => Input::Closed,
            "settings" => Input::Settings,
            "change-shortcut" => Input::ChangeShortcut,
            "skip" => Input::Skip,
            "watched" => Input::Watched,
            "practiced" => Input::Practiced,
            other => match other
                .strip_prefix("grant:")
                .and_then(|p| serde_json::from_value(serde_json::Value::String(p.into())).ok())
            {
                Some(permission) => Input::Grant(permission),
                None => return Effect::None,
            },
        };
        self.input(input)
    }

    pub fn grants(&mut self, grants: Grants) -> Effect {
        let now_ms = self.clock.elapsed().as_millis() as u64;
        self.input(Input::Grants { grants, now_ms })
    }

    pub fn show(&mut self) {
        if self.fallback_pending && !self.flow.hidden { self.restore_native(); }
        self.send(&serde_json::json!({"type": "show"}));
    }

    /// Keep every step's displayed Record keys in sync with the active shortcut.
    pub fn shortcut_changed(&mut self, label: &str) {
        if !self.shortcut_label.is_empty() && self.shortcut_label != label
            && self.flow.mode == Mode::Tour && !self.flow.practice_recording && !self.flow.first_capture_completed
        {
            self.flow.shortcut_tested = false;
            self.shortcut_choice_down = true;
            if self.flow.step == Step::TryIt { self.flow.step = Step::Shortcut; }
        }
        self.shortcut_label = label.to_owned();
        self.send(&serde_json::json!({"type": "shortcut", "label": label}));
    }

    pub fn shortcut_editor(&mut self, editor: &crate::capture::desktop::settings::ShortcutView) {
        if !editor.recording { self.flow.shortcut_editing = false; }
        let message = serde_json::json!({"type": "shortcut-editor", "shortcut": editor});
        self.shortcut_state = Some(message.clone());
        self.editor = Some(editor.clone());
        self.send(&message);
        self.sync();
    }

    #[cfg(target_os="linux")]
    pub(crate) fn desktop_shortcut_pressed(&mut self) {
        // OS metadata only: TypeScript decides whether this offered binding
        // belongs to the current listening state and uses the ordinary editor.
        if let Some(cfg)=crate::capture::desktop::linux::hyprland::external_record() {
            crate::capture::engine::runtime::apparent_log("shortcut recorder: offering desktop binding");
            self.send(&serde_json::json!({"type":"desktop-shortcut", "keyCode":cfg.key_code,
                "modifiers":cfg.carbon_modifiers,"key":"Copilot"}));
        } else {
            crate::capture::engine::runtime::apparent_log("shortcut recorder: desktop binding unavailable");
        }
    }

    pub(crate) fn local_practice(&self) -> bool {
        self.flow.local_practice()
    }

    pub(crate) fn shortcut_policy(&self) -> ShortcutPolicy {
        let policy = self.flow.shortcut_policy();
        if self.shortcut_choice_down && policy == ShortcutPolicy::Trial { ShortcutPolicy::Block } else { policy }
    }
    pub(crate) fn shortcut_selection_released(&mut self, released: bool) {
        if released { self.shortcut_choice_down = false; }
    }

    /// Both adapters return only modifiers, but macOS uses CGEventFlags and
    /// Linux uses Carbon shortcut bits. Zero means released on either platform.
    pub(crate) fn observe_shortcut_modifiers(&mut self, flags: u64) {
        self.shortcut_selection_released(flags == 0);
    }
    pub(crate) fn allows_capture_start(&self) -> bool {
        !self.flow.first_capture_required || self.flow.step == Step::Done
            || (self.flow.step == Step::TryIt && self.flow.local_practice())
    }

    pub(crate) fn choosing_shortcut(&self) -> bool {
        self.flow.step() == Step::Shortcut
    }

    pub fn observe_practice(&mut self, board:bool, screen:usize, processing:bool, saved:Option<bool>) {
        if self.flow.step()!=Step::TryIt {return;}
        if let Some(practice)=self.practice.as_mut() {
            practice.observe_ink(board,screen);
            if processing {practice.processing();}
            if let Some(copied)=saved {practice.saved(copied);}
        }
        self.sync();
    }
    pub fn observe_practice_surface(&mut self, board:bool, screen:usize, processing:bool, frame:Option<[f32;4]>) {
        // Ink and Close can arrive in one tick. Consume native ink first, then
        // visibility, and publish the resulting lesson only once.
        if let Some(practice)=self.practice.as_mut() {practice.observe_ink(board,screen);}
        self.practice_board(frame);
        self.observe_practice(board,screen,processing,None);
    }
    pub fn practice_note_saved(&mut self, saved: bool) {
        if self.flow.step()==Step::TryIt {
            if let Some(practice)=self.practice.as_mut() {practice.observe_note(saved);}
        }
    }
    pub fn practice_anchor(&mut self,anchor:Option<[f32;4]>) {self.anchor=anchor;}
    pub fn practice_board(&mut self, frame: Option<[f32;4]>) {
        self.practice_board=frame;
        if let Some(p)=self.practice.as_mut() { p.whiteboard_visible(frame.is_some()); }
    }
    pub fn board_view(&mut self, view: Option<serde_json::Value>) { self.board_view=view; }
    pub fn electron_practice(&self)->bool { self.practice_active() && self.fallback.is_some() && !self.fallback_pending }
    pub fn practice_active(&self)->bool {self.practice.is_some() && self.flow.step()==Step::TryIt}
    pub fn practice_locating(&self)->bool {self.practice.as_ref().is_some_and(|p|p.stage==super::practice::Stage::Locate)}
    pub fn practice_desktop_stage(&self)->bool {self.practice.as_ref().is_some_and(|p|matches!(p.stage,super::practice::Stage::Note|super::practice::Stage::ScreenInk))}
    pub fn practice_whiteboard(&mut self) {if let Some(p)=self.practice.as_mut(){p.whiteboard();}self.sync();}
    pub fn practice_saved_bundle(&mut self, path: &Path) { if self.practice_active() { self.practice_bundle=Some(path.to_owned()); } }
    /// A finalizer/clipboard observation, delivered only after the caller's native
    /// current-generation gate. Capture and request IDs retain their producer identity;
    /// the renderer cannot manufacture this receipt. This compatible adapter feeds
    /// the existing lesson until the headless TypeScript consumer is adopted.
    pub(crate) fn practice_completion(
        &mut self, generation: u64, capture_id: &str, request_id: Option<&str>,
        bundle: Option<&Path>, clipboard: Option<bool>,
    ) {
        if !self.practice_active() || !self.flow.practice_recording
            || capture_id.is_empty() || self.practice_receipt.is_some() { return; }
        self.practice_receipt = Some((generation, capture_id.to_owned(), request_id.map(str::to_owned)));
        match bundle {
            Some(path) => {
                self.practice_saved_bundle(path);
                self.observe_practice(false, 0, true, Some(clipboard == Some(true)));
            }
            None => { self.input(Input::CaptureEnded { completed: false }); }
        }
    }
    pub fn practice_opened_bundle(&mut self, path: &Path) { if self.practice_bundle.as_deref()==Some(path) {self.practice_latest();} }
    pub fn practice_latest(&mut self) {if let Some(p)=self.practice.as_mut(){p.opened_latest();}self.sync();}

    pub fn editing_shortcut(&self) -> bool {
        self.flow.step() == Step::Shortcut && self.flow.shortcut_editing
    }

    fn sync(&mut self) {
        #[cfg(test)]
        if matches!(self.transport, Transport::InProcess(None)) {
            return;
        }
        let mut view = serde_json::to_value(self.flow.view()).unwrap_or_default();
        view["type"] = "state".into();
        if let Some(practice)=self.practice.as_ref() {view["practice"]=serde_json::json!(practice.stage);}
        view["shortcut"]=self.shortcut_label.clone().into();
        view["shortcutSelectionReleased"]=(!self.shortcut_choice_down).into();
        view["platform"]=std::env::consts::OS.into();
        view["wisprFlowEnabled"]=(cfg!(target_os = "macos")
            && crate::shared::handoff::experiment("onboardingWisprFlow")).into();
        view["shortcutEditor"]=serde_json::json!(self.editor);
        view["anchor"]=serde_json::json!(self.anchor);
        view["practiceBoard"]=serde_json::json!(self.practice_board);
        view["boardView"]=serde_json::json!(self.board_view);
        view["testInstance"]=false.into();
        view["penSaveId"]=serde_json::json!(self.pen_save_id);
        view["penPicker"]=self.pen_picker.into();view["penSelected"]=self.pen_selected.into();view["penError"]=self.pen_error.into();
        view["penRgb"]=serde_json::json!(crate::shared::handoff::pen::rgb());
        view["speech"] = serde_json::to_value(crate::capture::engine::runtime::audio::transcription::speech_model::current()).unwrap_or_default();
        let text = view.to_string();
        if text != self.last_view {
            #[cfg(target_os = "macos")]
            if let Some(Transport::Helper { stdin: Some(pipe), .. }) = self.permission_adapter.as_mut() {
                use std::io::Write;
                for message in permission_guide_messages(&self.flow.view()) {
                    let _ = writeln!(pipe, "{message}").and_then(|()| pipe.flush());
                }
            }
            self.send(&view);
            self.last_view = text;
        }
        // Remember the step, so whatever quits Apparent, the tour comes back here.
        let resume = self.flow.resume_point();
        let tutorial = self.flow.tutorial();
        let new_resume = resume.is_some() && resume != self.saved_resume;
        let tested_for = self.flow.shortcut_tested.then(|| self.shortcut_label.clone());
        let milestones_changed = self.flow.mode == Mode::Tour
            && (self.saved_shortcut_chosen != self.flow.shortcut_chosen
                || self.saved_shortcut_tested_for != tested_for
                || self.saved_first_capture_completed != self.flow.first_capture_completed);
        if new_resume || tutorial != self.saved_tutorial || milestones_changed {
            let mut progress = Progress::load();
            if new_resume {
                progress.resume = resume;
            }
            // Persist when the successful trial advances, not only when a
            // window closes: force-quit/relaunch must not repeat Go again.
            if self.flow.mode == Mode::Tour { progress.leave(&self.flow); }
            progress.tutorial = tutorial;
            if self.flow.mode == Mode::Tour {
                progress.shortcut_chosen = self.flow.shortcut_chosen;
                progress.shortcut_tested_for = tested_for.clone();
                progress.first_capture_completed = self.flow.first_capture_completed;
            }
            if let Err(error) = progress.save_to(&crate::shared::handoff::default_config_path()) {
                crate::capture::engine::runtime::apparent_log(&format!("onboarding: progress save failed: {error}"));
                return;
            }
            self.saved_resume = resume.or(self.saved_resume);
            self.saved_tutorial = tutorial;
            self.saved_shortcut_chosen = self.flow.shortcut_chosen;
            self.saved_shortcut_tested_for = tested_for;
            self.saved_first_capture_completed = self.flow.first_capture_completed;
        }
    }

    // Electron owns presentation; the installed helper retains consent attribution and
    // the lifetime of asynchronous native prompts. Never send it a presentation state.
    fn permission_action(&mut self, action: &str, permission: Permission) {
        if self.fallback_pending { return; }
        if self.fallback.is_none() {
            self.send(&serde_json::json!({"type": action, "permission": permission}));
            return;
        }
        #[cfg(target_os = "linux")]
        if permission == Permission::Accessibility {
            // The Electron input-device action has the same bounded clipboard effect
            // as native onboarding. Copying never grants access or advances setup;
            // the existing poller must observe readable devices after login.
            crate::capture::desktop::linux::privacy::copy_input_command();
        } else {
            crate::capture::desktop::linux::privacy::open_settings(permission);
        }
        #[cfg(target_os = "macos")]
        {
            let adapter_dead = match self.permission_adapter.as_mut() {
                Some(Transport::Helper { child, stdin }) => stdin.is_none() || !matches!(child.try_wait(), Ok(None)),
                Some(_) => true,
                None => false,
            };
            if adapter_dead {
                if let Some(adapter) = self.permission_adapter.take() { retire_transport(adapter); }
                if self.restore_native() { self.permission_action(action, permission); }
                return;
            }
            if self.permission_adapter.is_none() {
                let Ok(path) = crate::capture::desktop::helper::path() else {
                    if self.restore_native() { self.permission_action(action, permission); }
                    return;
                };
                let mut command = std::process::Command::new(path);
                command.args(["onboarding", "--permissions-only"]);
                self.permission_adapter = Self::spawn_transport(&mut command, |_| {}).ok();
                if self.permission_adapter.is_none() {
                    if self.restore_native() { self.permission_action(action, permission); }
                    return;
                }
            }
            if let Some(Transport::Helper { stdin: Some(pipe), .. }) = self.permission_adapter.as_mut() {
                use std::io::Write;
                let message = serde_json::json!({"type": action, "permission": permission});
                if writeln!(pipe, "{message}").and_then(|()| pipe.flush()).is_err() {
                    if let Some(adapter) = self.permission_adapter.take() { retire_transport(adapter); }
                    if self.restore_native() { self.permission_action(action, permission); }
                }
            }
        }
    }

    fn send(&mut self, message: &serde_json::Value) {
        use std::io::Write;
        match &mut self.transport {
            Transport::Renderer { input, .. } => {
                let mut line = message.to_string().into_bytes();
                line.push(b'\n');
                input.send(line);
            }
            Transport::Helper { stdin, .. } => {
                if let Some(pipe) = stdin.as_mut()
                    && writeln!(pipe, "{message}")
                        .and_then(|()| pipe.flush())
                        .is_err()
                {
                    *stdin = None;
                }
            }
            Transport::InProcess(sender) => {
                if sender
                    .as_ref()
                    .is_some_and(|s| s.send(message.clone()).is_err())
                {
                    *sender = None;
                }
            }
        }
    }
}

