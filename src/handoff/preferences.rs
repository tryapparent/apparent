//! Desktop preference schema policy, tolerant parsing and effective read timing.
use super::AGENT_DEMO_VIDEO;
use super::{Config, config_store, default_config_path, update_config_in};
use anyhow::{Context, Result};
use serde::Deserialize;
use std::path::{Path, PathBuf};

impl Config {
    pub fn warm_recognizer_enabled(&self) -> bool {
        self.warm_recognizer.unwrap_or(true)
    }

    /// The output volume while recording when `lowerPlayback` is on, in percent of what it was.
    pub fn recording_volume(&self) -> u8 {
        self.playback_level.unwrap_or(20).min(100)
    }
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RoutingConfig {
    /// The checkout each app is built from, by bundle ID or a prefix of one
    /// (`{"ai.opencode.desktop": "~/code/opencode"}`), for apps whose checkout isn't named like
    /// them.
    #[serde(default)]
    pub apps: std::collections::BTreeMap<String, String>,
    /// The folder a URL prefix serves, for file servers whose pages aren't their own project's
    /// (`{"https://studio.example.ts.net:8444/raw/": "~/code/home/artifacts"}`).
    #[serde(default)]
    pub servers: std::collections::BTreeMap<String, String>,
}

/// `true`/`false`, `"yes"`/`"on"`/`"1"` and their opposites, or a number (non-zero is on). Other
/// values are skipped and logged once, as is an `experiments` that isn't an object.
pub(super) fn lenient_experiments<'de, D>(
    deserializer: D,
) -> std::result::Result<std::collections::BTreeMap<String, bool>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde_json::Value;
    let value = Value::deserialize(deserializer)?;
    let mut out = std::collections::BTreeMap::new();
    let Value::Object(map) = value else {
        if !value.is_null() {
            log_config_once(format!(
                "config.json: ignoring \"experiments\": {value} (expected an object)"
            ));
        }
        return Ok(out);
    };
    for (name, value) in map {
        let on = match &value {
            Value::Bool(b) => Some(*b),
            Value::Number(n) => n.as_f64().map(|n| n != 0.0),
            Value::String(s) => match s.trim().to_ascii_lowercase().as_str() {
                "true" | "yes" | "on" | "1" => Some(true),
                "false" | "no" | "off" | "0" | "" => Some(false),
                _ => None,
            },
            _ => None,
        };
        match on {
            Some(on) => {
                out.insert(name, on);
            }
            None => log_config_once(format!(
                "config.json: ignoring experiment \"{name}\": {value} (expected true or false)"
            )),
        }
    }
    Ok(out)
}

/// Config problems are logged once per process, not on every read.
pub(super) fn log_config_once(message: String) {
    static SEEN: std::sync::Mutex<Vec<String>> = std::sync::Mutex::new(Vec::new());
    let mut seen = SEEN
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    if !seen.contains(&message) {
        crate::capture::apparent_log(&message);
        seen.push(message);
    }
}

/// More of what Apparent already knows in the summary: marks, shortcuts, drags and windows inline
/// at their time, numbered marks on shared frames, where a screen changed.
pub const AGENT_CONTEXT: &str = "agentContext";

/// Transcribe Mac recordings while they record, so finishing only waits for the last words
/// (`live_transcribe`).
pub const LIVE_TRANSCRIBE: &str = "liveTranscribe";

static EXPERIMENT_OVERRIDES: std::sync::Mutex<Vec<String>> = std::sync::Mutex::new(Vec::new());

/// Turns an experiment on for this process (`apparent reprocess --experiment <name>`).
pub fn enable_experiment(name: &str) {
    EXPERIMENT_OVERRIDES
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .push(name.to_owned());
}

/// Whether an experiment is on: `"experiments": {"<name>": true}` in `config.json`, or
/// `enable_experiment` in this process. Off by default; tests see only `enable_experiment`.
pub fn experiment(name: &str) -> bool {
    let overridden = EXPERIMENT_OVERRIDES
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .iter()
        .any(|n| n == name);
    if overridden || cfg!(test) {
        return overridden;
    }
    experiment_enabled_in(&config(), name)
}

