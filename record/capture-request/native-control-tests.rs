use super::*;

#[test]
fn only_the_matching_capture_can_be_stopped_or_cancelled() {
    for phase in [Phase::Starting, Phase::Recording] {
        let state = State {
            phase: phase.clone(),
            capture_id: Some("capture-a".into()),
        };
        assert_eq!(
            decide(&state, Action::Cancel, "capture-b"),
            Outcome::WrongCapture
        );
        assert_eq!(
            decide(&state, Action::Stop, "capture-b"),
            Outcome::WrongCapture
        );
        assert_eq!(
            decide(&state, Action::Cancel, "capture-a"),
            Outcome::Cancelled
        );
        assert_eq!(
            decide(&state, Action::Stop, "capture-a"),
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
            decide(&state, Action::Stop, "capture-a"),
            Outcome::AlreadyEnded
        );
        assert_eq!(
            decide(&state, Action::Cancel, "capture-a"),
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
