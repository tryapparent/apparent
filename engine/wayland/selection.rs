use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, Weak};

static SELECTION: Mutex<Weak<AtomicBool>> = Mutex::new(Weak::new());

pub(crate) fn pending() -> bool {
    SELECTION
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .strong_count()
        != 0
}

pub(crate) fn reserve() -> Option<Arc<AtomicBool>> {
    let mut selection = SELECTION.lock().unwrap_or_else(|error| error.into_inner());
    if selection.strong_count() != 0 {
        return None;
    }
    let cancel = Arc::new(AtomicBool::new(false));
    *selection = Arc::downgrade(&cancel);
    Some(cancel)
}

pub(crate) fn cancel() {
    if let Some(selection) = SELECTION
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .upgrade()
    {
        selection.store(true, Ordering::Release);
    }
}
