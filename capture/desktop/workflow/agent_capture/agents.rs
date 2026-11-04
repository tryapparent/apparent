//! Narrow shared Agents Settings contract; paths and persistence stay in Rust.
use serde_json::{Value, json};
use crate::composition::command_line::{self as cli, Places, State};
use super::storage_clock_ms;

#[derive(serde::Deserialize, Debug)]
#[serde(tag = "agents", rename_all = "lowercase", deny_unknown_fields)]
pub(super) enum Request {
    Read { deadline: u64 },
    Install { deadline: u64 },
    Uninstall { deadline: u64 },
    Demo { enabled: bool, deadline: u64 },
}
impl Request {
    pub(super) fn deadline(&self) -> u64 {
        match self { Self::Read { deadline } | Self::Install { deadline } | Self::Uninstall { deadline } | Self::Demo { deadline, .. } => *deadline }
    }
    pub(super) fn execute(&self, config: &std::path::Path, deadline: u64) -> Value {
        self.execute_in(config, deadline, &Places::system())
    }
    fn execute_in(&self, config: &std::path::Path, deadline: u64, places: &Places) -> Value {
        let error = |code| json!({"error":code});
        let cli_operation = match self { Self::Install { .. } => Some("install"), Self::Uninstall { .. } => Some("uninstall"), _ => None };
        if let Some(operation) = cli_operation {
            crate::capture::engine::runtime::apparent_log(format!("Agents CLI {operation}: received"));
        }
        if storage_clock_ms() >= deadline { return error("admission_expired"); }
        if let Self::Demo { enabled, .. } = self {
            let allowed = || storage_clock_ms() < deadline;
            let result = crate::shared::handoff::update_config_allowed_in(config, &allowed, |raw| {
                let flags = raw.as_object_mut().ok_or_else(|| anyhow::anyhow!("invalid config"))?
                    .entry("experiments").or_insert_with(|| json!({}));
                let flags = flags.as_object_mut().ok_or_else(|| anyhow::anyhow!("invalid flags"))?;
                flags.insert("agentDemoVideo".into(), (*enabled).into());
                Ok(())
            });
            if result.is_err() { return error(if allowed() { "config_write_failed" } else { "admission_expired" }); }
        }
        let result = match self {
            Self::Install { .. } => cli::install(places).map(|_| ()),
            Self::Uninstall { .. } => {
                if matches!(cli::state(places), State::Installed { homebrew: true, .. }) { return error("cli_managed"); }
                cli::uninstall(places)
            },
            _ => Ok(()),
        };
        if let Err(cause) = result {
            // Keep paths and raw error text off the bridge and out of diagnostic
            // logs. OS kind/errno distinguish filesystem denial from ownership.
            if let Some(operation) = cli_operation {
                let io = cause.chain().find_map(|error| error.downcast_ref::<std::io::Error>());
                crate::capture::engine::runtime::apparent_log(format!(
                    "Agents CLI {operation}: failed kind={:?} errno={:?}",
                    io.map(std::io::Error::kind), io.and_then(std::io::Error::raw_os_error)));
            }
            return error("cli_change_failed");
        }
        if let Some(operation) = cli_operation {
            crate::capture::engine::runtime::apparent_log(format!("Agents CLI {operation}: completed"));
        }
        let raw: Value = match std::fs::read(config) {
            Ok(bytes) => match serde_json::from_slice(&bytes) { Ok(value) => value, Err(_) => return error("config_read_failed") },
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => json!({}),
            Err(_) => return error("config_read_failed"),
        };
        if !raw.is_object() { return error("config_read_failed"); }
        let (state, install, uninstall) = match cli::state(places) {
            State::Unavailable => ("unavailable", false, false),
            State::Installed { homebrew, .. } => (if homebrew { "managed" } else { "installed" }, false, !homebrew),
            State::Missing { .. } => ("missing", true, false),
            State::Stale { .. } => ("stale", true, true),
            State::Taken { .. } => ("taken", false, false),
            State::Nowhere => ("nowhere", false, false),
        };
        let demo = raw.get("experiments").and_then(|v| v.get("agentDemoVideo")).and_then(Value::as_bool).unwrap_or(true);
        json!({"agents":{"cli":state,"canInstall":install,"canUninstall":uninstall,"agentDemoVideo":demo,
            "skillCommand":crate::capture::desktop::settings::settings::SKILL_COMMAND}})
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn strict_requests_and_fixture_roundtrip() {
        for bad in [r#"{"agents":"read","deadline":1,"path":"/tmp"}"#, r#"{"agents":"demo","deadline":1,"enabled":"true"}"#, r#"{"agents":"install","deadline":-1}"#] {
            assert!(serde_json::from_str::<Request>(bad).is_err());
        }
        let root = std::env::temp_dir().join(format!("agents-{}", crate::shared::ids::make_bundle_id()));
        std::fs::create_dir(&root).unwrap();
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o700)).unwrap();
        let config = root.join("config.json");
        std::fs::write(&config, r#"{"secret":"keep","experiments":{"other":true}}"#).unwrap();
        let places = Places { target: Some(root.join("Apparent.app/Contents/MacOS/apparent")), install: vec![root.join("bin")], also: vec![] };
        let deadline = storage_clock_ms() + 3000;
        let read = Request::Read { deadline };
        assert_eq!(read.execute_in(&config, deadline, &places)["agents"]["agentDemoVideo"], true);
        let set = Request::Demo { enabled: false, deadline };
        assert_eq!(set.execute_in(&config, deadline, &places)["agents"]["agentDemoVideo"], false);
        let raw: Value = serde_json::from_slice(&std::fs::read(&config).unwrap()).unwrap();
        assert_eq!(raw["secret"], "keep"); assert_eq!(raw["experiments"]["other"], true);
        assert_eq!(set.execute_in(&config, 0, &places)["error"], "admission_expired");
        std::fs::create_dir(root.join("bin")).unwrap();
        let foreign = root.join("bin/apparent");
        std::fs::write(&foreign, "foreign").unwrap();
        assert_eq!(Request::Install { deadline }.execute_in(&config, deadline, &places)["error"], "cli_change_failed");
        Request::Uninstall { deadline }.execute_in(&config, deadline, &places);
        assert_eq!(std::fs::read_to_string(&foreign).unwrap(), "foreign");
        std::fs::remove_file(&foreign).unwrap();
        let target = places.target.as_ref().unwrap();
        std::fs::create_dir_all(target.parent().unwrap()).unwrap();
        std::fs::write(target, "fixture executable").unwrap();
        assert_eq!(Request::Install { deadline }.execute_in(&config, deadline, &places)["agents"]["cli"], "installed");
        assert_eq!(Request::Uninstall { deadline }.execute_in(&config, deadline, &places)["agents"]["cli"], "missing");
        assert!(!foreign.exists());
        std::fs::write(&config, "broken").unwrap();
        assert_eq!(set.execute_in(&config, deadline, &places)["error"], "config_write_failed");
        assert_eq!(std::fs::read_to_string(&config).unwrap(), "broken");
        // Valid JSON with a malformed nested preference must fail without
        // replacing the file or killing the shared Settings worker.
        for malformed in [r#"{"experiments":false}"#, r#"{"experiments":null}"#, r#"{"experiments":[]}"#] {
            std::fs::write(&config, malformed).unwrap();
            let metadata = std::fs::metadata(&config).unwrap();
            assert_eq!(set.execute_in(&config, storage_clock_ms() + 3000, &places)["error"], "config_write_failed");
            assert_eq!(std::fs::read_to_string(&config).unwrap(), malformed);
            use std::os::unix::fs::MetadataExt;
            assert_eq!(std::fs::metadata(&config).unwrap().ino(), metadata.ino());
        }
        std::fs::remove_dir_all(root).unwrap();
    }
}
