//! Native cursor sampling only. Electron owns hover, silhouette and freshness.
use super::{Mailbox, Arc, AtomicBool, Condvar, Duration, Instant, Mutex, Ordering};

pub(super) fn observe(
    alive: Arc<AtomicBool>, ready: Arc<AtomicBool>, activated: Arc<AtomicBool>,
    mailbox: Arc<(Mutex<Mailbox>, Condvar)>,
) {
    std::thread::spawn(move || {
        while alive.load(Ordering::Acquire) {
            std::thread::sleep(Duration::from_millis(80));
            if !alive.load(Ordering::Acquire) { break; }
            if !ready.load(Ordering::Acquire) || !activated.load(Ordering::Acquire) {
                continue;
            }
            let (lock, wake) = &*mailbox;
            if !lock.lock().unwrap().cursor_active { continue; }
            let observed = Instant::now();
            // Two bounded compositor reads run here, never on the GUI thread.
            let point = crate::capture::desktop::linux::compositor_cursor_position(Duration::from_millis(80));
            let mut pending = lock.lock().unwrap();
            if pending.closed || !alive.load(Ordering::Acquire) { break; }
            if !pending.cursor_active { continue; }
            // Coalesce facts while the single pipe writer is busy.
            pending.cursor = Some((observed, point));
            wake.notify_one();
        }
    });
}
