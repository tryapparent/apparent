#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Pane {
    General,
    Recording,
    Handoff,
    Storage,
    Permissions,
    Agents,
    Labs,
    About,
}

fn handoff_auto_paste_state(path: &Path) -> anyhow::Result<bool> {
    use crate::shared::preferences::{preference, preference_value, read_preferences};
    let config = read_preferences(path)?;
    let saved = preference_value(&config, "labs.autoPasteDraft");
    Ok(saved.as_ref().and_then(serde_json::Value::as_bool).unwrap_or_else(|| {
        preference("labs.autoPasteDraft").is_some_and(|entry| entry["default"] == true)
    }))
}

pub(super) fn handoff_auto_paste(path: &Path, request: u32, enabled: Option<bool>) -> serde_json::Value {
    let result = (|| {
        if let Some(enabled) = enabled {
            crate::shared::handoff::write_preference(path, "labs.autoPasteDraft", Some(enabled.into()))?;
        }
        handoff_auto_paste_state(path)
    })();
    serde_json::json!({"type":"handoff-auto-paste-result","request":request,"enabled":result.ok()})
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(tag = "action", rename_all = "kebab-case")]
pub enum Action {
    Navigate { pane: Pane },
    AgentsPreference { request: u32, enabled: Option<bool>, #[serde(default)] setting: Option<String> },
    HandoffAutoPaste { request: u32, enabled: Option<bool> },
    AgentsConnection { request: u32, connection: Option<super::agents::Connection>, #[serde(default)] disconnect: Option<String> },
    LabsPreference { request: u32, enabled: Option<bool>, setting: Option<String>, wardrobe: Option<super::super::frog_wardrobe::Request> },
    RecordingPreference { request: u32, key: String, value: serde_json::Value },
    RecordingMeter { visible: bool },
    PermissionAction { request: u32, intent: PermissionIntent },
    Set {
        key: String,
        value: serde_json::Value,
    },
    RecordShortcut {
        kind: ShortcutKind,
    },
    Shortcut {
        kind: ShortcutKind,
        #[serde(flatten)]
        pressed: Pressed,
    },
    CancelShortcut,
    ResetShortcut {
        kind: ShortcutKind,
    },
    ClearShortcut {
        kind: ShortcutKind,
    },
    Grant {
        permission: Permission,
    },
    Reopen,
    CheckForUpdates,
    DismissUpdateCheck,
    UpdateNow,
    UpdateLater,
    Tour,
    InstallCli,
    UninstallCli,
    ConnectHosted,
    ManageSharedLinks,
    Close,
}


#[cfg(test)]
mod handoff_settings_tests {
    #[test]
    fn handoff_auto_paste_reads_existing_opt_outs() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("config.json");
        let request = |enabled| super::handoff_auto_paste(&path, 1, enabled);
        assert_eq!(request(None)["enabled"], true);
        for config in [
            r#"{"experiments":{"autoPasteDraft":false,"other":true}}"#,
            r#"{"labs":{"autoPasteDraft":false},"experiments":{"other":true}}"#,
        ] {
            std::fs::write(&path, config).unwrap();
            assert_eq!(request(None)["enabled"], false);
            assert_eq!(request(Some(true))["enabled"], true);
            let saved: serde_json::Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
            assert_eq!(saved["experiments"]["other"], true);
        }
    }
}
