use super::*;

#[test]
fn only_the_matching_capture_can_be_stopped_or_cancelled() {
    let registry = Registry::default();
    for phase in [Phase::Starting, Phase::Recording] {
        let state = State {
            phase: phase.clone(),
            capture_id: Some("capture-a".into()),
        };
        assert_eq!(
            registry.decide(&state, Action::Cancel, "capture-b", false),
            Outcome::WrongCapture
        );
        assert_eq!(
            registry.decide(&state, Action::Stop, "capture-b", false),
            Outcome::WrongCapture
        );
        assert_eq!(
            registry.decide(&state, Action::Cancel, "capture-a", false),
            Outcome::Cancelled
        );
        assert_eq!(
            registry.decide(&state, Action::Stop, "capture-a", false),
            if phase == Phase::Recording {
                Outcome::Stopping
            } else {
                Outcome::NotReady
            }
        );
    }
    for phase in [
        Phase::Idle,
        Phase::Selecting,
        Phase::Processing,
        Phase::Completed,
    ] {
        let state = State {
            phase,
            capture_id: None,
        };
        assert_eq!(
            registry.decide(&state, Action::Stop, "capture-a", false),
            Outcome::AlreadyEnded
        );
        assert_eq!(
            registry.decide(&state, Action::Cancel, "capture-a", false),
            Outcome::AlreadyEnded
        );
    }
}

#[test]
fn ids_are_opaque_fresh_and_command_ids_are_strict() {
    let first = new_id().unwrap();
    let second = new_id().unwrap();
    assert!(valid_id(&first));
    assert!(valid_id(&second));
    assert_ne!(first, second);
    for invalid in [
        "",
        "capture-a",
        "0\nstop 00000000000000000000000000000000",
        "g0000000000000000000000000000000",
    ] {
        assert!(!valid_id(invalid));
        assert!(command(Some((Action::Cancel, invalid))).is_err());
    }
}

#[test]
fn response_phase_and_outcome_are_machine_readable() {
    let response = serde_json::json!({
        "state": State { phase: Phase::Starting, capture_id: Some("id".into()) },
        "outcome": Outcome::NotReady,
    });
    assert_eq!(response["state"]["phase"], "starting");
    assert_eq!(response["outcome"], "not_ready");
}

#[test]
fn support_start_has_its_own_admission() {
    let id = new_id().unwrap();
    let deadline = storage_clock_ms() + 1000;
    let (action, expires) = parse_capture_request(&format!("start-report {id} {deadline}")).unwrap();
    assert_eq!(action, Some((Action::StartReport, id)));
    assert!(expires >= clock_ms());
}

#[test]
fn owned_admission_is_once_only_and_rejections_cannot_start_later() {
    let mut registry = Registry::default();
    let mut starts = 0;
    for (id, occupied, expired) in [
        ("a", false, false),
        ("b", true, false),
        ("late", false, true),
        ("a", false, false),
        ("b", false, false),
        ("late", false, false),
    ] {
        starts += usize::from(registry.admit(id, occupied, expired));
    }
    assert_eq!(starts, 1);
    assert_eq!(registry.inspect("a")["status"], "starting");
    assert_eq!(registry.inspect("b")["error"], "occupied");
    assert_eq!(registry.inspect("late")["error"], "admission_expired");
}

#[test]
fn older_saved_result_survives_new_capture_and_stop_retry_does_not_stop_it() {
    let mut registry = Registry::default();
    registry.begin("old");
    registry.finish("old", Ok(std::path::Path::new("/captures/exact.apparent")));
    registry.begin("new");
    let state = State {
        phase: Phase::Recording,
        capture_id: Some("new".into()),
    };
    assert_eq!(
        registry.decide(&state, Action::Stop, "old", false),
        Outcome::AlreadyEnded
    );
    assert_eq!(
        registry.inspect("old")["bundle_path"],
        "/captures/exact.apparent"
    );
    assert_eq!(
        registry.decide(&state, Action::Stop, "other", false),
        Outcome::WrongCapture
    );
    assert_eq!(
        registry.decide(&state, Action::Stop, "new", false),
        Outcome::Stopping
    );
    registry.set("new", "processing", None, None);
    assert_eq!(
        registry.decide(&state, Action::Stop, "new", false),
        Outcome::AlreadyEnded
    );
}
