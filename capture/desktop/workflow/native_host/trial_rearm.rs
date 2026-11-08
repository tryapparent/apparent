use super::*;

const WALL: u64 = 1_800_000_000_000;
const MONO: u64 = 50_000;

fn source() -> SourceObservation {
    SourceObservation {
        binding: TrialBinding {
            source_epoch: "gui-epoch-1".into(),
            source_revision: 12,
            binding_id: "backend-registration-4".into(),
            effective_binding: "Ctrl+Shift+R".into(),
        },
        available: true,
        registered: true,
        physical_edges_available: true,
        busy: false,
        active_capture: false,
    }
}

fn request(
    source: &SourceObservation,
    id: &str,
    replaces: Option<TerminalIdentity>,
) -> BeginRequest {
    BeginRequest {
        reservation_id: id.into(),
        source_epoch: source.binding.source_epoch.clone(),
        source_revision: source.binding.source_revision,
        binding_id: source.binding.binding_id.clone(),
        effective_binding: source.binding.effective_binding.clone(),
        expires_at_wall_ms: WALL + 5_000,
        replaces,
    }
}

fn admitted() -> (ShortcutTrialGuard, SourceObservation) {
    let source = source();
    let mut guard = ShortcutTrialGuard::new();
    guard.observe_source(Some(&source));
    assert_eq!(
        guard.begin(&request(&source, "r1", None), MONO, WALL),
        BeginOutcome::Accepted
    );
    (guard, source)
}

fn edge(
    source: &SourceObservation,
    kind: EdgeKind,
    chord: &str,
    wall: u64,
    mono: u64,
) -> PhysicalEdge {
    PhysicalEdge {
        source_epoch: source.binding.source_epoch.clone(),
        source_revision: source.binding.source_revision,
        binding_id: source.binding.binding_id.clone(),
        chord_id: chord.into(),
        kind,
        press_id: (kind == EdgeKind::Press).then(|| "press-1".into()),
        wall_time_ms: wall,
        monotonic_time_ms: mono,
    }
}

fn observed_fact(guard: &mut ShortcutTrialGuard, source: &SourceObservation) -> TrialFact {
    guard.physical_edge(&edge(
        source,
        EdgeKind::Press,
        "chord",
        WALL + 10,
        MONO + 10,
    ));
    guard.physical_edge(&edge(
        source,
        EdgeKind::Release,
        "chord",
        WALL + 20,
        MONO + 20,
    ));
    guard.fact().clone()
}

fn replacement_identity(fact: &TrialFact) -> TerminalIdentity {
    let (binding, reservation_id) = match fact {
        TrialFact::Observed {
            binding,
            reservation_id,
            ..
        }
        | TrialFact::Expired {
            binding,
            reservation_id,
        }
        | TrialFact::Cancelled {
            binding,
            reservation_id,
        }
        | TrialFact::Unknown {
            binding,
            reservation_id,
        } => (binding, reservation_id),
        other => panic!("not terminal: {other:?}"),
    };
    TerminalIdentity {
        reservation_id: reservation_id.clone(),
        source_epoch: binding.source_epoch.clone(),
        source_revision: binding.source_revision,
        binding_id: binding.binding_id.clone(),
        effective_binding: binding.effective_binding.clone(),
    }
}

#[test]
fn idle_begin_rejects_unexpected_replaces_but_accepts_without_it() {
    let source = source();
    let mut guard = ShortcutTrialGuard::new();
    guard.observe_source(Some(&source));
    let idle = guard.fact().clone();
    let invented = TerminalIdentity {
        reservation_id: "old".into(),
        source_epoch: source.binding.source_epoch.clone(),
        source_revision: source.binding.source_revision,
        binding_id: source.binding.binding_id.clone(),
        effective_binding: source.binding.effective_binding.clone(),
    };
    assert_eq!(
        guard.begin(&request(&source, "r1", Some(invented)), MONO, WALL),
        BeginOutcome::Refused(Refusal::ReservationMismatch)
    );
    assert_eq!(guard.fact(), &idle);
    assert_eq!(
        guard.begin(&request(&source, "r1", None), MONO, WALL),
        BeginOutcome::Accepted
    );
}

