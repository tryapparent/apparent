pub(crate) mod connect;
mod agents;
pub(crate) use agents::persist_t3_connection;
pub(in crate::capture::desktop) mod labs;
pub(crate) use labs::desktop_access;
pub(crate) mod onboarding;
pub(crate) mod onboarding_window;
pub(crate) mod settings;
pub(in crate::capture::desktop) mod presentation;
pub(crate) mod shortcut;

pub(crate) use settings::*;

pub(crate) mod practice;

fn save_launch_at_login(
    path: &std::path::Path,
    on: bool,
    set: impl FnOnce(bool) -> anyhow::Result<()>,
) -> anyhow::Result<()> {
    use crate::shared::handoff::{edit_preference, preference_value, update_config_in};
    let key = "general.launchAtLogin";
    let wanted = serde_json::Value::Bool(on);
    let mut previous = None;
    update_config_in(path, |config| {
        previous = preference_value(config, key);
        edit_preference(config, key, Some(wanted.clone()))
    })?;
    if let Err(error) = set(on) {
        if let Err(rollback) = update_config_in(path, |config| {
            if preference_value(config, key).as_ref() == Some(&wanted) {
                edit_preference(config, key, previous)?;
            }
            Ok(())
        }) {
            crate::capture::engine::runtime::apparent_log(format!("Restoring {key} failed: {rollback:#}"));
        }
        return Err(error);
    }
    Ok(())
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
pub(crate) fn apply_quit_login_preference(on: bool) -> anyhow::Result<()> {
    let current = login_item();
    anyhow::ensure!(option_env!("APPARENT_PREVIEW_BUILD").is_none() && current != LoginItem::Unavailable,
        "Startup settings unavailable");
    let registered = matches!(current, LoginItem::On | LoginItem::NeedsApproval);
    save_launch_at_login(&crate::shared::handoff::default_config_path(), on, |wanted| {
        if wanted == registered { Ok(()) } else { set_login_item(wanted) }
    })?;
    if on && login_item() == LoginItem::NeedsApproval {
        settings::open_startup_settings_for_quit();
    }
    Ok(())
}

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheck {
    pub checking: bool,
    pub result: Option<UpdateResult>,
    #[cfg(target_os = "linux")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) progress: Option<crate::capture::desktop::linux::update::UpdateProgress>,
    #[cfg(target_os = "linux")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) failure: Option<UpdateFailure>,
}

#[cfg(target_os = "linux")]
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum UpdateFailure {
    Busy,
    RateLimited,
    Download,
    Verification,
    Installation,
    Restart,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum UpdateResult {
    Available,
    Current,
    Failed,
}

impl UpdateCheck {
    #[cfg(target_os = "linux")]
    pub(super) fn finish(&mut self, result: Result<&'static str, (String, Option<UpdateFailure>)>) {
        use crate::capture::desktop::linux::update::UpdateProgress;
        self.checking = false;
        let progress = self.progress.take();
        self.result = Some(match result {
            Ok("installed; restart Apparent to use it") | Ok("already installed; restart Apparent to use it") =>
                UpdateResult::Available,
            Ok("up to date") => UpdateResult::Current,
            Ok(other) => {
                crate::capture::engine::runtime::apparent_log(format!("Unexpected update check result: {other}"));
                use crate::capture::desktop::workflow::error_reporting::{self, updates::{Stage, Trigger}};
                let error = error_reporting::updates::failure(Stage::UnexpectedResult, anyhow::anyhow!("unexpected updater response"));
                error_reporting::report_update(&error, Trigger::User);
                UpdateResult::Failed
            }
            Err((error, failure)) => {
                crate::capture::engine::runtime::apparent_log(format!("Could not check for updates: {error}"));
                self.failure = failure.or(match progress {
                    Some(UpdateProgress::Downloading { .. }) => Some(UpdateFailure::Download),
                    Some(UpdateProgress::Verifying) => Some(UpdateFailure::Verification),
                    Some(UpdateProgress::Installing) => Some(UpdateFailure::Installation),
                    None => None,
                });
                UpdateResult::Failed
            }
        });
    }
}

#[cfg(target_os = "linux")]
fn update_failure(error: &anyhow::Error) -> Option<UpdateFailure> {
    use crate::capture::desktop::workflow::error_reporting::updates;
    if updates::is_lock_contention(error) {
        Some(UpdateFailure::Busy)
    } else if updates::is_rate_limited(error) {
        Some(UpdateFailure::RateLimited)
    } else {
        None
    }
}

fn recording_key(key: &str, value: &serde_json::Value) -> bool {
    match key {
        "lowerPlayback" => cfg!(target_os = "macos") && value.is_boolean(),
        "playbackLevel" => cfg!(target_os = "macos") && value.as_u64().is_some_and(|level| level <= 100),
        "microphone" | "transcriber" | "hexModel" | "hexLanguage" | "appleLocale" =>
            value.as_str().is_some_and(|value| value.len() <= 16_384),
        _ => false,
    }
}

enum RecordingMeter {
    #[cfg(not(target_os = "macos"))]
    Local(std::sync::mpsc::Sender<()>),
    #[cfg(target_os = "macos")]
    Native(std::process::ChildStdin),
}

impl RecordingMeter {
    #[cfg(not(target_os = "macos"))]
    fn start(id: String, report: impl Fn(f32) + Send + 'static) -> Option<Self> {
        let (stop, stop_requested) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let meter = crate::capture::engine::runtime::audio::mic::Meter::start(id);
            let mut previous = -1.0;
            while let Err(std::sync::mpsc::RecvTimeoutError::Timeout) =
                stop_requested.recv_timeout(std::time::Duration::from_millis(50))
            {
                let level = meter.level();
                if level != previous { report(level); previous = level; }
            }
        });
        Some(Self::Local(stop))
    }

    #[cfg(target_os = "macos")]
    fn start(id: String, report: impl Fn(f32) + Send + 'static) -> Option<Self> {
        use std::{io::BufRead, process::{Command, Stdio}};
        let mut child = Command::new(crate::capture::desktop::helper::path().ok()?)
            .args(["settings", "--input-level", &id])
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().ok()?;
        let stop = child.stdin.take()?;
        let stdout = child.stdout.take()?;
        std::thread::spawn(move || {
            #[derive(serde::Deserialize)]
            struct Reading { level: f32 }
            for line in std::io::BufReader::new(stdout).lines().map_while(Result::ok) {
                if let Ok(reading) = serde_json::from_str::<Reading>(&line) {
                    report(reading.level);
                }
            }
            let _ = child.wait();
        });
        Some(Self::Native(stop))
    }
}

