//! Agents persistence adapter. Defaults and presentation belong to TypeScript.
use std::path::Path;

#[derive(Clone, PartialEq, serde::Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Connection {
    origin: String,
    token: String,
    #[serde(rename = "expiresAt")]
    expires_at: f64,
}

// Settings actions are logged by native callers. Credentials must never take
// the ordinary derived-Debug path, including a failed persistence request.
impl std::fmt::Debug for Connection {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("T3Connection([redacted])")
    }
}

pub(super) fn connection_request(path: &Path, request: u32, connection: Option<Connection>) -> serde_json::Value {
    // TypeScript owns authorization/URL policy. Native retains the one config
    // mutation contract and independently bounds the private pipe payload.
    let valid = connection.as_ref().is_none_or(|value| !value.origin.is_empty() && value.origin.len() <= 2048
        && !value.token.is_empty() && value.token.len() <= 8192 && value.expires_at.is_finite() && value.expires_at > 0.0);
    let value = if valid { serde_json::to_value(connection).ok() } else { None };
    let facts = match value.and_then(|value| crate::shared::handoff::set_config_value_in(path, "t3", value).ok()) {
        Some(()) => facts(path),
        None => serde_json::json!({"error":"config_write_failed"}),
    };
    serde_json::json!({"type":"agents-result","request":request,"facts":facts})
}

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
    let mut result = serde_json::json!({"saved": config.get("experiments").and_then(|flags| flags.get("agentDemoVideo")).and_then(|flag| flag.as_bool()),
        "sharingSaved":config.get("experiments").and_then(|flags|flags.get("hostedSharing")).and_then(|flag|flag.as_bool()),
        "t3Saved":config.get("experiments").and_then(|flags|flags.get("t3DestinationPicker")).and_then(|flag|flag.as_bool()),
        "autoPasteSaved":config.get("experiments").and_then(|flags|flags.get("autoPasteDraft")).and_then(|flag|flag.as_bool()),
        "autoPasteSupported":cfg!(target_os = "linux"),
        "wisprSaved":config.get("experiments").and_then(|flags|flags.get("onboardingWisprFlow")).and_then(|flag|flag.as_bool()),
        "wisprSupported":cfg!(target_os = "macos"),
        "t3Configured":config.pointer("/t3/origin").and_then(|v|v.as_str()).is_some()
            &&config.pointer("/t3/token").and_then(|v|v.as_str()).is_some()});
    // This private pipe terminates in Electron main. Its public facts parser
    // validates the origin before exposing it to the page; no token is sent.
    if let Some(origin) = config.pointer("/t3/origin").and_then(|v|v.as_str()).filter(|s| s.len()<=2048) {
        result["t3Origin"] = serde_json::json!(origin);
    }
    if let Some(expiry) = config.pointer("/t3/expiresAt").and_then(|v|v.as_f64()).filter(|n|n.is_finite()) {
        result["t3ExpiresAt"] = serde_json::json!(expiry);
    }
    result
}

pub(super) fn request(path: &Path, request: u32, enabled: Option<bool>) -> serde_json::Value {
    request_for(path, request, enabled, None)
}

/// Labs receives only its experiment facts, never agent connection metadata.
pub(super) fn labs_facts(path: &Path) -> serde_json::Value {
    let facts = facts(path);
    if facts.get("error").is_some() { return facts; }
    serde_json::json!({"saved":null,"autoPasteSaved":facts["autoPasteSaved"],"autoPasteSupported":facts["autoPasteSupported"],"sharingSaved":facts["sharingSaved"],"wisprSaved":facts["wisprSaved"],"wisprSupported":facts["wisprSupported"]})
}

pub(super) fn labs_request(path: &Path, request: u32, enabled: Option<bool>, setting: &str) -> serde_json::Value {
    if !matches!(setting, "autoPaste" | "sharing" | "wisprFlow") {
        return serde_json::json!({"type":"agents-result","request":request,"facts":{"error":"config_write_failed"}});
    }
    if enabled.is_none() {
        return serde_json::json!({"type":"agents-result","request":request,"facts":labs_facts(path)});
    }
    let mut result = request_for(path, request, enabled, Some(setting));
    if result["facts"].get("error").is_none() { result["facts"] = labs_facts(path); }
    result
}

