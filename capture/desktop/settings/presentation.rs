//! Installed Electron presentations. Policy and settings persistence stay in Rust.
use std::{path::PathBuf, process::{Command, Stdio}, sync::Arc};
use super::settings::{Action, Event, Transport};

/// Unique across Settings sessions too: late events from a closed session must
/// never match the first window of a newly opened session.
pub(super) fn generation() -> u64 {
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(1);
    NEXT.fetch_add(1, Ordering::Relaxed)
}

pub(in crate::capture::desktop) fn assets() -> Option<(PathBuf, PathBuf)> {
    let executable = std::env::current_exe().ok()?;
    let parent = executable.parent()?;
    #[cfg(target_os = "macos")]
    let root = parent.parent()?.join("Resources/settings");
    #[cfg(not(target_os = "macos"))]
    let root = parent.parent()?.join("share/apparent/settings");
    let development = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("capture/desktop/ui/frontend");
    let mut candidates = vec![(root.join("app"), root.join("runtime"))];
    if executable.starts_with(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target")) {
        candidates.push((development.clone(), development.join("node_modules/electron/dist")));
    }
    for (app, runtime) in candidates {
        #[cfg(target_os = "macos")]
        let runtime = runtime.join("Electron.app/Contents/MacOS/Electron");
        #[cfg(not(target_os = "macos"))]
        let runtime = runtime.join("electron");
        if runtime.is_file() && app.join("dist/settings.html").is_file() && app.join("electron/main.cjs").is_file() {
            return Some((app, runtime));
        }
    }
    None
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum OnboardingAssetFailure {
    Executable,
    AppDirectory,
    Runtime,
    Html,
    Entry,
}

impl OnboardingAssetFailure {
    pub(super) fn stage(self) -> &'static str {
        match self {
            Self::Executable => "executable_lookup_failed",
            Self::AppDirectory => "app_directory_missing",
            Self::Runtime => "runtime_missing",
            Self::Html => "onboarding_html_missing",
            Self::Entry => "onboarding_entry_missing",
        }
    }
}

fn check_onboarding_assets(
    app: &std::path::Path,
    runtime: &std::path::Path,
) -> Result<(), OnboardingAssetFailure> {
    if !app.is_dir() {
        return Err(OnboardingAssetFailure::AppDirectory);
    }
    if !runtime.is_file() {
        return Err(OnboardingAssetFailure::Runtime);
    }
    if !app.join("dist/onboarding.html").is_file() {
        return Err(OnboardingAssetFailure::Html);
    }
    if !app.join("electron/onboarding.cjs").is_file() {
        return Err(OnboardingAssetFailure::Entry);
    }
    Ok(())
}

pub(super) fn onboarding_assets() -> Result<(PathBuf, PathBuf), OnboardingAssetFailure> {
    let executable = std::env::current_exe().map_err(|_| OnboardingAssetFailure::Executable)?;
    let parent = executable.parent().ok_or(OnboardingAssetFailure::Executable)?;
    #[cfg(target_os = "macos")]
    let root = parent
        .parent()
        .ok_or(OnboardingAssetFailure::Executable)?
        .join("Resources/settings");
    #[cfg(not(target_os = "macos"))]
    let root = parent
        .parent()
        .ok_or(OnboardingAssetFailure::Executable)?
        .join("share/apparent/settings");
    let development = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("capture/desktop/ui/frontend");
    let mut candidates = vec![(root.join("app"), root.join("runtime"))];
    if executable.starts_with(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target")) {
        candidates.push((development.clone(), development.join("node_modules/electron/dist")));
    }
    let mut failure = OnboardingAssetFailure::AppDirectory;
    for (app, runtime) in candidates {
        #[cfg(target_os = "macos")]
        let runtime = runtime.join("Electron.app/Contents/MacOS/Electron");
        #[cfg(not(target_os = "macos"))]
        let runtime = runtime.join("electron");
        match check_onboarding_assets(&app, &runtime) {
            Ok(()) => return Ok((app, runtime)),
            Err(stage) => failure = stage,
        }
    }
    Err(failure)
}

pub(super) fn open(about: bool, events: Arc<dyn Fn(Event) + Send + Sync>) -> anyhow::Result<Transport> {
    use std::io::BufRead;
    let (app, runtime) = assets().ok_or_else(|| anyhow::anyhow!("Packaged Storage Settings unavailable"))?;
    let mut launch = command(runtime, app);
    if about { launch.arg("--settings-about"); }
    let mut child = launch
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn()?;
    let stdin = child.stdin.take();
    let stdout = child.stdout.take();
    let child = crate::capture::ui_process::UiChild::new(child);
    std::thread::spawn(move || {
        if let Some(stdout) = stdout {
            for line in std::io::BufReader::new(stdout).lines().map_while(Result::ok) {
                // This presentation may navigate or reveal the effective folder;
                // it cannot invoke other native Settings actions through this pipe.
                if let Ok(action) = serde_json::from_str::<Action>(&line)
                    && (matches!(action, Action::Navigate { .. } | Action::ShowCaptures | Action::Close)
                        || about && (matches!(action, Action::CheckForUpdates | Action::DismissUpdateCheck | Action::UpdateNow | Action::UpdateLater | Action::Tour)
                            || matches!(&action, Action::Set { key, value } if key == "updateChannel" && matches!(value.as_str(), Some("stable" | "main")))))
                {
                    events(Event::Action(action));
                }
            }
        }
        events(Event::Exited);
    });
    Ok(Transport::Helper { child, stdin })
}

