#[cfg(test)]
mod build_version { include!("enablement/build_version.rs"); }
mod capture;
mod composition;
#[cfg(any(target_os = "macos", target_os = "linux"))]
mod connect;
mod shared;

fn main() -> anyhow::Result<()> {
    #[cfg(any(target_os="macos",target_os="linux"))]
    capture::desktop::workflow::test_instance::initialize()?;
    shared::handoff::pen::refresh();
    composition::cli::run()
}
