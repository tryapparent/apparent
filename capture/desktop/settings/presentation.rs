use std::{io::BufRead, path::PathBuf, process::{Command, Stdio}, sync::Arc};
use super::settings::{Action, Event, Transport, Pane};

#[cfg(test)]
pub(super) fn build_test_renderer() {
    static BUILT: std::sync::OnceLock<()> = std::sync::OnceLock::new();
    BUILT.get_or_init(|| {
        let frontend = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("capture/desktop/ui/frontend");
        assert!(Command::new("node").arg("--experimental-strip-types").arg(frontend.join("../../../../composition/onboarding/prepare.ts"))
            .current_dir(&frontend).status().unwrap().success());
        assert!(Command::new("node").arg(frontend.join("node_modules/vite/bin/vite.js"))
            .arg("build").current_dir(&frontend).status().unwrap().success());
    });
}

pub(super) fn generation() -> u64 {
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(1);
    NEXT.fetch_add(1, Ordering::Relaxed)
}

pub(in crate::capture::desktop) fn assets() -> Option<(PathBuf, PathBuf)> {
    settings_assets().ok()
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum OnboardingAssetFailure {
    Executable,
    AppDirectory,
    Runtime,
    SettingsHtml,
    SettingsEntry,
    Html,
    Entry,
}

impl OnboardingAssetFailure {
    pub(super) fn stage(self) -> &'static str {
        match self {
            Self::Executable => "executable_lookup_failed",
            Self::AppDirectory => "app_directory_missing",
            Self::Runtime => "runtime_missing",
            Self::SettingsHtml => "settings_html_missing",
            Self::SettingsEntry => "settings_entry_missing",
            Self::Html => "onboarding_html_missing",
            Self::Entry => "onboarding_entry_missing",
        }
    }
}

fn check_settings_assets(
    app: &std::path::Path,
    runtime: &std::path::Path,
) -> Result<(), OnboardingAssetFailure> {
    if !app.is_dir() {
        return Err(OnboardingAssetFailure::AppDirectory);
    }
    if !runtime.is_file() {
        return Err(OnboardingAssetFailure::Runtime);
    }
    if !app.join("dist/settings.html").is_file() {
        return Err(OnboardingAssetFailure::SettingsHtml);
    }
    if !app.join("electron/main.cjs").is_file() {
        return Err(OnboardingAssetFailure::SettingsEntry);
    }
    Ok(())
}

fn check_onboarding_assets(
    app: &std::path::Path,
    runtime: &std::path::Path,
) -> Result<(), OnboardingAssetFailure> {
    check_settings_assets(app, runtime)?;
    if !app.join("dist/onboarding.html").is_file() {
        return Err(OnboardingAssetFailure::Html);
    }
    if !app.join("dist/composition/onboarding/entry.cjs").is_file() {
        return Err(OnboardingAssetFailure::Entry);
    }
    Ok(())
}

pub(super) fn onboarding_assets() -> Result<(PathBuf, PathBuf), OnboardingAssetFailure> {
    let (app, runtime) = settings_assets()?;
    check_onboarding_assets(&app, &runtime)?;
    Ok((app, runtime))
}

fn settings_assets() -> Result<(PathBuf, PathBuf), OnboardingAssetFailure> {
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
        match check_settings_assets(&app, &runtime) {
            Ok(()) => return Ok((app, runtime)),
            Err(stage) => failure = stage,
        }
    }
    Err(failure)
}

pub(super) fn admits(pane: Pane, action: &Action) -> bool {
    matches!(action, Action::Navigate { .. } | Action::Close)
        || pane == Pane::Recording && (
            matches!(action, Action::RecordingMeter { .. })
            || matches!(action, Action::RecordingPreference { key, value, .. } if super::recording_key(key, value)))
        || pane == Pane::Permissions && matches!(action, Action::PermissionAction { request, .. } if *request > 0)
        || pane == Pane::General && (
            matches!(action, Action::RecordShortcut { .. } | Action::Shortcut { .. } | Action::CancelShortcut | Action::ResetShortcut { .. } | Action::ClearShortcut { .. })
            || matches!(action, Action::Set { key, value }
                if matches!(key.as_str(), "launchAtLogin" | "errorReporting") && value.is_boolean()))
        || pane == Pane::Agents && (matches!(action, Action::AgentsConnection { .. }) || matches!(action, Action::AgentsPreference { setting, .. } if matches!(setting.as_deref(), None | Some("t3"))))
        || pane == Pane::Labs && matches!(action, Action::LabsPreference { setting, .. } if super::labs::key(setting.as_deref()).is_some())
        || pane == Pane::About && (matches!(action, Action::CheckForUpdates | Action::DismissUpdateCheck | Action::UpdateNow | Action::UpdateLater | Action::Tour)
            || matches!(action, Action::Set { key, value } if key == "updateChannel" && matches!(value.as_str(), Some("stable" | "main"))))
}

