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

pub(crate) fn persist_t3_connection(path: &Path, connection: Option<Connection>, disconnect: Option<String>) -> anyhow::Result<()> {
    // TypeScript owns authorization/URL policy. Native retains the one config
    // mutation contract and independently bounds the private pipe payload.
    let valid = connection.as_ref().is_none_or(|value| !value.origin.is_empty() && value.origin.len() <= 2048
        && !value.token.is_empty() && value.token.len() <= 8192 && value.expires_at.is_finite() && value.expires_at > 0.0);
    anyhow::ensure!(valid, "Invalid T3 connection");
    let value = serde_json::to_value(connection)?;
    crate::shared::handoff::update_config_in(path, |config| {
        // Mechanical keyed merge under the existing writer lock. TypeScript owns
        // pairing, destination policy and the explicit computer to disconnect.
        let old = config.get("t3").cloned().unwrap_or(serde_json::Value::Null);
        let mut entries = Vec::new();
        if old.get("origin").is_some() { let mut first=old.clone(); first.as_object_mut().unwrap().remove("connections"); entries.push(first); }
        if let Some(extra)=old.get("connections").and_then(|v|v.as_array()) { entries.extend(extra.iter().cloned()); }
        anyhow::ensure!(entries.iter().all(|v|v.is_object() && v.get("origin").and_then(|v|v.as_str()).is_some()), "Invalid saved T3 connections");
        if value.is_null() {
            if let Some(origin)=disconnect.as_ref() { anyhow::ensure!(!origin.is_empty() && origin.len()<=2048,"Invalid connection key"); entries.retain(|v|v.get("origin").and_then(|v|v.as_str())!=Some(origin.as_str())); }
            else { entries.clear(); }
        } else if let Some(existing)=entries.iter_mut().find(|v|v.get("origin")==value.get("origin")) {
            existing.as_object_mut().unwrap().extend(value.as_object().unwrap().clone());
        } else { anyhow::ensure!(entries.len()<32,"Too many connections"); entries.push(value); }
        if entries.is_empty() { config.as_object_mut().unwrap().remove("t3"); }
        else { let mut first=entries.remove(0); if !entries.is_empty(){first["connections"]=serde_json::Value::Array(entries);} config["t3"]=first; }
        Ok(())
    })
}

pub(super) fn connection_request(path: &Path, request: u32, connection: Option<Connection>, disconnect: Option<String>) -> serde_json::Value {
    let facts=match persist_t3_connection(path,connection,disconnect) {
        Ok(())=>facts(path),Err(_)=>serde_json::json!({"error":"config_write_failed"}),
    };
    serde_json::json!({"type":"agents-result","request":request,"facts":facts})
}

