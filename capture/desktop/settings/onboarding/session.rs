include!(concat!(env!("CARGO_MANIFEST_DIR"), "/engine/native/desktop/desktop_frog_peer.rs"));
include!(concat!(env!("CARGO_MANIFEST_DIR"), "/engine/native/macos/desktop/onboarding_transport.rs"));

impl Session {
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
            frog_enabled: false, frog_revealed: false, frog_name: None, frog_error: false, frog_takeoff: None,
            clock: std::time::Instant::now(),
            practice: None,
            anchor: None,
            practice_board: None,
            board_id: None,
            practice_completed:false,practice_bundle:None,practice_receipt:None,editor:None,pen_picker: false,pen_selected:false,pen_error:false,pen_save_id:None,
        }
    }

    pub fn open(
        flow: Flow,
        shortcut: &str,
        events: impl Fn(Event) + Send + Sync + Clone + 'static,
    ) -> anyhow::Result<Self> {
        use std::sync::atomic::AtomicBool;
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

        let progress = Progress::load();
        let allowed = relaunch_allowed(&progress, unix_ms());
        let mut session = Self {
            source,
            transport_generation,
            flow: flow
                .with_auto_relaunch(allowed)
                .with_tutorial(progress.tutorial)
                .with_first_capture(
                    handoff::experiment("onboardingFirstCapture"),
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
            frog_enabled: Self::frog_enabled(shell),
            frog_revealed: false,
            frog_name: progress.frog_name,
            frog_error: false,
            frog_takeoff: None,
            clock: std::time::Instant::now(),
            practice: shell.then(super::practice::Practice::default),
            anchor: None,
            practice_board: None,
            board_id: None,
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

    pub fn restore_native(&mut self) -> bool {
        if self.fallback.is_some() { self.transport_generation = next_session_source(); }
        if self.fallback.is_some() && self.flow.hidden {
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
        if exited && !self.flow.first_capture_required {
            return;
        }
        let mut progress = Progress::load();
        progress.leave(&self.flow);
        progress.save();
    }

    pub fn dismiss(&self) -> anyhow::Result<()> {
        let mut progress = Progress::load();
        progress.dismiss(&self.flow);
        progress.save_to(&handoff::default_config_path())
    }

    pub fn input(&mut self, input: Input) -> Effect {
        if matches!(input, Input::ShortcutTriggered) && self.frog_stage() != 0 {
            self.frog_revealed = true;
            self.sync();
            return Effect::None;
        }
        if matches!(input, Input::ShortcutTriggered) && self.electron_shortcut_step() {
            if self.shortcut_policy() != ShortcutPolicy::Trial { return Effect::None; }
            self.flow.shortcut_chosen = true;
            self.flow.shortcut_tested = true;
        }
        if matches!(input, Input::Back) {
            self.frog_revealed = false;
            self.frog_error = false;
        }
        if matches!(&input, Input::ShortcutChosen) { self.shortcut_choice_down = true; }
        if self.practice.is_some() && self.flow.step()==Step::TryIt && !self.fallback_pending {
            match &input {
                Input::CaptureSelecting => {self.practice_events(vec![serde_json::json!({"type":"selecting"})],false);},
                Input::CaptureStarted => {
                    self.practice_completed=false;
                    self.practice_bundle=None;
                    self.practice_receipt=None;
                    self.practice.as_mut().unwrap().attempt+=1;
                    self.practice.as_mut().unwrap().close_board=None;
                },
                Input::CaptureEnded { completed:true } => {
                    self.practice_completed=self.flow.practice_recording;
                    self.flow.on(Input::CaptureEnded{completed:false});
                    self.sync();return Effect::None;
                },
                Input::CaptureEnded { completed:false } => {self.practice_events(vec![serde_json::json!({"type":"cancelled"})],false);},
                _=>{},
            }
        }
        let started=matches!(input,Input::CaptureStarted);
        let effect = self.flow.on(input);
        if started && self.practice.is_some() && self.flow.step()==Step::TryIt {
            let mut events=vec![serde_json::json!({"type":"reset"})];
            if self.flow.practice_recording {events.push(serde_json::json!({"type":"started"}));}
            self.practice_events(events,false);
        }
        static LAST: std::sync::Mutex<String> = std::sync::Mutex::new(String::new());
        let line = format!("onboarding: {:?} -> {effect:?}", self.flow.step());
        let mut last = LAST.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        if *last != line {
            crate::capture::engine::runtime::apparent_log(&line);
            *last = line;
        }
        drop(last);
        let result = match effect {
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

    pub fn action(&mut self, action: &str) -> Effect {
        if self.practice.is_some() && self.flow.step()==Step::Welcome {
            if action=="back" && self.pen_picker {self.pen_picker=false;self.sync();return Effect::None;}
            if action=="continue" && !self.pen_picker {self.pen_picker=true;self.sync();return Effect::None;}
            if let Some(name)=action.strip_prefix("pen:") {
                if self.pen_picker {
                    let (name, receipt) = name.split_once(':').map_or((name, None), |(name, id)| (name, Some(id)));
                    if receipt.is_some_and(|id| id.len()!=36 || !id.bytes().all(|c| c.is_ascii_hexdigit() || c==b'-')) {return Effect::None;}
                    self.pen_error=handoff::pen::save(name).is_err();
                    self.pen_selected=!self.pen_error;
                    self.pen_save_id=receipt.map(str::to_owned);
                    self.sync();
                }
                return Effect::None;
            }
            if action=="continue" && !self.pen_selected {return Effect::None;}
            if action=="skip-pen" && self.pen_picker {return self.input(Input::Continue);}
        }

        if action.starts_with("practice-") {
            if !["practice-review","practice-paste","practice-pasted","practice-locate","practice-finish"].contains(&action)||!self.practice_active() {return Effect::None;}
            let effect=self.practice_intent(action);
            self.sync();return effect;
        }
        let input = match action {
            "continue" if !self.electron_shortcut_step() => Input::Continue,
            "use-shortcut" if self.electron_shortcut_step() && self.flow.shortcut_tested
                && self.shortcut_policy() == ShortcutPolicy::Trial => Input::Continue,
            "back" => Input::Back,
            "later" => Input::Later,
            "close" => Input::Closed,
            "settings" => Input::Settings,
            "change-shortcut" => Input::ChangeShortcut,
            "skip-shortcut-trial" if !self.electron_shortcut_step() && !self.editor.as_ref().is_some_and(|editor| editor.recording) => Input::SkipShortcutTrial,
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

    pub fn shortcut_changed(&mut self, label: &str) {
        if !self.shortcut_label.is_empty() && self.shortcut_label != label
            && (self.electron_shortcut_step() || (self.flow.mode == Mode::Tour && !self.flow.practice_recording && !self.flow.first_capture_completed))
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

    pub(crate) fn shortcut_selection_released(&mut self, released: bool) {
        if released { self.shortcut_choice_down = false; }
    }

    pub(crate) fn observe_shortcut_modifiers(&mut self, flags: u64) {
        self.shortcut_selection_released(flags == 0);
    }
    pub(crate) fn choosing_shortcut(&self) -> bool {
        self.flow.step() == Step::Shortcut
    }

    pub fn observe_practice(&mut self,board:bool,screen:usize,processing:bool,saved:Option<bool>) {
        if !self.practice_active() {return;}
        let ink=serde_json::json!({"type":"ink","board":board,"screen":screen});
        let mut events=match self.practice.as_mut().and_then(|p|p.visibility.take()) {
            Some(visible)=>vec![ink.clone(),serde_json::json!({"type":"whiteboard-visible","visible":visible}),ink],
            None=>vec![ink],
        };
        if processing {events.push(serde_json::json!({"type":"processing"}));}
        if let Some(copied)=saved {events.push(serde_json::json!({"type":"saved","copied":copied}));}
        self.practice_events(events,false);self.sync();
    }
    pub fn observe_practice_surface(&mut self,board:bool,screen:usize,processing:bool,frame:Option<[f32;4]>) {
        self.practice_board=frame;
        if let Some(p)=self.practice.as_mut() {p.visibility=Some(frame.is_some());}
        self.observe_practice(board,screen,processing,None);
    }
    pub fn practice_note_saved(&mut self,_saved:bool) {}
    pub fn practice_anchor(&mut self,anchor:Option<[f32;4]>) {self.anchor=anchor;}
    #[cfg(test)]
    pub fn practice_board_closed(&mut self) {
        self.practice_board=None;
        self.practice_events(vec![serde_json::json!({"type":"whiteboard-visible","visible":false})],false);
    }
    pub fn board_id(&mut self,id:Option<String>) {self.board_id=id;}
    pub fn practice_active(&self)->bool {self.practice.is_some() && self.flow.step()==Step::TryIt}
    pub fn practice_locating(&self)->bool {self.practice.as_ref().is_some_and(|p|p.locating)}
    #[cfg(test)]
    pub fn practice_desktop_stage(&self)->bool {self.practice.as_ref().is_some_and(|p|p.desktop_stage)}
    #[cfg(test)]
    pub fn practice_whiteboard(&mut self) {self.practice_events(vec![serde_json::json!({"type":"whiteboard"})],false);self.sync();}
    pub(crate) fn practice_completion(
        &mut self, generation: u64, capture_id: &str, request_id: Option<&str>,
        bundle: Option<&Path>, clipboard: Option<bool>,
    ) {
        if !self.practice_active() || !self.flow.practice_recording
            || capture_id.is_empty() || self.practice_receipt.is_some() { return; }
        self.practice_receipt = Some((generation, capture_id.to_owned(), request_id.map(str::to_owned)));
        match bundle {
            Some(path) => {
                self.practice_bundle=Some(path.to_owned());
                self.observe_practice(false, 0, true, Some(clipboard == Some(true)));
            }
            None => { self.input(Input::CaptureEnded { completed: false }); }
        }
    }
    pub fn practice_opened_bundle(&mut self, path: &Path) { if self.practice_bundle.as_deref()==Some(path) {self.practice_latest();} }
    pub fn practice_settings_opened(&mut self) -> Effect {
        self.practice_intent("practice-settings")
    }
    fn practice_intent(&mut self, action:&str)->Effect {
        self.practice_events(vec![serde_json::json!({"type":"action","action":action})],true)
    }
    pub fn practice_latest(&mut self) {self.practice_events(vec![serde_json::json!({"type":"opened-latest"})],false);self.sync();}

    fn practice_events(&mut self, events:Vec<serde_json::Value>, intent:bool)->Effect {
        if self.fallback_pending {return Effect::None;}
        let board = self.board_id.clone();
        let Some(p)=self.practice.as_mut() else {return Effect::None;};
        if !intent && p.repeats_pending_poll(self.source,self.transport_generation,board.as_deref(),&events) {
            return Effect::None;
        }
        if p.pending.len()>=32 {self.restore_native();return Effect::None;}
        let batch=p.batch(self.source,self.transport_generation,board,events,intent);
        #[cfg(test)]
        if matches!(self.transport,Transport::InProcess(_)) {
            let reply=self.practice.as_ref().unwrap().test_reply();return self.practice_disposition(reply);
        }
        if let Transport::Renderer {input,..}=&self.transport {input.expect(batch["sequence"].as_str().unwrap().to_owned());}
        self.send(&batch);Effect::None
    }
    pub fn practice_disposition(&mut self, value:serde_json::Value)->Effect {
        if self.practice.is_none() || self.fallback_pending {return Effect::None;}
        let active=self.practice_active();
        let Ok(sequence)=self.practice.as_ref().unwrap().acknowledgement(&value) else {self.restore_native();return Effect::None;};
        if let Transport::Renderer {input,..}=&self.transport {
            if !input.ack(&sequence) {self.restore_native();return Effect::None;}
        }
        let Ok((finish,_))=self.practice.as_mut().unwrap().admit(value) else {self.restore_native();return Effect::None;};
        if !active {self.practice.as_mut().unwrap().close_board=None;return Effect::None;}
        if finish && self.practice_completed && self.practice_receipt.is_some() && self.practice_bundle.is_some() {
            self.flow.first_capture_completed=true;self.flow.step=Step::Done;self.sync();
            #[cfg(test)]
            if matches!(self.transport,Transport::InProcess(None)) {return self.input(Input::Continue);}
            if self.saved_first_capture_completed {return self.input(Input::Continue);}
            self.flow.first_capture_completed=false;self.flow.step=Step::TryIt;
        }
        self.sync();Effect::None
    }
    pub fn take_practice_board_close(&mut self)->Option<(u64,u64,u64,String)> {
        let p=self.practice.as_mut()?;Some((self.source,self.transport_generation,p.attempt,p.close_board.take()?))
    }
    pub fn current_practice_scope(&self,source:u64,transport:u64,attempt:u64)->bool {
        self.practice_active() && self.source==source && self.transport_generation==transport && !self.fallback_pending
            && self.practice.as_ref().is_some_and(|p|p.attempt==attempt)
    }

    pub fn admits_practice_capture_action(&self, attempt: u64, stage: super::practice::Stage) -> bool {
        self.current_practice_scope(self.source, self.transport_generation, attempt) &&
            traversal::practice_control(
                self.flow.step(),
                self.flow.practice_recording,
                self.practice.as_ref().is_some_and(|practice| {
                    practice.observed_attempt == Some(attempt) && practice.stage == stage
                }),
            )
    }

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
        if let Some(practice) = self.practice.as_ref() {
            view["practice"] = serde_json::json!(practice.stage);
            if self.flow.practice_recording && practice.observed_attempt == Some(practice.attempt) {
                view["practiceAttempt"] = practice.attempt.to_string().into();
            }
        }
        view["shortcut"]=self.shortcut_label.clone().into();
        view["shortcutSelectionReleased"]=(!self.shortcut_choice_down).into();
        view["platform"]=std::env::consts::OS.into();
        view["wisprFlowEnabled"]=(cfg!(target_os = "macos")
            && handoff::experiment_preference("labs.onboardingWisprFlow")).into();
        view["frogNaming"] = (self.frog_stage() == 2).into();
        view["frogName"] = serde_json::json!(if self.frog_enabled { self.frog_name.as_deref() } else { None });
        view["frogError"] = self.frog_error.into();
        view["shortcutEditor"]=serde_json::json!(self.editor);
        view["anchor"]=serde_json::json!(self.anchor);
        view["practiceBoard"]=serde_json::json!(self.practice_board);
        view["testInstance"]=false.into();
        view["penSaveId"]=serde_json::json!(self.pen_save_id);
        view["penPicker"]=self.pen_picker.into();view["penSelected"]=self.pen_selected.into();view["penError"]=self.pen_error.into();
        view["penRgb"]=serde_json::json!(handoff::pen::rgb());
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
            if self.flow.mode == Mode::Tour { progress.leave(&self.flow); }
            progress.tutorial = tutorial;
            if self.flow.mode == Mode::Tour {
                progress.shortcut_chosen = self.flow.shortcut_chosen;
                progress.shortcut_tested_for = tested_for.clone();
                progress.first_capture_completed = self.flow.first_capture_completed;
                progress.frog_adopted |= self.frog_enabled && self.frog_name.is_some()
                    && self.flow.first_capture_completed;
            }
            if let Err(error) = progress.save_to(&handoff::default_config_path()) {
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

    fn permission_action(&mut self, action: &str, permission: Permission) {
        if self.fallback_pending { return; }
        if self.fallback.is_none() {
            self.send(&serde_json::json!({"type": action, "permission": permission}));
            return;
        }
        #[cfg(target_os = "linux")]
        if permission == Permission::Accessibility {
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
