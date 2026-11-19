use super::*;

#[test]
fn child_window_exclusion_covers_initial_reset_and_late_readiness() {
    let mut ids = vec![11];
    restore_capture_exclusion(&mut ids, None, true);
    assert_eq!(ids, [11]);
    restore_capture_exclusion(&mut ids, Some(42), true);
    restore_capture_exclusion(&mut ids, Some(42), true);
    assert_eq!(ids, [11, 42]);
    ids.clear(); // The real start path resets telemetry before the initial SCK filter.
    restore_capture_exclusion(&mut ids, Some(42), true);
    assert_eq!(ids, [42]);
    ids.clear();
    restore_capture_exclusion(&mut ids, Some(42), false);
    restore_capture_exclusion(&mut ids, Some(0), true);
    assert!(ids.is_empty()); // Explicitly visible controls and unknown IDs stay out.
}

#[test]
fn late_child_stays_hidden_until_its_filter_receipt() {
    assert!(!capture_exclusion_ready(Some(42), &[], true));
    assert!(!capture_exclusion_ready(Some(42), &[11], true));
    assert!(!capture_exclusion_ready(None, &[42], true));
    assert!(!capture_exclusion_ready(Some(0), &[0], true));
    assert!(capture_exclusion_ready(Some(42), &[11, 42], true));
    // Device capture records the phone stream, not SCK's display; it has no SCK receipt.
    assert!(capture_exclusion_ready(Some(42), &[], false));
}
use crate::capture::desktop::native::pill::{PillStyle, PillSnapshot, model::Pres};

fn test_view(source: &PillSnapshot, revision: u64, movable: bool) -> View {
    project(source, revision, Facts { movable, paste: true, inspect: true, ..Facts::default() })
}

