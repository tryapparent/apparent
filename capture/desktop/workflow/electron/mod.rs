//! Resolve the single packaged Electron runtime. Callers own their surface protocol
//! and child lifecycle; this module never launches a window or changes routing.
use anyhow::{Context, Result, ensure};
use std::path::{Path, PathBuf};

pub(crate) struct Resources {
    pub executable: PathBuf,
    pub root: PathBuf,
    pub native_executable: PathBuf,
}

/// Preserve Chromium's namespace/renderer sandbox for user-owned Linux packages.
/// An unusable privileged helper must not prevent the ordinary sandbox route.
pub(crate) fn configure_sandbox(command: &mut std::process::Command, executable: &Path) -> Result<()> {
    #[cfg(target_os = "linux")]
    {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        let helper = std::fs::metadata(executable.parent().context("Missing runtime directory")?.join("chrome-sandbox"))?;
        if helper.uid() != 0 || helper.permissions().mode() & 0o4000 == 0 {
            command.arg("--disable-setuid-sandbox");
        }
    }
    #[cfg(not(target_os = "linux"))]
    let _ = (command, executable);
    Ok(())
}

pub(crate) fn resolve() -> Result<Resources> {
    let exe = std::env::current_exe()?;
    resolve_from(&exe, &PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("capture/desktop/ui/frontend"))
}

fn resolve_from(executable: &Path, development: &Path) -> Result<Resources> {
    // macOS can report the CLI alias as current_exe(). Assets and later
    // Launch Services routing must use the same installed bundle target.
    let native_executable = executable.canonicalize().context("Missing app executable")?;
    let installed = native_executable.parent().context("Missing app directory")?;
    #[cfg(target_os = "macos")]
    let root = installed.join("../Resources/note-ui");
    #[cfg(target_os = "linux")]
    let root = installed.join("../lib/apparent/note-ui");
    let packaged = root.join("dist/index.html").is_file();
    let root = if packaged { root } else { development.to_path_buf() };
    // Settings already packages the shared runtime. Assets and entry protocols
    // remain surface-owned; callers never derive the executable from the asset root.
    #[cfg(target_os = "macos")]
    let binary = if packaged {
        installed.join("../Resources/settings/runtime/Electron.app/Contents/MacOS/Electron")
    } else { root.join("node_modules/electron/dist/Electron.app/Contents/MacOS/Electron") };
    #[cfg(target_os = "linux")]
    let binary = if packaged {
        installed.join("../share/apparent/settings/runtime/electron")
    } else { root.join("node_modules/electron/dist/electron") };
    ensure!(
        binary.is_file() && root.join("dist/index.html").is_file(),
        "Desktop UI is missing; rebuild the packaged Electron frontend"
    );
    Ok(Resources { executable: binary, root, native_executable })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(target_os = "linux")]
    #[test]
    fn user_owned_runtime_keeps_namespace_and_renderer_sandbox_enabled() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(crate::shared::ids::make_bundle_id());
        std::fs::create_dir(&dir).unwrap();
        let helper = dir.join("chrome-sandbox");
        std::fs::write(&helper, "synthetic helper").unwrap();
        std::fs::set_permissions(&helper, std::fs::Permissions::from_mode(0o777)).unwrap();
        let mut command = std::process::Command::new(dir.join("electron"));
        configure_sandbox(&mut command, &dir.join("electron")).unwrap();
        assert_eq!(command.get_args().collect::<Vec<_>>(), ["--disable-setuid-sandbox"]);
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn installed_popups_use_settings_runtime_and_never_a_stale_duplicate() {
        let dir = std::env::temp_dir().join(crate::shared::ids::make_bundle_id());
        #[cfg(target_os = "macos")]
        let (bin, assets, runtime, old) = ("App.app/Contents/MacOS", "App.app/Contents/Resources/note-ui", "App.app/Contents/Resources/settings/runtime/Electron.app/Contents/MacOS/Electron", "runtime/Electron.app/Contents/MacOS/Electron");
        #[cfg(target_os = "linux")]
        let (bin, assets, runtime, old) = ("AppDir/usr/bin", "AppDir/usr/lib/apparent/note-ui", "AppDir/usr/share/apparent/settings/runtime/electron", "runtime/electron");
        let bin = dir.join(bin);
        let assets = dir.join(assets);
        let runtime = dir.join(runtime);
        for file in [assets.join("dist/index.html"), assets.join(old), runtime.clone()] {
            std::fs::create_dir_all(file.parent().unwrap()).unwrap();
            std::fs::write(file, b"synthetic").unwrap();
        }
        std::fs::create_dir_all(&bin).unwrap();
        let native = bin.join("apparent");
        std::fs::write(&native, b"synthetic native executable").unwrap();
        let alias = dir.join("bin/apparent");
        std::fs::create_dir_all(alias.parent().unwrap()).unwrap();
        std::os::unix::fs::symlink(&native, &alias).unwrap();
        for executable in [&native, &alias] {
            let resources = resolve_from(executable, &dir.join("unavailable-development")).unwrap();
            assert_eq!(resources.executable.canonicalize().unwrap(), runtime.canonicalize().unwrap());
            assert_eq!(resources.root.canonicalize().unwrap(), assets.canonicalize().unwrap());
            assert_eq!(resources.native_executable, native.canonicalize().unwrap());
        }
        std::fs::remove_file(runtime).unwrap();
        assert!(resolve_from(&alias, &dir.join("unavailable-development")).is_err(), "an old popup runtime cannot mask a broken installed package");
        std::fs::remove_dir_all(dir).unwrap();
    }
}

