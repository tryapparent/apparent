//! Resolve the single packaged Electron runtime. Callers own their surface protocol
//! and child lifecycle; this module never launches a window or changes routing.
use anyhow::{Context, Result, ensure};
use std::path::{Path, PathBuf};

pub(crate) struct Resources {
    pub executable: PathBuf,
    pub root: PathBuf,
    pub native_executable: PathBuf,
}

pub(crate) fn resolve() -> Result<Resources> {
    let exe = std::env::current_exe()?;
    resolve_from(&exe, &PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("capture/desktop/ui/frontend"))
}

fn resolve_from(executable: &Path, development: &Path) -> Result<Resources> {
    // macOS current_exe() may identify ~/bin/apparent rather than the bundle
    // target. Resolve it once for both asset discovery and subsequent launch.
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