pub(super) fn open(pane: Pane, events: Arc<dyn Fn(Event) + Send + Sync>) -> anyhow::Result<Transport> {
    let (app, runtime) = assets().ok_or_else(|| anyhow::anyhow!("Packaged Settings unavailable"))?;
    let mut launch = command(runtime.clone(), app);
    crate::capture::desktop::workflow::electron::configure_sandbox(&mut launch, &runtime)?;
    if let serde_json::Value::String(pane) = serde_json::to_value(pane)? {
        launch.arg(format!("--settings-{pane}"));
    }
    let mut child = launch
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn()?;
    let stdin = child.stdin.take();
    let stdout = child.stdout.take();
    let child = crate::capture::ui_process::UiChild::settings(child);
    std::thread::spawn(move || {
        if let Some(stdout) = stdout {
            for line in std::io::BufReader::new(stdout).lines().map_while(Result::ok) {
                if let Ok(action) = serde_json::from_str::<Action>(&line)
                    && [Pane::General, Pane::Recording, Pane::Permissions, Pane::Storage, Pane::Agents, Pane::Labs, Pane::About]
                        .into_iter().any(|pane| admits(pane, &action))
                {
                    events(Event::Action(action));
                }
            }
        }
        events(Event::Exited);
    });
    Ok(Transport { child, stdin })
}

fn renderer_command(runtime: PathBuf, app: PathBuf) -> Command {
    let mut command = Command::new(runtime);
    crate::shared::handoff::configure_nightly_child(&mut command);
    crate::capture::desktop::workflow::error_reporting::configure_child(&mut command);
    if cfg!(target_os = "linux") && std::env::var_os("WAYLAND_DISPLAY").is_none() {
        command.arg("--ozone-platform=x11");
    }
    command.arg(app);
    command
}

fn command(runtime: PathBuf, app: PathBuf) -> Command {
    let mut command = renderer_command(runtime, app);
    command.env("APPARENT_CONFIG", crate::shared::handoff::default_config_path());
    command.env_remove("APPARENT_MANUAL_REPORT_TOKEN");
    if !cfg!(debug_assertions) && let Some(token) = option_env!("APPARENT_POSTHOG_TOKEN") {
        command.env("APPARENT_MANUAL_REPORT_TOKEN", token);
    }
    command.env("APPARENT_MANUAL_REPORT_BUILD", env!("APPARENT_VERSION_LABEL"));
    command.env("APPARENT_MANUAL_REPORT_ENVIRONMENT", env!("APPARENT_REPORTING_ENVIRONMENT"));
    if let Ok(executable) = std::env::current_exe() {
        command.env("APPARENT_REPORT_EXECUTABLE", executable);
    }
    command.args(["--settings-storage", "--settings-parent"]);
    command
}

pub(super) fn onboarding_command(runtime: PathBuf, app: PathBuf) -> Command {
    let mut command = renderer_command(runtime, app.join("dist/composition/onboarding/entry.cjs"));
    command.arg("--assets-root").arg(app);
    command
}

#[cfg(all(test, any(target_os = "linux", target_os = "macos")))]
mod tests {
    use super::*;

