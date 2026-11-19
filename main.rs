#[cfg(test)]
mod build_version { include!("enablement/build_version.rs"); }
mod capture;
mod composition;
#[path = "engine/native/embedded_policy.rs"]
mod embedded_policy;
#[path = "engine/permissions/facts.rs"]
mod permission_facts;
#[path = "engine/permissions/admission.rs"]
mod permission_admission;
#[path = "engine/permissions/native.rs"]
mod permission_native;
#[cfg(not(windows))]
#[path = "engine/permissions/relaunch.rs"]
mod permission_relaunch;
#[cfg(any(target_os = "macos", target_os = "linux"))]
mod connect;
mod shared;

fn main() -> anyhow::Result<()> {
    crate::shared::handoff::pen::refresh();
    composition::run()
}
