//! Default-off hosted handoff, shared by macOS and Linux. No network on finish/paste.
//! Secrets go only through curl's stdin config, never argv or diagnostic output.
use std::collections::BTreeSet;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::os::fd::AsRawFd;
use std::os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result, bail, ensure};
use clap::Subcommand;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
mod renewal;
mod encrypted_transfer;
use encrypted_transfer::snapshot;
mod private_files;
use private_files::*;
mod file_transfer;
mod policy;
use policy::*;
mod encryption;
mod foreground;
use foreground::{canonical_query, validate_share_url};
mod activity;
#[cfg(target_os = "linux")]
pub use encryption::support::check_support_peer;
pub use foreground::foreground_progress;
pub mod settings;
/// Application-owned preferences and browser mechanics. Implementations must
/// perform fresh reads, preserve unrelated config, and serialize each write.
/// Called with queue.lock held for publication; never acquire queue.lock here.
pub use policy::ConfigProvider;
pub use policy::{RenewalDecision, RenewalFacts};
use settings::{SafeError, cancelled, hosted_failure};

pub const HOSTED_SYNC: &str = "hostedSync";
pub const HOSTED_SHARING: &str = "labs.hostedSharing";
pub const SPEAKING_STYLE: &str = "labs.speakingStyle";
pub const HOSTED_ENCRYPTION: &str = "hostedEncryption";
pub const FOREGROUND_UPLOAD: &str = "connectForegroundUpload";

/// Only the foreground caller may put this result on the clipboard. Detached
/// workers never own clipboard access, including retries and account completion.
#[derive(Clone)]
pub struct PreparedLink {
    pub text: String,
    job: Job,
    client: Client,
    foreground: bool,
    foreground_epoch: Option<String>,
}

impl PreparedLink {
    pub fn authorized(&self) -> bool {
        self.client.provider.experiment(HOSTED_SHARING) && if self.foreground {
            self.client.foreground_authorized(&self.job)
                && self.client.cancellation().is_ok_and(|epoch| epoch == self.foreground_epoch)
        } else { self.client.share_active(&self.job) }
    }
}

const MAX_BYTES: u64 = 500_000_000;
const MAX_FILES: usize = 512;
const MAX_FILE_BYTES: u64 = 90_000_000;
const MAX_JOBS: usize = 100;
const MAX_ATTEMPTS: u32 = 8;
const RETENTION: u64 = 7 * 24 * 60 * 60;
const JSON_LIMIT: u64 = 2_000_000;

pub use encryption::support::{open as open_support_report, seal as seal_support_report};

#[derive(Subcommand)]
pub enum ConnectCommand {
    #[command(hide = true)]
    SupportReportAvailable,
    #[command(hide = true)]
    SubmitSupportReport { bundle: PathBuf, archive: PathBuf, id: String },
    #[command(hide = true)]
    SealSupportReport { bundle: PathBuf, out: PathBuf, origin: String, id: String, recipient: String },
    #[command(hide = true)]
    OpenSupportReport { input: PathBuf, out: PathBuf, origin: String, id: String, key_file: PathBuf },
    #[cfg(target_os = "linux")]
    #[command(hide = true)]
    CheckSupportPeer { uid: u32 },
    /// Sign in through a device code. Upload requires explicit --consent-upload.
    Login {
        #[arg(long)]
        server: String,
        #[arg(long, default_value = "read", value_parser = ["upload", "read"])]
        scope: String,
        #[arg(long)]
        consent_upload: bool,
        /// Print the verification link without opening a browser.
        #[arg(long)]
        no_browser: bool,
        #[arg(long, help = "Save a separate named read profile")]
        reader: Option<String>,
    },
    /// Inspect local queue and credentials (never prints tokens); --account also reads quota.
    Status {
        #[arg(long)]
        account: bool,
    },
    /// Disable automatic uploads, cancel pending jobs and remove both local tokens.
    Logout {
        #[arg(long, help = "Sign out only this named read profile")]
        reader: Option<String>,
    },
    #[command(about = "List local Connect read profiles and authorization status")]
    Readers,
    #[command(about = "List recent recordings for one Connect reader")]
    List {
        #[arg(long)]
        reader: Option<String>,
        #[arg(long, default_value_t = 10, value_parser = clap::value_parser!(u8).range(1..=50))]
        limit: u8,
        #[arg(long)]
        json: bool,
    },
    /// Disable automatic uploads and cancel pending jobs, retaining credentials.
    Disable,
    /// Retry failed queued captures. Does not discover or upload old captures.
    Retry {
        /// Retry only this retained capture, without processing other queued work.
        #[arg(long)]
        id: Option<String>,
    },
    /// Explicitly upload one historical capture (requires upload consent).
    Upload { bundle: PathBuf },
    /// List original assets using only the encrypted index (v2 captures).
    Files {
        id: String,
        #[arg(long, help = "Use a specific read profile")]
        reader: Option<String>,
    },
    /// Show local inspection and authorized transfer options when Connect is unavailable.
    Alternatives,
    /// List or revoke public-by-link access. IDs are management IDs, not capture IDs.
    Shares {
        #[command(subcommand)]
        command: SharesCommand,
    },
}

#[derive(Subcommand)]
pub enum SharesCommand {
    /// List shared captures (read or upload login).
    List,
    /// Stop future access without deleting the private capture (upload login).
    Revoke { id: String },
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CloudConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub upload_consent: bool,
    #[serde(default)]
    pub server: String,
}

