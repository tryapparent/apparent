#[cfg(test)]
mod build_version { include!("enablement/build_version.rs"); }
#[cfg(any(target_os = "macos", target_os = "linux"))]
#[path = "engine/recognition/session.rs"]
mod circle_recognition;
mod capture;
mod composition;
#[cfg(target_os = "linux")]
#[path = "engine/recording/linux_candidate/mod.rs"]
mod linux_candidate;
#[path = "engine/native/embedded_policy.rs"]
mod embedded_policy;
#[path = "engine/recording/stored_frame.rs"]
mod stored_frame;
#[path = "engine/recording/preferences/mod.rs"]
mod recording_preferences;
#[path = "engine/permissions/facts.rs"]
mod permission_facts;
#[path = "engine/permissions/admission.rs"]
mod permission_admission;
#[path = "engine/permissions/native.rs"]
mod permission_native;
#[path = "engine/permissions/relaunch.rs"]
mod permission_relaunch;
#[cfg(any(target_os = "macos", target_os = "linux"))]
mod connect;
mod shared;

fn main() -> anyhow::Result<()> {
    crate::shared::handoff::pen::refresh();
    composition::run()
}