impl Drop for RecordingMeter {
    fn drop(&mut self) {
        #[cfg(not(target_os = "macos"))]
        let Self::Local(stop) = self;
        #[cfg(not(target_os = "macos"))]
        let _ = stop.send(());
        #[cfg(target_os = "macos")]
        let Self::Native(_stop_on_drop) = self;
    }
}

fn save_recording(path: &std::path::Path, key: &str, value: &serde_json::Value, inputs: Option<&crate::capture::engine::runtime::audio::mic::Inputs>) -> anyhow::Result<Effect> {
    let value = if key == "microphone" {
        serde_json::json!({"id": value})
    } else {
        value.clone()
    };
    crate::recording_preferences::save(path, &format!("recording.{key}"), Some(&value), inputs)?;
    Ok(if key == "appleLocale" { Effect::SpeechModel } else { Effect::None })
}

fn recording_state(view: settings::RecordingView) -> serde_json::Value {
    use crate::capture::engine::runtime::audio::transcription::speech_model;
    let speech = speech_model::current();
    if view.transcriber.engine == "apple" && speech.state == speech_model::State::Unknown {
        speech_model::ensure();
    }
    #[cfg(target_os = "linux")]
    let warnings: Vec<_> = [
        crate::capture::desktop::linux::media::encoder_warning(),
        crate::capture::desktop::linux::media::decoder_warning(),
    ].into_iter().flatten().collect();
    #[cfg(not(target_os = "linux"))]
    let warnings: Vec<String> = Vec::new();
    serde_json::json!({"type":"recording-state","state":{
        "platform":if cfg!(target_os="macos") {"macos"} else {"linux"},
        "microphone":view.microphone,"transcriber":view.transcriber,"speech":speech,
        "playback":cfg!(target_os = "macos").then(|| serde_json::json!({"enabled":view.lower_playback,"level":view.playback_level})),
        "mediaWarnings":warnings
    }})
}

