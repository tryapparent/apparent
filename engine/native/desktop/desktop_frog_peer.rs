pub(crate) struct DesktopFrogHost {
    child: Option<crate::capture::ui_process::UiChild>,
    input: pipe::Input,
    requests: std::sync::mpsc::Receiver<u32>,
    revision: u32,
    last: Option<(bool, String, Vec<&'static str>)>,
}

impl DesktopFrogHost {
    pub(crate) fn open(name: &str, takeoff: Option<[f64; 3]>) -> anyhow::Result<Self> {
        use std::{
            io::{BufRead, BufReader},
            process::Stdio,
            sync::mpsc,
        };
        let (assets, runtime) = super::presentation::onboarding_assets()
            .map_err(|error| anyhow::anyhow!("{}", error.stage()))?;
        let mut command = super::presentation::onboarding_command(runtime.clone(), assets);
        #[cfg(target_os = "linux")]
        {
            command.arg("--ozone-platform=x11");
            crate::capture::desktop::workflow::electron::configure_sandbox(&mut command, &runtime)?;
        }
        let mut child = command
            .arg("--desktop-frog")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| anyhow::anyhow!("missing frog input"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| anyhow::anyhow!("missing frog output"))?;
        let mut child = crate::capture::ui_process::UiChild::new(child);
        let input = match pipe::Input::new(stdin, || {}) {
            Ok(input) => input,
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(error.into());
            }
        };
        let (send, requests) = mpsc::sync_channel(1);
        std::thread::spawn(move || {
            let mut stdout = BufReader::new(stdout);
            let mut line = Vec::new();
            while matches!(read_protocol_line(&mut stdout, &mut line), Ok(1..=65_536)) {
                if let Some(revision) = std::str::from_utf8(&line).ok()
                    .and_then(|line| line.strip_prefix("record "))
                    .and_then(|revision| revision.strip_suffix('\n'))
                    .and_then(|revision| revision.parse().ok())
                {
                    let _ = send.try_send(revision);
                }
                line.clear();
            }
        });
        let mut host = Self {
            child: Some(child),
            input,
            requests,
            revision: 0,
            last: None,
        };
        anyhow::ensure!(
            host.send(serde_json::json!({"name": name, "takeoff": takeoff})),
            "frog input closed"
        );
        Ok(host)
    }

    fn send(&mut self, state: serde_json::Value) -> bool {
        self.input.send(format!("{state}\n").into_bytes())
    }

    pub(crate) fn tick(&mut self, visible: bool, shortcut: &str, equipped: &[&'static str]) -> Option<bool> {
        if !matches!(self.child.as_mut()?.try_wait(), Ok(None)) {
            return None;
        }
        self.project(visible, shortcut, equipped)?;
        let Ok(revision) = self.requests.try_recv() else { return Some(false); };
        let start = crate::capture::desktop::settings::onboarding::frog_policy::VISIBLE[
            usize::from(visible) * 2 + usize::from(revision != self.revision)
        ];
        if !start && !self.settle_record_request() { return None; }
        Some(start)
    }

    pub(crate) fn project(&mut self, visible: bool, shortcut: &str, equipped: &[&'static str]) -> Option<()> {
        if !self
            .last
            .as_ref()
            .is_some_and(|(was_visible, was_shortcut, was_equipped)| {
                *was_visible == visible && was_shortcut == shortcut && was_equipped == equipped
            })
        {
            if self.last.as_ref().is_none_or(|(was_visible, ..)| *was_visible != visible) {
                self.revision = self.revision.wrapping_add(1);
            }
            if !self.send(serde_json::json!({"visible": visible, "revision": self.revision, "shortcut": shortcut, "equipped": equipped})) {
                return None;
            }
            self.last = Some((visible, shortcut.to_owned(), equipped.to_vec()));
        }
        Some(())
    }

    pub(crate) fn settle_record_request(&mut self) -> bool {
        self.send(serde_json::json!({"type": "record-settled"}))
    }
}

impl Drop for DesktopFrogHost {
    fn drop(&mut self) {
        if let Some(mut child) = self.child.take() {
            std::thread::spawn(move || {
                for _ in 0..20 {
                    if !matches!(child.try_wait(), Ok(None)) { return; }
                    std::thread::sleep(std::time::Duration::from_millis(50));
                }
                let _ = child.kill();
                let _ = child.wait();
            });
        }
    }
}

impl Session {
    fn frog_enabled(shell: bool) -> bool {
        shell && crate::capture::desktop::workflow::electron::desktop_frog::supported()
            && crate::shared::handoff::experiment_preference("labs.desktopFrog")
    }

    fn frog_stage(&self) -> u8 {
        let active = self.frog_enabled
            && self.flow.first_capture_required
            && self.flow.step == Step::TryIt
            && !self.fallback_pending
            && self
                .practice
                .as_ref()
                .is_some_and(|p| p.stage == super::practice::Stage::Start);
        frog_policy::NAMING[usize::from(active) * 4
            + usize::from(self.frog_name.is_some()) * 2
            + usize::from(self.frog_revealed)]
    }

        pub(crate) fn name_frog(&mut self, name: String) -> bool {
        if self.frog_stage() != 2 {
            return false;
        }
        let mut progress = Progress::load();
        progress.frog_name = Some(name.clone());
        self.frog_error = progress
            .save_to(&crate::shared::handoff::default_config_path())
            .is_err();
        if !self.frog_error {
            self.frog_name = Some(name);
            self.flow.on(Input::ShortcutTriggered);
        }
        self.sync();
        !self.frog_error
    }

    pub(crate) fn finish_frog(&mut self, takeoff: [f64; 3]) -> Effect {
        if self.frog_enabled
            && self.frog_name.is_some()
            && self
                .practice
                .as_ref()
                .is_some_and(|p| p.stage == super::practice::Stage::Complete)
        {
            self.frog_takeoff = Some(takeoff);
            return self.action("practice-finish");
        }
        Effect::None
    }

        pub(crate) fn take_frog_takeoff(&mut self) -> Option<[f64; 3]> {
        self.frog_takeoff.take()
    }
}

#[cfg(test)]
#[test]
fn desktop_frog_name_intercepts_only_the_guided_shortcut() {
    let mut session = Session::for_test(
        Flow::tour(Step::TryIt, None).with_first_capture(true, true, true, false),
    );
    session.practice = Some(super::practice::Practice::default());
    session.frog_enabled = true;
    assert_eq!(session.shortcut_policy(), ShortcutPolicy::Trial);
    session.input(Input::ShortcutTriggered);
    assert_eq!(session.shortcut_policy(), ShortcutPolicy::Block);
    assert!(!session.flow.local_practice());
    session.frog_name = Some("Evie".into());
    assert_eq!(session.shortcut_policy(), ShortcutPolicy::Record);
    session.input(Input::ShortcutTriggered);
    assert!(session.flow.local_practice());
    assert_eq!(session.finish_frog([0.0, 0.0, 79.0]), Effect::None);
    assert!(session.frog_takeoff.is_none());
}
