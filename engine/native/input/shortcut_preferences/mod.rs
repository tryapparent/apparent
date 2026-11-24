#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Shortcuts {
    pub record: ShortcutConfig,
    pub paste: ShortcutConfig,
}

impl Default for Shortcuts {
    fn default() -> Self {
        Self {
            record: ShortcutConfig::default_record(),
            paste: ShortcutConfig::default_paste(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Stored {
    key_code: u32,
    modifiers: u32,
    label: String,
}

impl Shortcuts {
    pub fn get(&self, kind: ShortcutKind) -> &ShortcutConfig {
        match kind {
            ShortcutKind::Record => &self.record,
            ShortcutKind::Paste => &self.paste,
        }
    }

    fn set(&mut self, kind: ShortcutKind, cfg: ShortcutConfig) {
        match kind {
            ShortcutKind::Record => self.record = cfg,
            ShortcutKind::Paste => self.paste = cfg,
        }
    }

    pub fn load() -> Self {
        let path = crate::shared::handoff::default_config_path();
        let legacy = legacy_path();
        let (shortcuts, migrated) = Self::load_from(&path, &legacy);
        if migrated && save_shortcut_in(&path, ShortcutKind::Record, &shortcuts.record).is_ok() {
            let _ = std::fs::remove_file(&legacy);
        }
        if let Some(record) = desktop_record(&path) {
            return Self {
                record,
                ..shortcuts
            };
        }
        shortcuts
    }

    pub fn load_from(path: &Path, legacy: &Path) -> (Self, bool) {
        Self::from_config(&read_json(path), legacy)
    }

    fn from_config(config: &serde_json::Value, legacy: &Path) -> (Self, bool) {
        use crate::shared::handoff::preference_state;
        let mut shortcuts = Self::default();
        if crate::shared::handoff::is_nightly() {
            shortcuts.record = ShortcutConfig::unset();
        }
        let mut configured = config.get("shortcuts").is_some();
        for kind in ShortcutKind::ALL {
            let (value, source) = preference_state(config, shortcut_preference(kind));
            configured |= source != "default";
            if kind.can_unset() && value.as_ref().is_some_and(serde_json::Value::is_null) {
                shortcuts.set(kind, ShortcutConfig::unset());
            } else if let Some(cfg) = value
                .and_then(|value| serde_json::from_value::<Stored>(value).ok())
                .and_then(|s| from_stored(kind, s))
            {
                shortcuts.set(kind, cfg);
            }
        }
        if configured {
            return (shortcuts, false);
        }
        let old = read_json(legacy);
        let old = (
            old.get("key_code").and_then(serde_json::Value::as_u64),
            old.get("carbon_modifiers")
                .and_then(serde_json::Value::as_u64),
            old.get("label").and_then(serde_json::Value::as_str),
        );
        if let (Some(key_code), Some(modifiers), Some(label)) = old
            && let Some(cfg) = from_stored(
                ShortcutKind::Record,
                Stored {
                    key_code: key_code as u32,
                    modifiers: modifiers as u32,
                    label: label.to_owned(),
                },
            )
            && !cfg.is_default_for(ShortcutKind::Record)
            && cfg.label != "⌃⌥⇧S"
        {
            shortcuts.record = cfg;
            return (shortcuts, true);
        }
        (shortcuts, false)
    }
}

fn legacy_path() -> PathBuf {
    crate::shared::handoff::builtin_captures_dir()
        .parent()
        .map_or_else(|| PathBuf::from("."), Path::to_path_buf)
        .join("config.json")
}

fn shortcut_preference(kind: ShortcutKind) -> &'static str {
    match kind {
        ShortcutKind::Record => "general.recordShortcut",
        ShortcutKind::Paste => "general.pasteShortcut",
    }
}

fn from_stored(kind: ShortcutKind, stored: Stored) -> Option<ShortcutConfig> {
    let cfg = ShortcutConfig {
        key_code: stored.key_code,
        carbon_modifiers: stored.modifiers,
        label: stored.label,
    };
    if cfg.label.is_empty() || cfg.key_label().is_empty() {
        return None;
    }
    Some(if cfg.is_default_for(kind) {
        kind.default_config()
    } else {
        cfg
    })
}

fn read_json(path: &Path) -> serde_json::Value {
    std::fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
        .filter(serde_json::Value::is_object)
        .unwrap_or_else(|| serde_json::json!({}))
}

pub fn save_shortcut(kind: ShortcutKind, cfg: &ShortcutConfig) {
    if let Err(error) = save_shortcut_in(&crate::shared::handoff::default_config_path(), kind, cfg)
    {
        crate::capture::engine::runtime::apparent_log(format!(
            "Saving the {kind:?} shortcut failed: {error:#}"
        ));
    }
}

pub fn save_shortcut_in(
    path: &Path,
    kind: ShortcutKind,
    cfg: &ShortcutConfig,
) -> anyhow::Result<()> {
    #[cfg(target_os = "linux")]
    let app_owned = kind == ShortcutKind::Record
        && crate::capture::desktop::linux::hyprland::external_record().is_some();
    #[cfg(not(target_os = "linux"))]
    let app_owned = kind == ShortcutKind::Record && crate::shared::handoff::is_nightly();
    save_shortcut_in_with(path, kind, cfg, |config| {
        app_owned
            || (cfg!(target_os = "linux")
                && kind == ShortcutKind::Record
                && prefers_app_shortcut(config))
    })
}

#[cfg(test)]
fn save_shortcut_source_in(
    path: &Path,
    kind: ShortcutKind,
    cfg: &ShortcutConfig,
    app_owned: bool,
) -> anyhow::Result<()> {
    save_shortcut_in_with(path, kind, cfg, |_| app_owned)
}

fn save_shortcut_in_with(
    path: &Path,
    kind: ShortcutKind,
    cfg: &ShortcutConfig,
    app_owned: impl FnOnce(&serde_json::Value) -> bool,
) -> anyhow::Result<()> {
    crate::shared::handoff::update_config_in(path, |config| {
        let app_owned = app_owned(config);
        edit_shortcut(config, kind, cfg, app_owned)
    })
}

fn edit_shortcut(
    config: &mut serde_json::Value,
    kind: ShortcutKind,
    cfg: &ShortcutConfig,
    app_owned: bool,
) -> anyhow::Result<()> {
    let value = if cfg.is_default_for(kind) && !app_owned {
        None
    } else if cfg.is_unset() {
        anyhow::ensure!(
            kind.can_unset(),
            "the {kind:?} shortcut can't be turned off"
        );
        Some(serde_json::Value::Null)
    } else {
        let mut value = configured_shortcut(cfg)?;
        if app_owned {
            value["source"] = "app".into();
        }
        Some(value)
    };
    if !config["shortcuts"].is_object() {
        config["shortcuts"] = serde_json::json!({});
    }
    crate::shared::handoff::edit_preference(config, shortcut_preference(kind), value)
}

fn configured_shortcut(cfg: &ShortcutConfig) -> serde_json::Result<serde_json::Value> {
    serde_json::to_value(Stored {
        key_code: cfg.key_code,
        modifiers: cfg.carbon_modifiers,
        label: cfg.label.clone(),
    })
}

fn prefers_app_shortcut(config: &serde_json::Value) -> bool {
    let Some(value) =
        crate::shared::handoff::preference_value(config, shortcut_preference(ShortcutKind::Record))
    else {
        return false;
    };
    value.get("source").and_then(serde_json::Value::as_str) == Some("app")
        && serde_json::from_value::<Stored>(value)
            .ok()
            .and_then(|stored| from_stored(ShortcutKind::Record, stored))
            .is_some_and(|cfg| {
                cfg.key_code <= 255
                    && (cfg.carbon_modifiers
                        & (CARBON_CONTROL_KEY | CARBON_OPTION_KEY | CARBON_CMD_KEY)
                        != 0
                        || cfg.carbon_modifiers == 0
                        || cfg!(target_os = "linux") && cfg.key_code == 201)
                    && cfg.carbon_modifiers
                        & !(CARBON_CONTROL_KEY
                            | CARBON_OPTION_KEY
                            | CARBON_CMD_KEY
                            | CARBON_SHIFT_KEY)
                        == 0
            })
}

fn desktop_record(path: &Path) -> Option<ShortcutConfig> {
    desktop_record_from(&read_json(path))
}

fn desktop_record_from(config: &serde_json::Value) -> Option<ShortcutConfig> {
    #[cfg(target_os = "linux")]
    {
        let app_preferred = prefers_app_shortcut(config);
        crate::capture::engine::runtime::uses_desktop_record(app_preferred, true)
            .then(crate::capture::desktop::linux::hyprland::external_record)
            .flatten()
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = config;
        None
    }
}

pub(crate) fn shortcut_state_for_cli(
    config: &serde_json::Value,
    id: &str,
) -> (serde_json::Value, bool) {
    let kind = if id == shortcut_preference(ShortcutKind::Record) {
        ShortcutKind::Record
    } else {
        ShortcutKind::Paste
    };
    let (shortcuts, _) = Shortcuts::from_config(config, &legacy_path());
    let external = (kind == ShortcutKind::Record)
        .then(|| desktop_record_from(config))
        .flatten();
    let value = external.as_ref().unwrap_or_else(|| shortcuts.get(kind));
    let value = if value.is_unset() {
        serde_json::Value::Null
    } else {
        configured_shortcut(value).unwrap_or_default()
    };
    (value, external.is_some())
}

pub(crate) fn shortcut_public_value(value: serde_json::Value) -> serde_json::Value {
    let source = value["source"] == "app";
    let mut value = serde_json::from_value::<Stored>(value)
        .ok()
        .and_then(|stored| serde_json::to_value(stored).ok())
        .unwrap_or_default();
    if source && value.is_object() {
        value["source"] = "app".into();
    }
    value
}

pub(crate) fn set_shortcut_for_cli(
    path: &Path,
    id: &str,
    value: Option<serde_json::Value>,
) -> anyhow::Result<()> {
    use anyhow::{Context, ensure};
    let kind = ShortcutKind::ALL
        .into_iter()
        .find(|kind| shortcut_preference(*kind) == id)
        .context("Unknown shortcut preference")?;
    let reserved_bits =
        !(CARBON_CMD_KEY | CARBON_CONTROL_KEY | CARBON_OPTION_KEY | CARBON_SHIFT_KEY);
    let pressed = match value {
        Some(serde_json::Value::Null) => {
            ensure!(kind.can_unset(), "Record shortcut cannot be disabled");
            None
        }
        Some(value) => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase", deny_unknown_fields)]
            struct Chord {
                key_code: u32,
                modifiers: u32,
                key: String,
            }
            let Chord {
                key_code,
                modifiers,
                key,
            } = serde_json::from_value(value)
                .context("Expected shortcut {keyCode, modifiers, key}")?;
            ensure!(
                key.len() <= 32
                    && modifiers & reserved_bits == 0
                    && key_code <= if cfg!(target_os = "macos") { 127 } else { 255 },
                "Invalid shortcut chord"
            );
            #[cfg(not(target_os = "macos"))]
            let reserved = false;
            #[cfg(target_os = "macos")]
            let reserved = super::onboarding::native_shortcut_reserved(key_code, modifiers);
            Some(Pressed {
                key_code,
                modifiers,
                key,
                reserved,
            })
        }
        None => {
            let cfg = kind.default_config();
            Some(Pressed {
                key_code: cfg.key_code,
                modifiers: cfg.carbon_modifiers,
                key: cfg.key_label().to_owned(),
                reserved: false,
            })
        }
    };
    crate::shared::handoff::update_config_in(path, |config| {
        let (shortcuts, _) = Shortcuts::from_config(config, &legacy_path());
        let external = desktop_record_from(config);
        ensure!(
            kind != ShortcutKind::Record || external.is_none(),
            "The desktop manages the Record shortcut. Change the desktop binding to update it"
        );
        let other = match kind {
            ShortcutKind::Record => &shortcuts.paste,
            ShortcutKind::Paste => external.as_ref().unwrap_or(&shortcuts.record),
        };
        let cfg = match pressed {
            Some(pressed) => validate(kind, &pressed, other)
                .map_err(|why| anyhow::anyhow!("{}", why.message()))?,
            None => ShortcutConfig::unset(),
        };
        let app_owned = kind == ShortcutKind::Record
            && (crate::shared::handoff::is_nightly() || prefers_app_shortcut(config));
        edit_shortcut(config, kind, &cfg, app_owned)
    })
}

pub(crate) fn external_record_owned(kind: ShortcutKind) -> bool {
    kind == ShortcutKind::Record
        && desktop_record(&crate::shared::handoff::default_config_path()).is_some()
}

#[test]
fn a_custom_shortcut_from_0_3_moves_across_once() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("config.json");
    let legacy = dir.path().join("legacy.json");
    std::fs::write(
        &legacy,
        r#"{"key_code":41,"carbon_modifiers":2560,"label":"⌥⇧S"}"#,
    )
    .unwrap();
    let (former_default, migrate) = Shortcuts::load_from(&path, &legacy);
    if cfg!(target_os = "macos") {
        assert!(migrate);
        assert_eq!(former_default.record.label, "⌥⇧S");
        assert_eq!(former_default.record.key_code, 41);
    } else {
        assert_eq!((former_default, migrate), (Shortcuts::default(), false));
    }
    std::fs::write(
        &legacy,
        r#"{"key_code":15,"carbon_modifiers":6144,"label":"⌃⌥R"}"#,
    )
    .unwrap();
    let (loaded, migrate) = Shortcuts::load_from(&path, &legacy);
    assert!(migrate);
    assert_eq!(loaded.record.label, "⌃⌥R");
    save_shortcut_in(
        &path,
        ShortcutKind::Record,
        &ShortcutConfig::default_record(),
    )
    .unwrap();
    assert_eq!(
        Shortcuts::load_from(&path, &legacy),
        (Shortcuts::default(), false)
    );
}

#[test]
fn shortcut_preference_cli_preserves_other_chords_and_explicit_off() {
    use serde_json::{Value, json};
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("config.json");
    std::fs::write(&path, br#"{"shortcuts":{"future":42},"other":"keep"}"#).unwrap();
    let record = "general.recordShortcut";
    let paste = "general.pasteShortcut";
    let before = std::fs::read(&path).unwrap();
    assert!(set_shortcut_for_cli(&path, record, Some(Value::Null)).is_err());
    assert!(
        set_shortcut_for_cli(
            &path,
            paste,
            Some(json!({"keyCode": 255, "modifiers": 1, "key": "p"}))
        )
        .is_err()
    );
    assert_eq!(std::fs::read(&path).unwrap(), before);
    set_shortcut_for_cli(&path, paste, Some(Value::Null)).unwrap();
    let raw = read_json(&path);
    assert_eq!(raw.pointer("/general/pasteShortcut"), Some(&Value::Null));
    assert_eq!(raw["shortcuts"]["future"], 42);
    assert_eq!(raw["other"], "keep");
    assert_eq!(shortcut_state_for_cli(&raw, paste), (Value::Null, false));
    set_shortcut_for_cli(&path, paste, None).unwrap();
    let raw = read_json(&path);
    assert!(raw.pointer("/general/pasteShortcut").is_none());
    assert_eq!(
        shortcut_state_for_cli(&raw, paste).0["label"],
        ShortcutConfig::default_paste().label
    );
}
