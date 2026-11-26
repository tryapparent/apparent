impl Session {
    pub(crate) fn shortcut_policy(&self) -> ShortcutPolicy {
        match self.frog_stage() {
            1 => return ShortcutPolicy::Trial,
            2 => return ShortcutPolicy::Block,
            _ => (),
        }
        let policy = if self.electron_shortcut_step() {
            if self.flow.shortcut_editing { ShortcutPolicy::Block } else { ShortcutPolicy::Trial }
        } else { self.flow.shortcut_policy() };
        if self.shortcut_choice_down && policy == ShortcutPolicy::Trial { ShortcutPolicy::Block } else { policy }
    }

    fn confirm_shortcut(&mut self) -> Effect {
        if !self.electron_shortcut_step() || !self.flow.shortcut_tested
            || self.shortcut_policy() != ShortcutPolicy::Trial
        {
            return Effect::None;
        }
        if self.frog_enabled && self.flow.first_capture_required {
            let effect = self.flow.on(Input::Continue);
            if self.frog_stage() == 1 {
                return self.input(Input::ShortcutTriggered);
            }
            self.sync();
            return effect;
        }
        self.flow.step = Step::Done;
        self.input(Input::Continue)
    }

    fn electron_shortcut_step(&self) -> bool {
        self.fallback.is_some() && !self.fallback_pending && self.choosing_shortcut()
    }

    #[cfg(target_os = "macos")]
    pub(crate) fn shortcut_editor_pid(&self) -> Option<i32> {
        match &self.transport {
            Transport::Renderer { child, .. } if self.editing_shortcut() && !self.flow.hidden => {
                Some(child.pid())
            }
            _ => None,
        }
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
        let dev_icon = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/capture/desktop/assets/app-icon.png"
        );
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
        command
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null());
        let mut child = command.spawn()?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| anyhow::anyhow!("missing onboarding input"))?;
        let lost = events.clone();
        let input = match pipe::Input::new(stdin, move || lost(Event::Exited)) {
            Ok(input) => input,
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(error.into());
            }
        };
        if let Some(stdout) = child.stdout.take() {
            pipe::read_actions(stdout, events);
        }
        Ok(Transport::Renderer {
            child: crate::capture::ui_process::UiChild::new(child),
            input,
        })
    }

    fn spawn_transport(
        command: &mut std::process::Command,
        events: impl Fn(Event) + Send + Sync + Clone + 'static,
    ) -> anyhow::Result<Transport> {
        command
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null());
        let mut child = command.spawn()?;
        let stdin = child.stdin.take();
        if let Some(stdout) = child.stdout.take() {
            pipe::read_actions(stdout, events);
        }
        Ok(Transport::Helper {
            child: crate::capture::ui_process::UiChild::new(child),
            stdin,
        })
    }
}

#[test]
fn electron_shortcut_needs_a_native_trial_and_explicit_confirmation() {
    for required in [false, true] {
        let mut session=Session::for_test(Flow::tour(Step::Shortcut,None).with_first_capture(required,false,false,false));
        session.shortcut_label="Fn".into();
        session.fallback=Some(Box::new(|_|Ok(Transport::InProcess(None))));
        session.action("use-shortcut");
        assert_eq!(session.flow.step(),Step::Shortcut);
        session.input(Input::ShortcutChosen);
        session.input(Input::ShortcutTriggered);
        assert!(!session.flow.shortcut_tested);
        session.shortcut_selection_released(true);
        session.input(Input::ShortcutTriggered);
        assert!(session.flow.shortcut_tested);
        session.shortcut_changed("Copilot");
        assert!(!session.flow.shortcut_tested);
        session.shortcut_selection_released(true);
        session.input(Input::ShortcutTriggered);
        assert_eq!(session.action("use-shortcut"),Effect::Close);
        assert_eq!(session.flow.step(),Step::Done);
        assert!(!session.local_practice());
    }
}


#[test]
fn confirming_shortcut_reveals_opted_in_frog_without_arming_capture() {
    let mut session=Session::for_test(Flow::tour(Step::Shortcut,None).with_first_capture(true,true,true,false));
    session.fallback=Some(Box::new(|_|Ok(Transport::InProcess(None))));
    session.practice=Some(super::practice::Practice::default());
    session.frog_enabled=true;
    assert_eq!(session.action("use-shortcut"),Effect::None);
    assert_eq!(session.frog_stage(),2);
    assert!(!session.local_practice());
}
