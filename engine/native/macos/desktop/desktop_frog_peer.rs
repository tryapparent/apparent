#[cfg(target_os = "macos")]
pub(crate) struct DesktopFrogHost {
    child: Option<crate::capture::ui_process::UiChild>,
    input: pipe::Input,
    requests: std::sync::mpsc::Receiver<()>,
    last: Option<(bool, String)>,
}

#[cfg(target_os = "macos")]
impl DesktopFrogHost {
    pub(crate) fn open(name: &str, takeoff: Option<[f64; 3]>) -> anyhow::Result<Self> {
        use std::{
            io::{BufRead, BufReader},
            process::Stdio,
            sync::mpsc,
        };
        let (assets, runtime) = super::presentation::onboarding_assets()
            .map_err(|error| anyhow::anyhow!("{}", error.stage()))?;
        let mut child = super::presentation::onboarding_command(runtime, assets)
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
                if line == b"record\n" {
                    let _ = send.try_send(());
                }
                line.clear();
            }
        });
        let mut host = Self {
            child: Some(child),
            input,
            requests,
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

    pub(crate) fn tick(&mut self, visible: bool, shortcut: &str) -> Option<bool> {
        if !matches!(self.child.as_mut()?.try_wait(), Ok(None)) {
            return None;
        }
        if !self
            .last
            .as_ref()
            .is_some_and(|(was_visible, was_shortcut)| {
                *was_visible == visible && was_shortcut == shortcut
            })
        {
            if !self.send(serde_json::json!({"visible": visible, "shortcut": shortcut})) {
                return None;
            }
            self.last = Some((visible, shortcut.to_owned()));
        }
        let start = self.requests.try_recv().is_ok();
        Some(visible && start)
    }
}

#[cfg(target_os = "macos")]
impl Drop for DesktopFrogHost {
    fn drop(&mut self) {
        if let Some(mut child) = self.child.take() {
            std::thread::spawn(move || {
                let _ = child.kill();
                let _ = child.wait();
            });
        }
    }
}

impl Session {
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

    #[cfg(target_os = "macos")]
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

    #[cfg(target_os = "macos")]
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
