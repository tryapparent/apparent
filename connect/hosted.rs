//! Application composition for the independent Connect client.
use anyhow::{Context, Result};
pub use apparent_connect_client::{
    AccountView, CloudConfig, ConnectCommand, HOSTED_SHARING, HOSTED_SYNC, PreparedLink,
    SharesCommand,
};
use apparent_connect_client::{Client, ConfigProvider};
// Package call sites own the concrete flags; this adapter preserves override semantics.
use crate::shared::handoff::experiment as app_experiment;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

struct AppConfig(PathBuf);
impl ConfigProvider for AppConfig {
    fn config_path(&self) -> &Path {
        &self.0
    }
    fn cloud(&self) -> CloudConfig {
        crate::shared::handoff::load_config_from(&self.0)
            .cloud
            .unwrap_or_default()
    }
    fn experiment(&self, name: &str) -> bool {
        app_experiment(name)
    }
    fn set_cloud(&self, value: &CloudConfig) -> Result<()> {
        crate::shared::handoff::set_config_value_in(&self.0, "cloud", serde_json::to_value(value)?)
    }
    fn set_experiment(&self, name: &str, enabled: bool) -> Result<()> {
        crate::shared::handoff::set_experiment_in(&self.0, name, enabled)
    }
    fn open_browser(&self, uri: &Path) {
        let _ = crate::shared::handoff::open_path(uri);
    }
}
fn client_at(path: PathBuf) -> Client {
    Client::new(Arc::new(AppConfig(path)))
}
fn client() -> Client {
    client_at(crate::shared::handoff::default_config_path())
}

pub fn copy_link_handoff(bundle: &Path, allowed: &dyn Fn() -> bool) -> Result<PreparedLink> {
    let link = client().prepare_link(bundle, allowed)?;
    start_worker();
    Ok(link)
}
pub fn sharing_connected() -> bool {
    client().sharing_connected()
}
pub fn sharing_server() -> Option<String> {
    client().sharing_server()
}
pub fn shared_links_url() -> Option<String> {
    client().shared_links_url()
}
pub fn account_view_in(config: &Path) -> AccountView {
    client_at(config.into()).account_view()
}
pub fn sharing_online() -> bool {
    client().sharing_online()
}
pub fn connect_sharing(allowed: &dyn Fn() -> bool) -> Result<()> {
    let server = sharing_server()
        .context("Configure the hosted API server with apparent connect login first")?;
    client().login_allowed(&server, "upload", true, true, allowed)
}
pub fn sharing_progress(bundle: &Path) -> String {
    client().sharing_progress(bundle)
}

pub fn command(command: ConnectCommand) -> Result<()> {
    let client = client();
    match command {
        ConnectCommand::Shares { command } => match command {
            SharesCommand::List => {
                println!("{}", serde_json::to_string_pretty(&client.shares()?)?);
                Ok(())
            }
            SharesCommand::Revoke { id } => {
                client.revoke_share(&id)?;
                println!("Sharing stopped. Downloads and cached previews cannot be recalled.");
                Ok(())
            }
        },
        ConnectCommand::Login {
            server,
            scope,
            consent_upload,
            no_browser,
        } => client.login(&server, &scope, consent_upload, !no_browser),
        ConnectCommand::Status { account } => {
            println!(
                "{}",
                serde_json::to_string_pretty(&client.status(account)?)?
            );
            Ok(())
        }
        ConnectCommand::Logout => {
            client.disable(true)?;
            println!(
                "Signed out locally; pending uploads cancelled. Server data expires after seven days."
            );
            Ok(())
        }
        ConnectCommand::Disable => {
            client.disable(false)?;
            println!("Hosted uploads disabled; pending uploads cancelled.");
            Ok(())
        }
        ConnectCommand::Retry => {
            client.retry()?;
            client.process_once()
        }
        ConnectCommand::Upload { bundle } => {
            // CLI errors are printed with their source chain by main. Do not
            // attach path/credential parsing errors to these public diagnostics.
            let bundle = crate::shared::handoff::resolve_bundle_dir(&bundle).map_err(|_| {
                anyhow::anyhow!("invalid_bundle: choose an existing .apparent directory")
            })?;
            client.enqueue_explicit(&bundle).map_err(|_| {
                anyhow::anyhow!(
                    "queue_unavailable: check upload consent, sign-in and private hosted state; local capture is unchanged"
                )
            })?;
            println!("Queued hosted capture; inspect its ID with apparent connect status");
            client.process_once()
        }
    }
}
pub fn fetch(id: &str, out: &Path, wait: u64) -> Result<()> {
    println!("{}", client().fetch(id, out, wait)?.display());
    Ok(())
}
pub fn completed(bundle: &Path) {
    if cfg!(test) {
        return;
    }
    let client = client();
    if client.enabled() {
        // Disk-only identity/queue publication happens before clipboard construction.
        // Hashing, staging and networking are exclusively background work.
        if client.enqueue(bundle).is_err() {
            crate::capture::engine::runtime::apparent_log(
                "Hosted queue unavailable; saved local capture is unchanged",
            );
        }
        start_worker();
    }
}
pub fn handoff_pointer(bundle: &Path) -> Option<String> {
    if cfg!(test) {
        return None;
    }
    client().pointer(bundle)
}
pub fn start_worker() {
    if cfg!(test) {
        return;
    }
    static STARTED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    if STARTED.swap(true, std::sync::atomic::Ordering::SeqCst) {
        return;
    }
    std::thread::spawn(|| {
        let client = client();
        loop {
            if client.enabled() {
                let _ = client.process_once();
            }
            std::thread::sleep(Duration::from_secs(2));
        }
    });
}

#[cfg(test)]

#[cfg(test)]


#[cfg(test)]
mod hosted_logging_tests;
#[cfg(test)]
pub(crate) mod hosted_tests;