    #[test]
    fn renderer_children_follow_the_parent_display_backend() {
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
            (onboarding_command("/runtime/electron".into(), "/settings/app".into()), vec!["--assets-root", "/settings/app"]),
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
            expected.push(if mode.first() == Some(&"--assets-root") { "/settings/app/dist/composition/onboarding/entry.cjs" } else { "/settings/app" });
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
        assert_eq!(check_onboarding_assets(&app, &runtime), Err(OnboardingAssetFailure::SettingsHtml));
        std::fs::create_dir_all(app.join("dist")).unwrap();
        std::fs::write(app.join("dist/settings.html"), "synthetic settings").unwrap();
        assert_eq!(check_onboarding_assets(&app, &runtime), Err(OnboardingAssetFailure::SettingsEntry));
        std::fs::create_dir_all(app.join("electron")).unwrap();
        std::fs::write(app.join("electron/main.cjs"), "synthetic settings entry").unwrap();
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
        std::fs::create_dir_all(app.join("dist/composition/onboarding")).unwrap();
        std::fs::write(app.join("dist/composition/onboarding/entry.cjs"), "synthetic entry").unwrap();
        assert_eq!(check_onboarding_assets(&app, &runtime), Ok(()));
        std::fs::remove_file(app.join("dist/settings.html")).unwrap();
        assert_eq!(check_onboarding_assets(&app, &runtime), Err(OnboardingAssetFailure::SettingsHtml));
        std::fs::write(app.join("dist/settings.html"), "synthetic settings").unwrap();
        std::fs::remove_file(app.join("electron/main.cjs")).unwrap();
        assert_eq!(check_onboarding_assets(&app, &runtime), Err(OnboardingAssetFailure::SettingsEntry));
        std::fs::remove_dir_all(root).unwrap();
    }
}

pub(super) fn retire(transport: Transport) {
    let Transport { mut child, stdin } = transport;
    drop(stdin);
    std::thread::spawn(move || {
        for _ in 0..20 {
            if !matches!(child.try_wait(), Ok(None)) { return; }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        let _ = child.kill();
        let _ = child.wait();
    });
}

#[cfg(test)]
mod capability_tests {
    use super::*;
    #[test]
    fn pane_actions_keep_their_owner_after_general_labs_integration() {
        let panes = [Pane::General, Pane::Recording, Pane::Storage, Pane::Permissions, Pane::Agents, Pane::Labs, Pane::About];
        for (wire, owners) in [
            (r#"{"action":"check-for-updates"}"#, vec![Pane::About]),
            (r#"{"action":"labs-preference","request":1,"setting":"t3","enabled":true}"#, vec![]),
            (r#"{"action":"set","key":"launchAtLogin","value":true}"#, vec![Pane::General]),
            (r#"{"action":"set","key":"playbackLevel","value":101}"#, vec![]),
            (r#"{"action":"recording-preference","request":1,"key":"transcriber","value":"hex"}"#, vec![Pane::Recording]),
            (r#"{"action":"recording-preference","request":1,"key":"playbackLevel","value":101}"#, vec![]),
            (r#"{"action":"recording-preference","request":1,"key":"launchAtLogin","value":true}"#, vec![]),
            (r#"{"action":"recording-meter","visible":true}"#, vec![Pane::Recording]),
            (r#"{"action":"permission-action","request":1,"intent":{"kind":"recheck"}}"#, vec![Pane::Permissions]),
            (r#"{"action":"agents-preference","request":1,"setting":"autoPaste","enabled":true}"#, vec![]),
            (r#"{"action":"agents-preference","request":2,"setting":"sharing","enabled":true}"#, vec![]),
            (r#"{"action":"labs-preference","request":1,"setting":"streaming","enabled":true}"#, vec![Pane::Labs]),
            (r#"{"action":"labs-preference","request":2,"setting":"autoPaste","enabled":true}"#, vec![Pane::Labs]),
            (r#"{"action":"labs-preference","request":3,"setting":"sharing","enabled":true}"#, vec![Pane::Labs]),
            (r#"{"action":"labs-preference","request":4,"setting":"wisprFlow","enabled":true}"#, vec![Pane::Labs]),
            (r#"{"action":"agents-connection","request":4,"connection":null}"#, vec![Pane::Agents]),
            (r#"{"action":"agents-preference","request":3,"setting":"t3","enabled":true}"#, vec![Pane::Agents]),
            (r#"{"action":"agents-preference","request":5}"#, vec![Pane::Agents]),
            (r#"{"action":"agents-preference","request":6,"setting":"video","enabled":true}"#, vec![]),
        ] {
            let action: Action = serde_json::from_str(wire).unwrap();
            for pane in panes { assert_eq!(admits(pane, &action), owners.contains(&pane), "{wire}: {pane:?}"); }
        }
    }
}