#[derive(Clone, Deserialize, Serialize, PartialEq, Eq)]
struct Credential {
    server: String,
    #[serde(default)]
    site: Option<String>,
    scope: String,
    token: String,
    generation: String,
    #[serde(default, rename = "refreshToken")]
    refresh_token: Option<String>,
    #[serde(default, rename = "expiresAt")]
    expires_at: Option<u64>,
    #[serde(default, rename = "refreshExpiresAt")]
    refresh_expires_at: Option<u64>,
    #[serde(default, rename = "grantId")]
    grant_id: Option<String>,
    #[serde(default, rename = "authRequired")]
    auth_required: bool,
    #[serde(default)]
    encryption_identity: Option<String>,
    #[serde(default, rename = "accountInitial", deserialize_with = "renewal::deserialize_account_initial")]
    account_initial: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
struct Asset {
    path: String,
    size: u64,
    sha256: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Job {
    id: String,
    bundle: PathBuf,
    server: String,
    generation: String,
    created: u64,
    #[serde(default)]
    recorded_at_ms: Option<u64>,
    attempts: u32,
    next_attempt: u64,
    status: String,
    error: Option<String>,
    #[serde(default)]
    files: Vec<Asset>,
    #[serde(default)]
    shared: bool,
    #[serde(default)]
    public_copy: bool,
    #[serde(default)]
    encrypted: bool,
    #[serde(default)]
    speaking_style: bool,
    #[serde(default)]
    encryption: Option<encrypted_transfer::EncryptedJob>,
    #[serde(default = "legacy_encryption_version")]
    encryption_version: u32,
}

fn legacy_encryption_version() -> u32 { 1 }

#[derive(Clone)]
pub struct Client {
    provider: std::sync::Arc<dyn ConfigProvider>,
    #[cfg(any(test, feature = "test-support"))]
    config: PathBuf,
    state: PathBuf,
    named_reader: bool,
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn random_id() -> Result<String> {
    let mut bytes = [0u8; 16];
    File::open("/dev/urandom")?.read_exact(&mut bytes)?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}
fn valid_id(id: &str) -> bool {
    id.len() == 32
        && id
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn hex_digest(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn safe_shares_error(message: &str) -> &'static str {
    if message.starts_with("auth_required:") {
        return "auth_required";
    }
    if message.starts_with("Hosted API temporarily unavailable") {
        return "temporarily_unavailable";
    }
    if message.starts_with("Hosted transport failed") {
        return "transport_failed";
    }
    if message.starts_with("Hosted response exceeds limit") {
        return "response_limit";
    }
    if message.starts_with("Invalid hosted JSON response") {
        return "invalid_json";
    }
    for code in [
        "file_too_large", "manifest_conflict", "beta_required", "slow_down",
        "quota_exceeded", "unauthorized", "forbidden", "expired", "rejected",
        "not_found", "conflict", "authorization_pending", "device_expired",
        "device_rejected", "reauthorization_required",
    ] {
        if message.contains(code) {
            return code;
        }
    }
    "request_failed"
}

fn safe_shares_policy_message(message: &str) -> bool {
    matches!(
        message,
        "Invalid shares response"
            | "Invalid share response"
            | "Invalid shares cursor"
            | "Invalid share identity"
            | "Inactive share exposed a URL"
            | "Invalid share URL"
            | "Repeated shares cursor"
            | "Shares list exceeds the 64 MiB output limit"
            | "Invalid shares transport response"
            | "Shares transport closed"
            | "Hosted API temporarily unavailable; retry later"
            | "Hosted transport failed (network, timeout or response limit)"
            | "Hosted response exceeds limit"
            | "Invalid hosted JSON response"
            | "Hosted API request failed"
            | "auth_required: approve this device again with apparent connect login"
    ) || message == "Hosted API: file_too_large"
        || message == "Hosted API: manifest_conflict"
        || message == "Hosted API: beta_required"
        || message == "Hosted API: slow_down"
        || message == "Hosted API: quota_exceeded"
        || message == "Hosted API: unauthorized"
        || message == "Hosted API: forbidden"
        || message == "Hosted API: expired"
        || message == "Hosted API: rejected"
        || message == "Hosted API: not_found"
        || message == "Hosted API: conflict"
        || message == "Hosted API: authorization_pending"
        || message == "Hosted API: device_expired"
        || message == "Hosted API: device_rejected"
        || message == "Hosted API: reauthorization_required"
}

fn server_url(raw: &str) -> Result<String> {
    let raw = raw.trim_end_matches('/');
    ensure!(
        raw.len() <= 2048
            && raw.is_ascii()
            && !raw.bytes().any(|b| b.is_ascii_control()
                || b.is_ascii_whitespace()
                || b"\"'\\?#@".contains(&b)),
        "Invalid server URL"
    );
    let authority = raw
        .strip_prefix("https://")
        .or_else(|| raw.strip_prefix("http://"))
        .context("Server must use HTTPS")?;
    ensure!(
        !authority.is_empty() && !authority.contains('/'),
        "Server must be an origin without a path"
    );
    let host = authority.split(':').next().unwrap_or("");
    ensure!(
        !host.is_empty()
            && host
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b".-".contains(&b)),
        "Invalid server host"
    );
    if let Some((_, port)) = authority.split_once(':') {
        ensure!(
            !port.is_empty() && port.parse::<u16>().is_ok_and(|n| n > 0),
            "Invalid server port"
        );
    }
    ensure!(
        raw.starts_with("https://") || matches!(host, "127.0.0.1" | "localhost"),
        "Plain HTTP is allowed only on loopback"
    );
    Ok(raw.to_owned())
}

fn config_escape(value: &str) -> Result<String> {
    ensure!(
        !value.bytes().any(|b| b.is_ascii_control()),
        "Invalid transport value"
    );
    Ok(value.replace('\\', "\\\\").replace('"', "\\\""))
}

impl Client {
    /// Pure workflow policy runs in the packaged TypeScript owner. Native code
    /// supplies bounded stdio and process cleanup, without queue locks or secrets.
    pub fn shares(&self) -> Result<Value> {
        let server = server_url(&self.settings().server)?;
        let credential = self
            .credential("read", &server)
            .or_else(|_| self.credential("upload", &server))?;
        self.shares_with_typescript(&server, &credential)
    }
    fn shares_with_typescript(&self, server: &str, credential: &Credential) -> Result<Value> {
        let (runtime, module, electron_runtime) = shares_typescript_runtime()?;
        let mut command = Command::new(runtime);
        if electron_runtime {
            command.env("ELECTRON_RUN_AS_NODE", "1");
        } else if module.extension().is_some_and(|extension| extension == "ts") {
            command.arg("--experimental-strip-types");
        }
        let mut child = PolicyChild(
            command
                .arg(module)
                .arg(server)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .spawn()
                .context("Could not start Connect shares policy runtime")?,
        );
        let mut input = child.stdin.take().context("Missing shares policy input")?;
        let mut output = child.stdout.take().context("Missing shares policy output")?;
        loop {
            let line = policy_frame(&mut output)?;
            let request: Value = serde_json::from_str(&line)
                .with_context(|| format!("Invalid shares policy JSON ({} bytes)", line.len()))?;
            match request["operation"].as_str() {
                Some("complete") => {
                    ensure!(
                        request.as_object().is_some_and(|o| o.len() == 2)
                            && request.get("result").is_some(),
                        "Invalid shares policy result"
                    );
                    drop(input);
                    let status = policy_exit(&mut child)?;
                    ensure!(status.success(), "Shares policy failed");
                    return Ok(request["result"].clone());
                }
                Some("error") => {
                    let message = request["error"]
                        .as_str()
                        .context("Invalid shares policy error")?;
                    ensure!(
                        request.as_object().is_some_and(|o| o.len() == 2)
                            && safe_shares_policy_message(message),
                        "Invalid shares policy error"
                    );
                    drop(input);
                    let status = policy_exit(&mut child)?;
                    ensure!(
                        !status.success(),
                        "Shares policy error frame exited successfully"
                    );
                    bail!("{message}");
                }
                Some("page") => {
                    // A 4096-byte opaque cursor can expand sixfold in JSON and
                    // threefold in the percent-encoded query, plus the envelope.
                    ensure!(line.len() <= 40_000, "Oversized shares page request");
                    ensure!(
                        request.as_object().is_some_and(|o| o.len() == 3)
                            && request.get("before").is_some()
                            && request.get("query").is_some(),
                        "Invalid shares policy frame"
                    );
                    let route = match (&request["before"], &request["query"]) {
                        (Value::Null, Value::Null) => "/v1/shares".to_owned(),
                        (Value::String(cursor), Value::String(query))
                            if !cursor.is_empty()
                                && cursor.len() <= 4096
                                && canonical_query(query) =>
                        {
                            format!("/v1/shares?before={query}")
                        }
                        _ => bail!("Invalid shares cursor request"),
                    };
                    let reply = self.json_request(
                        server,
                        Some(credential),
                        "GET",
                        &route,
                        None,
                        Duration::from_secs(30),
                        &|| true,
                    );
                    let response = match reply {
                        Ok(body) => json!({"ok":true,"body":body}),
                        Err(error) => json!({"ok":false,"error":safe_shares_error(&error.to_string())}),
                    };
                    policy_write(&mut input, &response)?;
                }
                _ => bail!("Invalid shares policy operation"),
            }
        }
    }
    pub fn revoke_share(&self, id: &str) -> Result<()> {
        ensure!(
            valid_id(id),
            "Share management ID must be 32 lowercase hexadecimal characters (not the URL secret)"
        );
        let server = server_url(&self.settings().server)?;
        let credential = self.credential("upload", &server)?;
        let reply = self.json_request(
            &server,
            Some(&credential),
            "DELETE",
            &format!("/v1/shares/{id}"),
            None,
            Duration::from_secs(30),
            &|| true,
        )?;
        ensure!(reply["ok"] == true, "Share revocation failed");
        let remaining = self.shares_with_typescript(&server, &credential)?;
        ensure!(
            !remaining["shares"]
                .as_array()
                .context("Invalid shares response")?
                .iter()
                .any(|share| share["id"].as_str() == Some(id)
                    && !matches!(share["status"].as_str(), Some("revoked" | "expired"))),
            "Share is still active"
        );
        Ok(())
    }
    #[cfg(any(test, feature = "test-support"))]
    fn share(&self, bundle: &Path) -> Result<String> {
        self.share_allowed(bundle, &|| true)
    }
    pub fn prepare_link(
        &self,
        bundle: &Path,
        foreground: &dyn Fn() -> bool,
    ) -> Result<PreparedLink> {
        self.prepare_link_with_intent(bundle, foreground, false)
    }
    /// Call only after disclosing that anyone with the link can view this capture
    /// and shared captures are not end-to-end encrypted. Upload consent alone is
    /// insufficient. This never changes an existing private upload's format.
    pub fn prepare_public_link(
        &self,
        bundle: &Path,
        foreground: &dyn Fn() -> bool,
    ) -> Result<PreparedLink> {
        self.prepare_link_with_intent(bundle, foreground, true)
    }
    fn prepare_link_with_intent(
        &self,
        bundle: &Path,
        foreground: &dyn Fn() -> bool,
        public_copy: bool,
    ) -> Result<PreparedLink> {
        let (url, job) = self.share_prepared_with_intent(bundle, foreground, public_copy)?;
        Ok(PreparedLink {
            foreground: false,
            foreground_epoch: None,
            client: self.clone(),
            job,
            text: format!(
                "I recorded some feedback in Apparent. Open this link for the recording, transcript and original image evidence: {url}. Anyone with this link can view this capture; shared captures are not end-to-end encrypted."
            ),
        })
    }
    #[cfg(any(test, feature = "test-support"))]
    fn share_allowed(&self, bundle: &Path, foreground: &dyn Fn() -> bool) -> Result<String> {
        self.share_prepared(bundle, foreground).map(|(url, _)| url)
    }
    #[cfg(any(test, feature = "test-support"))]
    fn share_prepared(
        &self,
        bundle: &Path,
        foreground: &dyn Fn() -> bool,
    ) -> Result<(String, Job)> {
        self.share_prepared_with_intent(bundle, foreground, false)
    }
    fn share_prepared_with_intent(
        &self,
        bundle: &Path,
        foreground: &dyn Fn() -> bool,
        public_copy: bool,
    ) -> Result<(String, Job)> {
        ensure!(foreground(), "cancelled");
        ensure!(
            public_copy || !self.provider.experiment(HOSTED_ENCRYPTION),
            "encrypted_sharing_unsupported: encrypted captures require an approved agent client"
        );
        ensure!(
            self.provider.experiment(HOSTED_SHARING),
            "Hosted sharing is disabled"
        );
        let id = self.enqueue_with_intent(bundle, false, public_copy)?;
        let mut job = self
            .jobs()?
            .into_iter()
            .find(|j| j.id == id)
            .context("Missing queued capture")?;
        ensure!(
            self.share_active(&job),
            "Upload consent changed or capture was cancelled"
        );
        let credential = self.credential("upload", &job.server)?;
        let scratch = Scratch::new(&self.state)?;
        let files = snapshot(&job.bundle, &scratch.0)?;
        {
            let _lock = Lock::acquire(&self.state.join("queue.lock"), false)?;
            ensure!(self.share_active_locked(&job), "cancelled");
            // A concurrent uploader can have advanced the same job. Merge only the
            // immutable manifest, never overwrite its progress/status/retry state.
            let mut current = self
                .jobs()?
                .into_iter()
                .find(|j| j.id == id)
                .context("Missing queued capture")?;
            ensure!(
                current.files.is_empty() || current.files == files,
                "Bundle changed after reservation"
            );
            current.files = files.clone();
            // Retain the identity until retention expires, including after ready.
            // The URL secret itself is never stored in status or application logs.
            current.shared = true;
            self.save_job(&current)?;
            job = current;
        }
        job.recorded_at_ms = Job::recording_time(&scratch.0);
        let allowed =
            || foreground() && self.provider.experiment(HOSTED_SHARING) && self.share_active(&job);
        let base = format!("/v1/captures/{id}");
        let reserved = self.json_request(
            &job.server,
            Some(&credential),
            "POST",
            &base,
            Some(job.reservation(json!({"files":files}))),
            Duration::from_secs(30),
            &allowed,
        )?;
        ensure!(
            reserved["id"].as_str() == Some(&id),
            "Invalid reservation ID"
        );
        let reply = self.json_request(
            &job.server,
            Some(&credential),
            "POST",
            &format!("{base}/share"),
            None,
            Duration::from_secs(30),
            &allowed,
        )?;
        let url = reply["url"].as_str().context("Missing share URL")?;
        validate_share_url(&job.server, url)?;
        ensure!(
            matches!(
                reply["status"].as_str(),
                Some("uploading" | "pending" | "ready" | "paused" | "failed")
            ) && (reply["expiresAt"].is_number() || reply["expiresAt"].is_string()),
            "Invalid share response"
        );
        ensure!(allowed(), "cancelled");
        if job.public_copy {
            let _lock = Lock::acquire(&self.state.join("queue.lock"), false)?;
            ensure!(
                foreground() && self.provider.experiment(HOSTED_SHARING)
                    && self.share_active_locked(&job),
                "cancelled"
            );
            let mut current = self.jobs()?.into_iter().find(|j| j.id == id)
                .context("Missing queued capture")?;
            // A crash/cancel before share reservation must not leave an upload
            // that retry or a background worker can publish without the caller.
            if current.status == "awaiting_share" {
                current.status = "pending".into();
                self.save_job(&current)?;
            }
            job = current;
        }
        Ok((url.into(), job))
    }
    /// Providers must read current state and delegate writes to the caller's
    /// serialized config store. No preference snapshot is retained here.
    pub fn new(provider: std::sync::Arc<dyn ConfigProvider>) -> Self {
        let config = provider.config_path().to_path_buf();
        let state = config.parent().unwrap_or(Path::new(".")).join("hosted");
        Self {
            provider,
            #[cfg(any(test, feature = "test-support"))]
            config,
            state,
            named_reader: false,
        }
    }
    fn settings(&self) -> CloudConfig {
        self.provider.cloud()
    }
    fn revocation_intents(&self) -> Result<Vec<(PathBuf, bool)>> {
        match fs::symlink_metadata(&self.state) {
            Ok(_) => private_dir(&self.state)?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(e) => return Err(e.into()),
        }
        let entries = match fs::read_dir(&self.state) {
            Ok(entries) => entries,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(e) => return Err(e.into()),
        };
        let mut intents = Vec::new();
        for entry in entries {
            let path = entry?.path();
            if path
                .file_name()
                .and_then(|s| s.to_str())
                .is_some_and(|s| s.starts_with("revocation-") && s.ends_with(".intent"))
            {
                let logout = serde_json::from_slice(&read_private(&path, 128)?)?;
                intents.push((path, logout));
            }
        }
        Ok(intents)
    }
    /// Pending or unreadable durable revocation always blocks new authorization.
    pub fn revocation_pending(&self) -> bool {
        !self
            .revocation_intents()
            .is_ok_and(|intents| intents.is_empty())
    }
    pub fn enabled(&self) -> bool {
        if self.revocation_pending() {
            return false;
        }
        let cloud = self.provider.cloud();
        let experiment = self.provider.experiment(HOSTED_SYNC);
        experiment && cloud.enabled && cloud.upload_consent && server_url(&cloud.server).is_ok()
    }
    fn credential(&self, scope: &str, server: &str) -> Result<Credential> {
        let credential = self.stored_credential(scope)?;
        ensure!(
            credential.server == server,
            "Sign in with the requested scope and server"
        );
        Ok(credential)
    }
    fn stored_credential(&self, scope: &str) -> Result<Credential> {
        private_dir(&self.state)?;
        let credential: Credential = serde_json::from_slice(&read_private(
            &self.state.join(format!("{scope}.credential")),
            32768,
        )?)?;
        ensure!(
            credential.scope == scope
                && credential.server == server_url(&credential.server)?
                && valid_id(&credential.generation),
            "Sign in with the requested scope and server"
        );
        ensure!(
            !credential.token.is_empty()
                && credential.token.len() <= 8192
                && credential.token.bytes().all(|b| b.is_ascii_graphic()),
            "Invalid credential"
        );
        credential.validate()?;
        Ok(credential)
    }
    fn active(&self, job: &Job) -> bool {
        if !self.enabled() {
            return false;
        }
        let Ok(_lock) = Lock::acquire(&self.state.join("queue.lock"), false) else {
            return false;
        };
        self.active_locked(job)
    }
    // Caller holds queue.lock. Never acquire it recursively from a save path.
    fn active_locked(&self, job: &Job) -> bool {
        self.current_incarnation(job)
            .is_some_and(|current| current.status == job.status
                && !matches!(current.status.as_str(), "cancelled" | "awaiting_share"))
    }
    fn share_active(&self, job: &Job) -> bool {
        if !self.enabled() {
            return false;
        }
        let Ok(_lock) = Lock::acquire(&self.state.join("queue.lock"), false) else {
            return false;
        };
        self.share_active_locked(job)
    }
    // Upload progress is not a new authorization incarnation. The uploader still
    // uses active_locked's exact-status check before publishing its own results.
    fn share_active_locked(&self, job: &Job) -> bool {
        self.current_incarnation(job).is_some_and(|current| {
            (matches!(current.status.as_str(), "pending" | "failed" | "ready")
                || (current.public_copy && current.status == "awaiting_share"))
                && now().saturating_sub(current.created) <= RETENTION
                && (job.files.is_empty() || current.files == job.files)
                && (!job.shared || current.shared)
        })
    }
    // Caller holds queue.lock; identity and current consent are shared by both
    // policies, but mutable upload status must not stand in for consent.
    fn current_incarnation(&self, job: &Job) -> Option<Job> {
        if !self.enabled()
            || if job.public_copy {
                job.encrypted || !job.shared || !self.provider.experiment(HOSTED_SHARING)
            } else {
                job.encrypted != self.provider.experiment(HOSTED_ENCRYPTION)
            }
            || self.settings().server != job.server
            || !self
                .credential("upload", &job.server)
                .is_ok_and(|c| c.generation == job.generation)
        {
            return None;
        }
        let current: Job = serde_json::from_slice(
            &read_private(&self.state.join(format!("{}.job", job.id)), JSON_LIMIT).ok()?,
        )
        .ok()?;
        (current.id == job.id
            && current.bundle == job.bundle
            && current.server == job.server
            && current.generation == job.generation
            && current.encrypted == job.encrypted
            && current.encryption_version == job.encryption_version
            && current.public_copy == job.public_copy
            && (!current.public_copy || current.shared)
            && current.created == job.created)
            .then_some(current)
    }
    fn jobs(&self) -> Result<Vec<Job>> {
        private_dir(&self.state)?;
        let mut jobs = Vec::new();
        for entry in fs::read_dir(&self.state)? {
            let path = entry?.path();
            if path.extension().is_some_and(|e| e == "job") {
                ensure!(jobs.len() < MAX_JOBS, "Hosted queue exceeds bound");
                let job: Job = serde_json::from_slice(&read_private(&path, JSON_LIMIT)?)?;
                ensure!(
                    valid_id(&job.id) && path.file_stem().and_then(|s| s.to_str()) == Some(&job.id),
                    "Invalid queued ID"
                );
                jobs.push(job);
            }
        }
        Ok(jobs)
    }
    fn save_job(&self, job: &Job) -> Result<()> {
        let path = self.state.join(format!("{}.job", job.id));
        let mut job = job.clone();
        // Share admission may race an uploader snapshot. This monotonic metadata
        // must not be lost when that uploader publishes an acknowledgement.
        if let Ok(bytes) = read_private(&path, JSON_LIMIT) {
            if let Ok(current) = serde_json::from_slice::<Job>(&bytes) {
                job.shared |= current.shared;
            }
        }
        atomic_json(&path, &job)
    }
    pub fn enqueue(&self, bundle: &Path) -> Result<String> {
        self.enqueue_with_intent(bundle, false, false)
    }
    pub fn enqueue_explicit(&self, bundle: &Path) -> Result<String> {
        self.enqueue_with_intent(bundle, true, false)
    }
    fn enqueue_with_intent(&self, bundle: &Path, explicit: bool, public_copy: bool) -> Result<String> {
        ensure!(
            self.enabled(),
            "Enable hostedSync and grant upload consent with apparent connect login --scope upload --consent-upload"
        );
        private_dir(&self.state)?;
        #[cfg(any(test, feature = "test-support"))]
        test_support::run_hook("enqueue_before_lock", bundle);
        let _lock = Lock::acquire(&self.state.join("queue.lock"), false)?;
        // Disable clears the gates and cancels jobs under this same lock.
        // An admission paused before the lock must not publish after it returns.
        ensure!(self.enabled(), "Hosted uploads are disabled");
        ensure!(
            !public_copy || self.provider.experiment(HOSTED_SHARING),
            "Hosted sharing is disabled"
        );
        let bundle = bundle.canonicalize()?;
        // The bundle may itself be supplied through an alias, but no bundled data may be symlinked.
        ensure!(
            bundle.is_dir()
                && bundle.extension().is_some_and(|x| x == "apparent")
                && bundle.join("apparent.json").is_file(),
            "Expected completed .apparent bundle"
        );
        let settings = self.settings();
        let credential = self.credential("upload", &settings.server)?;
        let mut jobs = self.jobs()?;
        if !explicit {
            // Deduplicate only retained queue records, even after cancellation or
            // a fresh device grant. Pruned records leave no permanent dedup history.
            if let Some(job) = jobs
                .iter()
                .find(|j| {
                    j.bundle == bundle && j.server == settings.server
                        && j.public_copy == public_copy
                        && (!public_copy || (j.generation == credential.generation
                            && !matches!(j.status.as_str(), "cancelled" | "expired")
                            && now().saturating_sub(j.created) <= RETENTION))
                })
            {
                return Ok(job.id.clone());
            }
        } else {
            // Explicit consent for this bundle creates a fresh remote identity. A
            // reserved manifest and server tombstone are immutable; retry keeps an ID.
            for job in &mut jobs {
                if !job.public_copy && job.bundle == bundle
                    && job.server == settings.server && job.status != "ready"
                {
                    job.status = "cancelled".into();
                    self.save_job(job)?;
                }
            }
        }
        // Public admission leaves private metadata/spools untouched. Other
        // admissions reclaim only terminal/expired metadata, never live work.
        jobs.retain(|job| {
            if (!public_copy || job.public_copy) && (now().saturating_sub(job.created) > RETENTION
                || (!job.shared && matches!(job.status.as_str(), "ready" | "cancelled" | "expired")))
            {
                let _ = fs::remove_file(self.state.join(format!("{}.job", job.id)));
                let _ = fs::remove_dir_all(self.state.join(format!("{}.sealed", job.id)));
                false
            } else {
                true
            }
        });
        ensure!(
            jobs.len() < MAX_JOBS,
            "Hosted queue full; local bundle remains available"
        );
        let job = Job {
            id: random_id()?,
            recorded_at_ms: None,
            bundle,
            server: settings.server,
            generation: credential.generation,
            created: now(),
            attempts: 0,
            next_attempt: 0,
            status: if public_copy { "awaiting_share" } else { "pending" }.into(),
            error: None,
            files: Vec::new(),
            shared: public_copy,
            public_copy,
            speaking_style: !public_copy && self.provider.experiment(SPEAKING_STYLE),
            encrypted: !public_copy && self.provider.experiment(HOSTED_ENCRYPTION),
            encryption: None,
            encryption_version: 2,
        };
        self.save_job(&job)?;
        Ok(job.id)
    }

