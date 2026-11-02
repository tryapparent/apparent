//! Resolve the single packaged Electron runtime. Callers own their surface protocol
//! and child lifecycle; this module never launches a window or changes routing.
use anyhow::{Context, Result, ensure};
use std::path::PathBuf;

pub(crate) struct Resources {
    pub executable: PathBuf,
    pub root: PathBuf,
}

pub(crate) fn resolve() -> Result<Resources> {
    let exe = std::env::current_exe()?;
    let installed = exe.parent().context("Missing app directory")?;
    #[cfg(target_os = "macos")]
    let root = installed.join("../Resources/note-ui");
    #[cfg(target_os = "linux")]
    let root = installed.join("../lib/apparent/note-ui");
    // Development uses the same built entry, never a network-loaded renderer.
    let root = if root.join("dist/index.html").is_file() {
        root
    } else {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("capture/desktop/ui/frontend")
    };
    #[cfg(target_os = "macos")]
    let binary = root.join("runtime/Electron.app/Contents/MacOS/Electron");
    #[cfg(target_os = "linux")]
    let binary = root.join("runtime/electron");
    let binary = if binary.is_file() {
        binary
    } else {
        #[cfg(target_os = "macos")]
        let relative = "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron";
        #[cfg(target_os = "linux")]
        let relative = "node_modules/electron/dist/electron";
        root.join(relative)
    };
    ensure!(
        binary.is_file() && root.join("dist/index.html").is_file(),
        "Desktop UI is missing; rebuild the packaged Electron frontend"
    );
    Ok(Resources { executable: binary, root })
}