fn project(source: &PillSnapshot, revision: u64, mut facts: Facts) -> View {
    let session = PolicySession::open().unwrap();
    let send = |event| session.dispatch(event, 0, 0).unwrap();
    match &source.pres {
        Pres::Hidden => {}
        Pres::Selecting { mode, has_iphone } => {
            facts.phone = *has_iphone;
            send(Event::PickerOpened { mode: (*mode).into() });
        }
        Pres::Recording { chips, has_iphone } | Pres::RecordingWarning { chips, has_iphone } => {
            send(Event::CaptureStarted);
            facts.phone = *has_iphone;
            facts.no_words = matches!(source.pres, Pres::RecordingWarning { .. });
            if *chips { send(Event::RevealOpened { activity: 0 }); }
        }
        Pres::Processing => {
            send(Event::CaptureStarted);
            send(Event::CaptureSealed);
        }
        Pres::Completed { label, warning, share, .. } => {
            send(Event::CaptureStarted);
            send(Event::CaptureSealed);
            send(Event::CaptureSaved { recovery: false, text: Some(label.clone()), frame_count: 1, duration_ms: 1000 });
            facts.audio_issue = warning.then_some("No words");
            facts.audio_problem = *warning;
            facts.sharing_enabled = share.is_some();
            facts.sharing_online = *share == Some(true);
        }
    }
    facts.microphone_problem = source.mic_warning.is_some();
    facts.mic_warning = source.mic_warning.map(|warning| warning.announcement());
    View {
        presentation: session.present(&facts).unwrap(),
        revision,
        clock: source.clock.clone(),
        input_waveform: source.input_waveform,
        reduced_motion: source.reduced_motion,
        transcript: None,
        notice: None,
    }
}
fn snapshot(pres: Pres) -> PillSnapshot {
    PillSnapshot {
        pres,
        clock: "00:12".into(),
        mic_warning: None,
        input_waveform: None,
        reduced_motion: false,
        style: PillStyle::Black,
    }
}
fn command(revision: u64, action: &str) -> Command {
    Command {
        revision,
        action: action.into(),
        target: None,
    }
}
#[test]
#[cfg(target_os = "linux")]
fn electron_pill_drag_admission_stays_with_current_recording() {
    let mut view = test_view(&snapshot(Pres::Recording { chips: false, has_iphone: false }), 12, true);
    let mut drag = command(12, "drag");
    drag.target = Some([300.0, 60.0]);
    assert_eq!(view.drag_point(&drag, true), drag.target);
    assert_eq!(view.drag_point(&drag, false), None);
    drag.revision = 11;
    assert_eq!(view.drag_point(&drag, true), None);
    drag.revision = 12;
    drag.target = Some([f32::NAN, 60.0]);
    assert_eq!(view.drag_point(&drag, true), None);
    drag.target = Some([300.0, 60.0]);
    view.presentation.draggable = false;
    assert_eq!(view.drag_point(&drag, true), None);
    view.presentation.draggable = true;
    view.presentation.phase = "selecting".into();
    assert_eq!(view.drag_point(&drag, true), None);
    assert!(view.admit(drag).is_none(), "Geometry cannot dispatch a capture action");
}
#[test]
fn electron_pill_refuses_stale_and_unavailable_mutations() {
    let view = test_view(
        &snapshot(Pres::Recording {
            chips: false,
            has_iphone: false,
        }),
        12,
        true,
    );
    assert!(matches!(
        view.admit(command(12, "finish")),
        Some(PillAction::Finish)
    ));
    for (revision, action) in [
        (11, "finish"),
        (12, "paste"),
        (12, "record"),
        (12, "select-window"),
        (12, "switch-iphone"),
    ] {
        assert!(view.admit(command(revision, action)).is_none());
    }
    let value = serde_json::json!({"revision":12,"action":"finish","path":"/tmp/foreign"});
    assert!(serde_json::from_value::<Command>(value).is_err());
}
#[test]
fn electron_pill_preserves_capabilities_and_one_primary_action() {
    let states = vec![
        Pres::Hidden,
        Pres::Selecting {
            mode: SelectionMode::Area,
            has_iphone: false,
        },
        Pres::Selecting {
            mode: SelectionMode::Screen,
            has_iphone: true,
        },
        Pres::Recording {
            chips: false,
            has_iphone: false,
        },
        Pres::Recording {
            chips: true,
            has_iphone: true,
        },
        Pres::RecordingWarning {
            chips: false,
            has_iphone: false,
        },
        Pres::Processing,
        Pres::Completed {
            label: "Saved".into(),
            routes: vec![],
            warning: false,
            share: Some(false),
        },
    ];
    for state in states {
        let view = test_view(&snapshot(state), 1, true);
        assert!(view.actions.iter().filter(|a| a.primary).count() <= 1);
        assert!(!view.actions.iter().any(|a| a.id.contains("window")));
        if view.phase != "recording" {
            assert!(!view.draggable);
        }
        let json = serde_json::to_string(&view).unwrap();
        for private in ["bundle_path", "capture_id", "config", "credential"] {
            assert!(!json.contains(private));
        }
    }
}
#[cfg(target_os = "linux")]
fn pipe_sandbox_preflight(root_suid_helper: bool, namespace_available: bool) -> Result<(), &'static str> {
    if root_suid_helper || namespace_available { return Ok(()); }
    Err("ENVIRONMENT: production Electron sandbox is unavailable here; no candidate was launched. Use the isolated Omarchy gui-vm.py route in capture/desktop/docs/native-testing.md with an owned candidate and current resource/take admission. Preserve any earlier failed pipe evidence; do not use --no-sandbox, change host policy, or infer candidate failure/native acceptance from this preflight.")
}

#[test]
#[cfg(target_os = "linux")]
fn electron_pill_pipe_preflight_names_supported_route_without_waiving_failure() {
    let refusal = pipe_sandbox_preflight(false, false).unwrap_err();
    assert!(refusal.starts_with("ENVIRONMENT:"));
    assert!(refusal.contains("gui-vm.py"));
    assert!(refusal.contains("resource/take admission"));
    assert!(pipe_sandbox_preflight(true, false).is_ok());
    assert!(pipe_sandbox_preflight(false, true).is_ok());
}

