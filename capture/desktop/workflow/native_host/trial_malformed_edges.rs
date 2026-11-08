use super::*;

fn reserved() -> (ShortcutTrialGuard, PhysicalEdge) {
    let binding = TrialBinding {
        source_epoch: "source-a".into(),
        source_revision: 1,
        binding_id: "registration-a".into(),
        effective_binding: "Alt+Shift+R".into(),
    };
    let mut guard = ShortcutTrialGuard::new();
    guard.observe_source(Some(&SourceObservation {
        binding: binding.clone(),
        available: true,
        registered: true,
        physical_edges_available: true,
        busy: false,
        active_capture: false,
    }));
    assert_eq!(
        guard.begin(
            &BeginRequest {
                reservation_id: "reservation-a".into(),
                source_epoch: binding.source_epoch.clone(),
                source_revision: 1,
                binding_id: binding.binding_id.clone(),
                effective_binding: binding.effective_binding,
                expires_at_wall_ms: 2_000,
                replaces: None
            },
            100,
            1_000
        ),
        BeginOutcome::Accepted
    );
    (
        guard,
        PhysicalEdge {
            source_epoch: binding.source_epoch,
            source_revision: 1,
            binding_id: binding.binding_id,
            chord_id: "physical-a".into(),
            kind: EdgeKind::Press,
            press_id: Some("press-a".into()),
            wall_time_ms: 1_010,
            monotonic_time_ms: 110,
        },
    )
}

#[test]
fn malformed_edges_never_dispatch_or_advance_a_reserved_trial() {
    for kind in [EdgeKind::Press, EdgeKind::Release] {
        for bad_field in 0..4 {
            let (mut guard, mut edge) = reserved();
            edge.kind = kind;
            match bad_field {
                0 => edge.source_epoch.clear(),
                1 => edge.binding_id.push('\0'),
                2 => edge.chord_id.clear(),
                _ if kind == EdgeKind::Press => edge.press_id = None,
                _ => edge.source_epoch = "x".repeat(257),
            }
            assert_eq!(guard.physical_edge(&edge), CaptureDisposition::Suppress);
            assert!(matches!(guard.fact(), TrialFact::Reserved { .. }));
            assert!(!guard.has_unresolved_press());
        }
    }
}

#[test]
fn malformed_down_and_release_cannot_clear_a_held_press_or_publish_observed() {
    for kind in [EdgeKind::Press, EdgeKind::Release] {
        let (mut guard, valid) = reserved();
        assert_eq!(
            guard.physical_edge(&valid),
            CaptureDisposition::SuppressUntilPhysicalRelease
        );
        let mut bad = valid.clone();
        bad.kind = kind;
        bad.chord_id.clear();
        assert_eq!(
            guard.physical_edge(&bad),
            CaptureDisposition::SuppressUntilPhysicalRelease
        );
        assert!(guard.has_unresolved_press());
        assert!(matches!(guard.fact(), TrialFact::Pressing { .. }));
        let mut release = valid;
        release.kind = EdgeKind::Release;
        release.wall_time_ms += 1;
        release.monotonic_time_ms += 1;
        assert_eq!(guard.physical_edge(&release), CaptureDisposition::Suppress);
        assert!(matches!(guard.fact(), TrialFact::Observed { .. }));
    }
}

#[test]
fn malformed_idle_edge_is_not_authority_to_dispatch_capture() {
    let (mut guard, mut edge) = reserved();
    guard.cancel("reservation-a", 111);
    edge.press_id = None;
    assert_eq!(guard.physical_edge(&edge), CaptureDisposition::Suppress);
    assert!(matches!(guard.fact(), TrialFact::Cancelled { .. }));
}