    fn raw_request(
        &self,
        server: &str,
        token: Option<&str>,
        method: &str,
        route: &str,
        body: Option<&Path>,
        output: &Path,
        limit: u64,
        timeout: Duration,
        allowed: &dyn Fn() -> bool,
    ) -> Result<()> {
        let server = server_url(server)?;
        ensure!(
            route.starts_with("/v1/") && !route.contains(['\r', '\n', '"']),
            "Invalid API route"
        );
        ensure!(allowed(), cancelled());
        let mut config = format!(
            "url = \"{}\"\nrequest = \"{method}\"\n",
            config_escape(&format!("{server}{route}"))?
        );
        if let Some(token) = token {
            config.push_str(&format!(
                "header = \"Authorization: Bearer {}\"\n",
                config_escape(token)?
            ));
        }
        if let Some(body) = body {
            let (option, prefix) = if method == "PUT" { ("upload-file", "") } else { ("data-binary", "@") };
            config.push_str(&format!("{option} = \"{prefix}{}\"\n", config_escape(&body.to_string_lossy())?));
            config.push_str(if method == "PUT" {
                "header = \"Content-Type: application/octet-stream\"\n"
            } else {
                "header = \"Content-Type: application/json\"\n"
            });
        }
        let response = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(output)?;
        drop(response);
        let timeout = timeout
            .max(Duration::from_millis(1))
            .min(Duration::from_secs(60));
        let mut child = Command::new("curl")
            .args([
                "--disable",
                "--silent",
                "--show-error",
                "--no-netrc",
                "--proto",
                "=http,https",
                "--max-redirs",
                "0",
                "--connect-timeout",
                "5",
                "--max-time",
            ])
            .arg(format!("{:.3}", timeout.as_secs_f64()))
            .args(["--max-filesize", &limit.to_string(), "--output"])
            .arg(output)
            .args(["--write-out", "%{http_code}", "--config", "-"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .context("curl is required for hosted transport")?;
        let input_result = child
            .stdin
            .take()
            .context("Missing curl stdin")?
            .write_all(config.as_bytes());
        // Do not retain a second token-bearing config during polling.
        drop(config);
        if input_result.is_err() {
            let _ = child.kill();
            let _ = child.wait();
            ensure!(allowed(), cancelled());
            bail!(hosted_failure(SafeError::Offline, "Hosted transport input failed"));
        }
        let deadline = Instant::now() + timeout + Duration::from_millis(250);
        let status = loop {
            #[cfg(any(test, feature = "test-support"))]
            test_support::run_hook("transport_poll", body.unwrap_or(output));
            let active = allowed();
            if !active || Instant::now() > deadline {
                let _ = child.kill();
                let _ = child.wait();
                ensure!(active && allowed(), cancelled());
                bail!(hosted_failure(SafeError::Offline, "Hosted request timed out"));
            }
            if let Some(status) = child.try_wait()? {
                break status;
            }
            std::thread::sleep(Duration::from_millis(20));
        };
        let mut code = String::new();
        child
            .stdout
            .take()
            .context("Missing curl stdout")?
            .take(16)
            .read_to_string(&mut code)?;
        ensure!(allowed(), cancelled());
        #[cfg(test)]
        if !status.success() {
            // Numeric evidence only; config, paths, stderr and response text
            // can carry credentials or user data and must not be printed.
            eprintln!(
                "hosted curl failure: exit={:?}; http={:?}; body_bytes={:?}; response_bytes={:?}",
                status.code(),
                code.trim().parse::<u16>().ok(),
                body.and_then(|path| fs::metadata(path).ok())
                    .map(|m| m.len()),
                fs::metadata(output).ok().map(|m| m.len()),
            );
        }
        ensure!(
            status.success(),
            hosted_failure(SafeError::Offline, "Hosted transport failed (network, timeout or response limit)")
        );
        ensure!(
            fs::metadata(output)?.len() <= limit,
            "Hosted response exceeds limit"
        );
        if !code.starts_with('2') {
            if code.trim() == "401" {
                bail!(hosted_failure(SafeError::AuthRequired, "auth_required: approve this device again with apparent connect login"));
            }
            if code.trim() == "429" || code.starts_with('5') {
                bail!(hosted_failure(SafeError::Offline, "Hosted API temporarily unavailable; retry later"));
            }
            // Only expose a known non-secret error code, not remote text or curl stderr.
            let error = fs::read(output)
                .ok()
                .and_then(|b| serde_json::from_slice::<Value>(&b).ok());
            let code = error
                .as_ref()
                .and_then(|v| v.pointer("/error/code"))
                .and_then(Value::as_str)
                .unwrap_or("http_error");
            let safe = match code {
                "file_too_large"
                | "manifest_conflict"
                | "beta_required"
                | "slow_down"
                | "quota_exceeded"
                | "unauthorized"
                | "forbidden"
                | "expired"
                | "rejected"
                | "not_found"
                | "conflict"
                | "authorization_pending"
                | "device_expired"
                | "device_rejected"
                | "reauthorization_required" => code,
                _ => "http_error",
            };
            let kind = match safe {
                "device_expired" => SafeError::Expired,
                "device_rejected" | "rejected" => SafeError::Rejected,
                _ => SafeError::Unavailable,
            };
            bail!(hosted_failure(kind, format!("Hosted API: {safe}")));
        }
        ensure!(allowed(), cancelled());
        Ok(())
    }
    fn json_request(
        &self,
        server: &str,
        token: Option<&Credential>,
        method: &str,
        route: &str,
        body: Option<Value>,
        timeout: Duration,
        allowed: &dyn Fn() -> bool,
    ) -> Result<Value> {
        self.json_request_until(server, token, method, route, body, timeout, allowed, None)
    }
    fn json_request_until(
        &self,
        server: &str,
        token: Option<&Credential>,
        method: &str,
        route: &str,
        body: Option<Value>,
        timeout: Duration,
        allowed: &dyn Fn() -> bool,
        queue_deadline: Option<Instant>,
    ) -> Result<Value> {
        let scratch = Scratch::new(&self.state)?;
        let body_path = scratch.0.join("body");
        if let Some(body) = &body {
            atomic_json(&body_path, body)?;
        }
        let response = scratch.0.join("response");
        self.request_with_queue_deadline(
            server,
            token,
            method,
            route,
            body.as_ref().map(|_| body_path.as_path()),
            &response,
            JSON_LIMIT,
            timeout,
            allowed,
            queue_deadline,
        )?;
        serde_json::from_slice(&fs::read(response)?).context("Invalid hosted JSON response")
    }
    pub fn login(&self, server: &str, scope: &str, consent: bool, browser: bool) -> Result<()> {
        self.login_allowed(server, scope, consent, browser, &|| true)
    }
    pub fn login_allowed(
        &self,
        server: &str,
        scope: &str,
        consent: bool,
        browser: bool,
        allowed: &dyn Fn() -> bool,
    ) -> Result<()> {
        self.login_presented(
            server,
            scope,
            consent,
            allowed,
            &|approval| {
                println!(
                    "Open {}\nVerification code: {}\nRequested scope: {scope}",
                    approval.verification_uri, approval.user_code
                );
                if browser {
                    self.provider
                        .open_browser(Path::new(&approval.verification_uri));
                }
            },
            true,
        )
    }
    fn login_presented(
        &self,
        server: &str,
        scope: &str,
        consent: bool,
        allowed: &dyn Fn() -> bool,
        on_approval: &dyn Fn(settings::Approval),
        cli: bool,
    ) -> Result<()> {
        ensure!(allowed(), cancelled());
        let server = server_url(server)?;
        ensure!(matches!(scope, "upload" | "read"), "Invalid scope");
        ensure!(!self.named_reader || scope == "read", "Named readers require --scope read");
        ensure!(
            !self.named_reader || self.provider.experiment(HOSTED_ENCRYPTION),
            "Enable hostedEncryption before approving a named reader"
        );
        ensure!(
            scope != "upload" || consent,
            "Upload shares screen, voice, transcript and all bundle media with the hosted service. Repeat with --consent-upload to explicitly agree"
        );
        private_dir(&self.state)?;
        ensure!(!self.revocation_pending(), hosted_failure(SafeError::Cancelled, "cancelled: revocation pending"));
        let cancellation = self.cancellation()?;
        let login_id = random_id()?;
        let login_path = self.state.join(format!("{scope}.login"));
        {
            let _queue = Lock::acquire_until(
                &self.state.join("queue.lock"),
                false,
                (!cli).then(|| Instant::now() + Duration::from_secs(3)),
            )?;
            ensure!(
                allowed() && !self.revocation_pending() && self.cancellation()? == cancellation,
                cancelled()
            );
            atomic_json(&login_path, &login_id)?;
        }
        let caller_allowed = allowed;
        let still_current = || {
            caller_allowed()
                && !self.revocation_pending()
                && self.cancellation().is_ok_and(|epoch| epoch == cancellation)
                && read_private(&login_path, 128)
                    .ok()
                    .and_then(|b| serde_json::from_slice::<String>(&b).ok())
                    .as_deref()
                    == Some(&login_id)
        };
        let allowed: &dyn Fn() -> bool = &still_current;
        // Public keys are bound to this same approval, never to its server-known
        // user code. Secret material stays in a separate private endpoint artifact.
        let encryption_identity = if self.provider.experiment(HOSTED_ENCRYPTION) {
            let identity_path = self.state.join(format!("{login_id}.identity"));
            let identity = encryption::load_or_create_identity(&identity_path)?;
            Some((login_id.clone(), identity.public_key()))
        } else {
            None
        };
        let mut start_body = json!({"scope":scope});
        if let Some((_, public_key)) = &encryption_identity {
            start_body["encryptionKey"] = public_key.clone();
        }
        let start = self.json_request(
            &server,
            None,
            "POST",
            "/v1/device/start",
            Some(start_body),
            Duration::from_secs(30),
            allowed,
        )?;
        let device_code = start["deviceCode"]
            .as_str()
            .context("Missing device code")?;
        let user_code = start["userCode"].as_str().context("Missing user code")?;
        let uri = start["verificationUri"]
            .as_str()
            .context("Missing verification URI")?;
        ensure!(
            !device_code.is_empty()
                && device_code.len() <= 8192
                && !user_code.is_empty()
                && user_code.len() <= 128
                && !user_code.contains(device_code)
                && user_code
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-')
                && !user_code.chars().any(char::is_control),
            "Invalid device response"
        );
        // The API and device approval site can have distinct origins. Only open a
        // normal HTTPS link (loopback HTTP for a local test server), never a custom scheme.
        let (origin, _) = uri
            .split_once("://")
            .and_then(|(scheme, rest)| {
                rest.split_once('/')
                    .map(|(host, path)| (format!("{scheme}://{host}"), path))
            })
            .context("Invalid verification URI")?;
        server_url(&origin)?;
        ensure!(
            uri.len() <= 4096
                && !uri.contains(device_code)
                && !uri.contains(['#', '%'])
                && uri
                    .split_once('?')
                    .is_none_or(|(_, query)| query == format!("code={user_code}"))
                && !uri.bytes().any(|b| b.is_ascii_control()
                    || b.is_ascii_whitespace()
                    || b"\\\"'".contains(&b)),
            "Invalid verification URI"
        );
        ensure!(allowed(), cancelled());
        on_approval(settings::Approval {
            verification_uri: uri.into(),
            user_code: user_code.into(),
        });
        ensure!(allowed(), cancelled());
        let deadline = Instant::now()
            + Duration::from_secs(start["expiresIn"].as_u64().unwrap_or(300).min(900));
        let interval = Duration::from_secs(start["interval"].as_u64().unwrap_or(5).clamp(1, 30));
        let credential = loop {
            ensure!(allowed(), cancelled());
            ensure!(Instant::now() < deadline, hosted_failure(SafeError::Expired, "Device authorization expired"));
            std::thread::sleep(interval.min(deadline.saturating_duration_since(Instant::now())));
            ensure!(allowed(), cancelled());
            ensure!(Instant::now() < deadline, hosted_failure(SafeError::Expired, "Device authorization expired"));
            let issued = now();
            let reply = self.json_request(
                &server,
                None,
                "POST",
                "/v1/device/poll",
                Some(json!({"deviceCode": device_code})),
                deadline
                    .saturating_duration_since(Instant::now())
                    .min(Duration::from_secs(30)),
                allowed,
            )?;
            match reply["status"].as_str() {
                Some("pending") => continue,
                Some("waitlisted") => bail!(hosted_failure(SafeError::Waitlisted, "Connect account is waitlisted")),
                Some("approved") => {
                    ensure!(
                        reply["scope"].as_str() == Some(scope),
                        "Device authorization returned a different scope"
                    );
                    let token = reply["accessToken"]
                        .as_str()
                        .context("Missing access token")?;
                    ensure!(
                        !token.is_empty()
                            && token.len() <= 8192
                            && token.bytes().all(|b| b.is_ascii_graphic()),
                        "Invalid access token"
                    );
                    let mut credential = Credential {
                        server: server.clone(),
                        site: Some(origin.clone()),
                        scope: scope.into(),
                        token: token.into(),
                        generation: random_id()?,
                        refresh_token: None,
                        expires_at: None,
                        refresh_expires_at: None,
                        grant_id: None,
                        auth_required: false,
                        encryption_identity: encryption_identity.as_ref().map(|(id, _)| id.clone()),
                        account_initial: None,
                    };
                    credential.apply_reply(&reply, issued, false)?;
                    break credential;
                }
                _ => bail!(hosted_failure(SafeError::Rejected, "Device authorization rejected or invalid")),
            }
        };
        private_dir(&self.state)?;
        let _lock = Lock::acquire_until(
            &self.state.join("queue.lock"),
            false,
            (!cli).then(|| Instant::now() + Duration::from_secs(3)),
        )?;
        // Read-only login must not silently enable upload or switch an active uploader's server.
        ensure!(allowed(), cancelled());
        #[cfg(any(test, feature = "test-support"))]
        test_support::run_hook("login_snapshot", &self.config);
        if !self.named_reader {
            let mut settings = self.settings();
            ensure!(
                scope == "upload" || !settings.enabled || settings.server == server,
                "Disable uploads before switching servers"
            );
            if scope == "upload" {
                settings = CloudConfig {
                    enabled: true,
                    upload_consent: true,
                    server: server.clone(),
                };
                self.provider.set_experiment(HOSTED_SYNC, true)?;
            } else {
                settings.server = server;
            }
            self.provider.set_cloud_allowed(&settings, allowed).map_err(|error| {
                if allowed() { error } else { cancelled() }
            })?;
        }
        ensure!(allowed(), cancelled());
        self.clear_renewal(scope)?;
        atomic_json(&self.state.join(format!("{scope}.credential")), &credential)?;
        fs::remove_file(login_path)?;
        if cli {
            println!("Signed in for {scope}; tokens remain private on this machine.");
        }
        Ok(())
    }
    pub fn disable(&self, logout: bool) -> Result<()> {
        self.disable_until(logout, None)
    }
    fn disable_until(&self, logout: bool, deadline: Option<Instant>) -> Result<()> {
        private_dir(&self.state)?;
        // Immutable intents survive queue contention and cannot overwrite one another.
        let intent = self
            .state
            .join(format!("revocation-{}.intent", random_id()?));
        atomic_json(&intent, &logout)?;
        #[cfg(any(test, feature = "test-support"))]
        test_support::run_hook("disable_before_lock", &self.config);
        let _lock = Lock::acquire_until(&self.state.join("queue.lock"), false, deadline)?;
        let intents = self.revocation_intents()?;
        #[cfg(any(test, feature = "test-support"))]
        test_support::run_hook("disable_intents_snapshot", &self.config);
        let logout = logout || intents.iter().any(|(_, logout)| *logout);
        atomic_json(&self.state.join("cancellation"), &random_id()?)?;
        // Serialize the snapshot and gate write with login's settings/credential
        // commit. No network or staging holds this lock, only brief state work.
        if !self.named_reader {
            let mut settings = self.settings();
            settings.enabled = false;
            settings.upload_consent = false;
            self.provider.set_cloud(&settings)?;
        }
        let mut stopped = Vec::new();
        let mut revoke = Vec::new();
        for scope in ["upload", "read"] {
            match fs::remove_file(self.state.join(format!("{scope}.login"))) {
                Ok(()) => (),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
                Err(e) => return Err(e.into()),
            }
        }
        for mut job in self.jobs()? {
            if job.status != "ready" {
                job.status = "cancelled".into();
                self.save_job(&job)?;
                if job.shared {
                    if let Ok(credential) = self.credential("upload", &job.server) {
                        if credential.generation == job.generation {
                            stopped.push((job, credential));
                        }
                    }
                }
            }
        }
        if logout {
            for scope in ["upload", "read"] {
                if let Ok(c) = self.stored_credential(scope) {
                    revoke.push(c);
                }
                self.clear_renewal(scope)?;
                let path = self.state.join(format!("{scope}.credential"));
                match fs::remove_file(path) {
                    Ok(()) => (),
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
                    Err(e) => return Err(e.into()),
                }
            }
        }
        File::open(&self.state)?.sync_all()?;
        // Remove only the intents covered by these committed durable effects.
        for (path, _) in intents {
            fs::remove_file(path)?;
        }
        File::open(&self.state)?.sync_all()?;
        drop(_lock);
        // Only status metadata may be sent after cancellation, never more media.
        // Bound the whole best-effort stop notification and hold neither lock.
        let deadline = Instant::now() + Duration::from_secs(2);
        for (job, credential) in stopped {
            self.notify_progress_with(&job, "paused", &credential, deadline);
        }
        for credential in revoke {
            let _ = self.revoke_credential(&credential, deadline);
        }
        Ok(())
    }
    pub fn retry(&self) -> Result<()> {
        self.retry_selected(None)
    }
    /// Recover one retained capture under its existing identity and consent.
    pub fn retry_capture(&self, id: &str) -> Result<()> {
        ensure!(valid_id(id), "Capture ID must be 32 lowercase hexadecimal characters");
        private_dir(&self.state)?;
        // Serialize reset with worker result publication, before taking queue.lock.
        // A busy worker must leave this request unchanged, not accept a retry
        // which its older snapshot can immediately overwrite.
        let _worker = Lock::acquire_until(
            &self.state.join("worker.lock"), false,
            Some(Instant::now() + Duration::from_secs(3)),
        )?;
        self.retry_selected(Some(id))?;
        self.process_jobs(Some(id))
    }
    fn retry_selected(&self, id: Option<&str>) -> Result<()> {
        ensure!(self.enabled(), "Hosted uploads are disabled");
        private_dir(&self.state)?;
        let _lock = Lock::acquire(&self.state.join("queue.lock"), false)?;
        let mut retried = false;
        for mut job in self.jobs()? {
            if id.is_some_and(|id| job.id != id) {
                continue;
            }
            if self.active_locked(&job)
                && matches!(job.status.as_str(), "pending" | "failed")
                && now().saturating_sub(job.created) <= RETENTION
            {
                job.attempts = 0;
                job.next_attempt = 0;
                job.status = "pending".into();
                job.error = None;
                self.save_job(&job)?;
                retried = true;
            }
        }
        ensure!(id.is_none() || retried, "capture_not_retryable: choose a current pending or failed capture from apparent connect status; cancelled, expired and previous sign-in jobs cannot be revived");
        Ok(())
    }
    pub fn process_once(&self) -> Result<()> {
        private_dir(&self.state)?;
        let _worker = match Lock::acquire(&self.state.join("worker.lock"), true) {
            Ok(lock) => lock,
            Err(_) => return Ok(()),
        };
        self.process_jobs(None)
    }
    fn process_jobs(&self, id: Option<&str>) -> Result<()> {
        for mut job in self.jobs()? {
            if id.is_some_and(|id| job.id != id) {
                continue;
            }
            if job.status != "pending" || job.next_attempt > now() || !self.active(&job) {
                continue;
            }
            if now().saturating_sub(job.created) > RETENTION {
                let _lock = Lock::acquire(&self.state.join("queue.lock"), false)?;
                if !self.active_locked(&job) {
                    continue;
                }
                job.status = "expired".into();
                self.save_job(&job)?;
                continue;
            }
            let result = self.upload(&mut job);

            let _lock = Lock::acquire(&self.state.join("queue.lock"), false)?;
            // Logout/disable wins over a late completion. Never restore a cancelled job.
            if !self.active_locked(&job) {
                continue;
            }
            job.attempts += 1;
            match result {
                Ok(()) => {
                    job.status = "ready".into();
                    job.error = None;
                }
                Err(error) => {
                    // Inspect causes for known codes, but persist only the allowlisted
                    // classification below. Snapshot context is not a key failure.
                    let text = format!("{error:#}");
                    job.error = Some(
                        if text.contains("encryption_pending_recipient") {
                            "encryption_pending_recipient"
                        } else if text.contains("file_too_large") {
                            "file_too_large"
                        } else if text.contains("quota_exceeded") {
                            "quota_exceeded"
                        } else if text.contains("unsupported_asset") {
                            "unsupported_asset"
                        } else if text.contains("auth_required")
                            || text.contains("unauthorized")
                            || text.contains("forbidden")
                        {
                            "auth_required"
                        } else if text.contains("encryption_") || text.contains("encrypted_") {
                            "encryption_action_required"
                        } else {
                            "upload_failed"
                        }
                        .into(),
                    );
                    if job.error.as_deref() == Some("encryption_pending_recipient") {
                        // Offline/unapproved agent is a waiting state, not eight
                        // failed attempts followed by a stranded recording.
                        job.attempts = job.attempts.saturating_sub(1);
                    } else if job.attempts >= MAX_ATTEMPTS
                        || matches!(
                            job.error.as_deref(),
                            Some("auth_required" | "file_too_large" | "encryption_action_required")
                        )
                    {
                        job.status = "failed".into();
                    }
                    job.next_attempt = now() + (5u64 * (1u64 << job.attempts.min(10))).min(3600);
                }
            }
            self.save_job(&job)?;
            drop(_lock);
            if job.error.is_some() {
                self.notify_progress(
                    &job,
                    if job.status == "failed" {
                        "failed"
                    } else {
                        "paused"
                    },
                );
            }
        }
        Ok(())
    }
    fn notify_progress(&self, job: &Job, state: &str) {
        // A sharing admission can race an uploader's older job snapshot.
        if !job.shared
            && !self
                .jobs()
                .unwrap_or_default()
                .iter()
                .any(|current| current.id == job.id && current.shared)
        {
            return;
        }
        if let Ok(credential) = self.credential("upload", &job.server) {
            if credential.generation == job.generation {
                self.notify_progress_with(
                    job,
                    state,
                    &credential,
                    Instant::now() + Duration::from_secs(2),
                );
            }
        }
    }
    fn notify_progress_with(
        &self,
        job: &Job,
        state: &str,
        credential: &Credential,
        deadline: Instant,
    ) {
        let _ = self.json_request(
            &job.server,
            Some(credential),
            "POST",
            &format!("/v1/captures/{}/share/progress", job.id),
            Some(json!({"state":state})),
            deadline.saturating_duration_since(Instant::now()),
            &|| Instant::now() < deadline,
        );
    }
    fn upload(&self, job: &mut Job) -> Result<()> {
        if job.encrypted {
            return self.upload_encrypted(job);
        }
        let credential = self.credential("upload", &job.server)?;
        let scratch = Scratch::new(&self.state)?;
        // Stage a stable snapshot through O_NOFOLLOW handles. Retry the same manifest;
        // changing local media cannot silently mutate an already reserved capture ID.
        let files = snapshot(&job.bundle, &scratch.0)?;
        job.recorded_at_ms = Job::recording_time(&scratch.0);
        ensure!(
            serde_json::to_vec(&json!({"files": files}))?.len() <= 128 * 1024,
            "invalid_manifest: exceeds v1 request limit"
        );
        if job.files.is_empty() {
            job.files = files.clone();
            let _lock = Lock::acquire(&self.state.join("queue.lock"), false)?;
            ensure!(self.active_locked(job), "cancelled");
            self.save_job(job)?;
        }
        ensure!(
            job.files == files,
            "Bundle changed after upload was queued; explicitly upload it under a new ID"
        );
        let allowed = || self.active(job);
        let base = format!("/v1/captures/{}", job.id);
        let reserved = self.json_request(
            &job.server,
            Some(&credential),
            "POST",
            &base,
            Some(job.reservation(json!({"files": files}))),
            Duration::from_secs(30),
            &allowed,
        )?;
        ensure!(
            reserved["id"].as_str() == Some(&job.id),
            "Invalid reservation ID"
        );
        if reserved["status"] != "ready" {
            self.notify_progress(job, "uploading");
            ensure!(
                reserved["status"] == "pending",
                "Invalid reservation status"
            );
            for file in &job.files {
                let response = scratch.0.join(format!("ack-{}", random_id()?));
                self.request(
                    &job.server,
                    Some(&credential),
                    "PUT",
                    &format!("{base}/files/{}", file.path),
                    Some(&scratch.0.join(&file.path)),
                    &response,
                    JSON_LIMIT,
                    Duration::from_secs(60),
                    &allowed,
                )?;
            }
            let completed = self.json_request(
                &job.server,
                Some(&credential),
                "POST",
                &format!("{base}/complete"),
                None,
                Duration::from_secs(30),
                &allowed,
            )?;
            ensure!(
                completed["id"].as_str() == Some(&job.id) && completed["status"] == "ready",
                "Hosted capture did not complete"
            );
        }
        // Read back the exact manifest rather than trusting the completion write.
        let verified = self.json_request(
            &job.server,
            Some(&credential),
            "GET",
            &base,
            None,
            Duration::from_secs(30),
            &allowed,
        )?;
        let verified_files: Vec<Asset> = serde_json::from_value(verified["files"].clone())?;
        ensure!(
            verified["id"].as_str() == Some(&job.id)
                && verified["status"] == "ready"
                && same_manifest(&verified_files, &job.files),
            "Hosted completion verification failed"
        );
        Ok(())
    }
    pub fn status(&self, account: bool) -> Result<Value> {
        let settings = self.settings();
        let jobs = self.jobs()?;
        let mut result = json!({"server": settings.server, "enabled": self.enabled(), "uploadConsent": settings.upload_consent,
            "readSignedIn": self.credential("read", &settings.server).is_ok_and(|c| c.usable()), "uploadSignedIn": self.credential("upload", &settings.server).is_ok_and(|c| c.usable()),
            "encryption": self.provider.experiment(HOSTED_ENCRYPTION),
            "queuePath": self.state, "queue": jobs.iter().map(|j| json!({"id":j.id,"bundle":j.bundle,"status":j.status,"encrypted":j.encrypted,"attempts":j.attempts,"nextAttempt":j.next_attempt,"error":j.error})).collect::<Vec<_>>()});
        if account {
            let credential = self
                .credential("upload", &settings.server)
                .or_else(|_| self.credential("read", &settings.server))?;
            result["account"] = self.json_request(
                &settings.server,
                Some(&credential),
                "GET",
                "/v1/account",
                None,
                Duration::from_secs(30),
                &|| true,
            )?;
        }
        for scope in ["read", "upload"] {
            result[format!("{scope}Auth")] = self.auth_status(scope, &settings.server);
        }
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn hosted_asset_boundary() {
        for path in [
            "../summary.md",
            "/summary.md",
            "frames/../../secret",
            "frames/.credential",
            "frames/a\\b.png",
            "credentials.json",
        ] {
            assert!(!asset_path(path), "accepted {path}");
        }
        for path in [
            "summary.md",
            "apparent.json",
            "contact-sheet.png",
            "frames/frame-01.png",
            "frames-full/frame-01.png",
            "recording.mov",
            "audio.wav",
        ] {
            assert!(asset_path(path), "rejected {path}");
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct AccountView {
    pub server: Option<String>,
    pub connected: bool,
}

impl Client {
    pub fn sharing_connected(&self) -> bool {
        let client = self;
        client.enabled()
            && client
                .credential("upload", &client.settings().server)
                .is_ok_and(|c| c.usable())
    }

    pub fn sharing_server(&self) -> Option<String> {
        server_url(&self.settings().server).ok()
    }

    pub fn shared_links_url(&self) -> Option<String> {
        let client = self;
        let server = self.sharing_server()?;
        let credential = client
            .credential("upload", &server)
            .or_else(|_| client.credential("read", &server))
            .ok()?;
        let site = server_url(credential.site.as_deref()?).ok()?;
        Some(format!("{site}/hosted/shares"))
    }

    /// A bounded, read-only probe. An HTTP rejection still proves server connectivity;
    /// a transport error does not. Never admits an upload or writes a preference.
    pub fn sharing_online(&self) -> bool {
        let client = self;
        let Some(server) = self.sharing_server() else {
            return false;
        };
        match client.json_request(
            &server,
            None,
            "GET",
            "/v1/account",
            None,
            Duration::from_secs(3),
            &|| true,
        ) {
            Ok(_) => true,
            Err(error) => {
                error.to_string().starts_with("Hosted API:")
                    || error.to_string().starts_with("auth_required:")
            }
        }
    }

    pub fn sharing_progress(&self, bundle: &Path) -> String {
        let client = self;
        let canonical = fs::canonicalize(bundle).ok();
        let job = client
            .jobs()
            .unwrap_or_default()
            .into_iter()
            .filter(|job| Some(&job.bundle) == canonical.as_ref() && job.shared)
            .max_by_key(|job| (job.public_copy, job.created));
        match job {
            Some(job) if job.status == "ready" => "Link copied · ready".into(),
            Some(job) if job.status == "failed" => "Link copied · upload failed".into(),
            Some(job) if job.status == "cancelled" || !client.enabled() => {
                "Link copied · upload paused".into()
            }
            Some(job) if job.next_attempt > now() => "Link copied · waiting for connection".into(),
            _ => "Link copied · uploading · Estimating…".into(),
        }
    }
    pub fn account_view(&self) -> AccountView {
        let server = server_url(&self.settings().server).ok();
        let connected = self.enabled()
            && server
                .as_ref()
                .is_some_and(|server| self.credential("upload", server).is_ok_and(|c| c.usable()));
        AccountView { server, connected }
    }
}

#[cfg(any(test, feature = "test-support"))]
pub mod test_support;

#[cfg(test)]
mod shares_pipe_tests {
    use super::*;
    fn probe(code: &str) -> PolicyChild {
        let (runtime, _, electron) = shares_typescript_runtime().unwrap();
        let mut command = Command::new(runtime);
        if electron { command.env("ELECTRON_RUN_AS_NODE", "1"); }
        PolicyChild(command.args(["-e", code]).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().unwrap())
    }
    #[test]
    fn shares_pipe_refuses_unterminated_oversize_and_compound_output() {
        for (code, limit, expected) in [
            ("process.stdout.write('x'.repeat(65536))", 1024, "Oversized"),
            ("process.stdout.write('{}\\n{}\\n')", 1024, "Compound"),
        ] {
            let mut child = probe(code);
            let mut output = child.stdout.take().unwrap();
            let error = policy_frame_bounded(&mut output, Duration::from_secs(5), limit).unwrap_err();
            assert!(error.to_string().contains(expected), "{error}");
        }
    }
    #[test]
    fn shares_pipe_stalled_child_has_an_absolute_read_deadline() {
        let mut child = probe("setInterval(() => {}, 1000)");
        let mut output = child.stdout.take().unwrap();
        let started = Instant::now();
        assert!(policy_frame_bounded(&mut output, Duration::from_millis(30), 1024).unwrap_err().to_string().contains("timed out"));
        assert!(started.elapsed() < Duration::from_secs(2));
    }
}
