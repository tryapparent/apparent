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
        self.set_cloud_allowed(value, &|| true)
    }
    fn set_cloud_allowed(&self, value: &CloudConfig, allowed: &dyn Fn() -> bool) -> Result<()> {
        crate::shared::handoff::update_config_allowed_in(&self.0, allowed, |config| {
            let cloud = config.as_object_mut().unwrap().entry("cloud")
                .or_insert_with(|| serde_json::json!({}));
            let cloud = cloud.as_object_mut().context("Invalid cloud configuration")?;
            cloud.insert("enabled".into(), value.enabled.into());
            cloud.insert("uploadConsent".into(), value.upload_consent.into());
            cloud.insert("server".into(), value.server.clone().into());
            Ok(())
        })
    }
    fn set_experiment(&self, name: &str, enabled: bool) -> Result<()> {
        crate::shared::handoff::update_config_allowed_in(&self.0, &|| true, |config| {
            let experiments = config.as_object_mut().unwrap().entry("experiments")
                .or_insert_with(|| serde_json::json!({}));
            experiments.as_object_mut().context("Invalid experiments configuration")?
                .insert(name.to_owned(), enabled.into());
            Ok(())
        })
    }
    fn open_browser(&self, uri: &Path) {
        let _ = crate::shared::handoff::open_path(uri);
    }
}
pub(crate) fn client_at(path: PathBuf) -> Client {
    Client::new(Arc::new(AppConfig(path)))
}

/// Settings composition only; all protocol, credential and consent policy remains
/// in the production client. The controller owns browser clicks and worker start.
pub fn settings_backend(
    config: &Path,
) -> Arc<dyn crate::capture::desktop::settings::connect::Backend> {
    Arc::new(SettingsBackend(client_at(config.into()), config.into()))
}

struct SettingsBackend(Client, PathBuf);
use crate::capture::desktop::settings::connect as settings_controller;
impl settings_controller::Backend for SettingsBackend {
    fn shared_links_url(&self) -> Option<String> {
        crate::shared::handoff::capture_location::experiment_in(&self.1, HOSTED_SHARING)
            .ok().filter(|enabled| *enabled).and_then(|_| self.0.shared_links_url())
    }
    fn snapshot(
        &self,
    ) -> std::result::Result<settings_controller::Snapshot, settings_controller::SafeError> {
        self.0.settings_snapshot()
    }
    fn login(
        &self,
        server: &str,
        allowed: Arc<dyn Fn() -> bool + Send + Sync>,
        on_approval: &dyn Fn(settings_controller::Approval),
    ) -> std::result::Result<(), settings_controller::SafeError> {
        self.0.login_with_approval(server, "upload", true, &*allowed, on_approval)
    }
    fn resume(&self, server: &str, allowed: Arc<dyn Fn() -> bool + Send + Sync>) -> std::result::Result<(), settings_controller::SafeError> {
        self.0.settings_resume(server, &*allowed)
    }
    fn health(&self, allowed: Arc<dyn Fn() -> bool + Send + Sync>) -> settings_controller::Health {
        self.0.settings_health(&*allowed)
    }
    fn disable(&self, logout: bool) -> std::result::Result<(), settings_controller::SafeError> {
        self.0.settings_disable(logout)
    }
}
pub(crate) fn client() -> Client {
    client_at(crate::shared::handoff::default_config_path())
}

