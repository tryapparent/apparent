pub(crate) mod clock;
pub(crate) mod handoff;
pub(crate) mod hex;
pub(crate) mod ids;
pub(crate) mod model;
pub(crate) mod routing;
pub(crate) mod windows;

pub(crate) mod preferences {
    use std::{fs, path::Path};
    use anyhow::{Result, ensure};
    use serde_json::{Value, json};

    pub(crate) fn preferences() -> &'static [Value] {
        static CATALOG: std::sync::OnceLock<Vec<Value>> = std::sync::OnceLock::new();
        CATALOG.get_or_init(|| {
            serde_json::from_str(include_str!(concat!(env!("OUT_DIR"), "/settings-catalog.json")))
                .expect("valid Settings catalog")
        })
    }

    pub(crate) fn preference(id: &str) -> Option<&'static Value> {
        preferences().iter().find(|entry| entry["id"] == id)
    }

    fn leaf<'a>(config: &'a Value, id: &str) -> Option<&'a Value> {
        id.split('.').try_fold(config, |object, name| object.get(name))
    }

    fn decode_legacy(entry: &Value, value: &Value) -> Option<Value> {
        let legacy = &entry["legacy"];
        let invert = legacy["invert"] == true;
        if invert || legacy["lenient"] == true {
            experiment_boolean(value).map(|on| Value::Bool(on ^ invert))
        } else {
            valid(entry, value).then(|| value.clone())
        }
    }

    pub(crate) fn preference_value(config: &Value, id: &str) -> Option<Value> {
        preference_state(config, id).0
    }

    pub(crate) fn preference_state(config: &Value, id: &str) -> (Option<Value>, &'static str) {
        let Some(entry) = preference(id) else { return (None, "default") };
        if let Some((pane, _)) = id.split_once('.') && config.get(pane).is_some_and(|pane| !pane.is_object()) {
            return (None, "invalid");
        }
        let legacy = &entry["legacy"];
        let old_value = legacy["path"].as_str().and_then(|path| leaf(config, path));
        if let Some(value) = leaf(config, id) {
            if !valid(entry, value) {
                return (None, "invalid");
            }
            let old_app_edited = config["settingsCompatibility"].get(id).is_some_and(|expected| {
                Some(expected) != old_value && decode_legacy(entry, expected).as_ref() == Some(value)
            });
            if !old_app_edited {
                return (Some(value.clone()), "explicit");
            }
        }
        let Some(value) = old_value else { return (None, "default") };
        let value = decode_legacy(entry, value);
        if value.is_some() { (value, "legacy") } else { (None, "invalid") }
    }

    #[cfg(target_os = "linux")]
    pub(crate) fn check_legacy_readback(config: &Value) -> Result<()> {
        for entry in preferences() {
            let id = entry["id"].as_str().unwrap();
            if leaf(config, id).is_none() { continue }
            let Some(path) = entry["legacy"]["path"].as_str() else { continue };
            let previous = leaf(config, path).and_then(|value| decode_legacy(entry, value));
            let (current, source) = preference_state(config, id);
            ensure!(source != "invalid" && current == previous,
                "Re-save {id} with apparent settings before installing or restarting an update");
        }
        Ok(())
    }

    pub(crate) fn read_preference(path: &Path, id: &str) -> Option<Value> {
        preference_value(&read_preferences(path).ok()?, id)
    }

    pub(crate) fn read_preferences(path: &Path) -> Result<Value> {
        let value: Value = match fs::read(path) {
            Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| anyhow::anyhow!("Invalid Settings file"))?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => json!({}),
            Err(error) => return Err(error.into()),
        };
        ensure!(value.is_object(), "Settings file must be an object");
        Ok(value)
    }

    pub(crate) fn valid(entry: &Value, value: &Value) -> bool {
        if value.is_null() {
            return entry["nullable"] == true;
        }
        let typed = match entry["kind"].as_str() {
            Some("boolean") => value.is_boolean(),
            Some("string") => value.is_string(),
            Some("integer") => value.is_i64() || value.is_u64(),
            Some("number") => value.is_number(),
            Some("object") => value.is_object(),
            _ => false,
        };
        typed
            && entry["choices"].as_array().is_none_or(|options| options.contains(value))
            && value.as_f64().is_none_or(|n| {
                entry["min"].as_f64().is_none_or(|min| n >= min)
                    && entry["max"].as_f64().is_none_or(|max| n <= max)
            })
    }

    pub(crate) fn experiment_boolean(value: &Value) -> Option<bool> {
        match value {
            Value::Bool(on) => Some(*on),
            Value::Number(n) => n.as_f64().map(|n| n != 0.0),
            Value::String(s) => match s.trim().to_ascii_lowercase().as_str() {
                "true" | "yes" | "on" | "1" => Some(true),
                "false" | "no" | "off" | "0" | "" => Some(false),
                _ => None,
            },
            _ => None,
        }
    }

    #[cfg(test)]
    #[test]
    fn compatibility_writes_preserve_opt_outs_and_accept_older_app_changes() {
        use crate::shared::handoff::edit_preference;

        let id = "general.errorReporting";
        let mut config = json!({"other": "keep"});
        edit_preference(&mut config, id, Some(false.into())).unwrap();
        assert_eq!(config["errorReporting"], false);
        assert_eq!(config["general"]["errorReporting"], false);
        assert_eq!(preference_state(&config, id), (Some(false.into()), "explicit"));
        config["errorReporting"] = true.into();
        assert_eq!(preference_state(&config, id), (Some(true.into()), "legacy"));
        edit_preference(&mut config, id, None).unwrap();
        assert_eq!(preference_state(&config, id), (None, "default"));
        assert_eq!(config["other"], "keep");
    }

    #[cfg(test)]
    #[test]
    fn compatibility_round_trips_inverted_picker_and_null_retention() {
        use crate::shared::handoff::edit_preference;

        let picker = "permissions.skipScreenSelection";
        let retention = "storage.mediaDays";
        let mut config = json!({});
        edit_preference(&mut config, picker, Some(true.into())).unwrap();
        edit_preference(&mut config, retention, Some(Value::Null)).unwrap();
        assert_eq!(config["experiments"]["chooseScreenEachTime"], false);
        assert_eq!(config["retention"].get("mediaDays"), Some(&Value::Null));
        config["experiments"]["chooseScreenEachTime"] = true.into();
        config["retention"]["mediaDays"] = 21.into();
        assert_eq!(preference_value(&config, picker), Some(false.into()));
        assert_eq!(preference_value(&config, retention), Some(21.into()));
        config["permissions"]["skipScreenSelection"] = json!("invalid");
        assert_eq!(preference_state(&config, picker), (None, "invalid"));
    }

    #[cfg(all(test, target_os = "linux"))]
    #[test]
    fn updater_refuses_stale_legacy_opt_out_until_it_is_resaved() {
        use crate::shared::handoff::edit_preference;

        let id = "general.errorReporting";
        let mut config = json!({"general": {"errorReporting": false}, "errorReporting": true});
        assert!(check_legacy_readback(&config).is_err());
        edit_preference(&mut config, id, Some(false.into())).unwrap();
        assert!(check_legacy_readback(&config).is_ok());
    }
}
