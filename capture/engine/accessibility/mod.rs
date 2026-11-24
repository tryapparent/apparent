#[cfg(target_os = "macos")]
pub(crate) mod ax;
#[cfg(not(target_os = "macos"))]
pub(crate) mod ax_other;
#[cfg(target_os = "linux")]
#[path = "../../../engine/accessibility/linux.rs"]
pub(crate) mod ax;
#[cfg(not(any(target_os = "macos", target_os = "linux")))]
pub(crate) use ax_other as ax;

#[path = "../../../engine/accessibility/stroke.rs"]
mod stroke;
pub(crate) use stroke::{mark_started, probe_stroke};
#[cfg(any(target_os = "linux", target_os = "macos"))]
use stroke::admit_browser_page;
