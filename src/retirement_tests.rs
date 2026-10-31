//! Executable boundaries for the retirement of live phone acquisition.
use super::*;

#[test]
fn retired_live_phone_is_absent_from_owned_desktop_admission() {
    let ui = include_str!("ui.rs");
    for retired in [
        "iphone_preview",
        "start_recording_iphone",
        "CaptureSource::Phone",
    ] {
        assert!(
            !ui.contains(retired),
            "desktop lifecycle restored live phone state: {retired}"
        );
    }
}

#[test]
fn retired_phone_cli_is_rejected_by_parser_before_any_work() {
    for args in [
        vec!["apparent", "app", "--iphone"],
        vec!["apparent", "record", "--iphone"],
        vec!["apparent", "devices"],
    ] {
        assert!(Cli::try_parse_from(&args).is_err(), "accepted {args:?}");
    }
    assert!(Cli::try_parse_from(["apparent", "app", "--record"]).is_ok());
    assert!(Cli::try_parse_from(["apparent", "record", "--duration", "1"]).is_ok());
}

#[test]
fn retired_camera_cannot_be_shown_or_requested_even_from_stale_state() {
    use onboarding::{Effect, Flow, Input, Permission};
    let mut flow = Flow::fix(vec![Permission::Camera], None);
    assert!(flow.view().rows.is_empty());
    assert_eq!(flow.on(Input::Grant(Permission::Camera)), Effect::None);
    assert!(!Permission::Camera.asked(None));
}

#[test]
fn retired_helper_and_camera_packaging_are_absent() {
    let helper = include_str!("../helper/main.swift");
    for mode in ["case \"devices\":", "case \"mirror\":", "case \"shrink\":"] {
        assert!(!helper.contains(mode), "live helper mode: {mode}");
    }
    let permission = include_str!("../helper/Onboarding.swift");
    assert!(!permission.contains("\"camera\""));
    assert!(!permission.contains("authorizationStatus(for: .video)"));
    assert!(!permission.contains("requestAccess(for: .video)"));
    for packaging in [
        include_str!("../helper/Info.plist"),
        include_str!("../scripts/install-app.sh"),
        include_str!("../scripts/build-mac-preview.sh"),
        include_str!("../scripts/release-app.sh"),
        include_str!("../scripts/Apparent.entitlements"),
    ] {
        assert!(!packaging.contains("NSCameraUsageDescription"));
        assert!(!packaging.contains("com.apple.security.device.camera"));
    }
}

#[test]
fn retirement_preserves_desktop_permission_declarations_in_all_mac_packages() {
    for (name, packaging) in [
        ("install", include_str!("../scripts/install-app.sh")),
        ("preview", include_str!("../scripts/build-mac-preview.sh")),
        ("release", include_str!("../scripts/release-app.sh")),
    ] {
        for permission in [
            "NSScreenCaptureUsageDescription",
            "NSMicrophoneUsageDescription",
            "NSSpeechRecognitionUsageDescription",
            "NSAppleEventsUsageDescription",
        ] {
            assert!(
                packaging.contains(&format!("<key>{permission}</key>")),
                "{name} package lost desktop permission declaration {permission}"
            );
        }
        assert!(!packaging.contains("NSCameraUsageDescription"));
    }
}

#[test]
fn old_camera_progress_preserves_other_grants_and_unknown_config() {
    use onboarding::{Permission, Progress, Step};
    let dir =
        std::env::temp_dir().join(format!("apparent-retirement-config-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("config.json");
    let input = serde_json::json!({
        "other": {"untouched": 42},
        "onboarding": {"seen": true, "resume": "permissions", "granted": ["microphone", "accessibility", "camera"], "futureProgress": {"keep": true}}
    });
    std::fs::write(&path, serde_json::to_vec(&input).unwrap()).unwrap();
    let progress = Progress::load_from(&path);
    assert!(progress.seen);
    assert_eq!(progress.resume, Some(Step::Permissions));
    assert!(progress.granted.contains(&Permission::Camera));
    assert!(progress.granted.contains(&Permission::Microphone));
    assert!(progress.granted.contains(&Permission::Accessibility));
    progress.save_to(&path).unwrap();
    let saved: serde_json::Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    assert_eq!(saved, input);
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn first_capture_milestones_and_legacy_camera_coexist_and_reset() {
    use onboarding::{Permission, Progress};
    let dir = std::env::temp_dir().join(format!("apparent-milestones-{}", make_bundle_id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("config.json");
    let input = serde_json::json!({
        "other": {"untouched": 42},
        "onboarding": {"seen": true, "granted": ["camera"], "shortcutChosen": true,
            "firstCaptureCompleted": true, "futureProgress": {"keep": true}}
    });
    std::fs::write(&path, serde_json::to_vec(&input).unwrap()).unwrap();
    let mut progress = Progress::load_from(&path);
    assert!(progress.shortcut_chosen && progress.first_capture_completed);
    assert!(progress.granted.contains(&Permission::Camera));
    progress.save_to(&path).unwrap();
    let saved: serde_json::Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    assert_eq!(saved, input);
    progress.shortcut_chosen = false;
    progress.first_capture_completed = false;
    progress.save_to(&path).unwrap();
    let loaded = Progress::load_from(&path);
    assert!(!loaded.shortcut_chosen && !loaded.first_capture_completed);
    let mut expected = input;
    expected["onboarding"]
        .as_object_mut()
        .unwrap()
        .remove("shortcutChosen");
    expected["onboarding"]
        .as_object_mut()
        .unwrap()
        .remove("firstCaptureCompleted");
    let saved: serde_json::Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    assert_eq!(saved, expected);
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn saved_device_copy_text_is_file_only_and_preserves_the_manifest() {
    let dir = std::env::temp_dir().join(format!("apparent-copy-{}.apparent", make_bundle_id()));
    let (_, mut bundle, _) = generate_demo_bundle(Some(dir.clone())).unwrap();
    bundle.source = Some("iphone".into());
    bundle.target.mode = model::CaptureMode::Device;
    for capture in ["mirror", "apparentkit"] {
        bundle.device = Some(model::DeviceInfo {
            name: "Archived device".into(),
            capture: capture.into(),
            ..Default::default()
        });
        let manifest = serde_json::to_vec(&bundle).unwrap();
        std::fs::write(dir.join("apparent.json"), &manifest).unwrap();
        let (loaded_dir, loaded) = handoff::load_bundle(&dir).unwrap();
        let text = handoff::clipboard_summary(&loaded, &loaded_dir);
        assert!(text.contains("Archived device"), "{text}");
        assert!(text.contains("contact-sheet.png"), "{text}");
        assert_eq!(std::fs::read(dir.join("apparent.json")).unwrap(), manifest);
    }
    std::fs::remove_dir_all(dir).unwrap();
}
