//! Admission safety for the existing GUI writer, not Engine runtime clearance.

/// Preserve the historical epoch fallback, but retain whether a nonce actually
/// established an incarnation suitable for irreversible adoption.
pub(crate) fn process_epoch(nonce: Result<String, ()>, pid: u32) -> (String, bool) {
    match nonce {
        Ok(epoch) => {
            let qualified = !epoch.is_empty();
            (epoch, qualified)
        }
        Err(()) => (format!("process-{pid}"), false),
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) enum Phase {
    #[default]
    Open,
    Sealed,
    Retired,
    Unknown,
}

#[derive(Default)]
pub(crate) struct Fence {
    phase: Phase,
}

impl Fence {
    pub(crate) fn allows_start(&self, persisted: Result<bool, ()>) -> bool {
        self.phase == Phase::Open && persisted == Ok(false)
    }

    /// The GUI thread must call this after its epoch/revision and deadline checks.
    /// Existing capture/finalizer ownership refuses before sealing or persistence.
    pub(crate) fn seal(&mut self, busy: bool) -> bool {
        if busy { return false; }
        self.phase = Phase::Sealed;
        true
    }

    pub(crate) fn complete(&mut self, durable: bool) {
        self.phase = if self.phase == Phase::Sealed && durable {
            Phase::Retired
        } else {
            Phase::Unknown
        };
    }

    pub(crate) fn state(&self, persisted: Result<bool, ()>) -> &'static str {
        match (self.phase, persisted) {
            (Phase::Open, Ok(false)) => "open",
            (Phase::Open, Ok(true)) => "retired-observed",
            (Phase::Retired, Ok(true)) => "retired",
            _ => "unknown",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reused_pid_fallback_never_qualifies_as_a_nonce_incarnation() {
        let first = process_epoch(Err(()), 7);
        let restarted = process_epoch(Err(()), 7);
        assert_eq!(first, restarted, "PID fallback may repeat across a restart");
        assert_eq!(first, ("process-7".into(), false));
        assert_eq!(process_epoch(Ok(String::new()), 7), (String::new(), false));
        assert_eq!(process_epoch(Ok("fresh-nonce".into()), 7), ("fresh-nonce".into(), true));
    }

    #[test]
    fn only_open_with_an_authoritative_absent_marker_admits_capture() {
        let fence = Fence::default();
        assert!(fence.allows_start(Ok(false)));
        assert!(!fence.allows_start(Ok(true)));
        assert!(!fence.allows_start(Err(())));
        assert_eq!(fence.state(Ok(true)), "retired-observed");
    }

    #[test]
    fn busy_refusal_keeps_existing_capture_and_writer_ownership() {
        let mut fence = Fence::default();
        assert!(!fence.seal(true));
        assert!(fence.allows_start(Ok(false)));
        assert_eq!(fence.state(Ok(false)), "open");
    }

    #[test]
    fn sealing_blocks_queued_starts_before_the_durable_transaction_finishes() {
        let mut fence = Fence::default();
        assert!(fence.seal(false));
        assert!(!fence.allows_start(Ok(false)));
        assert!(!fence.allows_start(Ok(true)));
        assert_eq!(fence.state(Ok(true)), "unknown");
        fence.complete(true);
        assert_eq!(fence.state(Ok(true)), "retired");
        assert!(!fence.allows_start(Ok(false)), "removing disk metadata cannot reopen this process");
    }

    #[test]
    fn failed_or_uncertain_persistence_never_reopens_or_becomes_confirmed_by_read() {
        let mut fence = Fence::default();
        assert!(fence.seal(false));
        fence.complete(false);
        for persisted in [Ok(false), Ok(true), Err(())] {
            assert!(!fence.allows_start(persisted));
            assert_eq!(fence.state(persisted), "unknown");
        }
        // A separately admitted explicit operation can confirm durability.
        assert!(fence.seal(false));
        fence.complete(true);
        assert_eq!(fence.state(Ok(true)), "retired");
    }

    #[test]
    fn a_new_process_observes_retirement_but_does_not_infer_a_commit_receipt() {
        let mut first = Fence::default();
        assert!(first.seal(false));
        first.complete(true);
        let restarted = Fence::default();
        assert!(!restarted.allows_start(Ok(true)));
        assert_eq!(restarted.state(Ok(true)), "retired-observed");
        assert_eq!(first.state(Ok(false)), "unknown");
    }

    #[test]
    fn completion_without_a_matching_admission_fails_closed() {
        let mut fence = Fence::default();
        fence.complete(true);
        assert!(!fence.allows_start(Ok(false)));
        assert_eq!(fence.state(Ok(true)), "unknown");
    }
}