#[test]
fn observed_terminal_replaces_only_with_fresh_selectors_and_preserves_predecessor() {
    let (mut guard, source) = admitted();
    let old = observed_fact(&mut guard, &source);
    let replaces = replacement_identity(&old);
    assert_eq!(
        guard.begin(
            &request(&source, "r2", Some(replaces)),
            MONO + 30,
            WALL + 30
        ),
        BeginOutcome::Accepted
    );
    assert_eq!(guard.previous_fact(), Some(&old));
    assert!(
        matches!(guard.fact(), TrialFact::Reserved { reservation_id, binding, .. }
        if reservation_id == "r2" && binding == &source.binding)
    );
}

#[test]
fn wrong_old_identity_same_id_and_stale_current_selectors_refuse_without_mutation() {
    let (mut guard, source) = admitted();
    let old = observed_fact(&mut guard, &source);
    let original = old.clone();
    let exact = replacement_identity(&old);

    let mut wrong_id = exact.clone();
    wrong_id.reservation_id = "other".into();
    assert_eq!(
        guard.begin(
            &request(&source, "r2", Some(wrong_id)),
            MONO + 30,
            WALL + 30
        ),
        BeginOutcome::Refused(Refusal::ReservationMismatch)
    );
    let mut wrong_old_revision = exact.clone();
    wrong_old_revision.source_revision += 1;
    assert_eq!(
        guard.begin(
            &request(&source, "r2", Some(wrong_old_revision)),
            MONO + 30,
            WALL + 30
        ),
        BeginOutcome::Refused(Refusal::ReservationMismatch)
    );
    let mut wrong_old_registration = exact.clone();
    wrong_old_registration.binding_id.push_str("-other");
    assert_eq!(
        guard.begin(
            &request(&source, "r2", Some(wrong_old_registration)),
            MONO + 30,
            WALL + 30
        ),
        BeginOutcome::Refused(Refusal::ReservationMismatch)
    );
    let mut wrong_old_epoch = exact.clone();
    wrong_old_epoch.source_epoch.push_str("-other");
    assert_eq!(
        guard.begin(
            &request(&source, "r2", Some(wrong_old_epoch)),
            MONO + 30,
            WALL + 30
        ),
        BeginOutcome::Refused(Refusal::ReservationMismatch)
    );
    let mut wrong_old_label = exact.clone();
    wrong_old_label.effective_binding.push_str("-other");
    assert_eq!(
        guard.begin(
            &request(&source, "r2", Some(wrong_old_label)),
            MONO + 30,
            WALL + 30
        ),
        BeginOutcome::Refused(Refusal::ReservationMismatch)
    );
    assert_eq!(
        guard.begin(
            &request(&source, "r1", Some(exact.clone())),
            MONO + 30,
            WALL + 30
        ),
        BeginOutcome::Refused(Refusal::InvalidRequest)
    );

    let mut fresh = source.clone();
    fresh.binding.source_revision += 1;
    guard.observe_source(Some(&fresh));
    let before = guard.fact().clone();
    assert_eq!(
        guard.begin(
            &request(&source, "r2", Some(exact.clone())),
            MONO + 30,
            WALL + 30
        ),
        BeginOutcome::Refused(Refusal::StaleSource)
    );
    let mut bad_new_binding = request(&fresh, "r2", Some(exact));
    bad_new_binding.effective_binding.push_str(" stale");
    assert_eq!(
        guard.begin(&bad_new_binding, MONO + 30, WALL + 30),
        BeginOutcome::Refused(Refusal::StaleSource)
    );
    assert_eq!(guard.fact(), &before);
    assert_eq!(before, original);
    assert_eq!(guard.previous_fact(), None);
}

