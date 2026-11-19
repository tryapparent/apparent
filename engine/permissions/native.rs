#[cfg(target_os = "macos")]
mod mac {
    use crate::capture::ui_process::UiChild;
    use crate::permission_facts::{Grants, Permission};
    use serde_json::json;
    use std::collections::BTreeSet;
    use std::io::Write;
    use std::process::{ChildStdin, Command, Stdio};

    #[derive(Default)]
    pub(super) struct Guide {
        process: Option<(UiChild, ChildStdin)>,
        open: BTreeSet<Permission>,
    }

    impl Guide {
        pub(super) fn send(&mut self, effect: &str, permission: Permission) -> anyhow::Result<()> {
            if !self
                .process
                .as_mut()
                .is_some_and(|(child, _)| matches!(child.try_wait(), Ok(None)))
            {
                let mut child = Command::new(crate::capture::desktop::helper::path()?)
                    .args(["onboarding", "--permissions-only"])
                    .stdin(Stdio::piped())
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .spawn()?;
                let input = child
                    .stdin
                    .take()
                    .ok_or_else(|| anyhow::anyhow!("No permission helper input"))?;
                self.process = Some((UiChild::new(child), input));
                self.open.clear();
            }
            let (_, input) = self.process.as_mut().unwrap();
            writeln!(
                input,
                "{}",
                json!({"type": effect, "permission": permission})
            )?;
            input.flush()?;
            if effect == "open-settings"
                && matches!(
                    permission,
                    Permission::ScreenRecording | Permission::Accessibility
                )
            {
                self.open.insert(permission);
            }
            Ok(())
        }

        pub(super) fn observe(&mut self, grants: &Grants) {
            if let Some((_, input)) = self.process.as_mut() {
                self.open.retain(|&permission| {
                    if !grants.granted(permission) {
                        return true;
                    }
                    let _ = writeln!(
                        input,
                        "{}",
                        json!({"type": "close-guide", "permission": permission})
                    );
                    false
                });
            }
        }
    }

    impl Drop for Guide {
        fn drop(&mut self) {
            if let Some((mut child, input)) = self.process.take() {
                drop(input);
                std::thread::spawn(move || {
                    for _ in 0..20 {
                        if !matches!(child.try_wait(), Ok(None)) {
                            return;
                        }
                        std::thread::sleep(std::time::Duration::from_millis(50));
                    }
                    let _ = child.kill();
                    let _ = child.wait();
                });
            }
        }
    }
}

use crate::permission_admission::{Platform, Repair};
use crate::permission_facts::{Grants, Permission};

#[derive(Default)]
pub(crate) struct Effects {
    #[cfg(target_os = "macos")]
    guide: mac::Guide,
}

impl Effects {
    pub(crate) fn observe(&mut self, _grants: &Grants) {
        #[cfg(target_os = "macos")]
        self.guide.observe(_grants);
    }

    pub(crate) fn perform(&mut self, permission: Permission, repair: Repair) -> anyhow::Result<()> {
        #[cfg(target_os = "macos")]
        match repair {
            Repair::Request if permission == Permission::ScreenRecording => {
                crate::capture::engine::runtime::request_screen_capture();
                return Ok(());
            }
            Repair::Request => return self.guide.send("request", permission),
            Repair::OpenSettings => return self.guide.send("open-settings", permission),
            _ => {}
        }
        #[cfg(target_os = "linux")]
        if repair == Repair::CopyInput && permission == Permission::Accessibility {
            return crate::capture::desktop::linux::privacy::try_copy_input_command();
        }
        anyhow::bail!("Unsupported permission repair")
    }
}

pub(crate) fn platform() -> Platform {
    #[cfg(target_os = "linux")]
    let wayland = crate::capture::desktop::linux::wayland_session();
    #[cfg(not(target_os = "linux"))]
    let wayland = false;
    if cfg!(target_os = "macos") {
        Platform::Macos
    } else if wayland {
        Platform::Wayland
    } else {
        Platform::X11
    }
}

pub(crate) fn restart(busy: bool) -> Option<&'static str> {
    if busy {
        return Some("capture-active");
    }
    #[cfg(windows)]
    {
        crate::capture::desktop::settings::onboarding::relaunch();
        None
    }
    #[cfg(not(windows))]
    crate::permission_relaunch::launch().err().map(|error| {
        crate::capture::engine::runtime::apparent_log(format!(
            "Could not reopen Apparent: {error:#}"
        ));
        "failed"
    })
}
