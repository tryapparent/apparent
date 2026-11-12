//! Resolve the single packaged Electron runtime. Callers own their surface protocol
//! and child lifecycle; this module never launches a window or changes routing.
use anyhow::{Context, Result, ensure};
use std::path::{Path, PathBuf};

pub(crate) struct Resources {
    pub executable: PathBuf,
    pub root: PathBuf,
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
    let installed = exe.parent().context("Missing app directory")?;
    resolve_from(installed, &PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("capture/desktop/ui/frontend"))
}

fn resolve_from(installed: &Path, development: &Path) -> Result<Resources> {
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
    Ok(Resources { executable: binary, root })
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
        let resources = resolve_from(&bin, &dir.join("unavailable-development")).unwrap();
        assert_eq!(resources.executable.canonicalize().unwrap(), runtime.canonicalize().unwrap());
        assert_eq!(resources.root.canonicalize().unwrap(), assets.canonicalize().unwrap());
        std::fs::remove_file(runtime).unwrap();
        assert!(resolve_from(&bin, &dir.join("unavailable-development")).is_err(), "an old popup runtime cannot mask a broken installed package");
        std::fs::remove_dir_all(dir).unwrap();
    }
}
