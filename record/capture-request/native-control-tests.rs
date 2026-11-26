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

#[test]
fn finalization_error_or_cancel_never_publishes_a_saved_path() {
    let mut registry = Registry::default();
    registry.begin("failure");
    registry.finish("failure", Err("disk full".into()));
    let failure = registry.inspect("failure");
    assert_eq!(failure["status"], "failed");
    assert_eq!(failure["error"], "finalization_failed");
    assert_eq!(failure["message"], "disk full");
    assert!(failure["bundle_path"].is_null());
    registry.set("cancel", "cancelled", None, None);
    assert!(registry.inspect("cancel")["bundle_path"].is_null());
    assert_eq!(registry.inspect("unknown")["error"], "unknown_capture");
}

#[test]
fn stop_wait_sends_one_stop_then_inspects_only_that_id_until_saved() {
    let mut calls = vec![];
    let replies = [
        serde_json::json!({"capture_id":"owned", "status":"processing", "outcome":"stopping"}),
        serde_json::json!({"capture_id":"owned", "status":"processing"}),
        serde_json::json!({"capture_id":"owned", "status":"saved", "bundle_path":"/captures/exact.apparent"}),
    ];
    let value = execute_with(
        Some((Action::Stop, "owned")),
        true,
        Duration::from_secs(1),
        |action, _| {
            calls.push(action.map(|(a, id)| (a, id.to_owned())));
            Ok(replies[calls.len() - 1].to_string())
        },
    );
    assert_eq!(value["bundle_path"], "/captures/exact.apparent");
    assert_eq!(
        calls,
        vec![
            Some((Action::Stop, "owned".into())),
            Some((Action::Inspect, "owned".into())),
            Some((Action::Inspect, "owned".into()))
        ]
    );
}

#[test]
fn start_wait_requires_real_readiness_receipt_for_the_owned_id() {
    let mut calls = 0;
    let value = execute_with(
        Some((Action::Start, "owned")),
        true,
        Duration::from_secs(1),
        |action, _| {
            calls += 1;
            assert_eq!(
                action.unwrap().0,
                if calls == 1 {
                    Action::Start
                } else {
                    Action::Inspect
                }
            );
            Ok(serde_json::json!({"capture_id":"owned", "status":if calls == 1 {"starting"} else {"recording"}}).to_string())
        },
    );
    assert_eq!(value["status"], "recording");
    assert_eq!(calls, 2);
}

#[test]
fn capture_start_reports_permission_blockers_on_wait_and_retry() {
    use crate::{permission_admission::Admission, permission_facts::Permission};
    let mut registry = Registry::default();
    for (id, admission, code, missing) in [
        (
            "blocked",
            Admission::Blocked(vec![Permission::ScreenRecording, Permission::Accessibility]),
            "missing_permissions",
            serde_json::json!(["screen-recording", "accessibility"]),
        ),
        ("checking", Admission::Checking, "permissions_checking", serde_json::Value::Null),
    ] {
        assert!(registry.admit(id, false, false));
        registry.set(id, "cancelled", None, None);
        registry.fail_start_permissions(id, admission);
        registry.fail_start(id);
        assert!(!registry.admit(id, false, false));

        let value = execute_with(
            Some((Action::Start, id)),
            true,
            Duration::from_secs(1),
            |action, _| {
                assert_eq!(action, Some((Action::Start, id)));
                Ok(registry.inspect(id).to_string())
            },
        );
        assert_eq!(value["status"], "failed");
        assert_eq!(value["error"], code);
        assert_eq!(value["missing_permissions"], missing);
        assert!(value["bundle_path"].is_null());
    }
    assert!(registry.admit("other", false, false));
    registry.set("other", "cancelled", None, None);
    registry.fail_start("other");
    assert_eq!(registry.inspect("other")["error"], "start_failed");
}