/// Most experiments are opt-in. This one is on unless explicitly disabled.
pub(crate) fn experiment_enabled_in(config: &Config, name: &str) -> bool {
    config
        .experiments
        .get(name)
        .copied()
        .unwrap_or(name == AGENT_DEMO_VIDEO)
}

pub fn load_config_from(path: &Path) -> Config {
    config_store::read_value_from(path)
        .ok()
        .map(config_from_value)
        .unwrap_or_default()
}

/// The config in `value`. A key whose value doesn't fit (`"autoSend": "maybe"`) is dropped and
/// logged on its own, so one bad setting never resets the others to their defaults.
fn config_from_value(value: serde_json::Value) -> Config {
    let serde_json::Value::Object(map) = value else {
        return Config::default();
    };
    if let Ok(config) = serde_json::from_value(serde_json::Value::Object(map.clone())) {
        return config;
    }
    // Add keys one at a time, keeping each only if everything so far still reads.
    let mut kept = serde_json::Map::new();
    for (key, value) in map {
        kept.insert(key.clone(), value.clone());
        if let Err(error) =
            serde_json::from_value::<Config>(serde_json::Value::Object(kept.clone()))
        {
            kept.remove(&key);
            log_config_once(format!("config.json: ignoring \"{key}\": {error}"));
        }
    }
    serde_json::from_value(serde_json::Value::Object(kept)).unwrap_or_default()
}

pub(super) fn config() -> Config {
    load_config_from(&default_config_path())
}

/// Read at recording start; edits never interrupt an active capture. Tests use defaults.
pub fn warm_recognizer() -> bool {
    if cfg!(test) {
        Config::default().warm_recognizer_enabled()
    } else {
        config().warm_recognizer_enabled()
    }
}

/// `routing.apps` from config.json, `~` expanded. Tests see none.
pub fn routing_apps() -> Vec<(String, PathBuf)> {
    routing_paths(|routing| routing.apps)
}

/// `routing.servers` in config.json: URL prefixes and the folders they serve, `~` expanded.
pub fn routing_servers() -> Vec<(String, PathBuf)> {
    routing_paths(|routing| routing.servers)
}

fn routing_paths(
    pick: fn(RoutingConfig) -> std::collections::BTreeMap<String, String>,
) -> Vec<(String, PathBuf)> {
    if cfg!(test) {
        return Vec::new();
    }
    let home = dirs::home_dir().unwrap_or_default();
    config()
        .routing
        .map(pick)
        .unwrap_or_default()
        .into_iter()
        .map(|(id, path)| {
            let path = match path.strip_prefix("~/") {
                Some(rest) => home.join(rest),
                None => PathBuf::from(path),
            };
            (id, path)
        })
        .collect()
}

/// Whether Mac captures of a dev site go straight to its session (`autoSend`, default on).
pub fn auto_send() -> bool {
    config().auto_send.unwrap_or(true)
}

/// Whether the menu offers video export (`videoExport`, default off). `apparent export` works
/// either way.
pub fn video_export() -> bool {
    config().video_export.unwrap_or(false)
}

/// The configured transcriber name (`transcriber`) as written, unvalidated.
pub fn transcriber() -> Option<String> {
    config().transcriber
}

/// The configured Hex model id (`hexModel`), if any.
pub fn hex_model() -> Option<String> {
    config()
        .hex_model
        .map(|model| model.trim().to_owned())
        .filter(|model| !model.is_empty())
}

/// The configured Hex language, defaulting to the previous English behavior.
pub fn hex_language() -> String {
    hex_language_from(&config())
}

pub fn hex_language_from(config: &Config) -> String {
    config
        .hex_language
        .as_deref()
        .and_then(crate::hex::language_code)
        .unwrap_or_else(|| crate::hex::DEFAULT_LANGUAGE.into())
}

