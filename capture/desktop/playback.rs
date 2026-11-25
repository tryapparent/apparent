#[cfg(target_os = "macos")]
#[path = "../../engine/native/macos/desktop/playback.rs"]
mod platform;

#[cfg(not(target_os = "macos"))]
mod platform {
    pub struct Guard;

    pub fn warm_up() {}

    impl Guard {
        pub fn start() -> Option<Self> {
            None
        }
    }
}

pub use platform::{Guard, warm_up};