#[derive(Default)]
struct QuitPrompt(Option<crate::composition::worker::quit::Session>);

impl gpui::Global for QuitPrompt {}

pub(crate) fn confirm_quit(cx: &mut gpui::App) -> bool {
    let prompt = cx.default_global::<QuitPrompt>();
    if prompt.0.is_some() {
        return true;
    }
    let open = || {
        use crate::capture::desktop::settings::{LoginItem, login_item};
        let login = login_item();
        let state = crate::composition::worker::quit::State {
            checked: matches!(login, LoginItem::On | LoginItem::NeedsApproval),
            available: option_env!("APPARENT_PREVIEW_BUILD").is_none() && login != LoginItem::Unavailable,
            needs_approval: login == LoginItem::NeedsApproval,
            desktop_shortcut_possible: cfg!(target_os = "linux"),
        };
        let resources = resolve()?;
        let mut command = std::process::Command::new(&resources.executable);
        configure_sandbox(&mut command, &resources.executable)?;
        #[cfg(target_os = "linux")]
        if std::env::var_os("WAYLAND_DISPLAY").is_none() {
            command.arg("--ozone-platform=x11");
        }
        let entry = resources.root.join("dist/quit/main.cjs");
        ensure!(entry.is_file(), "Quit dialog bundle unavailable");
        command.arg(entry);
        crate::composition::worker::quit::Session::open(command, state)
    };
    match open() {
        Ok(dialog) => prompt.0 = Some(dialog),
        Err(error) => crate::capture::engine::runtime::apparent_log(format!("Quit dialog unavailable: {error:#}")),
    }
    prompt.0.is_some()
}

pub(crate) fn poll_windows(cx: &mut gpui::App) {
    crate::capture::desktop::settings::settings_window::poll(cx);
    let prompt = cx.default_global::<QuitPrompt>();
    let Some(dialog) = prompt.0.as_mut() else { return };
    use crate::composition::worker::quit::Event;
    let decision = match dialog.event() {
        Some(Event::Decided(decision)) => decision,
        Some(Event::Closed { before_display_failure }) => {
            prompt.0.take();
            if before_display_failure {
                crate::capture::engine::runtime::apparent_log("Quit dialog failed before display; using native shutdown");
                super::shutdown::request();
            }
            return;
        }
        Some(Event::Ready) | None => return,
    };
    let saved = decision.checked.map_or(Ok(()), crate::capture::desktop::settings::apply_quit_login_preference);
    if let Err(error) = &saved {
        crate::capture::engine::runtime::apparent_log(format!("Quit dialog startup setting: {error:#}"));
    }
    let replied = dialog.reply(saved.is_ok()).is_ok();
    if !replied || saved.is_ok() {
        prompt.0.take();
    }
    if saved.is_ok() && decision.quit {
        super::shutdown::request();
    }
}
