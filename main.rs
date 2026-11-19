#[cfg(test)]
mod build_version { include!("enablement/build_version.rs"); }
mod capture;
mod composition;
#[path = "engine/permissions/facts.rs"]
mod permission_facts;
#[path = "engine/permissions/admission.rs"]
mod permission_admission;
#[cfg(any(target_os = "macos", target_os = "linux"))]
mod connect;
mod shared;

fn main() -> anyhow::Result<()> {
    crate::shared::handoff::pen::refresh();
    composition::run()
}
