//! Bounded independent-session consent scheduling. Transport remains in `portal`.
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;

#[derive(Debug)]
pub(super) enum Failure {
    Cancelled,
    Source(String),
}

/// Hold independent leases until all serialized approvals finish. XDPH can pause
/// existing streams while a subsequent native picker is open.
/// Returns true only for explicit user cancel, which invalidates every approval.
pub(super) fn sequence<T>(
    count: usize,
    stopping: &AtomicBool,
    deadline: Instant,
    mut request: impl FnMut(usize, Instant) -> Result<T, Failure>,
    mut deliver: impl FnMut(usize, Result<T, String>),
) -> bool {
    let mut cancelled = false;
    let mut results = Vec::with_capacity(count);
    for index in 0..count {
        if cancelled || stopping.load(Ordering::Acquire) || Instant::now() >= deadline {
            results.push(Err("Screen sharing cancelled or overall consent deadline expired".into()));
            continue;
        }
        let result = request(index, deadline);
        // A late approval is not permission to start a recorder after Stop/Cancel.
        if stopping.load(Ordering::Acquire) || Instant::now() >= deadline {
            drop(result);
            results.push(Err("Screen sharing stopped or overall consent deadline expired".into()));
            continue;
        }
        match result {
            Ok(source) => results.push(Ok(source)),
            Err(Failure::Source(message)) => results.push(Err(message)),
            Err(Failure::Cancelled) => {
                cancelled = true;
                results.push(Err("Screen sharing cancelled by user".into()));
            }
        }
    }
    for (index, result) in results.into_iter().enumerate() {
        if cancelled || stopping.load(Ordering::Acquire) {
            drop(result);
            deliver(index, Err("Screen sharing cancelled by user or stopped".into()));
        } else {
            deliver(index, result);
        }
    }
    cancelled
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::{Cell, RefCell};
    use std::time::Duration;

    #[test]
    fn approved_sources_are_held_until_all_native_pickers_complete() {
        let delivered = RefCell::new(Vec::new());
        let deadline = Instant::now() + Duration::from_secs(1);
        assert!(!sequence(2, &AtomicBool::new(false), deadline, |index, shared_deadline| {
            assert_eq!(shared_deadline, deadline);
            if index == 1 { assert!(delivered.borrow().is_empty(), "XDPH may pause A during B consent; no recorder may start yet"); }
            Ok(index)
        }, |_, result| delivered.borrow_mut().push(result.unwrap())));
        assert_eq!(*delivered.borrow(), vec![0, 1]);
    }

    #[test]
    fn cancel_stops_the_prompt_sequence_and_does_not_become_partial_success() {
        let attempts = Cell::new(0);
        let delivered = RefCell::new(Vec::new());
        let cancelled = sequence(3, &AtomicBool::new(false), Instant::now() + Duration::from_secs(1), |index, _| {
            attempts.set(attempts.get() + 1);
            if index == 1 { Err(Failure::Cancelled) } else { Ok(index) }
        }, |_, result| delivered.borrow_mut().push(result));
        assert!(cancelled);
        assert_eq!(attempts.get(), 2);
        assert!(delivered.borrow().iter().all(Result::is_err));
    }

    #[test]
    fn deadline_and_global_stop_prevent_further_prompts_but_wrong_choice_does_not_retry() {
        for stopped in [false, true] {
            let calls = Cell::new(0);
            sequence::<()>(2, &AtomicBool::new(stopped), Instant::now(), |_, _| {
                calls.set(calls.get() + 1); Ok(())
            }, |_, result| assert!(result.is_err()));
            assert_eq!(calls.get(), 0);
        }
        let calls = Cell::new(0);
        let results = RefCell::new(Vec::new());
        assert!(!sequence(2, &AtomicBool::new(false), Instant::now() + Duration::from_secs(1), |index, _| {
            calls.set(calls.get() + 1);
            if index == 0 { Err(Failure::Source("wrong output".into())) } else { Ok(index) }
        }, |_, result| results.borrow_mut().push(result)));
        assert_eq!(calls.get(), 2);
        assert!(results.borrow()[0].is_err());
        assert_eq!(results.borrow()[1], Ok(1));
    }
}