fn microphone_view(
    choice: Option<&crate::capture::engine::runtime::audio::mic::Choice>,
    inputs: Option<&crate::capture::engine::runtime::audio::mic::Inputs>,
    allowed: bool,
) -> MicrophoneView {
    use crate::capture::engine::runtime::audio::mic::Pick;
    let option = |id: &str, title: String, enabled: bool| MenuOptionView {
        id: id.to_owned(),
        title,
        enabled,
    };
    let empty = crate::capture::engine::runtime::audio::mic::Inputs::default();
    let pick = Pick::new(choice, inputs.unwrap_or(&empty));
    let default_title = match inputs.and_then(crate::capture::engine::runtime::audio::mic::Inputs::default_input) {
        Some(input) => format!("System default ({})", input.name),
        None => "System default".to_owned(),
    };
    let mut options = vec![option("default", default_title, true)];
    if let Some(inputs) = inputs.filter(|i| !i.devices.is_empty()) {
        options.push(option("-", String::new(), false));
        options.extend(
            inputs
                .devices
                .iter()
                .map(|input| option(&input.id, input.name.clone(), true)),
        );
    }
    let loaded = inputs.is_some();
    if let (Some(choice), true, Pick::Missing { .. }) = (choice, loaded, &pick) {
        options.push(option(
            &choice.id,
            format!("{} (not connected)", choice.name),
            false,
        ));
    }
    MicrophoneView {
        selected: choice.map_or_else(|| "default".to_owned(), |c| c.id.clone()),
        value: match (choice, &pick) {
            (_, Pick::Chosen(input)) => input.name.clone(),
            (Some(choice), _) => choice.name.clone(),
            (None, _) => "System default".to_owned(),
        },
        options,
        note: if loaded { pick.note() } else { None },
        meter: pick
            .device()
            .filter(|_| allowed && loaded)
            .map(|input| input.id.clone()),
    }
}

#[test]
fn recording_preferences_use_one_durable_config_mutation_and_keep_unrelated_values() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("config.json");
    std::fs::write(&path, r#"{"transcriber":"apple","videoExport":false,"recording":{"videoExport":false},"future":{"field":42},"microphone":{"id":"gone","name":"Previous input"}}"#).unwrap();
    let read_json = |path: &std::path::Path| serde_json::from_slice::<serde_json::Value>(&std::fs::read(path).unwrap()).unwrap();
    assert!(save_recording(&path, "microphone", &"disconnected".into(), None).is_err());
    assert_eq!(read_json(&path)["microphone"]["id"], "gone");
    assert_eq!(save_recording(&path, "microphone", &"default".into(), None).unwrap(), Effect::None);
    assert_eq!(save_recording(&path, "hexModel", &"selected".into(), None).unwrap(), Effect::None);
    assert!(save_recording(&path, "videoExport", &true.into(), None).is_err());
    let saved = read_json(&path);
    assert_eq!(saved["future"]["field"], 42);
    assert_eq!(saved["recording"]["hexModel"], "selected");
    assert_eq!(saved["recording"]["transcriber"], "hex");
    assert_eq!(saved["videoExport"], false);
    assert_eq!(saved["recording"]["videoExport"], false);
    assert!(saved.get("microphone").is_none());

    std::fs::write(&path, "invalid config").unwrap();
    assert!(save_recording(&path, "hexModel", &"selected".into(), None).is_err());
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "invalid config");
}

pub(super) struct Transport {
    child: crate::capture::ui_process::UiChild,
    stdin: Option<std::process::ChildStdin>,
}

impl Transport {
    pub(super) fn send(&mut self, message: &serde_json::Value) {
        use std::io::Write;
        if let Some(pipe) = self.stdin.as_mut()
            && writeln!(pipe, "{message}").and_then(|()| pipe.flush()).is_err()
        {
            self.stdin = None;
        }
    }
}

fn about_state(config_path: &std::path::Path, update_check: &UpdateCheck) -> serde_json::Value {
    let config = crate::shared::handoff::load_config_from(config_path);
    #[cfg(target_os = "linux")]
    use crate::capture::desktop::linux::update::{restart_pending, status_at};
    #[cfg(target_os = "linux")]
    let status = status_at(config_path).unwrap_or_default();
    #[cfg(not(target_os = "linux"))]
    let status = serde_json::Value::Null;
    let update_channel = status["channel"].as_str().unwrap_or_else(|| {
        if config.update_channel.as_deref() == Some("main") { "main" } else { "stable" }
    });
    #[cfg(target_os = "linux")]
    let pending = restart_pending(&status);
    #[cfg(not(target_os = "linux"))]
    let pending = false;
    serde_json::json!({
        "type": "about-state", "version": env!("APPARENT_VERSION_LABEL"),
        "updates": settings::updates_available(), "updateCheck": update_check,
        "restartPending": pending, "stagedRelease": status.get("installed").filter(|_| pending),
        "updateChannel": update_channel,
        "mainUpdates": cfg!(target_os = "linux"), "linux": cfg!(target_os = "linux"),
        "mac": cfg!(target_os = "macos"), "nightly": crate::shared::handoff::is_nightly(),
        "resumeTour": onboarding::Progress::load_from(config_path).resume.is_some()
    })
}
