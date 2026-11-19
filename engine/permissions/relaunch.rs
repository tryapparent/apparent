const AFTER_EXIT: &str = "pid=$1; shift; i=0; \
    while kill -0 \"$pid\" 2>/dev/null && [ $i -lt 100 ]; do sleep 0.1; i=$((i+1)); done; ";

pub(crate) fn launch() -> std::io::Result<()> {
    let exe = std::env::current_exe()?;
    let bundle = exe
        .ancestors()
        .find(|p| p.extension().is_some_and(|ext| ext == "app"));
    let pid = std::process::id().to_string();
    let mut command = std::process::Command::new("/bin/sh");
    match bundle {
        Some(app) => command
            .arg("-c")
            .arg(format!("{AFTER_EXIT}exec /usr/bin/open \"$1\""))
            .args(["apparent-relaunch", &pid])
            .arg(app),
        None => command
            .arg("-c")
            .arg(format!("{AFTER_EXIT}exec \"$@\""))
            .args(["apparent-relaunch", &pid])
            .arg(&exe)
            .args(std::env::args_os().skip(1)),
    };
    command
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map(|_| ())
}

pub fn relaunch() {
    let _ = launch();
}
