#[cfg(test)]
mod build_version { include!("enablement/build_version.rs"); }
mod capture;
mod composition;
#[path = "engine/native/embedded_policy.rs"]
mod embedded_policy;
#[path = "engine/recording/stored_frame.rs"]
mod stored_frame;
#[path = "engine/permissions/facts.rs"]
mod permission_facts;
#[path = "engine/permissions/admission.rs"]
mod permission_admission;
#[path = "record/pill/input/native.rs"]
mod lip_input;
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
