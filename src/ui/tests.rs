use super::*;

#[cfg(any(target_os = "macos", target_os = "linux"))]
#[test]
pub(super) fn deferred_finalizer_success_survives_dismissal_and_new_capture() {
    for processing_b in [false, true] {
        deferred_finalizer_receipt_survives_dismissal_and_new_capture(true, processing_b, false);
    }
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
#[test]
pub(super) fn deferred_finalizer_failure_survives_dismissal_and_new_capture() {
    for processing_b in [false, true] {
        deferred_finalizer_receipt_survives_dismissal_and_new_capture(false, processing_b, false);
    }
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
#[test]
pub(super) fn deferred_feedback_finalizer_stays_local_after_dismissal() {
    for succeeded in [false, true] {
        for processing_b in [false, true] {
            deferred_finalizer_receipt_survives_dismissal_and_new_capture(succeeded, processing_b, true);
        }
    }
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
pub(super) fn deferred_finalizer_receipt_survives_dismissal_and_new_capture(succeeded: bool, processing_b: bool, feedback: bool) {
    use crate::onboarding::{Effect, Flow, Grants, Input, Permission, Session, Status, Step};
    let (sender, _receiver) = flume::unbounded();
    let mut coordinator = ApparentCoordinator::new(SharedCaptureTelemetry::new(sender), None);
    let grants = Grants {
        statuses: Permission::REQUIRED.into_iter().map(|p| (p, Status::Granted)).collect(),
        ..Default::default()
    };
    coordinator.onboarding = Some(Session::for_test(
        Flow::tour(Step::TryIt, Some(grants)).with_first_capture(true, true, false),
    ));
    let bundle: ApparentBundle = serde_json::from_value(serde_json::json!({
        "version": 1, "id": "a", "createdAtMs": 0, "durationMs": 1000,
        "target": {"mode": "display", "displayId": 0,
            "frame": {"x": 0.0, "y": 0.0, "width": 640.0, "height": 480.0, "scale": 1.0}},
        "transcript": {"source": "test", "text": "", "segments": []},
        "strokes": [], "marks": [], "events": [], "keyframes": [], "contactSheet": "c.png"
    })).unwrap();
    let exact_path = PathBuf::from("/synthetic/finalizer/a-exact.apparent");
    // Hold A's result until B starts, then deliver through finish_recording's
    // production coordinator dispatch, not a test recreation of its guard.
    let deferred = if succeeded {
        Ok((exact_path.clone(), bundle.clone(), String::new()))
    } else {
        Err(anyhow::anyhow!("A's deferred finalizer failed"))
    };
    assert!(coordinator.agent_captures.admit("a", false, false));
    coordinator.agent_capture_id = Some("a".into());
    coordinator.set_island_phase(IslandPhase::Recording);
    // finish_recording detaches A's ID before starting its finalizer.
    let finishing_id = coordinator.agent_capture_id.take().unwrap();
    coordinator.agent_captures.set(&finishing_id, "processing", None, None);
    coordinator.set_island_phase(IslandPhase::Processing);
    let generation_a = coordinator.capture_generation;

    // Native Escape uses cancel_recording: its state-only cancellation and
    // dismiss_island's phase transition revoke UI ownership, not A's worker.
    coordinator.cancel_capture_attempt();
    coordinator.set_island_phase(IslandPhase::Dismissing);
    coordinator.set_island_phase(IslandPhase::Hidden);
    assert_eq!(coordinator.agent_captures.inspect("a")["status"], "processing");
    assert!(coordinator.agent_captures.admit("b", false, false));
    coordinator.agent_capture_id = Some("b".into());
    coordinator.onboarding.as_mut().unwrap().input(Input::ShortcutTriggered);
    coordinator.set_island_phase(IslandPhase::Recording);
    coordinator.agent_captures.set("b", "recording", None, None);
    if processing_b {
        // Also cover B already finalizing: a phase-only guard must not accept A.
        coordinator.agent_capture_id.take();
        coordinator.agent_captures.set("b", "processing", None, None);
        coordinator.set_island_phase(IslandPhase::Processing);
    }
    let state_b = coordinator.agent_state();
    let receipt_b = coordinator.agent_captures.inspect("b");
    let generation_b = coordinator.capture_generation;
    coordinator.completed_dir = Some(PathBuf::from("/synthetic/b-review.apparent"));
    coordinator.completed_note = Some("B's note".into());
    coordinator.review_bundle = Some((PathBuf::from("/synthetic/b-review.apparent"), bundle));
    let review_b = coordinator.review_bundle.clone();

    let mut completed = Vec::new();
    coordinator.receive_capture_result(generation_a, Some(&finishing_id), feedback, deferred, |dir| {
        completed.push(dir.to_path_buf());
    }, |_, _| {
        panic!("stale A must not enter UI/clipboard/onboarding effects");
    });
    assert_eq!(completed, if succeeded && !feedback { vec![exact_path.clone()] } else { vec![] });
    let receipt_a = coordinator.agent_captures.inspect("a");
    if succeeded {
        assert_eq!(receipt_a, serde_json::json!({
            "capture_id": "a", "status": "saved", "bundle_path": exact_path, "error": null
        }));
    } else {
        assert_eq!(receipt_a, serde_json::json!({
            "capture_id": "a", "status": "failed", "bundle_path": null,
            "error": "finalization_failed", "message": "A's deferred finalizer failed"
        }));
    }
    assert_eq!(coordinator.agent_state(), state_b);
    assert_eq!(coordinator.agent_captures.inspect("b"), receipt_b);
    assert_eq!(coordinator.capture_generation, generation_b);
    assert_eq!(coordinator.completed_dir, Some(PathBuf::from("/synthetic/b-review.apparent")));
    assert_eq!(coordinator.completed_note.as_deref(), Some("B's note"));
    assert_eq!(coordinator.review_bundle, review_b);
    assert_eq!(coordinator.onboarding.as_mut().unwrap().action("continue"), Effect::None);
}

#[test]
pub(super) fn current_finalizer_completes_once_before_ui_for_agent_and_manual_captures() {
    for owned in [false, true] {
        for feedback in [false, true] {
            let (sender, _receiver) = flume::unbounded();
            let mut coordinator = ApparentCoordinator::new(SharedCaptureTelemetry::new(sender), None);
            coordinator.set_island_phase(IslandPhase::Processing);
            let generation = coordinator.capture_generation;
            if owned {
                assert!(coordinator.agent_captures.admit("a", false, false));
                coordinator.agent_captures.set("a", "processing", None, None);
            }
            let bundle = serde_json::from_value(serde_json::json!({
                "version": 1, "id": "a", "createdAtMs": 0, "durationMs": 1000,
                "target": {"mode": "display", "displayId": 0,
                    "frame": {"x": 0.0, "y": 0.0, "width": 640.0, "height": 480.0, "scale": 1.0}},
                "transcript": {"source": "test", "text": "", "segments": []},
                "strokes": [], "marks": [], "events": [], "keyframes": [], "contactSheet": "c.png"
            })).unwrap();
            let path = PathBuf::from("/synthetic/current-exact.apparent");
            let effects = std::cell::RefCell::new(Vec::new());
            coordinator.receive_capture_result(generation, owned.then_some("a"), feedback,
                Ok((path.clone(), bundle, String::new())),
                |dir| { assert_eq!(dir, path); effects.borrow_mut().push("completed"); },
                |coord, result| {
                    assert_eq!(result.unwrap().0, path);
                    if owned {
                        assert_eq!(coord.agent_captures.inspect("a")["status"], "saved");
                    }
                    effects.borrow_mut().push("ui");
                });
            assert_eq!(*effects.borrow(), if feedback { vec!["ui"] } else { vec!["completed", "ui"] });
        }
    }
}

#[test]
pub(super) fn failed_hidden_shortcut_attempt_cannot_lend_eligibility_to_menu_capture() {
    use crate::onboarding::{Effect, Flow, Grants, Input, Permission, Session, Status, Step};
    let (sender, _receiver) = flume::unbounded();
    let mut coordinator = ApparentCoordinator::new(SharedCaptureTelemetry::new(sender), None);
    let grants = Grants {
        statuses: Permission::REQUIRED.into_iter().map(|p| (p, Status::Granted)).collect(),
        ..Default::default()
    };
    coordinator.onboarding = Some(Session::for_test(
        Flow::tour(Step::TryIt, Some(grants)).with_first_capture(true, true, false),
    ));
    coordinator.onboarding.as_mut().unwrap().input(Input::ShortcutTriggered);
    // The same cancellation path used by journal/startup failure, before any island appears.
    coordinator.cancel_capture_attempt();
    assert!(matches!(coordinator.island_phase, IslandPhase::Hidden));
    assert!(coordinator.active_recording.is_none());
    // A later menu recording has no ShortcutTriggered event.
    coordinator.set_island_phase(IslandPhase::Recording);
    coordinator.set_island_phase(IslandPhase::Processing);
    coordinator.set_island_phase(IslandPhase::Completed {
        finished_at: Instant::now(), frame_count: 1, duration_ms: 1000, inbox_count: 0,
    });
    assert_eq!(coordinator.onboarding.as_mut().unwrap().action("continue"), Effect::None);
}

#[test]
pub(super) fn stale_finalization_cannot_complete_a_new_practice_recording() {
    use crate::onboarding::{Effect, Flow, Grants, Input, Permission, Step};
    let (sender, _receiver) = flume::unbounded();
    let mut coordinator = ApparentCoordinator::new(SharedCaptureTelemetry::new(sender), None);
    let mut grants = Grants::default();
    for permission in Permission::REQUIRED {
        grants.statuses.insert(permission, crate::onboarding::Status::Granted);
    }
    let mut flow = Flow::tour(Step::TryIt, Some(grants))
        .with_first_capture(true, true, false);
    coordinator.set_island_phase(IslandPhase::Recording);
    let first = coordinator.capture_generation;
    coordinator.set_island_phase(IslandPhase::Processing);
    assert!(coordinator.accepts_capture_result(first));
    coordinator.set_island_phase(IslandPhase::Dismissing);
    // The detached worker is still running, but dismissal revokes its UI result.
    assert!(!coordinator.accepts_capture_result(first));
    coordinator.set_island_phase(IslandPhase::Hidden);
    flow.on(Input::ShortcutTriggered);
    assert_eq!(flow.on(Input::CaptureStarted), Effect::Hide);
    coordinator.set_island_phase(IslandPhase::Recording);
    let second = coordinator.capture_generation;
    let deliver = |coordinator: &mut ApparentCoordinator, flow: &mut Flow, generation| {
        if coordinator.accepts_capture_result(generation) {
            coordinator.set_island_phase(IslandPhase::Completed {
                finished_at: Instant::now(), frame_count: 1, duration_ms: 1000, inbox_count: 0,
            });
            flow.on(Input::CaptureEnded { completed: true });
        }
    };
    deliver(&mut coordinator, &mut flow, first);
    assert!(matches!(coordinator.island_phase, IslandPhase::Recording));
    assert_eq!(flow.step(), Step::TryIt);
    coordinator.set_island_phase(IslandPhase::Processing);
    deliver(&mut coordinator, &mut flow, first);
    assert!(coordinator.is_processing());
    assert_eq!(flow.step(), Step::TryIt);
    deliver(&mut coordinator, &mut flow, second);
    assert_eq!(flow.step(), Step::Done);
    assert!(!coordinator.accepts_capture_result(second), "a duplicate result is stale too");
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
#[test]
pub(super) fn failed_capture_start_discards_its_identity_without_an_active_recording() {
    let (sender, _receiver) = flume::unbounded();
    let mut coordinator = ApparentCoordinator::new(SharedCaptureTelemetry::new(sender), None);
    coordinator.agent_capture_id = Some("pending-capture".into());

    assert!(coordinator.discard_recording().is_none());
    assert_eq!(coordinator.agent_state().capture_id, None);
}

#[test]
pub(super) fn feedback_issue_url_opens_a_public_template_without_capture_data() {
    assert_eq!(
        feedback_issue_url(),
        "https://github.com/tryapparent/apparent/issues/new?template=bug_report.yml"
    );
}

#[test]
pub(super) fn capture_failure_status_survives_inbox_changes() {
    let failure = Some("Capture failed — no screen frames".to_owned());
    assert_eq!(status_bar_text(None, failure.clone()), failure);
    assert_eq!(status_bar_text(Some("Exporting…".into()), failure), Some("Exporting…".into()));
}

#[test]
pub(super) fn picker_exclusion_survives_session_reset_until_deferred_close() {
    // reset_for_session clears the prior session's IDs before the initial
    // ScreenCaptureKit filter is built, while the picker is still open.
    let mut excluded = Vec::new();
    restore_picker_exclusion(&mut excluded, Some(41));
    restore_picker_exclusion(&mut excluded, Some(41));
    restore_picker_exclusion(&mut excluded, None);
    assert_eq!(excluded, vec![41]);
}

#[cfg(target_os = "linux")]
#[test]
pub(super) fn recording_equalizer_is_available_without_an_experiment() {
    assert!(recording_equalizer_enabled());
}

#[cfg(target_os = "linux")]
#[test]
pub(super) fn equalizer_only_moves_for_new_samples_and_decays_on_stall() {
    let mut meter = InputEqualizer::default();
    meter.step(None, false); // lab recording / missing microphone
    assert_eq!(meter.level, 0.0);
    meter.step(Some((1280, 0.8)), false);
    assert!(meter.level > 0.0 && meter.level < 0.8);
    let last = meter.level;
    meter.step(Some((1280, 0.8)), false); // same samples, not proof of continued input
    assert!(meter.level < last);
    meter.step(Some((2560, 0.0)), true); // fresh silent callback
    assert_eq!(meter.level, 0.0);
    meter.step(Some((128, 0.5)), true); // new capture resets count
    assert_eq!(meter.level, 0.5);
}

#[test]
pub(super) fn completed_capture_distinguishes_missing_audio_from_no_words_and_model_failure() {
    let empty = crate::model::TranscriptData::default();
    let spoken = crate::model::TranscriptData {
        text: "hello".into(),
        ..Default::default()
    };
    let skipped = crate::model::TranscriptData {
        source: "none".into(),
        ..Default::default()
    };
    let unavailable = crate::model::TranscriptData {
        missing: Some(crate::model::MissingTranscript {
            reason: "Model unavailable".into(),
            retry: true,
        }),
        ..Default::default()
    };
    assert_eq!(
        completed_audio_issue(None, &empty, false),
        Some(CompletedAudioIssue::NoAudio)
    );
    assert_eq!(
        completed_audio_issue(None, &empty, true),
        Some(CompletedAudioIssue::NoWords)
    );
    assert_eq!(
        completed_audio_issue(None, &unavailable, true),
        Some(CompletedAudioIssue::TranscriptionUnavailable)
    );
    assert_eq!(
        completed_audio_issue(None, &unavailable, false),
        Some(CompletedAudioIssue::NoAudio)
    );
    assert_eq!(
        completed_audio_issue(None, &skipped, false),
        Some(CompletedAudioIssue::NoAudio)
    );
    assert_eq!(
        completed_audio_issue(None, &skipped, true),
        Some(CompletedAudioIssue::TranscriptionUnavailable)
    );
    assert_eq!(completed_audio_issue(Some("iphone"), &empty, false), None);
    assert_eq!(completed_audio_issue(Some("iphone"), &empty, true), None);
    assert_eq!(completed_audio_issue(None, &spoken, true), None);
    assert_eq!(
        completed_audio_issue(None, &spoken, false),
        Some(CompletedAudioIssue::NoAudio)
    );
    assert_eq!(
        completed_status_label(0, None, Some(CompletedAudioIssue::NoAudio)),
        "Copied · No audio"
    );
    assert_eq!(
        completed_status_label(0, None, Some(CompletedAudioIssue::NoWords)),
        "Copied · No words"
    );
    assert_eq!(
        completed_status_label(0, None, Some(CompletedAudioIssue::TranscriptionUnavailable)),
        "Copied · Transcript unavailable"
    );
}

#[test]
pub(super) fn review_history_stops_at_both_ends() {
    let paths = vec![
        PathBuf::from("new"),
        PathBuf::from("middle"),
        PathBuf::from("old"),
    ];
    assert_eq!(review_neighbor(&paths, &paths[0], true), Some(&paths[1]));
    assert_eq!(review_neighbor(&paths, &paths[1], false), Some(&paths[0]));
    assert_eq!(review_neighbor(&paths, &paths[2], true), None);
    assert_eq!(review_neighbor(&paths, &paths[0], false), None);
    assert_eq!(
        review_neighbor(&paths, &PathBuf::from("elsewhere"), true),
        None
    );
}

#[test]
pub(super) fn review_navigation_failure_takes_priority_over_history_scan_failure() {
    assert_eq!(
        review_notice(
            Some("scan failed"),
            Some("Could not open capture: removed"),
            false,
        ),
        Some("Could not open capture: removed".to_owned())
    );
    assert_eq!(
        review_notice(Some("scan failed"), Some("Ready"), false),
        Some("Could not read captures: scan failed".to_owned())
    );
}

#[test]
pub(super) fn feedback_review_displays_privacy_notice_and_browser_errors() {
    let warning = "Review before sharing publicly. Nothing is uploaded automatically.";
    assert_eq!(
        review_notice(None, Some(warning), true).as_deref(),
        Some(warning)
    );
    let error = "Could not open GitHub: browser unavailable";
    assert_eq!(
        review_notice(None, Some(error), true).as_deref(),
        Some(error)
    );
}

#[test]
pub(super) fn review_workspace_gives_words_reading_room_without_cropping_the_stage() {
    let (stage, words) = review_workspace_widths(1120.0);
    assert!(words >= 420.0, "words panel too narrow: {words}");
    assert!(stage >= 600.0, "image stage too narrow: {stage}");
    let (stage, words) = review_workspace_widths(760.0);
    assert_eq!((stage, words), (720.0, 760.0));
    let (stage, words) = review_workspace_widths(320.0);
    assert_eq!((stage, words), (280.0, 320.0));
}

#[test]
pub(super) fn selected_frame_speech_follows_selection_not_the_whole_capture() {
    let frames = [Some("first moment"), Some("second moment")];
    assert_eq!(review_frame_speech(&frames, 1), "second moment");
    assert_eq!(review_frame_speech(&frames, 2), "No words at this moment.");
    assert_eq!(review_speech_status(false, None), None);
    assert!(
        review_speech_status(true, None)
            .unwrap()
            .contains("audio was saved")
    );
    assert_eq!(
        review_speech_status(false, Some("speech failed")),
        Some("Transcription unavailable: speech failed".into())
    );
}

#[test]
pub(super) fn recording_controls_offer_whiteboard_on_every_desktop() {
    assert!(whiteboard_enabled());
    let controls = trail_keys(false, false, &[], "hud-");
    assert_eq!(
        controls.iter().any(|item| item
            .as_ref()
            .is_some_and(|(name, _)| name == "hud-whiteboard")),
        true
    );
}

#[test]
pub(super) fn island_geometry_is_concentric() {
    assert_eq!(ISLAND_RADIUS, CHIP_RADIUS + ISLAND_INSET);
    assert_eq!(ISLAND_PAD + 1.0, ISLAND_INSET);
    assert_eq!(CHIP_H + 2.0 * ISLAND_INSET, ISLAND_H);
    assert!(ISLAND_H <= PILL_WINDOW_H);
}

#[test]
pub(super) fn a_held_drag_needs_room_for_an_area() {
    let laptop = [0.0, 0.0, 1728.0, 1117.0];
    assert_eq!(
        area_rect([100.0, 80.0], [40.0, 20.0], laptop),
        Some([40.0, 20.0, 60.0, 60.0])
    );
    assert_eq!(area_rect([0.0, 0.0], [30.0, 200.0], laptop), None);
}

#[test]
pub(super) fn recording_controls_follow_the_pointer_without_retargeting_the_capture() {
    let first = crate::screens::Screen {
        id: 1,
        frame: [0.0, 0.0, 1920.0, 1200.0],
        visible: [0.0, 0.0, 1920.0, 1200.0],
        scale: 1.25,
        safe_top: 0.0,
    };
    let second = crate::screens::Screen {
        id: 2,
        frame: [1920.0, 0.0, 1280.0, 800.0],
        visible: [1920.0, 0.0, 1280.0, 800.0],
        scale: 1.0,
        safe_top: 0.0,
    };
    let screens = [first, second];
    let selected_capture = second.frame;
    assert_eq!(
        recording_pointer_destination(second.frame, [2400.0, 300.0], &screens),
        None
    );
    assert_eq!(
        recording_pointer_destination(second.frame, [350.0, 300.0], &screens),
        Some(first.frame)
    );
    assert_eq!(
        recording_pointer_destination(first.frame, [350.0, 300.0], &screens),
        None
    );
    assert_eq!(
        recording_pointer_destination(first.frame, [2400.0, 300.0], &screens),
        Some(second.frame)
    );
    assert_eq!(
        recording_pointer_destination(second.frame, [3300.0, 300.0], &screens),
        None
    );
    assert_eq!(
        selected_capture, second.frame,
        "the selected capture must not move with the UI"
    );
}

/// Kit's review: a drag that starts at x -150 on a left display and overshoots to x 160 on
/// the laptop keeps to the left display, so it's recorded there (`screens::area_on_display`).
#[test]
pub(super) fn an_area_drag_stays_on_the_display_it_started_on() {
    let left = [-1920.0, 37.0, 1920.0, 1080.0];
    assert_eq!(
        area_rect([-150.0, 200.0], [160.0, 400.0], left),
        Some([-150.0, 200.0, 150.0, 200.0])
    );
    // Past its bottom-left corner too.
    assert_eq!(
        area_rect([-1800.0, 1000.0], [-2100.0, 1300.0], left),
        Some([-1920.0, 1000.0, 120.0, 117.0])
    );
    // What's left on the display can be too small to record.
    assert_eq!(area_rect([-20.0, 200.0], [400.0, 400.0], left), None);
    let screens = [
        crate::screens::Screen {
            id: 1,
            frame: [0.0, 0.0, 1728.0, 1117.0],
            visible: [0.0, 0.0, 1728.0, 1117.0],
            scale: 2.0,
            safe_top: 0.0,
        },
        crate::screens::Screen {
            id: 2,
            frame: left.map(f64::from),
            visible: left.map(f64::from),
            scale: 1.0,
            safe_top: 0.0,
        },
    ];
    let area = area_rect([-150.0, 200.0], [160.0, 400.0], left).unwrap();
    let (i, rect) = crate::screens::area_on_display(&screens, area).unwrap();
    assert_eq!((screens[i].id, rect), (2, area));
}

#[test]
pub(super) fn selection_modes_cycle_in_hud_order() {
    use SelectionMode::{Area, Iphone, Screen, Window};
    let walk = |has_iphone: bool, forward: bool| {
        let mut mode = Area;
        let mut seen = Vec::new();
        for _ in 0..5 {
            mode = mode.cycled(forward, has_iphone);
            seen.push(mode);
        }
        seen
    };
    if cfg!(target_os = "macos") {
        assert_eq!(walk(true, true), [Window, Screen, Iphone, Area, Window]);
        assert_eq!(walk(true, false), [Iphone, Screen, Window, Area, Iphone]);
    } else {
        // No cabled iPhone off macOS, even when one is plugged in.
        assert_eq!(walk(true, true), walk(false, true));
    }
    assert_eq!(walk(false, true), [Window, Screen, Area, Window, Screen]);
    assert_eq!(walk(false, false), [Screen, Window, Area, Screen, Window]);
    // An unplugged phone leaves the picker on a mode that is no longer listed.
    assert_eq!(Iphone.cycled(true, false), Area);
    assert_eq!(Iphone.cycled(false, false), Screen);
}

#[test]
pub(super) fn digits_pick_modes_by_hud_position() {
    use SelectionMode::{Area, Iphone, Screen, Window};
    let pick = |key, has_iphone| SelectionMode::from_digit(key, has_iphone);
    assert_eq!(pick("1", true), Some(Area));
    assert_eq!(pick("2", true), Some(Window));
    assert_eq!(pick("3", false), Some(Screen));
    assert_eq!(pick("4", true), cfg!(target_os = "macos").then_some(Iphone));
    assert_eq!(pick("4", false), None);
    assert_eq!(pick("0", true), None);
    assert_eq!(pick("5", true), None);
    assert_eq!(pick("a", true), None);
}

#[test]
pub(super) fn selecting_row_width_mirrors_layout() {
    let segment = |label: f32| label + 2.0 * SEG_PX + SEG_ICON + SEG_ICON_GAP;
    let divider = 1.0 + 2.0 * DIVIDER_MX;
    // Three segments, divider, ✕: four gaps between five items.
    assert_eq!(
        selecting_row_width(&[30.0, 50.0, 45.0], None),
        segment(30.0) + segment(50.0) + segment(45.0) + divider + CHIP_H + 4.0 * CHIP_GAP
    );
    // A fourth segment and the Record chip each add their width and one gap.
    assert_eq!(
        selecting_row_width(&[30.0, 50.0, 45.0, 42.0], Some(70.0)),
        selecting_row_width(&[30.0, 50.0, 45.0], None) + segment(42.0) + 70.0 + 2.0 * CHIP_GAP
    );
    // The widest row (generous label estimates) still fits the pill window.
    let widest = selecting_row_width(&[34.0, 56.0, 50.0, 46.0], Some(2.0 * CHIP_PX + 52.0));
    assert!(
        widest + 2.0 * ISLAND_INSET <= PILL_WINDOW_W - 16.0,
        "{widest}"
    );
}

#[test]
pub(super) fn island_spring_settles_without_large_overshoot() {
    let (mut x, mut v) = (200.0_f32, 0.0_f32);
    let mut peak = x;
    for _ in 0..90 {
        (x, v) = spring_step(x, v, 300.0, 1.0 / 60.0, motion::Tune::DEFAULT.island);
        peak = peak.max(x);
    }
    assert!((x - 300.0).abs() < 0.5, "settled at {x}");
    assert!(peak < 300.0 + 100.0 * 0.05, "overshoot peak {peak}");
}

#[test]
pub(super) fn reveal_springs_lead_the_morph_palette_and_settle() {
    let t = motion::Tune::DEFAULT;
    // Width leads morph .42/.16 open and .38/.08 close on a slightly faster spring.
    assert!(t.reveal_open.response < 0.42);
    assert!(t.reveal_close.response < 0.38);
    assert!(t.reveal_close.response < t.reveal_open.response);
    assert!((t.reveal_open.bounce - 0.16).abs() < 1e-6);
    assert!(t.reveal_exit_s < t.reveal_enter_s && t.reveal_exit_s >= 0.75 * t.reveal_enter_s);
    assert!(t.reveal_blur_px <= 4.0);
    for (spring, from, to) in [
        (t.reveal_open, ISLAND_OPEN_FROM_W, 430.0),
        (t.reveal_close, 430.0, 330.0),
    ] {
        let (mut x, mut v) = (from, 0.0_f32);
        for _ in 0..60 {
            (x, v) = spring_step(x, v, to, 1.0 / 60.0, spring);
        }
        assert!((x - to).abs() < 0.5, "settled at {x}");
    }
}

#[test]
pub(super) fn trailing_items_fade_in_as_the_edge_uncovers_them() {
    let offsets = trail_offsets(100.0, &[50.0, 60.0]);
    assert_eq!(offsets, vec![100.0, 100.0 + 50.0 + CHIP_GAP]);
    assert_eq!(edge_alpha(100.0, 100.0, 50.0), 0.0);
    assert!((edge_alpha(125.0, 100.0, 50.0) - 0.5).abs() < 1e-6);
    assert_eq!(edge_alpha(150.0, 100.0, 50.0), 1.0);
    assert_eq!(edge_alpha(400.0, 100.0, 50.0), 1.0);
}

#[test]
pub(super) fn a_switch_chip_morph_starts_where_the_pill_was_and_rests_centred() {
    let (width, target, clock_w) = (336.0, 298.0, 35.0);
    let start = SwitchLayout::new(SwitchMorph { slide: None }, width, target, clock_w);
    // The lead is still pinned to the left edge and the chips start behind its divider.
    assert!(start.ghost_left().abs() < 1e-3, "{}", start.ghost_left());
    let chips_x = CHIP_H + clock_w + LEAD_TRAIL + 2.0 * CHIP_GAP + 1.0 + 2.0 * DIVIDER_MX;
    assert!((start.row_left() - chips_x).abs() < 1e-3);
    assert_eq!(start.ghost_alphas(), [1.0, 1.0, 1.0]);
    // At rest the picker row is centred in the capsule, the lead past its edge and gone.
    let rest = SwitchLayout::new(
        SwitchMorph {
            slide: Some((0.0, 0.0)),
        },
        target,
        target,
        clock_w,
    );
    assert!(rest.row_left().abs() < 1e-3);
    assert_eq!(rest.ghost_alphas(), [0.0, 0.0, 0.0]);
}

#[test]
pub(super) fn island_spring_is_stable_for_long_frames() {
    let (x, _) = spring_step(200.0, 0.0, 300.0, 0.05, motion::Tune::DEFAULT.island);
    assert!(x > 200.0 && x < 300.0);
}

#[test]
pub(super) fn area_badge_sits_below_and_flips_near_edges() {
    let screen = [1440.0, 900.0];
    let badge = [90.0, BADGE_H];
    let [bx, by] = place_badge(
        [100.0, 100.0, 300.0, 200.0],
        badge,
        screen,
        BadgeAnchor::BelowTrailing,
    );
    assert_eq!([bx, by], [310.0, 308.0]);

    let [_, by] = place_badge(
        [100.0, 600.0, 300.0, 290.0],
        badge,
        screen,
        BadgeAnchor::BelowTrailing,
    );
    assert_eq!(by, 600.0 - BADGE_GAP - BADGE_H);

    let [bx, by] = place_badge(
        [0.0, 0.0, 40.0, 900.0],
        badge,
        screen,
        BadgeAnchor::BelowTrailing,
    );
    assert_eq!(bx, BADGE_MARGIN);
    assert!(by + BADGE_H <= 900.0 - BADGE_MARGIN);
}

#[test]
pub(super) fn window_badge_centers_and_clamps_on_screen() {
    let screen = [1440.0, 900.0];
    let [bx, by] = place_badge(
        [200.0, 100.0, 600.0, 400.0],
        [200.0, BADGE_H],
        screen,
        BadgeAnchor::Center,
    );
    assert_eq!([bx, by], [400.0, 289.0]);

    let clipped = clip_rect([-300.0, -50.0, 400.0, 200.0], screen);
    assert_eq!(clipped, [0.0, 0.0, 100.0, 150.0]);
}

#[test]
pub(super) fn timeline_lines_split_into_time_and_body() {
    assert_eq!(
        split_timeline_line("0:04 ✎ Circle around button — frame #2"),
        ("0:04", "Circle around button — frame #2", true)
    );
    assert_eq!(
        split_timeline_line("0:05 · Clicked Save"),
        ("0:05", "Clicked Save", false)
    );
    assert_eq!(
        split_timeline_line("0:01 “hello”"),
        ("0:01", "“hello”", false)
    );
}

#[test]
pub(super) fn last_used_mode_keys_round_trip() {
    for mode in SelectionMode::ALL {
        assert_eq!(SelectionMode::from_key(mode.key()), Some(mode));
    }
    assert_eq!(
        SelectionMode::from_key("iphone\n"),
        Some(SelectionMode::Iphone)
    );
    assert_eq!(SelectionMode::from_key("fullscreen"), None);
}

#[test]
pub(super) fn clock_template_is_width_stable() {
    assert_eq!(clock_template("12:34"), "00:00");
    assert_eq!(completed_label(0, None), "Copied");
    assert_eq!(
        completed_label(0, Some("Sent to APPARENT")),
        "Sent to APPARENT"
    );
    assert_eq!(completed_label(1, Some("Sent to APPARENT")), "From iPhone");
    assert_eq!(completed_label(3, None), "3 from iPhone");
    assert_eq!(
        completed_status_label(0, None, Some(CompletedAudioIssue::NoWords)),
        "Copied · No words"
    );
    assert_eq!(
        completed_status_label(
            0,
            Some("Sent to APPARENT"),
            Some(CompletedAudioIssue::NoWords)
        ),
        "Sent to APPARENT · No words"
    );
    assert_eq!(completed_status_label(0, None, None), "Copied");
    assert_eq!(
        completed_status_label(
            0,
            Some("Saved · review"),
            Some(CompletedAudioIssue::NoAudio)
        ),
        "Saved · review · No audio"
    );
}