/// Electron selects its display backend before loading the application entry.
/// GPUI hides WAYLAND_DISPLAY on Linux; every Electron surface must follow that
/// XWayland choice, while preserving an explicitly retained Wayland display.
fn renderer_command(runtime: PathBuf, app: PathBuf) -> Command {
    let mut command = Command::new(runtime);
    crate::capture::desktop::workflow::error_reporting::configure_child(&mut command);
    if cfg!(target_os = "linux") && std::env::var_os("WAYLAND_DISPLAY").is_none() {
        command.arg("--ozone-platform=x11");
    }
    command.arg(app);
    command
}

fn command(runtime: PathBuf, app: PathBuf) -> Command {
    let mut command = renderer_command(runtime, app);
    command.arg("--settings-storage").arg("--settings-parent");
    command
}

pub(super) fn onboarding_command(runtime: PathBuf, app: PathBuf) -> Command {
    let mut command = renderer_command(runtime, app);
    command.arg("--onboarding");
    command
}

#[cfg(all(test, any(target_os = "linux", target_os = "macos")))]
mod tests {
    use super::*;

    #[test]
    fn renderer_children_follow_the_parent_display_backend() {
        // Child processes exercise the real environment policy without changing
        // this multi-threaded test process's environment.
        for display in [None, Some("wayland-test")] {
            let mut child = Command::new(std::env::current_exe().unwrap());
            child.args(["--exact", "capture::desktop::settings::presentation::tests::renderer_child_arguments", "--nocapture"])
                .env("APPARENT_TEST_RENDERER_ARGS", "1")
                .env("XDG_SESSION_TYPE", "wayland")
                .env_remove("WAYLAND_DISPLAY");
            if let Some(display) = display { child.env("WAYLAND_DISPLAY", display); }
            let output = child.output().unwrap();
            assert!(output.status.success(), "{}\n{}", String::from_utf8_lossy(&output.stdout), String::from_utf8_lossy(&output.stderr));
            assert!(String::from_utf8_lossy(&output.stdout).contains("1 passed"));
        }
    }

    #[test]
    fn renderer_child_arguments() {
        if std::env::var_os("APPARENT_TEST_RENDERER_ARGS").is_none() { return; }
        for (child, mode) in [
            (command("/runtime/electron".into(), "/settings/app".into()), vec!["--settings-storage", "--settings-parent"]),
            (onboarding_command("/runtime/electron".into(), "/settings/app".into()), vec!["--onboarding"]),
        ] {
            assert_eq!(child.get_program(), "/runtime/electron");
            if cfg!(debug_assertions) {
                assert!(child.get_envs().any(|(key, value)| key == "APPARENT_DESKTOP_REPORTING" && value == Some(std::ffi::OsStr::new("0"))),
                    "development Settings and onboarding must disable inherited reporting admission");
            }
            let args: Vec<_> = child.get_args().map(|arg| arg.to_str().unwrap()).collect();
            let mut expected = vec![];
            if cfg!(target_os = "linux") && std::env::var_os("WAYLAND_DISPLAY").is_none() {
                expected.push("--ozone-platform=x11");
            }
            expected.push("/settings/app");
            expected.extend(mode);
            assert_eq!(args, expected);
        }
    }

    #[test]
    fn onboarding_appimage_layout_reports_the_missing_asset_stage() {
        let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let root = std::env::temp_dir().join(format!(
            "apparent-onboarding-assets-{}-{nonce}",
            std::process::id()
        ));
        std::fs::create_dir(&root).unwrap();
        let app = root.join("app");
        let runtime = root.join("runtime/electron");
        assert_eq!(
            check_onboarding_assets(&app, &runtime),
            Err(OnboardingAssetFailure::AppDirectory)
        );
        assert_eq!(OnboardingAssetFailure::AppDirectory.stage(), "app_directory_missing");
        std::fs::create_dir_all(&app).unwrap();
        assert_eq!(
            check_onboarding_assets(&app, &runtime),
            Err(OnboardingAssetFailure::Runtime)
        );
        assert_eq!(OnboardingAssetFailure::Runtime.stage(), "runtime_missing");
        std::fs::create_dir_all(runtime.parent().unwrap()).unwrap();
        std::fs::write(&runtime, "synthetic runtime").unwrap();
        assert_eq!(
            check_onboarding_assets(&app, &runtime),
            Err(OnboardingAssetFailure::Html)
        );
        assert_eq!(OnboardingAssetFailure::Html.stage(), "onboarding_html_missing");
        std::fs::create_dir_all(app.join("dist")).unwrap();
        std::fs::write(app.join("dist/onboarding.html"), "synthetic html").unwrap();
        assert_eq!(
            check_onboarding_assets(&app, &runtime),
            Err(OnboardingAssetFailure::Entry)
        );
        assert_eq!(OnboardingAssetFailure::Entry.stage(), "onboarding_entry_missing");
        std::fs::create_dir_all(app.join("electron")).unwrap();
        std::fs::write(app.join("electron/onboarding.cjs"), "synthetic entry").unwrap();
        assert_eq!(check_onboarding_assets(&app, &runtime), Ok(()));
        std::fs::remove_dir_all(root).unwrap();
    }
}

pub(super) fn retire(transport: Transport) {
    match transport {
        Transport::InProcess(sender) => drop(sender),
        Transport::Helper { mut child, stdin } => {
            drop(stdin);
            // Reap without blocking capture or the UI thread. A closing child
            // cannot hold Settings navigation or application shutdown hostage.
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
