use std::cell::RefCell;
use std::time::Instant;

// ---------------------------------------------------------------------------------------------
// Clock

struct Clock {
    anchor: Instant,
    /// Animation seconds at `anchor`.
    base: f64,
    scale: f64,
}

thread_local! {
    static CLOCK: RefCell<Clock> = RefCell::new(Clock { anchor: Instant::now(), base: 0.0, scale: 1.0 });
}

/// Animation time in seconds. Every capsule age reads this, so a time scale slows them all.
pub(crate) fn now() -> f64 {
    CLOCK.with_borrow(|c| c.base + c.anchor.elapsed().as_secs_f64() * c.scale)
}

pub(crate) fn time_scale() -> f32 {
    CLOCK.with_borrow(|c| c.scale as f32)
}

/// Re-anchors so ages already running continue from where they are.
pub(crate) fn set_time_scale(scale: f64) {
    CLOCK.with_borrow_mut(|c| {
        let scale = scale.clamp(0.02, 4.0);
        if (scale - c.scale).abs() < 1e-9 {
            return;
        }
        c.base += c.anchor.elapsed().as_secs_f64() * c.scale;
        c.anchor = Instant::now();
        c.scale = scale;
    });
}
