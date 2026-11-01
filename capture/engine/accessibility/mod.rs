#[cfg(any(target_os = "macos", target_os = "windows"))]
pub(crate) mod ax;
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub(crate) mod ax_other;
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub(crate) use ax_other as ax;
