fn assets() -> Option<(PathBuf, PathBuf)> {
    let executable = std::env::current_exe().ok()?;
    let parent = executable.parent()?;
    #[cfg(target_os = "macos")]
    let root = parent.parent()?.join("Resources/settings");
    #[cfg(target_os = "linux")]
    let root = parent.parent()?.join("share/apparent/settings");
    let source = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("capture/desktop/ui/frontend");
    let mut candidates = vec![(root.join("app"), root.join("runtime"))];
    if cfg!(debug_assertions) {
        candidates.push((source.clone(), source.join("node_modules/electron/dist")));
    }
    for (app, runtime) in candidates {
        #[cfg(target_os = "macos")]
        let runtime = runtime.join("Electron.app/Contents/MacOS/Electron");
        #[cfg(target_os = "linux")]
        let runtime = runtime.join("electron");
        if runtime.is_file()
            && app.join("dist/pill/index.html").is_file()
            && app.join("electron/pill/main.cjs").is_file()
        {
            return Some((app, runtime));
        }
    }
    None
}
