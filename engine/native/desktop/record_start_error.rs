use anyhow::Result;
use std::process::{Command, Stdio};

pub(crate) fn show(title: &str, description: &str) {
    let title = title.to_owned();
    let description = description.to_owned();
    let report = |title: &str, description: &str| {
        crate::capture::desktop::linux::shell::notify(title, description)
    };
    let fallback = (title.clone(), description.clone());
    if std::thread::Builder::new().name("apparent-record-start-error".into()).spawn(move || {
        let open = || -> Result<()> {
            let resources = crate::capture::desktop::workflow::electron::resolve()?;
            let mut command = Command::new(&resources.executable);
            crate::capture::desktop::workflow::electron::configure_sandbox(&mut command, &resources.executable)?;
            if std::env::var_os("WAYLAND_DISPLAY").is_none() {
                command.arg("--ozone-platform=x11");
            }
            let mut child = command
                .arg(resources.root.join("dist/quit/main.cjs"))
                .arg(serde_json::json!({ "kind": "record-start-error", "title": &title, "description": &description }).to_string())
                .stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::null()).spawn()?;
            let lifetime = child.stdin.take();
            anyhow::ensure!(child.wait()?.success(), "Recording start dialog exited unsuccessfully");
            drop(lifetime);
            Ok(())
        };
        if open().is_err() { report(&title, &description); }
    }).is_err() {
        report(&fallback.0, &fallback.1);
    }
}