#[test]
#[ignore = "requires the built Electron frontend and an isolated Xvfb/disposable desktop"]
fn electron_pill_real_pipe_roundtrip() {
    use std::{os::unix::fs::PermissionsExt, process::Command as Process};
    #[cfg(target_os = "linux")]
    {
        use std::os::unix::fs::MetadataExt;
        let helper = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("capture/desktop/ui/frontend/node_modules/electron/dist/chrome-sandbox");
        let root_suid = std::fs::metadata(helper).is_ok_and(|m| m.uid() == 0 && m.permissions().mode() & 0o4000 != 0);
        // Admission only: a successful namespace probe is not sandbox/native proof.
        // Refuse before spawning Session or consuming a desktop attempt on unsupported hosts.
        let namespace = root_suid || Process::new("unshare")
            .args(["--user", "--map-root-user", "true"])
            .output().is_ok_and(|output| output.status.success());
        if let Err(reason) = pipe_sandbox_preflight(root_suid, namespace) { panic!("{reason}"); }
    }
    let directory = std::env::temp_dir().join(format!(
        "pill-pipe-{}",
        crate::capture::desktop::workflow::agent_capture::new_id().unwrap()
    ));
    std::fs::create_dir(&directory).unwrap();
    std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o700)).unwrap();
    let output = Process::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "capture::desktop::ui::electron_pill::tests::electron_pill_real_pipe_child",
            "--ignored",
            "--nocapture",
        ])
        .env("APPARENT_PILL_PIPE_CHILD", "1")
        .env("HOME", &directory)
        .env("XDG_CONFIG_HOME", directory.join(".config"))
        .env("XDG_CACHE_HOME", directory.join(".cache"))
        .env("XDG_DATA_HOME", directory.join(".local/share"))
        .output()
        .unwrap();
    let _ = std::fs::remove_dir_all(&directory);
    assert!(
        output.status.success(),
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
#[ignore = "subprocess fixture; invoked only by electron_pill_real_pipe_roundtrip"]
fn electron_pill_real_pipe_child() {
    use std::time::{Duration, Instant};
    assert_eq!(
        std::env::var("APPARENT_PILL_PIPE_CHILD").as_deref(),
        Ok("1")
    );
    let view = test_view(
        &snapshot(Pres::Recording {
            chips: false,
            has_iphone: false,
        }),
        1,
        true,
    );
    let mut session = Session::open(view.clone(), 1, Default::default()).unwrap();
    // A legitimate placement may precede Electron's app/window readiness.
    session.place([100.0, 100.0]);
    let deadline = Instant::now() + Duration::from_secs(8);
    while !session.ready() && Instant::now() < deadline {
        session.update(view.clone(), 1, Default::default());
        std::thread::sleep(Duration::from_millis(20));
    }
    assert!(
        session.ready() && session.healthy(),
        "real Electron did not report readiness"
    );
    // Flood latest-state replacement around activation: control messages must survive.
    for _ in 0..2000 {
        session.update(view.clone(), 1, Default::default());
    }
    session.activate();
    for _ in 0..2000 {
        session.update(view.clone(), 1, Default::default());
    }
    std::thread::sleep(Duration::from_millis(1200));
    assert!(
        session.healthy(),
        "activation acknowledgement was lost under state load"
    );
    let anchor = session.note_badge_anchor().expect("visible child must report its native frame");
    assert!(anchor.iter().all(|value| value.is_finite()) && anchor[2] > 0.0 && anchor[3] > 0.0);
    session.update(
        test_view(&snapshot(Pres::Hidden), 0, false),
        1,
        Default::default(),
    );
    assert!(
        session.actions().is_empty(),
        "rendering alone must never dispatch a capture action"
    );
}

#[test]
fn electron_pill_expired_command_returns_fresh_actionable_readback_without_dispatch() {
    let mut view = test_view(
        &snapshot(Pres::Recording {
            chips: false,
            has_iphone: false,
        }),
        9,
        true,
    );
    assert!(view.consume(command(9, "finish"), false).is_none());
    assert_eq!(view.revision, 10);
    assert!(view.notice.is_some());
    assert!(view.consume(command(9, "cancel"), true).is_none());
    assert_eq!(
        view.revision, 10,
        "old commands cannot consume a new capture's revision"
    );
    assert!(matches!(
        view.consume(command(10, "finish"), true),
        Some(PillAction::Finish)
    ));
    assert!(view.notice.is_none());
}

#[test]
fn electron_pill_requires_an_explicit_capture_for_handoff() {
    let view = project(
        &snapshot(Pres::Completed {
            label: "Saved".into(), routes: vec![], warning: false, share: Some(true),
        }),
        1,
        Facts::default(),
    );
    for action in ["paste", "copy-link", "inspect"] {
        assert!(view.admit(command(1, action)).is_none());
    }
    assert!(matches!(
        view.admit(command(1, "dismiss")),
        Some(PillAction::DismissCompleted)
    ));
}

#[test]
fn captured_level_projects_to_shared_pill_without_a_platform_gate() {
    let mut source = snapshot(Pres::Recording { chips: false, has_iphone: false });
    source.input_waveform = Some([0.6; 24]);
    assert_eq!(test_view(&source, 1, false).input_waveform, Some([0.6; 24]));
}

#[test]
fn agents_setup_navigation_is_revision_bound_and_never_admitted_during_capture() {
    let snapshot = snapshot(Pres::Processing);
    let view = test_view(&snapshot, 9, false);
    assert!(matches!(view.admit(command(9, "settings-labs")), Some(PillAction::SettingsAgents)));
    assert!(view.admit(command(8, "settings-labs")).is_none());
    let mut recording = view.clone(); recording.presentation.phase = "recording".into();
    assert!(recording.admit(command(9, "settings-labs")).is_none());
}

#[test]
fn explicit_public_copy_requires_the_current_enabled_share_control() {
    let view = test_view(&snapshot(Pres::Completed {share:Some(true),warning:false,label:"Saved".into(),routes:vec![]}), 10, false);
    assert!(matches!(view.admit(command(10, "copy-public-link")), Some(PillAction::CopyPublicLink)));
    assert!(view.admit(command(9, "copy-public-link")).is_none());
    let disabled = test_view(&snapshot(Pres::Completed {share:Some(false),warning:false,label:"Saved".into(),routes:vec![]}), 10, false);
    assert!(disabled.admit(command(10, "copy-public-link")).is_none());
    let hidden = test_view(&snapshot(Pres::Completed {share:None,warning:false,label:"Saved".into(),routes:vec![]}), 10, false);
    assert!(hidden.admit(command(10, "copy-public-link")).is_none());
}

#[test]
fn sharing_confirmation_cannot_retain_a_stale_or_unavailable_completion() {
    let view = test_view(&snapshot(Pres::Completed {share:Some(true),warning:false,label:"Link copied".into(),routes:vec![]}), 10, false);
    assert!(view.admits_sharing_confirmation(Some(10)));
    for revision in [None, Some(9), Some(11)] {
        assert!(!view.admits_sharing_confirmation(revision));
    }
    for pres in [
        Pres::Completed {share:Some(false),warning:false,label:"Saved".into(),routes:vec![]},
        Pres::Completed {share:None,warning:false,label:"Saved".into(),routes:vec![]},
        Pres::Recording {chips:false,has_iphone:false}, Pres::Hidden,
    ] {
        assert!(!test_view(&snapshot(pres), 10, false).admits_sharing_confirmation(Some(10)));
    }
}

    #[test]
    fn embedded_module_keeps_state_through_native_calls() -> Result<()> {
        let pill = PolicySession::open()?;
        let selected = pill.dispatch(Event::PickerOpened { mode: Mode::Screen }, 0, 0)?;
        assert_eq!(selected.phase, Phase::Selecting);
        assert!(matches!(selected.mode, Some(Mode::Screen)));
        assert_eq!(pill.dispatch(Event::CaptureStarted, 1, 1)?.phase, Phase::Recording);
        assert_eq!(pill.dispatch(Event::CaptureSealed, 2, 2)?.phase, Phase::Processing);
        let completed = pill.dispatch(Event::CaptureSaved { recovery: false, text: None, frame_count: 1, duration_ms: 1000 }, 3, 3)?;
        assert_eq!(completed.phase, Phase::Completed);
        assert_eq!(completed.wake_in_ms, Some(15_000));
        assert_eq!(pill.dispatch(Event::Deadline, 15_003, 15_003)?.phase, Phase::Dismissing);
        Ok(())
    }