/// The configured Apple Speech locale, or the Mac's own language when unset.
pub fn apple_locale() -> Option<String> {
    apple_locale_from(&config())
}

pub fn apple_locale_from(config: &Config) -> Option<String> {
    config
        .apple_locale
        .as_deref()
        .and_then(crate::speech_model::locale_id)
}

/// The command transcriber's program (`transcribeCommand`, `transcribeTimeoutSeconds`), read
/// on its own from the config file.
pub fn transcribe_command()
-> Result<crate::command_transcriber::Program, crate::command_transcriber::Unusable> {
    crate::command_transcriber::Program::load_from(&default_config_path())
}

/// Whether the native AppKit + Metal recording pill is enabled (`APPARENT_NATIVE_PILL` or
/// `nativePill` in `config.json`, default `true`). macOS only: elsewhere the GPUI capsule draws.
pub fn native_pill() -> bool {
    if cfg!(not(target_os = "macos")) {
        return false;
    }
    if let Ok(val) = std::env::var("APPARENT_NATIVE_PILL") {
        let s = val.trim().to_ascii_lowercase();
        if matches!(s.as_str(), "0" | "false" | "gpui" | "off" | "no") {
            return false;
        }
        if matches!(s.as_str(), "1" | "true" | "native" | "metal" | "on" | "yes") {
            return true;
        }
    }
    config().native_pill.unwrap_or(true)
}

/// Configured capsule style (`pillStyle` in `config.json`, default `"black"`).
pub fn pill_style() -> crate::native::pill::PillStyle {
    config()
        .pill_style
        .as_deref()
        .and_then(crate::native::pill::PillStyle::from_str_opt)
        .unwrap_or(crate::native::pill::PillStyle::Black)
}

