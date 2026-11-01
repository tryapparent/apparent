#[cfg_attr(not(target_os = "macos"), path = "pill/other.rs")]
pub mod pill;
#[cfg(target_os = "macos")]
pub(super) mod laser_overlay;
