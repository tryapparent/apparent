//! Agents persistence adapter. Defaults and presentation belong to TypeScript.
use std::path::Path;

pub(super) fn facts(path: &Path) -> serde_json::Value {
    let config = match std::fs::read(path) {
        Ok(bytes) => match serde_json::from_slice::<serde_json::Value>(&bytes) {
            Ok(value) if value.is_object() => value,
            _ => return serde_json::json!({"error": "config_read_failed"}),
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => serde_json::json!({}),
        Err(_) => return serde_json::json!({"error": "config_read_failed"}),
    };
    // Match the existing config reader: absent/non-boolean values have no
    // explicit preference. Never forward unrelated config or private keys.
    serde_json::json!({"saved": config.get("experiments").and_then(|flags| flags.get("agentDemoVideo")).and_then(|flag| flag.as_bool())})
}

pub(super) fn request(path: &Path, request: u32, enabled: Option<bool>) -> serde_json::Value {
    let facts = if let Some(enabled) = enabled {
        match crate::shared::handoff::set_experiment_in(path, "agentDemoVideo", enabled) {
            Ok(()) => facts(path),
            Err(_) => serde_json::json!({"error": "config_write_failed"}),
        }
    } else { facts(path) };
    serde_json::json!({"type": "agents-result", "request": request, "facts": facts})
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn agents_preference_preserves_config_and_reports_failed_writes() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        assert_eq!(facts(&path), serde_json::json!({"saved": null}));
        std::fs::write(&path, r#"{"secret":"private","experiments":{"other":true}}"#).unwrap();
        for on in [false, true] {
            assert_eq!(request(&path, 7, Some(on)), serde_json::json!({"type":"agents-result","request":7,"facts":{"saved":on}}));
            let config: serde_json::Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
            assert_eq!(config["secret"], "private");
            assert_eq!(config["experiments"]["other"], true);
            assert_eq!(crate::shared::handoff::experiment_enabled_in(&crate::shared::handoff::load_config_from(&path), "agentDemoVideo"), on);
        }
        std::fs::write(&path, "invalid").unwrap();
        assert_eq!(facts(&path)["error"], "config_read_failed");
        assert_eq!(request(&path, 8, Some(false))["facts"]["error"], "config_write_failed");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "invalid");
    }

    #[test]
    #[ignore = "requires built frontend and Electron; Linux also requires xvfb-run"]
    fn agents_electron_rust_roundtrip() {
        use std::io::{BufRead, Write};
        use std::process::{Command, Stdio};
        let dir = tempfile::tempdir().unwrap();
        let config = dir.path().join("config.json");
        std::fs::write(&config, r#"{"secret":"private","experiments":{"other":true}}"#).unwrap();
        let script = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("capture/desktop/ui/frontend/tests/settings/agents/native.ts");
        // The CI roundtrip group also contains headless Node-only providers.
        // Own this renderer's display rather than relying on a caller's DISPLAY
        // or exposing a test window on the host desktop.
        let mut command = if cfg!(target_os = "linux") {
            let mut command = Command::new("xvfb-run");
            command.args(["-a", "node"]);
            command
        } else { Command::new("node") };
        let mut child = command.arg("--experimental-strip-types").arg(script).arg(&config)
            .arg(super::super::settings::SKILL_COMMAND)
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::inherit()).spawn().unwrap();
        let mut input = child.stdin.take().unwrap();
        for line in std::io::BufReader::new(child.stdout.take().unwrap()).lines() {
            let line = line.unwrap();
            if let Ok(super::super::settings::Action::AgentsPreference { request: id, enabled }) = serde_json::from_str(&line) {
                writeln!(input, "{}", request(&config, id, enabled)).unwrap();
            } else { panic!("Unexpected Agents command: {line}"); }
        }
        assert!(child.wait().unwrap().success());
        let saved: serde_json::Value = serde_json::from_slice(&std::fs::read(&config).unwrap()).unwrap();
        assert_eq!(saved["experiments"]["agentDemoVideo"], true);
        assert_eq!(saved["experiments"]["other"], true);
        assert_eq!(saved["secret"], "private");
    }
}
