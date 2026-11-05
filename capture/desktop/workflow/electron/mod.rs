//! Resolve the single packaged Electron runtime. Callers own their surface protocol
//! and child lifecycle; this module never launches a window or changes routing.
use anyhow::{ensure, Context, Result};
use std::path::{Path, PathBuf};

pub(crate) struct Resources {
    pub executable: PathBuf,
    pub root: PathBuf,
}

pub(crate) fn resolve() -> Result<Resources> {
    let exe = std::env::current_exe()?;
    let installed = exe.parent().context("Missing app directory")?;
    let checkout = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let development = checkout.join("capture/desktop/ui/frontend");
    let allow_development = exe.starts_with(checkout.join("target"));
    resolve_from(installed, &development, allow_development)
}

fn resolve_from(
    installed: &Path,
    development: &Path,
    allow_development: bool,
) -> Result<Resources> {
    #[cfg(target_os = "macos")]
    let root = installed.join("../Resources/note-ui");
    #[cfg(target_os = "linux")]
    let root = installed.join("../lib/apparent/note-ui");
    let packaged = root.join("dist/index.html").is_file()
        && root.join("electron/notes/main.cjs").is_file()
        && root.join("electron/notes/preload.cjs").is_file()
        && root.join("electron/notes/protocol.cjs").is_file()
        && root.join("electron/runtime.cjs").is_file();
    let root = if packaged {
        root
    } else if allow_development {
        development.to_path_buf()
    } else {
        anyhow::bail!("Packaged Desktop UI is missing; rebuild the application resources")
    };
    // Settings already packages the shared runtime. Assets and entry protocols
    // remain surface-owned; callers never derive the executable from the asset root.
    #[cfg(target_os = "macos")]
    let binary = if packaged {
        installed.join("../Resources/settings/runtime/Electron.app/Contents/MacOS/Electron")
    } else {
        root.join("node_modules/electron/dist/Electron.app/Contents/MacOS/Electron")
    };
    #[cfg(target_os = "linux")]
    let binary = if packaged {
        installed.join("../share/apparent/settings/runtime/electron")
    } else {
        root.join("node_modules/electron/dist/electron")
    };
    ensure!(
        binary.is_file() && root.join("dist/index.html").is_file(),
        "Desktop UI is missing; rebuild the packaged Electron frontend"
    );
    Ok(Resources {
        executable: binary,
        root,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn installed_popups_use_settings_runtime_and_never_a_stale_duplicate() {
        let dir = std::env::temp_dir().join(crate::shared::ids::make_bundle_id());
        #[cfg(target_os = "macos")]
        let (bin, assets, runtime, old) = (
            "App.app/Contents/MacOS",
            "App.app/Contents/Resources/note-ui",
            "App.app/Contents/Resources/settings/runtime/Electron.app/Contents/MacOS/Electron",
            "runtime/Electron.app/Contents/MacOS/Electron",
        );
        #[cfg(target_os = "linux")]
        let (bin, assets, runtime, old) = (
            "AppDir/usr/bin",
            "AppDir/usr/lib/apparent/note-ui",
            "AppDir/usr/share/apparent/settings/runtime/electron",
            "runtime/electron",
        );
        let bin = dir.join(bin);
        let assets = dir.join(assets);
        let runtime = dir.join(runtime);
        for file in [
            assets.join("dist/index.html"),
            assets.join("electron/notes/main.cjs"),
            assets.join("electron/notes/preload.cjs"),
            assets.join("electron/notes/protocol.cjs"),
            assets.join("electron/runtime.cjs"),
            assets.join(old),
            runtime.clone(),
        ] {
            std::fs::create_dir_all(file.parent().unwrap()).unwrap();
            std::fs::write(file, b"synthetic").unwrap();
        }
        std::fs::create_dir_all(&bin).unwrap();
        let resources = resolve_from(&bin, &dir.join("unavailable-development"), false).unwrap();
        assert_eq!(
            resources.executable.canonicalize().unwrap(),
            runtime.canonicalize().unwrap()
        );
        assert_eq!(
            resources.root.canonicalize().unwrap(),
            assets.canonicalize().unwrap()
        );
        std::fs::remove_file(runtime).unwrap();
        assert!(
            resolve_from(&bin, &dir.join("unavailable-development"), false).is_err(),
            "an old popup runtime cannot mask a broken installed package"
        );
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn only_target_executables_may_use_checkout_renderer_resources() {
        let dir = std::env::temp_dir().join(crate::shared::ids::make_bundle_id());
        let bin = dir.join("AppDir/usr/bin");
        let development = dir.join("checkout/frontend");
        for path in [
            development.join("dist/index.html"),
            development.join("electron/notes/main.cjs"),
            development.join("electron/notes/preload.cjs"),
            development.join("electron/notes/protocol.cjs"),
            development.join("electron/runtime.cjs"),
        ] {
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, b"synthetic").unwrap();
        }
        std::fs::create_dir_all(&bin).unwrap();
        assert!(
            resolve_from(&bin, &development, false).is_err(),
            "an installed executable must not load missing renderer assets from checkout"
        );
        let resources = resolve_from(&bin, &development, true).unwrap();
        assert_eq!(resources.root, development);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
