use super::*;
fn source() -> SourceObservation {
    SourceObservation {
        binding: TrialBinding {
            source_epoch: "source-a".into(),
            source_revision: 1,
            binding_id: "binding-a".into(),
            effective_binding: "Alt+Shift+S".into(),
        },
        available: true,
        registered: true,
        physical_edges_available: true,
        busy: false,
        active_capture: false,
    }
}
fn edge(source: &SourceObservation, kind: EdgeKind, mono: u64) -> PhysicalEdge {
    PhysicalEdge {
        source_epoch: source.binding.source_epoch.clone(),
        source_revision: source.binding.source_revision,
        binding_id: source.binding.binding_id.clone(),
        chord_id: "physical-chord".into(),
        kind,
        press_id: (kind == EdgeKind::Press).then(|| "press-a".into()),
        wall_time_ms: 1000 + mono,
        monotonic_time_ms: mono,
    }
}
fn admitted() -> (ShortcutTrialGuard, SourceObservation) {
    let source = source();
    let mut guard = ShortcutTrialGuard::new();
    guard.observe_source(Some(&source));
    assert_eq!(
        guard.begin(
            &BeginRequest {
                reservation_id: "reservation-a".into(),
                source_epoch: source.binding.source_epoch.clone(),
                source_revision: source.binding.source_revision,
                binding_id: source.binding.binding_id.clone(),
                effective_binding: source.binding.effective_binding.clone(),
                expires_at_wall_ms: 6000,
                replaces: None
            },
            50,
            1000
        ),
        BeginOutcome::Accepted
    );
    (guard, source)
}
#[test]
fn queued_press_observed_before_admission_cannot_become_a_request_scoped_pair() {
    let (mut guard, source) = admitted();
    assert_eq!(
        guard.physical_edge(&edge(&source, EdgeKind::Press, 49)),
        CaptureDisposition::Suppress
    );
    assert!(!guard.has_unresolved_press());
    guard.physical_edge(&edge(&source, EdgeKind::Release, 51));
    assert!(matches!(guard.fact(), TrialFact::Reserved { .. }));
}
#[test]
fn foreign_source_release_with_recycled_chord_token_cannot_clear_held_ownership() {
    let (mut guard, source) = admitted();
    guard.physical_edge(&edge(&source, EdgeKind::Press, 51));
    let mut replacement = source.clone();
    replacement.binding.source_epoch = "source-b".into();
    replacement.binding.binding_id = "binding-b".into();
    guard.observe_source_at(Some(&replacement), 52);
    assert_eq!(
        guard.physical_edge(&edge(&replacement, EdgeKind::Release, 52)),
        CaptureDisposition::SuppressUntilPhysicalRelease
    );
    assert!(guard.has_unresolved_press());
    assert!(
        matches!(guard.fact(),TrialFact::Unknown{reservation_id,..} if reservation_id=="reservation-a")
    );
    assert_eq!(
        guard.legacy_capture_disposition("binding-b", "physical-chord"),
        CaptureDisposition::SuppressUntilPhysicalRelease
    );
    assert_eq!(
        guard.physical_edge(&edge(&source, EdgeKind::Release, 53)),
        CaptureDisposition::Suppress
    );
    assert!(!guard.has_unresolved_press());
}
#[test]
fn delayed_release_predating_the_admitted_press_cannot_clear_held_ownership() {
    let (mut guard, source) = admitted();
    guard.physical_edge(&edge(&source, EdgeKind::Press, 55));
    assert_eq!(
        guard.physical_edge(&edge(&source, EdgeKind::Release, 54)),
        CaptureDisposition::SuppressUntilPhysicalRelease
    );
    assert!(guard.has_unresolved_press());
    assert!(matches!(guard.fact(), TrialFact::Unknown { .. }));
    guard.physical_edge(&edge(&source, EdgeKind::Release, 56));
    assert!(!guard.has_unresolved_press());
    assert!(matches!(guard.fact(), TrialFact::Unknown { .. }));
}
#[test]
fn view_revision_refresh_preserves_admitted_context_but_foreign_registration_release_cannot_clear_held_ownership(
) {
    for replace_revision in [false, true] {
        let (mut guard, source) = admitted();
        guard.physical_edge(&edge(&source, EdgeKind::Press, 51));
        let mut replacement = source.clone();
        if replace_revision {
            replacement.binding.source_revision += 1;
        } else {
            replacement.binding.binding_id = "binding-b".into();
        }
        guard.observe_source_at(Some(&replacement), 52);
        assert_eq!(
            guard.physical_edge(&edge(&replacement, EdgeKind::Release, 52)),
            CaptureDisposition::SuppressUntilPhysicalRelease
        );
        assert!(guard.has_unresolved_press());
        if replace_revision {
            assert!(matches!(guard.fact(), TrialFact::Pressing { binding, .. }
                if binding.source_revision == source.binding.source_revision));
        } else {
            assert!(matches!(guard.fact(), TrialFact::Unknown { .. }));
        }
        assert_eq!(
            guard.legacy_capture_disposition("binding-b", "physical-chord"),
            CaptureDisposition::SuppressUntilPhysicalRelease
        );
        assert_eq!(
            guard.physical_edge(&edge(&source, EdgeKind::Release, 53)),
            CaptureDisposition::Suppress
        );
        assert!(!guard.has_unresolved_press());
        if replace_revision {
            assert!(matches!(guard.fact(), TrialFact::Observed { binding, .. }
                if binding.source_revision == source.binding.source_revision));
        } else {
            assert!(matches!(guard.fact(), TrialFact::Unknown { .. }));
        }
    }
}
