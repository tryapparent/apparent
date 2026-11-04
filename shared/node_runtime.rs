//! Policy-free access to the existing packaged Node/Electron runtime. No windows
//! or services are started here; stream/adapter callers own their child lifetime.
use anyhow::{Context, Result, ensure};
use std::path::{Path, PathBuf};

pub(crate) fn electron_executable(installed: &Path, development: &Path, packaged: bool) -> PathBuf {
    #[cfg(target_os = "macos")]
    let relative = "../Resources/settings/runtime/Electron.app/Contents/MacOS/Electron";
    #[cfg(target_os = "linux")]
    let relative = "../share/apparent/settings/runtime/electron";
    if packaged {
        return installed.join(relative);
    }
    #[cfg(target_os = "macos")]
    let relative = "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron";
    #[cfg(target_os = "linux")]
    let relative = "node_modules/electron/dist/electron";
    development.join(relative)
}

pub(crate) struct Executor {
    pub executable: PathBuf,
    pub entry: PathBuf,
}

pub(crate) fn config_executor() -> Result<Executor> {
    let exe = std::env::current_exe()?;
    let installed = exe.parent().context("Missing application directory")?;
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    resolve_config(installed, root)
}

fn resolve_config(installed: &Path, root: &Path) -> Result<Executor> {
    #[cfg(target_os = "macos")]
    let entry = installed.join("../Resources/settings/app/shared-config/rpc.cjs");
    #[cfg(target_os = "linux")]
    let entry = installed.join("../share/apparent/settings/app/shared-config/rpc.cjs");
    if entry.is_file() {
        let executable =
            electron_executable(installed, &root.join("capture/desktop/ui/frontend"), true);
        ensure!(
            executable.is_file(),
            "Settings runtime is missing; reinstall Apparent"
        );
        return Ok(Executor { executable, entry });
    }
    let packaged = installed.file_name().is_some_and(|name| name == "MacOS")
        || (installed.file_name().is_some_and(|name| name == "bin")
            && installed
                .parent()
                .and_then(Path::file_name)
                .is_some_and(|name| name == "usr"));
    ensure!(
        !packaged,
        "Settings transaction assets are missing; reinstall Apparent"
    );
    let entry = root.join("shared/handoff/typescript/dist/rpc.cjs");
    ensure!(
        entry.is_file(),
        "Settings transaction assets are missing; build shared/handoff/typescript"
    );
    let frontend = root.join("capture/desktop/ui/frontend");
    let electron = electron_executable(installed, &frontend, false);
    let executable = if electron.is_file() {
        electron
    } else {
        std::env::var_os("PATH")
            .and_then(|paths| {
                std::env::split_paths(&paths)
                    .map(|directory| directory.join("node"))
                    .find(|node| node.is_file())
            })
            .context("Node.js 22.18+ is required for development settings transactions")?
    };
    Ok(Executor { executable, entry })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn installed_transactions_use_only_the_existing_runtime_and_staged_entry() {
        let root = std::env::temp_dir().join(crate::shared::ids::make_bundle_id());
        #[cfg(target_os = "macos")]
        let installed = root.join("App.app/Contents/MacOS");
        #[cfg(target_os = "linux")]
        let installed = root.join("AppDir/usr/bin");
        #[cfg(target_os = "macos")]
        let entry = installed.join("../Resources/settings/app/shared-config/rpc.cjs");
        #[cfg(target_os = "linux")]
        let entry = installed.join("../share/apparent/settings/app/shared-config/rpc.cjs");
        let executable = electron_executable(&installed, &root, true);
        for file in [&entry, &executable] {
            std::fs::create_dir_all(file.parent().unwrap()).unwrap();
            std::fs::write(file, b"synthetic").unwrap();
        }
        let result = resolve_config(&installed, &root.join("unavailable")).unwrap();
        assert_eq!(result.entry, entry);
        assert_eq!(result.executable, executable);
        std::fs::remove_file(executable).unwrap();
        assert!(resolve_config(&installed, &root).is_err());
        std::fs::remove_file(entry).unwrap();
        assert!(resolve_config(&installed, &root).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
}
