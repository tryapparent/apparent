impl ApparentCoordinator {
    fn accept_frog_name(&mut self, _name: String, _cx: &mut Context<Self>) -> crate::capture::desktop::settings::onboarding::Effect {
        #[cfg(target_os = "macos")]
        if !self.capture_busy() && self.onboarding.as_mut().is_some_and(|session| session.name_frog(_name)) {
            self.begin_target_selection(_cx);
        }
        crate::capture::desktop::settings::onboarding::Effect::None
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
        } else if self.source_is_stopping() {
            Activity::Processing
        } else if self.is_selecting() {
            Activity::Picker
        } else {
            Activity::Free
        }
    }

    fn onboarding_shortcut_policy(&self) -> crate::capture::desktop::settings::onboarding::ShortcutPolicy {
        use crate::capture::desktop::settings::onboarding::ShortcutPolicy;
        if self.lab { return ShortcutPolicy::Record; }
        self.onboarding.as_ref().map_or(ShortcutPolicy::Record, |s| s.shortcut_policy())
    }

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

    pub fn press_shortcut(&mut self, cx: &mut Context<Self>) {
        #[cfg(target_os="linux")]
        if let Some(session)=self.onboarding.as_mut().filter(|session|session.editing_shortcut()) {
            session.desktop_shortcut_pressed();
            return;
        }
        let activity = self.activity();
        if self.gate.is_pending() || self.push_to_talk_pending() {
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
            let picker = display_selection::requested();
            if !self.ready_to_record(picker) { return; }
            #[cfg(target_os = "linux")]
            if self.arm_push_to_talk() { return; }
            if !picker { self.begin_playback(); }
            self.hold_mods = crate::capture::engine::runtime::modifier_flags();
            self.telemetry.take_escape();
        }
        let action = self.shortcut.press(activity);
        self.apply_shortcut(action, cx);
    }

    fn push_to_talk_pending(&self) -> bool {
        #[cfg(target_os = "linux")]
        { self.shortcut.hold.is_some() }
        #[cfg(not(target_os = "linux"))]
        { false }
    }

    #[cfg(target_os = "linux")]
    fn arm_push_to_talk(&mut self) -> bool {
        use crate::capture::desktop::settings::shortcut::{Hold, PUSH_TO_TALK, push_to_talk_supported};
        if self.lab || self.report_capture || display_selection::pending()
            || self.onboarding.as_ref().is_some_and(|session| session.local_practice())
            || !crate::shared::handoff::experiment(PUSH_TO_TALK) || !push_to_talk_supported()
        {
            return false;
        }
        self.shortcut.hold = Hold::begin(&self.telemetry);
        if self.shortcut.hold.is_some() {
            self.telemetry.take_escape();
        }
        self.shortcut.hold.is_some()
    }

    #[cfg(target_os = "linux")]
    fn tick_push_to_talk(&mut self, cx: &mut Context<Self>) {
        use crate::capture::desktop::settings::shortcut::{Action, Activity, HoldAction};
        let Some(mut hold) = self.shortcut.hold.take() else { return; };
        if let Some(generation) = hold.generation {
            if self.capture_generation != generation || self.active_recording.is_none() { return; }
        } else if self.activity() != Activity::Free || display_selection::pending() {
            return;
        }
        let held = hold.key.held();
        let input_available = held.is_some()
            && !self.telemetry.shortcuts_paused.load(std::sync::atomic::Ordering::Acquire);
        let cancelled = self.telemetry.take_escape() || !input_available;
        match hold.action(input_available && held == Some(true), cancelled) {
            HoldAction::Wait => self.shortcut.hold = Some(hold),
            HoldAction::Tap => {
                if !display_selection::requested() { self.begin_playback(); }
                self.apply_shortcut(Action::RecordScreen, cx);
            }
            HoldAction::Start => {
                hold.target = linux::hyprland::focused_window().ok();
                self.start_recording_with_target(|_| discover_start_target(), cx);
                if self.active_recording.is_some() {
                    hold.generation = Some(self.capture_generation);
                    self.shortcut.hold = Some(hold);
                }
            }
            HoldAction::Finish => {
                self.shortcut.hold = Some(hold);
                self.finish_recording_with_release(input_available, cx);
            }
            HoldAction::Cancel => {}
        }
    }

    pub fn tick_shortcut(&mut self, cx: &mut Context<Self>) {
        #[cfg(target_os = "linux")]
        if self.shortcut.hold.is_some() {
            self.tick_push_to_talk(cx);
            return;
        }
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
}