pub fn copy_link_handoff(bundle: &Path, allowed: &dyn Fn() -> bool, foreground: bool) -> Result<PreparedLink> {
    if foreground { return client().prepare_foreground_link(bundle, false, allowed); }
    let link = client().prepare_link(bundle, allowed)?;
    start_worker();
    Ok(link)
}
pub fn prepare_public_link_handoff(bundle: &Path, allowed: &dyn Fn() -> bool, foreground: bool) -> Result<PreparedLink> {
    if foreground { return client().prepare_foreground_link(bundle, true, allowed); }
    let link = client().prepare_public_link(bundle, allowed)?;
    start_worker();
    Ok(link)
}
pub fn observe_recording_start(practice: bool) {
    client().observe_recording_start(practice);
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

pub fn foreground_enabled() -> bool { client().foreground_enabled() }
pub fn foreground_progress() -> Option<u64> { apparent_connect_client::foreground_progress() }

fn recovery(error: anyhow::Error) -> anyhow::Error {
    // Keep the actual refusal visible to humans and CLI consumers on line one.
    let message = format!("{error}; run apparent connect alternatives for local inspection and authorized transfer options");
    error.context(message)
}

pub fn command(command: ConnectCommand) -> Result<()> {
    let client = client();
    let result = (|| match command {
        ConnectCommand::SupportReportAvailable => client.support_report_available(),
        ConnectCommand::SubmitSupportReport { bundle, archive, id } =>
            client.submit_support_report(&bundle, &archive, &id),
        ConnectCommand::SealSupportReport { bundle, out, origin, id, recipient } =>
            apparent_connect_client::seal_support_report(&bundle, &out, &origin, &id, &recipient)
                .map_err(|_| anyhow::anyhow!("Could not seal the support report. The recording remains local.")),
        ConnectCommand::OpenSupportReport { input, out, origin, id, key_file } =>
            apparent_connect_client::open_support_report(&input, &out, &origin, &id, &key_file)
                .map_err(|_| anyhow::anyhow!("Could not open the private support report.")),
        #[cfg(target_os = "linux")]
        ConnectCommand::CheckSupportPeer { uid } => apparent_connect_client::check_support_peer(uid),
        ConnectCommand::Files { id, reader } => {
            println!("{}",serde_json::to_string_pretty(&client.list_files(&id, reader.as_deref())?)?);
            Ok(())
        }
        ConnectCommand::Alternatives => {
            println!("{}", apparent_connect_client::Client::alternatives()?);
            Ok(())
        }
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
            reader,
        } => match reader {
            Some(name) => {
                anyhow::ensure!(scope == "read" && !consent_upload, "--reader is for read approval");
                client.login_reader(&name, &server, !no_browser)
            }
            None => client.login(&server, &scope, consent_upload, !no_browser),
        },
        ConnectCommand::Status { account } => {
            println!(
                "{}",
                serde_json::to_string_pretty(&client.status(account)?)?
            );
            Ok(())
        }
        ConnectCommand::Readers => {
            println!("{}", serde_json::to_string_pretty(&client.readers()?)?);
            Ok(())
        }
        ConnectCommand::Logout { reader: Some(name) } => {
            client.logout_reader(&name)?;
            println!("Signed out reader {name}.");
            Ok(())
        }
        ConnectCommand::Logout { reader: None } => {
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
        ConnectCommand::Retry { id: Some(id) } => client.retry_capture(&id),
        ConnectCommand::Retry { id: None } => {
            client.retry()?;
            client.process_once()
        }
        ConnectCommand::Upload { bundle } => {
            // CLI errors are printed with their source chain by main. Do not
            // attach path/credential parsing errors to these public diagnostics.
            let bundle = crate::shared::handoff::resolve_bundle_dir(&bundle).map_err(|_| {
                anyhow::anyhow!("invalid_bundle: choose an existing .apparent directory")
            })?;
            if client.foreground_enabled() {
                let id = client.upload_foreground(&bundle, &|| true)?;
                println!("Uploaded capture. Inspect with: apparent inspect {id}");
                return Ok(());
            }
            client.enqueue_explicit(&bundle).map_err(|_| {
                anyhow::anyhow!(
                    "queue_unavailable: check upload consent, sign-in and private hosted state; local capture is unchanged"
                )
            })?;
            println!("Queued hosted capture; inspect its ID with apparent connect status");
            client.process_once()
        }
    })();
    result.map_err(recovery)
}
#[derive(clap::Args)]
pub struct FetchArgs {
    id: String,
    #[arg(long, help = "Use a specific Connect read profile")]
    reader: Option<String>,
    #[arg(long = "file", help = "Retrieve these original asset paths into an extraction directory (v2)")]
    files: Vec<String>,
    #[arg(long)]
    out: PathBuf,
    #[arg(long, default_value_t = 0)]
    wait: u64,
}

pub fn fetch(args: FetchArgs) -> Result<()> {
    let selection = (!args.files.is_empty()).then_some(args.files.as_slice());
    let fetched = client().fetch_with_reader(
        &args.id, &args.out, args.wait, selection, args.reader.as_deref(),
    ).map_err(recovery)?;
    println!("{}", fetched.display());
    Ok(())
}
/// Only a bare canonical Connect ID implies a download. Explicit local paths
/// retain local inspection semantics; fetch never overwrites existing output.
pub fn inspect_source(source: &Path, reader: Option<&str>) -> Result<PathBuf> {
    let Some(id) = inspect_capture_id(source) else {
        anyhow::ensure!(reader.is_none(), "--reader requires a Connect capture ID");
        return Ok(source.to_path_buf());
    };
    client().fetch_with_reader(id, &PathBuf::from(format!("./{id}.apparent")), 120, None, reader)
        .map_err(recovery)
}

pub(crate) fn inspect_capture_id(source: &Path) -> Option<&str> {
    source.to_str().filter(|id| {
        id.len() == 32
            && id
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    })
}

#[cfg(test)]
mod inspect_tests {
    use super::*;

    #[test]
    fn only_bare_canonical_ids_trigger_connect_fetch() {
        let id = "0123456789abcdef0123456789abcdef";
        assert_eq!(inspect_capture_id(Path::new(id)), Some(id));
        for local in [
            format!("./{id}"),
            format!("{id}/"),
            format!("{id}/apparent.json"),
            format!("/{id}"),
            format!("{id}.apparent"),
            id.to_uppercase(),
            "latest".into(),
            "apparent.json".into(),
            "0123456789abcdef0123456789abcde".into(),
            "g123456789abcdef0123456789abcdef".into(),
            "0123456789abcdef0123456789abcdef0".into(),
        ] {
            assert_eq!(inspect_capture_id(Path::new(&local)), None, "{local}");
        }
        use std::os::unix::ffi::OsStrExt;
        assert_eq!(
            inspect_capture_id(Path::new(std::ffi::OsStr::from_bytes(&[0xff; 32]))),
            None
        );
    }
}

pub fn completed(bundle: &Path) {
    if cfg!(test) {
        return;
    }
    let client = client();
    if client.foreground_enabled() { return; }
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
mod hosted_settings_tests;
#[cfg(test)]
pub(crate) mod hosted_tests;
