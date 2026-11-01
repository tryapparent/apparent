use super::clock::now_epoch_ms;

pub(crate) fn make_bundle_id() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    // Two IDs in the same millisecond (parallel tests, overlapping ingests) must still differ.
    static COUNT: AtomicU64 = AtomicU64::new(0);
    let ms = now_epoch_ms();
    let pid = std::process::id();
    match COUNT.fetch_add(1, Ordering::Relaxed) {
        0 => format!("apparent-{ms}-{pid:x}"),
        n => format!("apparent-{ms}-{pid:x}-{n}"),
    }
}