#[test]
fn reserved_pressing_and_unknown_held_cannot_be_replaced_even_after_expiry_time() {
    let (mut reserved, source) = admitted();
    let mut after_deadline = request(&source, "r2", None);
    after_deadline.expires_at_wall_ms = WALL + 9_000;
    assert_eq!(
        reserved.begin(&after_deadline, MONO + 5_001, WALL + 5_001),
        BeginOutcome::Refused(Refusal::ReservationActive)
    );
    assert!(
        matches!(reserved.fact(), TrialFact::Reserved { reservation_id, .. } if reservation_id == "r1")
    );

    let (mut pressing, source) = admitted();
    pressing.physical_edge(&edge(
        &source,
        EdgeKind::Press,
        "held",
        WALL + 10,
        MONO + 10,
    ));
    let old_pressing = pressing.fact().clone();
    assert_eq!(
        pressing.begin(&request(&source, "r2", None), MONO + 20, WALL + 20),
        BeginOutcome::Refused(Refusal::Busy)
    );
    assert_eq!(pressing.fact(), &old_pressing);

    let (mut unknown_held, source) = admitted();
    unknown_held.physical_edge(&edge(
        &source,
        EdgeKind::Press,
        "held",
        WALL + 10,
        MONO + 10,
    ));
    assert_eq!(
        unknown_held.cancel("r1", MONO + 20),
        CancelOutcome::UnknownWhileHeld
    );
    let unknown = unknown_held.fact().clone();
    assert_eq!(
        unknown_held.begin(
            &request(&source, "r2", Some(replacement_identity(&unknown))),
            MONO + 30,
            WALL + 30
        ),
        BeginOutcome::Refused(Refusal::Busy)
    );
    assert_eq!(unknown_held.fact(), &unknown);
    assert!(unknown_held.has_unresolved_press());
}

#[test]
fn caller_must_advance_expiry_before_freshness_fence_and_replacement() {
    let (mut guard, source) = admitted();
    let reserved = guard.fact().clone();
    assert_eq!(
        guard.begin(&request(&source, "r2", None), MONO + 5_001, WALL + 5_001),
        BeginOutcome::Refused(Refusal::ReservationActive)
    );
    assert_eq!(
        guard.fact(),
        &reserved,
        "begin never hides the terminal expiry transition"
    );
    guard.advance(MONO + 5_000);
    let expired = guard.fact().clone();
    assert!(
        matches!(&expired, TrialFact::Expired { reservation_id, .. } if reservation_id == "r1")
    );
    let replacement = BeginRequest {
        expires_at_wall_ms: WALL + 9_000,
        ..request(&source, "r2", Some(replacement_identity(&expired)))
    };
    assert_eq!(
        guard.begin(&replacement, MONO + 5_001, WALL + 5_001),
        BeginOutcome::Refused(Refusal::RetirementUnconfirmed),
        "replacement remains blocked until the native producer supplies a retirement watermark"
    );
    assert_eq!(guard.fact(), &expired);
}

#[test]
fn coherent_view_revision_refresh_does_not_invalidate_active_registration_or_rewrite_fact() {
    let (mut guard, source) = admitted();
    let original = guard.fact().clone();
    let mut refreshed = source.clone();
    refreshed.binding.source_revision += 5;
    guard.observe_source(Some(&refreshed));
    assert_eq!(guard.fact(), &original);
    assert_eq!(guard.physical_edge_binding(), Some(&source.binding));
    assert_eq!(
        guard.physical_edge(&edge(
            &source,
            EdgeKind::Press,
            "chord",
            WALL + 10,
            MONO + 10
        )),
        CaptureDisposition::SuppressUntilPhysicalRelease
    );
    assert_eq!(
        guard.physical_edge(&edge(
            &source,
            EdgeKind::Release,
            "chord",
            WALL + 20,
            MONO + 20
        )),
        CaptureDisposition::Suppress
    );
    assert!(
        matches!(guard.fact(), TrialFact::Observed { binding, .. } if binding.source_revision == source.binding.source_revision)
    );
}

