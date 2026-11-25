#[cfg(target_os = "linux")]
pub(crate) mod linux;
#[cfg(target_os = "macos")]
pub(crate) mod macos;
#[path = "../../../../engine/native/note_tap.rs"]
pub(crate) mod note_tap;
#[cfg(any(target_os = "linux", target_os = "macos"))]
pub(crate) use note_tap::NoteTap;
#[cfg(target_os = "linux")]
pub(crate) use linux::*;
#[cfg(target_os = "macos")]
pub(crate) use macos::*;

#[cfg(any(target_os = "linux", target_os = "macos"))]
pub(crate) use note_tap::observe_note_tap;
