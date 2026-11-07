//! One scoped native-only poller. It never registers or dispatches shortcuts,
//! starts capture, emits clicks/notes, or sets legacy recording active.
use crate::capture::engine::runtime::{
    NativeInkObservation, NativeInkObserver, SharedCaptureTelemetry, track_shift_ink_observed,
};
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

pub(crate) struct NativeInkCollector {
    stop: Arc<AtomicBool>,
    worker: Option<JoinHandle<Result<(), &'static str>>>,
    ready: std::sync::mpsc::Receiver<Result<(), &'static str>>,
}
impl NativeInkCollector {
    pub(crate) fn start(
        telemetry: Arc<SharedCaptureTelemetry>,
        observer: Arc<dyn NativeInkObserver>,
        name: String,
        rect: [f64; 4],
    ) -> Result<Self, &'static str> {
        let keyboard = crate::capture::desktop::linux::input::NativeInkKeyboard::open()?;
        // Capture the initial state synchronously before acknowledging activation.
        let initial = keyboard.modifiers()?;
        Self::spawn(
            move || {
                let modifiers = keyboard.modifiers()?;
                let position = crate::capture::desktop::linux::hyprland::ink_pointer(&name, rect)
                    .ok_or("pointer-unavailable")?;
                let mut t = libc::timespec {
                    tv_sec: 0,
                    tv_nsec: 0,
                };
                if unsafe { libc::clock_gettime(libc::CLOCK_MONOTONIC, &mut t) } != 0
                    || t.tv_sec < 0
                    || !(0..1_000_000_000).contains(&t.tv_nsec)
                {
                    return Err("clock-unavailable");
                }
                let time = (t.tv_sec as u64)
                    .checked_mul(1_000_000_000)
                    .and_then(|n| n.checked_add(t.tv_nsec as u64))
                    .ok_or("clock-unavailable")?;
                Ok((modifiers, position, time))
            },
            move |pure, previous, position, time| {
                track_shift_ink_observed(
                    &telemetry,
                    (position[0], position[1]),
                    pure,
                    previous,
                    Some(time),
                )
            },
            move || observer.observe(NativeInkObservation::ClockUnavailable),
            initial[0],
        )
    }
    fn spawn(
        mut sample: impl FnMut() -> Result<([bool; 4], [f64; 2], u64), &'static str> + Send + 'static,
        mut observe: impl FnMut(bool, bool, [f64; 2], u64) + Send + 'static,
        failed: impl Fn() + Send + 'static,
        initially_held: bool,
    ) -> Result<Self, &'static str> {
        let (ready_tx, ready) = std::sync::mpsc::sync_channel(1);
        let stop = Arc::new(AtomicBool::new(false));
        let signal = stop.clone();
        let worker = std::thread::Builder::new()
            .name("apparent-native-ink".into())
            .spawn(move || {
                let mut announced = false;
                let mut previous = false;
                let mut await_release = initially_held;
                while !signal.load(Ordering::Acquire) {
                    let (mods, position, time) = match sample() {
                        Ok(v) => v,
                        Err(e) => {
                            failed();
                            if !announced {
                                let _ = ready_tx.send(Err(e));
                            }
                            return Err(e);
                        }
                    };
                    if !announced {
                        let _ = ready_tx.send(Ok(()));
                        announced = true;
                    }
                    if signal.load(Ordering::Acquire) {
                        break;
                    }
                    if !mods[0] {
                        await_release = false;
                    } else if mods[1..].iter().any(|v| *v) {
                        await_release = true;
                    }
                    let pure = mods[0] && !mods[1..].iter().any(|v| *v) && !await_release;
                    observe(pure, previous, position, time);
                    previous = pure;
                    std::thread::sleep(Duration::from_millis(8));
                }
                // Stop does not manufacture a key release/acceptedAt timestamp.
                // The controller discards any still-provisional gesture on seal.
                Ok(())
            })
            .map_err(|_| "collector-unavailable")?;
        Ok(Self {
            stop,
            worker: Some(worker),
            ready,
        })
    }
    /// The owner retains this handle before waiting. Timeout/negative readiness
    /// never drops a still-owned native worker or proves input availability.
    pub(crate) fn wait_ready(&self, deadline: Instant) -> Result<(), &'static str> {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err("collector-ready-unknown");
        }
        let result = self
            .ready
            .recv_timeout(remaining)
            .map_err(|_| "collector-ready-unknown")?;
        if Instant::now() >= deadline {
            return Err("collector-ready-unknown");
        }
        result
    }
    /// Timeout retains the owning handle and does not claim drain or clearance.
    pub(crate) fn stop_and_drain(&mut self, deadline: Instant) -> Result<(), &'static str> {
        self.stop.store(true, Ordering::Release);
        let worker = self.worker.as_ref().ok_or("collector-already-drained")?;
        while !worker.is_finished() {
            if Instant::now() >= deadline {
                return Err("collector-drain-unknown");
            }
            std::thread::sleep(Duration::from_millis(1));
        }
        if Instant::now() >= deadline {
            return Err("collector-drain-unknown");
        }
        self.worker
            .take()
            .unwrap()
            .join()
            .map_err(|_| "collector-panicked")?
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Mutex, mpsc};
    #[test]
    fn scoped_owner_waits_for_real_shift_release_and_never_synthesizes_stop_release() {
        let samples = Arc::new(Mutex::new(vec![
            ([true, false, false, false], [1., 2.], 1),
            ([false, false, false, false], [2., 3.], 2),
            ([true, false, false, false], [3., 4.], 3),
        ]));
        let seen = Arc::new(Mutex::new(Vec::new()));
        let out = seen.clone();
        let input = samples.clone();
        let (tx, rx) = mpsc::channel();
        let mut collector = NativeInkCollector::spawn(
            move || {
                let mut v = input.lock().unwrap();
                Ok(if v.len() > 1 { v.remove(0) } else { v[0] })
            },
            move |pure, prior, p, t| {
                out.lock().unwrap().push((pure, prior, p, t));
                let _ = tx.send(());
            },
            || panic!("unexpected failure"),
            true,
        )
        .unwrap();
        collector
            .wait_ready(Instant::now() + Duration::from_secs(1))
            .unwrap();
        for _ in 0..3 {
            rx.recv_timeout(Duration::from_secs(1)).unwrap();
        }
        collector
            .stop_and_drain(Instant::now() + Duration::from_secs(1))
            .unwrap();
        let v = seen.lock().unwrap();
        assert!(!v[0].0);
        assert!(!v[1].0);
        assert!(v[2].0);
        assert!(v.last().unwrap().0, "stop never creates accepted release");
    }
    #[test]
    fn read_failure_is_explicit_and_never_becomes_successful_zero() {
        let failed = Arc::new(AtomicBool::new(false));
        let f = failed.clone();
        let mut c = NativeInkCollector::spawn(
            || Err("fixture-device-loss"),
            |_, _, _, _| panic!("no sample"),
            move || {
                f.store(true, Ordering::Release);
            },
            false,
        )
        .unwrap();
        assert!(
            c.wait_ready(Instant::now() + Duration::from_secs(1))
                .is_err()
        );
        assert!(
            c.stop_and_drain(Instant::now() + Duration::from_secs(1))
                .is_err()
        );
        assert!(failed.load(Ordering::Acquire));
    }
}
