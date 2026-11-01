mod agent_proof;
#[cfg(test)]
#[path = "../build_version.rs"]
mod build_version;
mod capture;
mod composition;
#[cfg(any(target_os = "macos", target_os = "linux"))]
mod connect;
mod desktop;
#[cfg(target_os = "windows")]
mod win;
mod shared;

fn main() -> anyhow::Result<()> {
    composition::cli::run()
}
