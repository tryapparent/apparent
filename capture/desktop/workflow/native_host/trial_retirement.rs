use super::*;

const WALL: u64 = 1_800_000_000_000;
const MONO: u64 = 50_000;

fn source() -> SourceObservation {
    SourceObservation {
        binding: TrialBinding {
            source_epoch: "epoch".into(),
            source_revision: 1,
            binding_id: "registration".into(),
            effective_binding: "Ctrl+Shift+R".into(),
        },
        available: true,
        registered: true,
        physical_edges_available: true,
        busy: false,
        active_capture: false,
    }
}
fn request(source: &SourceObservation) -> BeginRequest {
    BeginRequest {
        reservation_id: "r1".into(),
        binding_id: source.binding.binding_id.clone(),
        effective_binding: source.binding.effective_binding.clone(),
        source_epoch: source.binding.source_epoch.clone(),
        source_revision: source.binding.source_revision,
        expires_at_wall_ms: WALL + 5_000,
        replaces: None,
    }
}
fn edge(source: &SourceObservation, kind: EdgeKind, chord: &str, mono: u64) -> PhysicalEdge {
    PhysicalEdge {
        source_epoch: source.binding.source_epoch.clone(),
        source_revision: source.binding.source_revision,
        binding_id: source.binding.binding_id.clone(),
        chord_id: chord.into(),
        kind,
        press_id: (kind == EdgeKind::Press).then(|| "press-1".into()),
        wall_time_ms: WALL + mono - MONO,
        monotonic_time_ms: mono,
    }
}
fn admitted() -> (ShortcutTrialGuard, SourceObservation) {
    let source = source();
    let mut guard = ShortcutTrialGuard::new();
    guard.observe_source(Some(&source));
    assert_eq!(
        guard.begin(&request(&source), MONO, WALL),
        BeginOutcome::Accepted
    );
    (guard, source)
}
fn terminal_identity(fact: &TrialFact) -> TerminalIdentity {
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
        other => panic!("expected terminal fact, got {other:?}"),
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
fn delayed_press_after_cancel_is_consumed_not_dispatched() {
    let (mut guard, source) = admitted();
    assert_eq!(guard.cancel("r1", MONO + 100), CancelOutcome::Cancelled);
    let delayed = edge(&source, EdgeKind::Press, "chord", MONO + 50);
    assert_eq!(
        guard.physical_edge(&delayed),
        CaptureDisposition::SuppressUntilPhysicalRelease
    );
    assert!(!matches!(guard.fact(), TrialFact::Observed { .. }));
}

#[test]
fn delayed_press_after_expiry_is_consumed_not_dispatched() {
    let (mut guard, source) = admitted();
    assert_eq!(
        guard.advance(MONO + 5_000),
        CaptureDisposition::SuppressUntilPhysicalRelease
    );
    let delayed = edge(&source, EdgeKind::Press, "chord", MONO + 40);
    assert_eq!(
        guard.physical_edge(&delayed),
        CaptureDisposition::SuppressUntilPhysicalRelease
    );
    assert!(!matches!(guard.fact(), TrialFact::Observed { .. }));
}

#[test]
fn pre_retirement_release_does_not_clear_retiring_held_input() {
    let (mut guard, source) = admitted();
    assert_eq!(
        guard.physical_edge(&edge(&source, EdgeKind::Press, "chord", MONO + 10)),
        CaptureDisposition::SuppressUntilPhysicalRelease
    );
    assert_eq!(
        guard.cancel("r1", MONO + 100),
        CancelOutcome::UnknownWhileHeld
    );
    assert_eq!(
        guard.physical_edge(&edge(&source, EdgeKind::Release, "chord", MONO + 90)),
        CaptureDisposition::SuppressUntilPhysicalRelease
    );
    assert!(guard.has_unresolved_press());
    assert!(matches!(guard.fact(), TrialFact::Unknown { .. }));
}

#[test]
fn terminal_replacement_is_guarded_while_retirement_lacks_a_queue_watermark() {
    let (mut guard, source) = admitted();
    assert_eq!(guard.cancel("r1", MONO + 100), CancelOutcome::Cancelled);
    let old = guard.fact().clone();
    let release = edge(&source, EdgeKind::Release, "chord", MONO + 110);
    assert_eq!(guard.physical_edge(&release), CaptureDisposition::Suppress);
    let late_down = edge(&source, EdgeKind::Press, "chord", MONO + 50);
    assert_eq!(
        guard.physical_edge(&late_down),
        CaptureDisposition::Suppress
    );
    let duplicate_late_down = edge(&source, EdgeKind::Press, "chord", MONO + 60);
    assert_eq!(
        guard.physical_edge(&duplicate_late_down),
        CaptureDisposition::Suppress
    );
    assert!(
        !guard.has_unresolved_press(),
        "the retained release time reconciles this earlier down"
    );
    assert_eq!(
        guard.legacy_capture_disposition_at("epoch", 1, "registration", "chord", Some(MONO + 50)),
        CaptureDisposition::Suppress,
        "the corresponding legacy press may arrive after its release"
    );
    assert_eq!(
        guard.legacy_capture_disposition("registration", "chord"),
        CaptureDisposition::Suppress,
        "untimed callbacks cannot infer a fresh event after retirement"
    );
    assert_eq!(
        guard.legacy_capture_disposition_at("epoch", 1, "registration", "chord", Some(MONO + 120)),
        CaptureDisposition::Dispatch,
        "a later timed press is beyond the retirement cutoff"
    );
    let mut next = request(&source);
    next.reservation_id = "r2".into();
    next.expires_at_wall_ms = WALL + 6_000;
    next.replaces = Some(terminal_identity(&old));
    assert_eq!(
        guard.begin(&next, MONO + 120, WALL + 120),
        BeginOutcome::Refused(Refusal::RetirementUnconfirmed)
    );
    assert!(guard.has_unconfirmed_retirement());
    assert_eq!(guard.current_begin_binding(), None);
    assert_eq!(guard.fact(), &old);
}

#[test]
fn source_invalidation_without_an_occurrence_time_fails_closed() {
    let (mut guard, source) = admitted();
    assert_eq!(
        guard.observe_source(None),
        CaptureDisposition::SuppressUntilPhysicalRelease
    );
    assert!(guard.has_unconfirmed_retirement());
    let release = edge(&source, EdgeKind::Release, "chord", MONO + 100);
    assert_eq!(
        guard.physical_edge(&release),
        CaptureDisposition::SuppressUntilPhysicalRelease,
        "without a source clock the infinite cutoff cannot be reconciled"
    );
    assert_eq!(guard.current_begin_binding(), None);
    assert!(
        matches!(guard.fact(), TrialFact::Unknown { reservation_id, .. } if reservation_id == "r1")
    );
}

#[test]
fn post_retirement_press_without_a_release_stays_suppressed() {
    for expired in [false, true] {
        let (mut guard, source) = admitted();
        let cutoff = if expired { MONO + 5_000 } else { MONO + 100 };
        if expired {
            guard.advance(cutoff);
        } else {
            assert_eq!(guard.cancel("r1", cutoff), CancelOutcome::Cancelled);
        }
        let terminal = guard.fact().clone();
        let later = edge(&source, EdgeKind::Press, "chord", cutoff + 10);
        assert_eq!(
            guard.physical_edge(&later),
            CaptureDisposition::SuppressUntilPhysicalRelease,
            "a later timestamp cannot prove the retired physical chord was released"
        );
        assert!(guard.has_unresolved_press());
        assert_eq!(guard.fact(), &terminal);
        assert_eq!(
            guard.physical_edge(&edge(&source, EdgeKind::Release, "chord", cutoff + 20)),
            CaptureDisposition::Suppress
        );
        assert!(!guard.has_unresolved_press());
        assert_eq!(
            guard.legacy_capture_disposition_at(
                "epoch",
                1,
                "registration",
                "chord",
                Some(cutoff + 10)
            ),
            CaptureDisposition::Suppress,
            "the delayed capture callback remains older than the consumed release"
        );
    }
}

#[test]
fn post_retirement_legacy_callback_requires_a_later_trusted_release_boundary() {
    let (mut guard, source) = admitted();
    guard.cancel("r1", MONO + 100);
    assert_eq!(
        guard.legacy_capture_disposition_at("epoch", 1, "registration", "chord", Some(MONO + 110)),
        CaptureDisposition::Suppress,
        "a timestamp after cancel is not input retirement proof"
    );
    guard.physical_edge(&edge(&source, EdgeKind::Release, "chord", MONO + 120));
    assert_eq!(
        guard.legacy_capture_disposition_at("epoch", 1, "registration", "chord", Some(MONO + 110)),
        CaptureDisposition::Suppress,
        "an earlier callback cannot bypass the consumed release boundary"
    );
    assert_eq!(
        guard.legacy_capture_disposition_at("epoch", 1, "registration", "chord", Some(MONO + 130)),
        CaptureDisposition::Dispatch,
        "a fresh ordinary press after the exact release may dispatch without rearming a trial"
    );
    assert!(
        guard.has_unconfirmed_retirement(),
        "ordinary capture does not prove trial rearm clearance"
    );
}

#[test]
fn retired_edge_context_keeps_original_selectors_after_source_refresh() {
    let (mut guard, source) = admitted();
    guard.cancel("r1", MONO + 100);
    let mut current = source.clone();
    current.binding.source_revision += 1;
    current.binding.binding_id = "replacement-registration".into();
    guard.observe_source_at(Some(&current), MONO + 110);
    assert_eq!(
        guard.physical_edge_binding(),
        Some(&source.binding),
        "queued original edges must not be relabelled with current registration selectors"
    );
    assert_eq!(guard.current_begin_binding(), None);
}

#[test]
fn inconsistent_wall_release_retires_without_clearing_input_or_allowing_rearm() {
    let (mut guard, source) = admitted();
    guard.physical_edge(&edge(&source, EdgeKind::Press, "chord", MONO + 10));
    let mut invalid_up = edge(&source, EdgeKind::Release, "chord", MONO + 20);
    invalid_up.wall_time_ms = WALL + 9;
    assert_eq!(
        guard.physical_edge(&invalid_up),
        CaptureDisposition::SuppressUntilPhysicalRelease
    );
    assert!(guard.has_unresolved_press());
    assert!(guard.has_unconfirmed_retirement());
    assert_eq!(guard.current_begin_binding(), None);
    let terminal = guard.fact().clone();
    assert!(matches!(terminal, TrialFact::Unknown { .. }));
    assert_eq!(
        guard.legacy_capture_disposition_at("epoch", 1, "registration", "chord", Some(MONO + 21)),
        CaptureDisposition::SuppressUntilPhysicalRelease
    );
    invalid_up.monotonic_time_ms = MONO + 25;
    assert_eq!(
        guard.physical_edge(&invalid_up),
        CaptureDisposition::SuppressUntilPhysicalRelease,
        "an invalid release cannot clear held ownership through the retirement branch either"
    );
    assert!(guard.has_unresolved_press());
    assert_eq!(
        guard.physical_edge(&edge(&source, EdgeKind::Release, "chord", MONO + 30)),
        CaptureDisposition::Suppress
    );
    assert!(!guard.has_unresolved_press());
    assert_eq!(guard.fact(), &terminal);
    let mut replacement = request(&source);
    replacement.reservation_id = "new".into();
    replacement.replaces = Some(terminal_identity(&terminal));
    assert_eq!(
        guard.begin(&replacement, MONO + 40, WALL + 40),
        BeginOutcome::Refused(Refusal::RetirementUnconfirmed)
    );
}