#[test]
fn actual_registration_change_invalidates_to_unknown_and_waits_for_watermark() {
    let (mut guard, old_source) = admitted();
    let replaces = replacement_identity(&TrialFact::Unknown {
        binding: old_source.binding.clone(),
        reservation_id: "r1".into(),
    });
    let mut current = old_source.clone();
    current.binding.source_revision += 1;
    current.binding.binding_id = "backend-registration-5".into();
    current.binding.effective_binding = "Alt+Shift+R".into();
    guard.observe_source_at(Some(&current), MONO + 10);
    assert!(
        matches!(guard.fact(), TrialFact::Unknown { reservation_id, binding }
        if reservation_id == "r1" && binding == &old_source.binding)
    );
    assert_ne!(guard.fact(), &TrialFact::Idle(current.binding.clone()));
    assert_eq!(
        guard.begin(
            &request(&current, "r2", Some(replaces)),
            MONO + 10,
            WALL + 10
        ),
        BeginOutcome::Refused(Refusal::RetirementUnconfirmed)
    );
    assert_eq!(
        guard.fact(),
        &TrialFact::Unknown {
            binding: old_source.binding.clone(),
            reservation_id: "r1".into(),
        }
    );
    assert_eq!(guard.previous_fact(), None);
}

#[test]
fn terminal_replacement_requires_exact_old_and_fresh_current_identity() {
    let (mut guard, source) = admitted();
    let terminal = observed_fact(&mut guard, &source);
    let replaces = replacement_identity(&terminal);
    let mut stale = source.clone();
    stale.binding.source_revision += 1;
    guard.observe_source(Some(&stale));
    assert_eq!(guard.current_begin_binding(), Some(&stale.binding));
    assert_eq!(
        guard.begin(
            &request(&stale, "r2", Some(replaces.clone())),
            MONO + 30,
            WALL + 30
        ),
        BeginOutcome::Accepted
    );
    assert_eq!(guard.previous_fact(), Some(&terminal));
    assert_eq!(
        guard.current_begin_binding(),
        None,
        "active reservation has no current begin binding"
    );
}

#[test]
fn cancelled_and_native_unknown_remain_guarded_without_retirement_watermark() {
    let (mut cancelled, source) = admitted();
    assert_eq!(cancelled.cancel("r1", MONO + 1), CancelOutcome::Cancelled);
    let cancelled_fact = cancelled.fact().clone();
    assert_eq!(
        cancelled.begin(
            &request(&source, "r2", Some(replacement_identity(&cancelled_fact))),
            MONO + 2,
            WALL + 2
        ),
        BeginOutcome::Refused(Refusal::RetirementUnconfirmed)
    );
    assert_eq!(cancelled.fact(), &cancelled_fact);
    assert_eq!(cancelled.previous_fact(), None);

    let (mut unknown, old_source) = admitted();
    unknown.observe_source_at(None, MONO + 1);
    let unknown_fact = unknown.fact().clone();
    let mut current = old_source.clone();
    current.binding.source_epoch = "gui-epoch-2".into();
    current.binding.source_revision = 1;
    current.binding.binding_id = "backend-registration-9".into();
    unknown.observe_source_at(Some(&current), MONO + 2);
    assert_eq!(
        unknown.fact(),
        &unknown_fact,
        "new source does not rewrite terminal evidence to idle"
    );
    assert_eq!(
        unknown.begin(
            &request(&current, "r2", Some(replacement_identity(&unknown_fact))),
            MONO + 2,
            WALL + 2
        ),
        BeginOutcome::Refused(Refusal::RetirementUnconfirmed)
    );
    assert_eq!(unknown.fact(), &unknown_fact);
    assert_eq!(unknown.previous_fact(), None);
}
