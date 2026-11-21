//! Persistence mechanism only. The Labs catalogue/defaults belong to Desktop TS.
use std::path::Path;
use crate::shared::handoff::{AGENT_CONTEXT, Config};
const KEY: &str = "localStreamingTranscription";
const AUTO_PASTE: &str = "autoPasteDraft";

#[cfg(target_os = "linux")]
use crate::capture::desktop::settings::shortcut::{PUSH_TO_TALK, push_to_talk_supported};
#[cfg(not(target_os = "linux"))]
const PUSH_TO_TALK: &str = "pushToTalk";
#[cfg(not(target_os = "linux"))]
fn push_to_talk_supported() -> bool { false }

fn auto_paste_supported() -> bool {
    #[cfg(target_os = "linux")]
    { crate::capture::desktop::linux::auto_paste::available() }
    #[cfg(not(target_os = "linux"))]
    { false }
}
pub(super) fn facts(path: &Path) -> serde_json::Value {
    let value = match std::fs::read(path) {
        Ok(bytes) => match serde_json::from_slice::<serde_json::Value>(&bytes) {
            Ok(value) if value.is_object() => value,
            _ => return serde_json::json!({"error":"config_read_failed"}),
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => serde_json::json!({}),
        Err(_) => return serde_json::json!({"error":"config_read_failed"}),
    };
    let saved = |key| value.get("experiments").and_then(|flags|flags.get(key)).and_then(|flag|flag.as_bool());
    let experiment_config = serde_json::json!({"experiments": value.get("experiments")});
    let agent_context = serde_json::from_value::<Config>(experiment_config)
        .ok()
        .and_then(|config| config.experiments.get(AGENT_CONTEXT).copied());
    serde_json::json!({
        "saved": saved(KEY),
        "compactHandoffSaved": saved(crate::composition::frame_labels::EXPERIMENT),
        "transcriptOnlySaved": saved(crate::composition::transcript_handoff::EXPERIMENT),
        "agentContextSaved": agent_context,
        "sharingSaved": saved("hostedSharing"),
        "autoPasteSaved": saved(AUTO_PASTE),
        "autoPasteSupported": auto_paste_supported(),
        "pushToTalkSaved": saved(PUSH_TO_TALK),
        "pushToTalkSupported": push_to_talk_supported(),
        "wisprSaved": saved("onboardingWisprFlow"),
        "wisprSupported": cfg!(target_os = "macos"),
        "silentPromptSaved": saved("silentPrompt"),
        "pillDoodlesSaved": saved(crate::capture::desktop::ui::electron_pill::PILL_DOODLES),
        "dictationFrogSaved": saved("dictationFrog"),
    })
}
pub(super) fn key(setting: Option<&str>) -> Option<(&'static str, bool)> {
    match setting {
        None | Some("streaming") => Some((KEY, true)),
        Some("compactHandoff") => Some((crate::composition::frame_labels::EXPERIMENT, true)),
        Some("transcriptOnly") => Some((crate::composition::transcript_handoff::EXPERIMENT, true)),
        Some("agentContext") => Some((AGENT_CONTEXT, true)),
        Some("sharing") => Some(("hostedSharing", true)),
        Some("autoPaste") => Some((AUTO_PASTE, true)),
        Some("pushToTalk") => Some((PUSH_TO_TALK, true)),
        Some("wisprFlow") => Some(("onboardingWisprFlow", cfg!(target_os = "macos"))),
        Some("silentPrompt") => Some(("silentPrompt", true)),
        Some(name) if name == crate::capture::desktop::ui::electron_pill::PILL_DOODLES => Some((crate::capture::desktop::ui::electron_pill::PILL_DOODLES, true)),
        Some("dictationFrog") => Some(("dictationFrog", cfg!(target_os = "macos"))),
        _ => None,
    }
}
pub(super) fn request(path: &Path, request: u32, enabled: Option<bool>, setting: Option<&str>) -> serde_json::Value {
    let Some((key, true)) = key(setting) else {
        return serde_json::json!({"type":"labs-result","request":request,"facts":{"error":"config_write_failed"}});
    };
    let result = if enabled == Some(true) && (key == AUTO_PASTE && !auto_paste_supported()
        || key == PUSH_TO_TALK && !push_to_talk_supported()) {
        serde_json::json!({"error":"config_write_failed"})
    } else if let Some(on) = enabled {
        match crate::shared::handoff::set_experiment_in(path, key, on) {
            Ok(()) => facts(path), Err(_) => serde_json::json!({"error":"config_write_failed"}),
        }
    } else {facts(path)};
    serde_json::json!({"type":"labs-result","request":request,"facts":result})
}
#[cfg(test)] mod tests {
    use super::*;
    #[test]
    fn labs_cannot_change_the_retired_note_experiment() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        let original = r#"{"experiments":{"doubleShiftNotes":true},"onboarding":{"doubleShiftNoteStarts":1}}"#;
        std::fs::write(&path, original).unwrap();
        assert!(facts(&path).get("doubleShiftSaved").is_none());
        assert_eq!(request(&path, 5, Some(false), Some("doubleShiftNotes"))["facts"]["error"], "config_write_failed");
        assert_eq!(std::fs::read_to_string(path).unwrap(), original);
    }
    #[test]
    fn agent_context_reads_existing_values_and_uses_the_shared_writer() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("config.json");
        assert!(facts(&path)["agentContextSaved"].is_null());
        std::fs::write(&path, r#"{"secret":"private","experiments":{"agentContext":"yes","other":true}}"#).unwrap();
        assert_eq!(facts(&path)["agentContextSaved"], true);
        for enabled in [false, true] {
            let response = request(&path, 1, Some(enabled), Some(AGENT_CONTEXT));
            assert_eq!(response["facts"]["agentContextSaved"], enabled);
            assert!(!response.to_string().contains("private"));
            let stored = std::fs::read_to_string(&path).unwrap();
            let saved: serde_json::Value = serde_json::from_str(&stored).unwrap();
            assert_eq!(saved["experiments"][AGENT_CONTEXT], enabled);
            assert_eq!(saved["experiments"]["other"], true);
            assert_eq!(saved["secret"], "private");
        }
    }
    #[test]
    fn silent_prompt_is_opt_in_and_round_trips() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("config.json");
        std::fs::write(&path, r#"{"experiments":{"other":true}}"#).unwrap();
        assert!(facts(&path)["silentPromptSaved"].is_null());
        for enabled in [true, false] {
            let response = request(&path, 1, Some(enabled), Some("silentPrompt"));
            assert_eq!(response["facts"]["silentPromptSaved"], enabled);
            let config = crate::shared::handoff::load_config_from(&path);
            assert!(crate::shared::handoff::experiment_enabled_in(&config, "other"));
        }
    }
    #[test]
    fn pill_doodles_are_opt_in_and_use_the_shared_writer() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("config.json");
        std::fs::write(&path, r#"{"experiments":{"other":true}}"#).unwrap();
        assert!(facts(&path)["pillDoodlesSaved"].is_null());
        for enabled in [true, false] {
            let response = request(&path, 1, Some(enabled), Some(crate::capture::desktop::ui::electron_pill::PILL_DOODLES));
            assert_eq!(response["facts"]["pillDoodlesSaved"], enabled);
            let config = crate::shared::handoff::load_config_from(&path);
            assert_eq!(crate::shared::handoff::experiment_enabled_in(&config, crate::capture::desktop::ui::electron_pill::PILL_DOODLES), enabled);
            assert!(crate::shared::handoff::experiment_enabled_in(&config, "other"));
        }
    }
    #[test]
    fn wispr_lab_defaults_off_and_uses_the_shared_config_transaction_only_on_mac() {
        let dir = tempfile::tempdir().unwrap(); let path = dir.path().join("config.json");
        std::fs::write(&path, r#"{"secret":"private","experiments":{"other":true}}"#).unwrap();
        assert!(facts(&path)["wisprSaved"].is_null());
        assert!(!crate::shared::handoff::experiment_enabled_in(&crate::shared::handoff::load_config_from(&path), "onboardingWisprFlow"));
        let reply = request(&path, 10, Some(true), Some("wisprFlow"));
        if cfg!(target_os = "macos") {
            assert_eq!(reply["facts"]["wisprSaved"], true);
        } else { assert_eq!(reply["facts"]["error"], "config_write_failed"); }
        let saved: serde_json::Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(saved["secret"], "private"); assert_eq!(saved["experiments"]["other"], true);
        assert!(!reply.to_string().contains("private"));
    }
    #[test]
    #[ignore = "requires prepared frontend dependencies and Electron; Linux also requires xvfb-run"]
    fn labs_electron_rust_roundtrip() {
        use std::io::{BufRead, Write};
        use std::process::{Command, Stdio};
        let root = Path::new(env!("CARGO_MANIFEST_DIR"));
        let frontend = root.join("capture/desktop/ui/frontend");
        super::super::presentation::build_test_renderer();
        let directory = tempfile::tempdir().unwrap(); let path = directory.path().join("config.json");
        std::fs::write(&path, r#"{"secret":"private","experiments":{"other":true}}"#).unwrap();
        let mut command = if cfg!(target_os = "linux") {
            let mut command = Command::new("xvfb-run");command.args(["-a", "node"]);command
        } else { Command::new("node") };
        let mut child = command.arg("--experimental-strip-types")
            .arg(frontend.join("tests/settings/labs/native.ts")).arg(&path)
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::inherit()).spawn().unwrap();
        let mut input = child.stdin.take().unwrap();
        for line in std::io::BufReader::new(child.stdout.take().unwrap()).lines() {
            let line = line.unwrap();
            if let Ok(super::super::settings::Action::LabsPreference {request: id, enabled, setting}) = serde_json::from_str(&line) {
                writeln!(input, "{}", request(&path, id, enabled, setting.as_deref())).unwrap();
            } else if let Ok(super::super::settings::Action::AgentsPreference { request: id, enabled, setting }) = serde_json::from_str(&line) {
                assert!(setting.as_deref() == Some("t3") || setting.is_none() && enabled.is_none());
                writeln!(input, "{}", super::super::agents::request_for(&path, id, enabled, setting.as_deref())).unwrap();
            } else {
                let value: serde_json::Value = serde_json::from_str(&line)
                    .unwrap_or_else(|error| panic!("Unexpected Labs driver output ({error}): {line}"));
                assert_eq!(value["action"], "close");
            }
        }
        assert!(child.wait().unwrap().success());
        assert_eq!(facts(&path)["saved"], false);
    }
    #[test] fn labs_keeps_unrelated_settings_and_never_repairs_corrupt_config() {
        let dir=tempfile::tempdir().unwrap();let path=dir.path().join("config.json");
        assert!(facts(&path)["saved"].is_null());
        std::fs::write(&path,r#"{"secret":"private","t3":{"origin":"https://example.test","token":"private-token"},"experiments":{"other":true,"agentDemoVideo":true,"t3DestinationPicker":true}}"#).unwrap();
        assert!(!facts(&path).to_string().contains("private"));
        for on in [true,false] {
            assert_eq!(request(&path,1,Some(on),None)["facts"]["saved"],on);
            let saved:serde_json::Value=serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
            assert_eq!(saved["secret"],"private");assert_eq!(saved["experiments"]["other"],true);
            assert_eq!(saved["t3"]["token"],"private-token");
            assert_eq!(saved["experiments"]["agentDemoVideo"],true);assert_eq!(saved["experiments"]["t3DestinationPicker"],true);
        }
        let initial = facts(&path);
        let enable = request(&path,3,Some(true),Some("autoPaste"));
        if initial["autoPasteSupported"] == true {
            assert_eq!(enable["facts"]["autoPasteSaved"],true);
        } else {
            assert_eq!(enable["facts"]["error"],"config_write_failed");
            assert!(facts(&path)["autoPasteSaved"].is_null());
        }
        crate::shared::handoff::set_experiment_in(&path, AUTO_PASTE, true).unwrap();
        assert_eq!(request(&path,3,Some(false),Some("autoPaste"))["facts"]["autoPasteSaved"],false);
        assert_eq!(facts(&path)["saved"],false);
        let before=std::fs::read(&path).unwrap();
        assert_eq!(request(&path,4,Some(true),Some("unknown"))["facts"]["error"],"config_write_failed");
        assert_eq!(std::fs::read(&path).unwrap(),before);
        std::fs::write(&path,"invalid").unwrap();
        assert_eq!(request(&path,2,Some(true),None)["facts"]["error"],"config_write_failed");
        assert_eq!(std::fs::read_to_string(&path).unwrap(),"invalid");
    }
    #[test] fn public_sharing_preserves_private_upload_preferences() {
        let dir=tempfile::tempdir().unwrap();let path=dir.path().join("config.json");
        assert!(facts(&path)["sharingSaved"].is_null());
        std::fs::write(&path,r#"{"secret":"keep","experiments":{"hostedEncryption":true,"autoPasteDraft":false}}"#).unwrap();
        for on in [true,false] {
            assert_eq!(request(&path,1,Some(on),Some("sharing"))["facts"]["sharingSaved"],on);
            let saved:serde_json::Value=serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
            assert_eq!(saved["secret"],"keep");assert_eq!(saved["experiments"]["hostedEncryption"],true);
            assert_eq!(saved["experiments"]["autoPasteDraft"],false);
        }
    }
}
