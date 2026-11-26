use super::*;
#[test]
fn unexpected_finished_then_clean_exit_cannot_become_unavailable() {
    let action: CommandMessage = serde_json::from_slice(br#"{"action":"finished"}"#).unwrap();
    assert!(matches!(action, CommandMessage::Finished));
    let result = validate_finish_receipt(false);
    assert!(result.is_err());
    for reader_ahead in [false, true] {
    let mut state = lifecycle::Lifecycle::default();
    if reader_ahead { state.observed_ready(); }
    state.observed_actor_result(result.is_err(), false);
    let waiting = state.finish();
    state.complete(false, false, false, true);
    assert!(waiting.recv().unwrap().is_err());
    assert!(state.finish().recv().unwrap().is_err());
    state.observed_actor_result(false, false);
    state.observed_ready();
    state.complete(true, false, false, true);
    assert!(state.finish().recv().unwrap().is_err());
    }
}
#[test]
fn an_expected_finish_receipt_preserves_normal_drain() {
    let mut state = lifecycle::Lifecycle::default();
    state.observed_ready();
    state.observed_actor_result(validate_finish_receipt(true).is_err(), true);
    state.complete(true, false, false, false);
    assert_eq!(state.finish().recv().unwrap(), Ok(FinishOutcome::Drained));
}
