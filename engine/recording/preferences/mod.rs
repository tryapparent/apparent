use anyhow::{Context, Result, ensure};
use serde_json::{Value, json};
use std::path::Path;

use crate::capture::engine::runtime::audio::{
    mic,
    transcription::{speech_model, transcribe::Engine},
};
use crate::shared::handoff::{edit_preference, update_config_in, write_preference};

#[cfg(not(test))]
#[path = "../../accessibility/desktop_access.rs"]
mod native_access;
#[cfg(not(test))]
pub(crate) use native_access::desktop_access;
#[cfg(test)]
pub(crate) fn desktop_access(activate: bool) -> &'static str {
    if activate { "enabled" } else { "disabled" }
}

pub(crate) fn recording_key(key: &str, value: &serde_json::Value) -> bool {
    match key {
        "agentContext" => value.is_boolean(),
        "contextAccessibility" => value.as_bool() == Some(true),
        "lowerPlayback" => cfg!(target_os = "macos") && value.is_boolean(),
        "playbackLevel" => cfg!(target_os = "macos") && value.as_u64().is_some_and(|level| level <= 100),
        "microphone" | "transcriber" | "hexModel" | "hexLanguage" | "appleLocale" =>
            value.as_str().is_some_and(|value| value.len() <= 16_384),
        _ => false,
    }
}

fn recording_context_enabled(path: &Path) -> bool {
    use crate::shared::handoff::{AGENT_CONTEXT, experiment_enabled_in, load_config_from};
    experiment_enabled_in(&load_config_from(path), AGENT_CONTEXT)
}

pub(crate) fn context_state(path: &Path) -> Value {
    let enabled = recording_context_enabled(path);
    json!({"enabled": enabled, "access": enabled.then(|| desktop_access(false))})
}

pub(crate) fn save_from_ui(path: &Path, key: &str, value: &Value, inputs: Option<&mic::Inputs>) -> Result<()> {
    if key == "agentContext" {
        use crate::shared::handoff::{AGENT_CONTEXT_PREFERENCE, write_preference};
        write_preference(path, AGENT_CONTEXT_PREFERENCE, Some(value.clone()))?;
        return Ok(());
    }
    if key == "contextAccessibility" {
        const ACTIVATE: [bool; 4] = include!("../../../record/settings/permissions/agent-context-activation.json");
        let enabled = usize::from(recording_context_enabled(path));
        anyhow::ensure!(ACTIVATE[usize::from(value.as_bool() == Some(true)) | (enabled << 1)], "Recording context is off");
        anyhow::ensure!(
            matches!(desktop_access(true), "enabled" | "approval_required"),
            "Desktop accessibility unavailable"
        );
        return Ok(());
    }
    let value = if key == "microphone" {
        serde_json::json!({"id": value})
    } else {
        value.clone()
    };
    save(path, &format!("recording.{key}"), Some(&value), inputs)
}

pub(crate) fn save(
    path: &Path,
    id: &str,
    value: Option<&Value>,
    inputs: Option<&mic::Inputs>,
) -> Result<()> {
    ensure!(
        matches!(
            id,
            "recording.microphone"
                | "recording.transcriber"
                | "recording.hexModel"
                | "recording.hexLanguage"
                | "recording.appleLocale"
                | "recording.lowerPlayback"
                | "recording.playbackLevel"
        ),
        "Unknown recording preference"
    );
    let Some(value) = value else {
        return write_preference(path, id, None);
    };
    if id == "recording.microphone" {
        let device = value
            .get("id")
            .and_then(Value::as_str)
            .context("Expected microphone device ID")?;
        if device == "default" {
            return write_preference(path, id, None);
        }
        let inputs = inputs.context("Microphone list unavailable")?;
        ensure!(inputs.find(device).is_some(), "Microphone disconnected");
        return mic::save_in(path, device, inputs);
    }
    let string = || {
        value
            .as_str()
            .filter(|value| value.len() <= 16_384)
            .context("Expected recording preference text")
    };
    let stored = match id {
        "recording.transcriber" => {
            let engine = Engine::parse(string()?).context("Invalid transcriber")?;
            Some(engine.name().into())
        }
        "recording.hexModel" => {
            let model = string()?.trim();
            ensure!(!model.is_empty(), "Missing Hex model");
            return update_config_in(path, |config| {
                edit_preference(config, id, Some(model.into()))?;
                edit_preference(config, "recording.transcriber", Some("hex".into()))
            });
        }
        "recording.hexLanguage" => Some(
            crate::shared::hex::language_code(string()?)
                .context("Invalid Hex language")?
                .into(),
        ),
        "recording.appleLocale" => {
            let locale = string()?.trim();
            if locale.is_empty() || locale.eq_ignore_ascii_case("auto") {
                None
            } else {
                Some(
                    speech_model::locale_id(locale)
                        .context("Invalid Apple Speech language")?
                        .into(),
                )
            }
        }
        _ => Some(value.clone()),
    };
    write_preference(path, id, stored)
}

pub(crate) fn set_from_cli(path: &Path, id: &str, value: Option<Value>) -> Result<()> {
    let inputs = (id == "recording.microphone" && value.is_some()).then(mic::inputs);
    save(path, id, value.as_ref(), inputs.as_ref())
}

pub(crate) fn public_value(id: &str, value: Value) -> Value {
    if id != "recording.microphone" {
        return value;
    }
    value
        .get("id")
        .and_then(Value::as_str)
        .map_or(Value::Null, |id| json!({"id": id}))
}

pub(crate) fn apply_streaming(setting: Option<&str>, enabled: Option<bool>, reply: &serde_json::Value) {
    if setting.is_none_or(|name| name == "streaming")
        && let Some(on) = enabled
        && reply["facts"]["saved"].as_bool() == Some(on)
    {
        use crate::capture::engine::runtime::audio::transcription::speech_preview;
        if on {
            speech_preview::prepare();
        } else {
            speech_preview::release_cache();
        }
    }
}

#[test]
fn recording_context_default_and_explicit_permissions() {
    use crate::shared::{handoff::load_config_from, preferences::sdk_context_enabled_in};
    let fixture = tempfile::tempdir().unwrap();
    let path = fixture.path().join("config.json");
    assert!(recording_context_enabled(&path));
    assert!(!sdk_context_enabled_in(&load_config_from(&path)));

    std::fs::write(&path, r#"{"unrelated":"keep","experiments":{"agentContext":"off"}}"#).unwrap();
    assert!(!recording_context_enabled(&path));
    assert!(save_from_ui(&path, "contextAccessibility", &true.into(), None).is_err());

    save_from_ui(&path, "agentContext", &true.into(), None).unwrap();
    assert!(sdk_context_enabled_in(&load_config_from(&path)));
    assert_eq!(context_state(&path)["access"], "disabled");
    save_from_ui(&path, "contextAccessibility", &true.into(), None).unwrap();
    assert_eq!(crate::shared::handoff::read_preferences(&path).unwrap()["unrelated"], "keep");

    crate::shared::handoff::write_preference(&path, crate::shared::handoff::AGENT_CONTEXT_PREFERENCE, None).unwrap();
    assert!(recording_context_enabled(&path));
    assert!(!sdk_context_enabled_in(&load_config_from(&path)));
}
