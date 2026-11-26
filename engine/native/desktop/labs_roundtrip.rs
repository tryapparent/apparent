#[test]
#[ignore = "requires prepared frontend dependencies and Electron; Linux also requires xvfb-run"]
fn labs_electron_rust_roundtrip() {
    use std::io::{BufRead, Write};
    use std::process::{Command, Stdio};
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    super::super::presentation::build_test_renderer();
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("config.json");
    std::fs::write(
        &path,
        r#"{"secret":"private","experiments":{"other":true}}"#,
    )
    .unwrap();
    let mut command = if cfg!(target_os = "linux") {
        let mut command = Command::new("xvfb-run");
        command.args(["-a", "node"]);
        command
    } else {
        Command::new("node")
    };
    let mut child = command
        .arg("--experimental-strip-types")
        .arg(root.join("composition/settings/enablement/labs/native.mts"))
        .arg(&path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .unwrap();
    let mut input = child.stdin.take().unwrap();
    for line in std::io::BufReader::new(child.stdout.take().unwrap()).lines() {
        let line = line.unwrap();
        if let Ok(super::super::settings::Action::LabsPreference {
            request: id,
            enabled,
            setting,
            ..
        }) = serde_json::from_str(&line)
        {
            writeln!(input, "{}", request(&path, id, enabled, setting.as_deref())).unwrap();
        } else if let Ok(super::super::settings::Action::AgentsPreference {
            request: id,
            enabled,
            setting,
        }) = serde_json::from_str(&line)
        {
            assert!(setting.as_deref() == Some("t3") || setting.is_none() && enabled.is_none());
            writeln!(
                input,
                "{}",
                super::super::agents::request_for(&path, id, enabled, setting.as_deref())
            )
            .unwrap();
        } else if let Ok(super::super::settings::Action::HandoffAutoPaste {
            request: id,
            enabled,
        }) = serde_json::from_str(&line)
        {
            writeln!(
                input,
                "{}",
                super::super::settings::handoff_auto_paste(&path, id, enabled)
            )
            .unwrap();
        } else if let Ok(super::super::settings::Action::Navigate { pane }) =
            serde_json::from_str(&line)
        {
            assert_eq!(pane, super::super::settings::Pane::Handoff);
            writeln!(input, "{}", serde_json::json!({"type":"show","pane":pane})).unwrap();
        } else {
            let value: serde_json::Value = serde_json::from_str(&line)
                .unwrap_or_else(|error| panic!("Unexpected Labs driver output ({error}): {line}"));
            assert_eq!(value["action"], "close");
        }
    }
    assert!(child.wait().unwrap().success());
    assert_eq!(facts(&path)["saved"], false);
}