pub(super) fn facts(path: &Path) -> serde_json::Value {
    let Ok(config) = crate::shared::handoff::read_preferences(path) else {
        return serde_json::json!({"error": "config_read_failed"});
    };
    // Match the existing config reader: absent/non-boolean values have no
    // explicit preference. Never forward unrelated config or private keys.
    let mut result = serde_json::json!({"saved": crate::shared::handoff::preference_value(&config, "agents.agentDemoVideo"),
        "t3Saved":crate::shared::handoff::preference_value(&config, "agents.t3DestinationPicker"),
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
    if let Some(t3)=config.get("t3") {
        let mut entries=vec![t3];
        if let Some(extra)=t3.get("connections").and_then(|v|v.as_array()) { entries.extend(extra.iter().take(31)); }
        let public:Vec<_>=entries.into_iter().filter_map(|v| {
            let origin=v.get("origin")?.as_str()?;
            if origin.len()>2048 || v.get("token")?.as_str()?.is_empty(){return None;}
            Some(serde_json::json!({"origin":origin,"expiresAt":v.get("expiresAt")}))
        }).collect();
        if !public.is_empty(){result["t3Connections"]=serde_json::json!(public);}
    }
    result
}

pub(super) fn request(path: &Path, request: u32, enabled: Option<bool>) -> serde_json::Value {
    request_for(path, request, enabled, None)
}

pub(super) fn request_for(path: &Path, request: u32, enabled: Option<bool>, setting: Option<&str>) -> serde_json::Value {
    let key = match setting { None | Some("video") => "agents.agentDemoVideo", Some("t3") => "agents.t3DestinationPicker", _ => return serde_json::json!({"type":"agents-result","request":request,"facts":{"error":"config_write_failed"}}) };
    let facts = if let Some(enabled) = enabled {
        match crate::shared::handoff::write_preference(path, key, Some(enabled.into())) {
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
    fn keyed_connections_preserve_other_computers_and_unrelated_secrets() {
        let dir=tempfile::tempdir().unwrap();let path=dir.path().join("config.json");
        std::fs::write(&path,r#"{"secret":"keep","t3":{"origin":"https://x1.test","token":"first-secret","expiresAt":9999999999999.0,"projectId":"p"}}"#).unwrap();
        let make=|origin:&str,token:&str|Connection{origin:origin.into(),token:token.into(),expires_at:9999999999999.0};
        let added=connection_request(&path,1,Some(make("https://clanker.test","second-secret")),None);
        assert_eq!(added["facts"]["t3Connections"].as_array().unwrap().len(),2);
        assert!(!added.to_string().contains("secret"));
        connection_request(&path,2,Some(make("https://x1.test","renewed-secret")),None);
        let saved:serde_json::Value=serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(saved["t3"]["projectId"],"p");assert_eq!(saved["t3"]["token"],"renewed-secret");assert_eq!(saved["t3"]["connections"][0]["token"],"second-secret");
        let removed=connection_request(&path,3,None,Some("https://x1.test".into()));
        assert_eq!(removed["facts"]["t3Connections"].as_array().unwrap().len(),1);
        let saved:serde_json::Value=serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(saved["secret"],"keep");assert_eq!(saved["t3"]["origin"],"https://clanker.test");
    }
    #[test]
    fn settings_connection_uses_the_config_transaction_without_enabling_the_picker_or_logging_credentials() {
        let dir = tempfile::tempdir().unwrap(); let path = dir.path().join("config.json");
        std::fs::write(&path, r#"{"other":"keep","experiments":{"t3DestinationPicker":false}}"#).unwrap();
        let connection: Connection = serde_json::from_value(serde_json::json!({"origin":"http://127.0.0.1:3773","token":"private-fixture","expiresAt":1234567890.0})).unwrap();
        let action = super::super::settings::Action::AgentsConnection {request:4,connection:Some(connection.clone()),disconnect:None};
        assert!(!format!("{action:?}").contains("private-fixture"));
        let reply = connection_request(&path,4,Some(connection),None);
        assert_eq!(reply["facts"]["t3Configured"],true); assert_eq!(reply["facts"]["t3Saved"],false);
        assert!(!reply.to_string().contains("private-fixture"));
        let value: serde_json::Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(value["other"],"keep"); assert_eq!(value["t3"]["token"],"private-fixture");
        assert_eq!(connection_request(&path,5,None,None)["facts"]["t3Configured"],false);
        let value: serde_json::Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert!(value.get("t3").is_none());assert_eq!(value["other"],"keep");
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
        assert_eq!(saved["agents"]["t3DestinationPicker"], true);
        assert_eq!(saved["experiments"]["t3DestinationPicker"], true);
        assert_eq!(request_for(&path, 10, Some(true), Some("unknown"))["facts"]["error"], "config_write_failed");
    }
    #[test]
    fn agents_preference_preserves_config_and_reports_failed_writes() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        assert_eq!(facts(&path), serde_json::json!({"saved": null,"t3Saved":null,"t3Configured":false}));
        std::fs::write(&path, r#"{"secret":"private","experiments":{"other":true}}"#).unwrap();
        for on in [false, true] {
            assert_eq!(request(&path, 7, Some(on)), serde_json::json!({"type":"agents-result","request":7,"facts":{"saved":on,"t3Saved":null,"t3Configured":false}}));
            let config: serde_json::Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
            assert_eq!(config["secret"], "private");
            assert_eq!(config["experiments"]["other"], true);
            assert_eq!(config["agents"]["agentDemoVideo"], on);
            assert_eq!(crate::shared::handoff::experiment_preference_in(&crate::shared::handoff::load_config_from(&path), "agents.agentDemoVideo"), on);
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
        // Native prerequisites prepare the Node providers, not Vite's renderer
        // assets. Build from source even when another owner selected this group.
        super::super::presentation::build_test_renderer();
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
            if let Ok(super::super::settings::Action::AgentsPreference { request: id, enabled, setting }) = serde_json::from_str(&line) {
                writeln!(input, "{}", request_for(&config, id, enabled, setting.as_deref())).unwrap();
            } else { panic!("Unexpected Agents command: {line}"); }
        }
        assert!(child.wait().unwrap().success());
        let saved: serde_json::Value = serde_json::from_slice(&std::fs::read(&config).unwrap()).unwrap();
        assert_eq!(saved["agents"]["agentDemoVideo"], true);
        assert!(saved["agents"]["t3DestinationPicker"].is_null());
        assert!(saved["experiments"]["onboardingWisprFlow"].is_null());
        assert_eq!(saved["experiments"]["other"], true);
        assert_eq!(saved["secret"], "private");
    }
}
