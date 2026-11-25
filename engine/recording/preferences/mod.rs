use anyhow::{Context, Result, ensure};
use serde_json::{Value, json};
use std::path::Path;

use crate::capture::engine::runtime::audio::{
    mic,
    transcription::{speech_model, transcribe::Engine},
};
use crate::shared::handoff::{edit_preference, update_config_in, write_preference};

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
                | "recording.videoExport"
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
