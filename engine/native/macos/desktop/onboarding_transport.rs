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
