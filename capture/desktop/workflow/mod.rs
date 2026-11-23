pub(crate) mod agent_capture;
#[cfg(any(target_os = "macos", target_os = "linux"))]
pub(crate) mod error_reporting;
#[path = "../../../engine/diagnostics/performance/mod.rs"]
pub(crate) mod performance;
#[cfg(target_os = "linux")]
pub(super) use error_reporting::native_supervisor::FinishPhase;
pub(crate) mod connect_settings;
#[cfg(any(target_os = "macos", target_os = "linux"))]
pub(crate) mod public_sharing;
pub(crate) mod inbox;
#[cfg(any(target_os = "macos", target_os = "linux"))]
pub(crate) mod launch_instance;
#[cfg(any(target_os = "macos", target_os = "linux"))]
pub(crate) mod launch_url;
pub(crate) mod page;
pub(crate) mod shutdown;
pub(in crate::capture::desktop) mod storage_preferences;
pub(crate) mod notes;

pub(crate) mod electron;
pub(crate) mod local_transcription;