pub(super) fn request_for(path: &Path, request: u32, enabled: Option<bool>, setting: Option<&str>) -> serde_json::Value {
    let key = match setting { None | Some("video") => "agentDemoVideo", Some("t3") => "t3DestinationPicker", Some("sharing") => "hostedSharing",
        #[cfg(target_os = "linux")]
        Some("autoPaste") => "autoPasteDraft",
        #[cfg(target_os = "macos")]
        Some("wisprFlow") => "onboardingWisprFlow",
        _ => return serde_json::json!({"type":"agents-result","request":request,"facts":{"error":"config_write_failed"}}) };
    let facts = if let Some(enabled) = enabled {
        match crate::shared::handoff::set_experiment_in(path, key, enabled) {
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
    fn wispr_lab_defaults_off_and_uses_the_shared_config_transaction_only_on_mac() {
        let dir = tempfile::tempdir().unwrap(); let path = dir.path().join("config.json");
        std::fs::write(&path, r#"{"secret":"private","experiments":{"other":true}}"#).unwrap();
        assert!(facts(&path)["wisprSaved"].is_null());
        assert!(!crate::shared::handoff::experiment_enabled_in(&crate::shared::handoff::load_config_from(&path), "onboardingWisprFlow"));
        let reply = labs_request(&path, 10, Some(true), "wisprFlow");
        if cfg!(target_os = "macos") {
            assert_eq!(reply["facts"]["wisprSaved"], true);
        } else { assert_eq!(reply["facts"]["error"], "config_write_failed"); }
        let saved: serde_json::Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(saved["secret"], "private"); assert_eq!(saved["experiments"]["other"], true);
        assert!(!reply.to_string().contains("private"));
    }
    #[test]
    fn labs_projection_and_mutation_preserve_agent_preferences_and_private_connection() {
        let dir = tempfile::tempdir().unwrap(); let path = dir.path().join("config.json");
        std::fs::write(&path, r#"{"secret":"private","t3":{"origin":"https://example.test","token":"private-token"},"experiments":{"agentDemoVideo":true,"t3DestinationPicker":true}}"#).unwrap();
        let facts = labs_facts(&path);
        assert_eq!(facts.as_object().unwrap().len(), 6);
        assert!(facts["autoPasteSaved"].is_null());
        assert!(!facts.to_string().contains("private"));
        assert_eq!(labs_request(&path, 1, None, "autoPaste")["facts"], facts);
        assert_eq!(labs_request(&path, 2, Some(false), "sharing")["facts"]["sharingSaved"], false);
        assert_eq!(labs_request(&path, 3, Some(false), "t3")["facts"]["error"], "config_write_failed");
        #[cfg(target_os = "macos")]
        assert_eq!(labs_request(&path, 2, Some(true), "autoPaste")["facts"]["error"], "config_write_failed");
        #[cfg(target_os = "linux")]
        {
            assert_eq!(labs_request(&path, 1, Some(true), "autoPaste")["facts"]["autoPasteSaved"], true);
            let saved: serde_json::Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
            assert_eq!(saved["secret"], "private"); assert_eq!(saved["t3"]["token"], "private-token");
            assert_eq!(saved["experiments"]["agentDemoVideo"], true);
            assert_eq!(saved["experiments"]["t3DestinationPicker"], true);
        }
    }
    #[test]
    fn settings_connection_uses_the_config_transaction_without_enabling_the_picker_or_logging_credentials() {
        let dir = tempfile::tempdir().unwrap(); let path = dir.path().join("config.json");
        std::fs::write(&path, r#"{"other":"keep","experiments":{"t3DestinationPicker":false}}"#).unwrap();
        let connection: Connection = serde_json::from_value(serde_json::json!({"origin":"http://127.0.0.1:3773","token":"private-fixture","expiresAt":1234567890.0})).unwrap();
        let action = super::super::settings::Action::AgentsConnection {request:4,connection:Some(connection.clone())};
        assert!(!format!("{action:?}").contains("private-fixture"));
        let reply = connection_request(&path,4,Some(connection));
        assert_eq!(reply["facts"]["t3Configured"],true); assert_eq!(reply["facts"]["t3Saved"],false);
        assert!(!reply.to_string().contains("private-fixture"));
        let value: serde_json::Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(value["other"],"keep"); assert_eq!(value["t3"]["token"],"private-fixture");
        assert_eq!(connection_request(&path,5,None)["facts"]["t3Configured"],false);
        let value: serde_json::Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert!(value.get("t3").is_none());assert_eq!(value["other"],"keep");
    }
    #[test]
    fn public_sharing_preserves_private_upload_preferences() {
        let dir = tempfile::tempdir().unwrap(); let path = dir.path().join("config.json");
        assert!(facts(&path)["sharingSaved"].is_null());
        std::fs::write(&path, r#"{"secret":"keep","experiments":{"hostedEncryption":true,"autoPaste":false}}"#).unwrap();
        for on in [true, false] {
            assert_eq!(request_for(&path, 1, Some(on), Some("sharing"))["facts"]["sharingSaved"], on);
            let value: serde_json::Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
            assert_eq!(value["secret"], "keep"); assert_eq!(value["experiments"]["hostedEncryption"], true);
            assert_eq!(value["experiments"]["autoPaste"], false);
        }
    }
    #[test]
    fn t3_preference_is_independent_and_keeps_pairing_private() {
        let dir = tempfile::tempdir().unwrap(); let path = dir.path().join("config.json");
        std::fs::write(&path, r#"{"secret":"private","t3":{"origin":"https://example.test","token":"private-token"},"experiments":{"agentDemoVideo":false}}"#).unwrap();
        assert!(facts(&path)["t3Saved"].is_null());
        let value = request_for(&path, 9, Some(true), Some("t3"));
        assert_eq!(value["facts"]["t3Saved"], true);
        assert_eq!(value["facts"]["saved"], false);
        assert!(!value.to_string().contains("private-token"));
        let saved: serde_json::Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(saved["t3"]["token"], "private-token"); assert_eq!(saved["secret"], "private");
        assert_eq!(request_for(&path, 10, Some(true), Some("unknown"))["facts"]["error"], "config_write_failed");
    }
    #[test]
    fn agents_preference_preserves_config_and_reports_failed_writes() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        assert_eq!(facts(&path), serde_json::json!({"saved": null,"t3Saved":null,"sharingSaved":null,"t3Configured":false,"autoPasteSaved":null,"autoPasteSupported":cfg!(target_os = "linux"),"wisprSaved":null,"wisprSupported":cfg!(target_os = "macos")}));
        std::fs::write(&path, r#"{"secret":"private","experiments":{"other":true}}"#).unwrap();
        for on in [false, true] {
            assert_eq!(request(&path, 7, Some(on)), serde_json::json!({"type":"agents-result","request":7,"facts":{"saved":on,"t3Saved":null,"sharingSaved":null,"t3Configured":false,"autoPasteSaved":null,"autoPasteSupported":cfg!(target_os = "linux"),"wisprSaved":null,"wisprSupported":cfg!(target_os = "macos")}}));
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
    #[ignore = "requires prepared frontend dependencies and Electron; Linux also requires xvfb-run"]
    fn agents_electron_rust_roundtrip() {
        use std::io::{BufRead, Write};
        use std::process::{Command, Stdio};
        let frontend = Path::new(env!("CARGO_MANIFEST_DIR")).join("capture/desktop/ui/frontend");
        // Native prerequisites prepare the Node providers, not Vite's renderer
        // assets. Build from source even when another owner selected this group.
        assert!(Command::new("node").arg(frontend.join("node_modules/vite/bin/vite.js"))
            .arg("build").current_dir(&frontend).status().unwrap().success());
        let dir = tempfile::tempdir().unwrap();
        let config = dir.path().join("config.json");
        std::fs::write(&config, r#"{"secret":"private","experiments":{"other":true}}"#).unwrap();
        let script = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("capture/desktop/ui/frontend/tests/settings/agents/native.ts");
        // The CI roundtrip group also contains headless Node-only providers.
        // Own this renderer's display rather than relying on a caller's DISPLAY
        // or exposing a test window on the host desktop.
        for route in ["agents", "labs"] {
        let mut command = if cfg!(target_os = "linux") {
            let mut command = Command::new("xvfb-run");
            command.args(["-a", "node"]);
            command
        } else { Command::new("node") };
        let mut child = command.arg("--experimental-strip-types").arg(&script).arg(&config)
            .arg(super::super::settings::SKILL_COMMAND).arg(route)
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::inherit()).spawn().unwrap();
        let mut input = child.stdin.take().unwrap();
        for line in std::io::BufReader::new(child.stdout.take().unwrap()).lines() {
            let line = line.unwrap();
            if let Ok(super::super::settings::Action::AgentsPreference { request: id, enabled, setting }) = serde_json::from_str(&line) {
                let result = if route == "labs" { assert!(matches!(setting.as_deref(), Some("autoPaste" | "sharing" | "wisprFlow"))); labs_request(&config, id, enabled, setting.as_deref().unwrap()) } else { request_for(&config, id, enabled, setting.as_deref()) };
                writeln!(input, "{}", result).unwrap();
            } else { panic!("Unexpected Agents command: {line}"); }
        }
        assert!(child.wait().unwrap().success());
        }
        let saved: serde_json::Value = serde_json::from_slice(&std::fs::read(&config).unwrap()).unwrap();
        assert_eq!(saved["experiments"]["agentDemoVideo"], true);
        assert_eq!(saved["experiments"]["t3DestinationPicker"], false);
        if cfg!(target_os = "macos") {
            assert_eq!(saved["experiments"]["onboardingWisprFlow"], false);
        } else {
            assert!(saved["experiments"]["onboardingWisprFlow"].is_null());
        }
        assert_eq!(saved["experiments"]["other"], true);
        assert_eq!(saved["secret"], "private");
    }
}