/// Change one experiment without replacing unrelated flags or secret-bearing config keys.
pub(crate) fn set_experiment_in(path: &Path, name: &str, on: bool) -> Result<()> {
    update_config_in(path, |config| {
        let experiments = config
            .as_object_mut()
            .unwrap()
            .entry("experiments")
            .or_insert_with(|| serde_json::json!({}));
        let experiments = experiments
            .as_object_mut()
            .with_context(|| format!("Invalid experiments at {}", path.display()))?;
        experiments.insert(name.to_owned(), on.into());
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::super::{set_config_value_in, test_support::Fixture};
    use super::*;
    use std::fs;
    #[test]
    fn apple_locale_round_trips_and_keeps_other_keys() {
        let fixture = Fixture::new();
        let path = fixture.0.join("config.json");
        fs::write(&path, br#"{"ingestToken":"abc","autoSend":false}"#).unwrap();
        let config = load_config_from(&path);
        assert_eq!(apple_locale_from(&config), None);
        assert_eq!(config.auto_send, Some(false));

        for (value, expected) in [
            ("zh-TW".into(), Some("zh-TW")),
            ("bad value".into(), None),
            (5.into(), None),
            (serde_json::Value::Null, None),
        ] {
            set_config_value_in(&path, "appleLocale", value).unwrap();
            let config = load_config_from(&path);
            assert_eq!(apple_locale_from(&config).as_deref(), expected);
            assert_eq!(
                serde_json::from_slice::<serde_json::Value>(&fs::read(&path).unwrap()).unwrap()["ingestToken"],
                "abc"
            );
            assert_eq!(config.auto_send, Some(false));
        }
        let raw: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert!(raw.get("appleLocale").is_none());
    }

    #[test]
    fn transcriber_preference_round_trips_and_keeps_other_keys() {
        let fixture = Fixture::new();
        let path = fixture.0.join("config.json");
        fs::write(&path, br#"{"ingestToken":"abc","autoSend":false}"#).unwrap();
        let config = load_config_from(&path);
        assert_eq!((&config.transcriber, &config.hex_model), (&None, &None));
        assert_eq!(hex_language_from(&config), "en");
        set_config_value_in(&path, "transcriber", "hex".into()).unwrap();
        set_config_value_in(&path, "hexModel", "parakeet_v3".into()).unwrap();
        set_config_value_in(&path, "hexLanguage", "nl".into()).unwrap();
        let config = load_config_from(&path);
        assert_eq!(config.transcriber.as_deref(), Some("hex"));
        assert_eq!(config.hex_model.as_deref(), Some("parakeet_v3"));
        assert_eq!(hex_language_from(&config), "nl");
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&fs::read(&path).unwrap()).unwrap()["ingestToken"],
            "abc"
        );
        assert_eq!(config.auto_send, Some(false));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(&path).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o600);
        }
    }

    #[test]
    fn malformed_command_keys_never_reset_the_rest_of_the_config() {
        let fixture = Fixture::new();
        let path = fixture.0.join("config.json");
        fs::write(
            &path,
            br#"{"transcriber":"command","autoSend":false,"transcribeCommand":"whisper {audio}","transcribeTimeoutSeconds":"soon"}"#,
        )
        .unwrap();
        let config = load_config_from(&path);
        assert_eq!(config.transcriber.as_deref(), Some("command"));
        assert_eq!(config.auto_send, Some(false));
    }

    #[test]
    fn auto_send_defaults_on_and_the_toggle_keeps_other_keys() {
        let fixture = Fixture::new();
        let path = fixture.0.join("config.json");
        fs::write(
            &path,
            br#"{"ingestToken":"abc","retention":{"mediaDays":7}}"#,
        )
        .unwrap();
        assert_eq!(load_config_from(&path).auto_send, None);
        set_config_value_in(&path, "autoSend", serde_json::Value::Bool(false)).unwrap();
        let config = load_config_from(&path);
        assert_eq!(config.auto_send, Some(false));
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&fs::read(&path).unwrap()).unwrap()["ingestToken"],
            "abc"
        );
        let raw: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(raw["retention"]["mediaDays"], 7);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
    }

    #[test]
    fn warm_recognizer_defaults_on_and_config_can_disable_it() {
        let fixture = Fixture::new();
        let path = fixture.0.join("config.json");
        assert!(load_config_from(&path).warm_recognizer_enabled());
        fs::write(&path, br#"{"unrelated":"kept","autoSend":false}"#).unwrap();
        assert!(load_config_from(&path).warm_recognizer_enabled());
        set_config_value_in(&path, "warmRecognizer", false.into()).unwrap();
        let config = load_config_from(&path);
        assert!(!config.warm_recognizer_enabled());
        assert_eq!(config.auto_send, Some(false));
        let raw: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(raw["unrelated"], "kept");
        set_config_value_in(&path, "warmRecognizer", true.into()).unwrap();
        assert!(load_config_from(&path).warm_recognizer_enabled());
        // An invalid value drops only this key, leaving the default and other settings.
        fs::write(&path, br#"{"warmRecognizer":"off","autoSend":false}"#).unwrap();
        let config = load_config_from(&path);
        assert!(config.warm_recognizer_enabled());
        assert_eq!(config.auto_send, Some(false));
        // The retired experiment cannot override an explicit top-level opt-out.
        fs::write(
            &path,
            br#"{"warmRecognizer":false,"experiments":{"warmRecognizer":true}}"#,
        )
        .unwrap();
        assert!(!load_config_from(&path).warm_recognizer_enabled());
    }

    #[test]
    fn video_export_flag_defaults_off() {
        let fixture = Fixture::new();
        let path = fixture.0.join("config.json");
        fs::write(&path, br#"{"autoSend":false}"#).unwrap();
        assert_eq!(load_config_from(&path).video_export, None);
        fs::write(&path, br#"{"videoExport":true}"#).unwrap();
        assert_eq!(load_config_from(&path).video_export, Some(true));
    }

    #[test]
    fn config_defaults_when_missing_or_minimal() {
        let fixture = Fixture::new();
        let missing = fixture.0.join("missing.json");
        let cfg = load_config_from(&missing);
        assert_eq!(cfg, Config::default());
    }
    #[test]
    fn one_bad_setting_never_resets_the_others() {
        let fixture = Fixture::new();
        let path = fixture.0.join("config.json");
        fs::write(
            &path,
            r#"{"agentHost": "studio", "autoSend": "maybe", "usbApps": "not-a-list", "videoExport": true, "nativePill": 3, "pillStyle": "glass", "unknown": {"x": 1}}"#,
        )
        .unwrap();
        let cfg = load_config_from(&path);
        assert_eq!(cfg.agent_host.as_deref(), Some("studio"));
        assert_eq!(cfg.video_export, Some(true));
        assert_eq!(cfg.pill_style.as_deref(), Some("glass"));
        assert_eq!(cfg.auto_send, None);
        assert_eq!(cfg.native_pill, None);
    }

    #[test]
    fn experiments_are_read_from_config_and_off_by_default() {
        let fixture = Fixture::new();
        let path = fixture.0.join("config.json");
        fs::write(
            &path,
            r#"{"experiments": {"agentContext": true, "other": false}}"#,
        )
        .unwrap();
        let cfg = load_config_from(&path);
        assert_eq!(cfg.experiments.get(AGENT_CONTEXT), Some(&true));
        assert_eq!(cfg.experiments.get("other"), Some(&false));
        assert!(Config::default().experiments.is_empty());
        // A bad value skips that experiment, never the file.
        fs::write(
            &path,
            r#"{"autoSend": false, "experiments": {"agentContext": "yes", "a": 1, "b": "maybe", "c": [1], "d": "off"}}"#,
        )
        .unwrap();
        let cfg = load_config_from(&path);
        assert_eq!(cfg.auto_send, Some(false));
        assert_eq!(cfg.experiments.get(AGENT_CONTEXT), Some(&true));
        assert_eq!(cfg.experiments.get("a"), Some(&true));
        assert_eq!(cfg.experiments.get("d"), Some(&false));
        assert!(!cfg.experiments.contains_key("b") && !cfg.experiments.contains_key("c"));
        fs::write(&path, r#"{"autoSend": false, "experiments": true}"#).unwrap();
        let cfg = load_config_from(&path);
        assert_eq!(cfg.auto_send, Some(false));
        assert!(cfg.experiments.is_empty());
        // Tests never read Kit's config, only what this process turned on.
        assert!(!experiment("neverEnabled"));
        enable_experiment("enabledForThisTest");
        assert!(experiment("enabledForThisTest"));
    }
    #[test]
    fn demo_video_setting_preserves_other_experiments_and_rejects_bad_config() {
        let fixture = Fixture::new();
        let path = fixture.0.join("config.json");
        assert!(experiment_enabled_in(
            &load_config_from(&path),
            AGENT_DEMO_VIDEO
        ));
        fs::write(
            &path,
            r#"{"ingestToken":"private","experiments":{"other":true}}"#,
        )
        .unwrap();
        assert!(experiment_enabled_in(
            &load_config_from(&path),
            AGENT_DEMO_VIDEO
        ));
        set_experiment_in(&path, AGENT_DEMO_VIDEO, true).unwrap();
        let raw: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(raw["ingestToken"], "private");
        assert_eq!(raw["experiments"]["other"], true);
        assert_eq!(
            load_config_from(&path).experiments.get(AGENT_DEMO_VIDEO),
            Some(&true)
        );
        set_experiment_in(&path, AGENT_DEMO_VIDEO, false).unwrap();
        assert_eq!(
            load_config_from(&path).experiments.get(AGENT_DEMO_VIDEO),
            Some(&false)
        );
        assert!(!experiment_enabled_in(
            &load_config_from(&path),
            AGENT_DEMO_VIDEO
        ));
        fs::write(&path, b"{").unwrap();
        assert!(set_experiment_in(&path, AGENT_DEMO_VIDEO, true).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"{");
    }
}
