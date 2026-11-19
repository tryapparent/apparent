//! Secret-free presentation boundary over the existing device/credential transport.
use super::*;

pub const DEFAULT_SERVER: &str = "https://hosted.tryapparent.com";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Snapshot {
    pub reusable_upload_grant: bool,
    pub encryption: bool,
    pub server: Option<String>,
    pub connected: bool,
    pub uploads_enabled: bool,
    pub reauthorization_required: bool,
    pub account_initial: Option<String>,
}
#[derive(Clone)]
pub struct Approval {
    pub verification_uri: String,
    pub user_code: String,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Health {
    Online,
    Offline,
    AuthRequired,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SafeError {
    Waitlisted,
    Cancelled,
    Offline,
    AuthRequired,
    Rejected,
    Expired,
    LocalState,
    InvalidServer,
    Unavailable,
}

// Inspect only known internal diagnostics, never copy remote text, paths or secrets.
fn safe_error(error: &anyhow::Error, allowed: &dyn Fn() -> bool) -> SafeError {
    if !allowed() {
        return SafeError::Cancelled;
    }
    let message = error.to_string();
    if message == "Connect account is waitlisted" {
        SafeError::Waitlisted
    } else if message == "cancelled" || message.starts_with("cancelled:") {
        SafeError::Cancelled
    } else if message.starts_with("auth_required:") {
        SafeError::AuthRequired
    } else if message == "Device authorization expired" || message == "Hosted API: device_expired" {
        SafeError::Expired
    } else if message == "Device authorization rejected or invalid"
        || message == "Hosted API: device_rejected"
        || message == "Hosted API: rejected"
    {
        SafeError::Rejected
    } else if message.starts_with("Hosted transport")
        || message.starts_with("Hosted request")
        || message == "Hosted API temporarily unavailable; retry later"
    {
        SafeError::Offline
    } else if error.downcast_ref::<std::io::Error>().is_some()
        || error.downcast_ref::<serde_json::Error>().is_some()
    {
        SafeError::LocalState
    } else {
        SafeError::Unavailable
    }
}

impl Client {
    // Persisted authorization survives access-token expiry when it can renew.
    // This is local validity, not proof of server connectivity or upload readiness.
    fn settings_authorized(&self, credential: &Credential) -> bool {
        credential.usable()
            && (!self.provider.experiment(HOSTED_ENCRYPTION)
                || self.endpoint_identity(credential).is_ok())
    }
    // Only completed renewal can make an expired access token upload-ready.
    fn settings_usable(&self, credential: &Credential) -> bool {
        self.settings_authorized(credential) && credential.expires_at.is_none_or(|expiry| expiry > now())
    }
    // Strict read for presentation: unlike the application's tolerant preferences
    // reader, corrupt relevant state must not be displayed as a successful sign-out.
    // This is read-only; the application provider remains the sole config writer.
    fn settings_local_config(&self) -> std::result::Result<CloudConfig, SafeError> {
        let bytes = match OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
            .open(self.provider.config_path())
        {
            Ok(file) => {
                if !file
                    .metadata()
                    .map_err(|_| SafeError::LocalState)?
                    .is_file()
                {
                    return Err(SafeError::LocalState);
                }
                let mut bytes = Vec::new();
                file.take(JSON_LIMIT + 1)
                    .read_to_end(&mut bytes)
                    .map_err(|_| SafeError::LocalState)?;
                if bytes.len() as u64 > JSON_LIMIT {
                    return Err(SafeError::LocalState);
                }
                bytes
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(CloudConfig::default());
            }
            Err(_) => return Err(SafeError::LocalState),
        };
        let value: Value = serde_json::from_slice(&bytes).map_err(|_| SafeError::LocalState)?;
        let object = value.as_object().ok_or(SafeError::LocalState)?;
        if let Some(experiments) = object.get("experiments") {
            let experiments = experiments.as_object().ok_or(SafeError::LocalState)?;
            if [HOSTED_SYNC, HOSTED_ENCRYPTION].iter().any(|key| experiments
                .get(*key)
                .is_some_and(|flag| !flag.is_boolean()))
            {
                return Err(SafeError::LocalState);
            }
        }
        match object.get("cloud") {
            None => Ok(CloudConfig::default()),
            Some(value) => serde_json::from_value(value.clone()).map_err(|_| SafeError::LocalState),
        }
    }
    fn settings_grant(
        &self,
        scope: &str,
        server: &str,
    ) -> std::result::Result<Option<Credential>, SafeError> {
        match fs::symlink_metadata(self.state.join(format!("{scope}.credential"))) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err(SafeError::LocalState),
            Ok(_) => (),
        }
        let credential = self
            .stored_credential(scope)
            .map_err(|_| SafeError::LocalState)?;
        Ok((credential.server == server).then_some(credential))
    }
    /// Fresh disk-only state; never renews credentials or probes the server.
    pub fn settings_snapshot(&self) -> std::result::Result<Snapshot, SafeError> {
        if self.revocation_pending() {
            return Err(SafeError::LocalState);
        }
        let config = self.settings_local_config()?;
        let server = if config.server.is_empty() {
            None
        } else {
            Some(server_url(&config.server).map_err(|_| SafeError::InvalidServer)?)
        };
        let origin = server.as_deref().unwrap_or(DEFAULT_SERVER);
        let upload = self.settings_grant("upload", origin)?;
        let read = self.settings_grant("read", origin)?;
        let connected = upload.as_ref().is_some_and(|grant| self.settings_authorized(grant))
            || read.as_ref().is_some_and(|grant| self.settings_authorized(grant));
        // Prefer the upload grant even when it cannot supply identity: a read
        // grant may belong to a different account. Never substitute its initial.
        let account_initial = upload.as_ref().or(read.as_ref())
            .filter(|grant| grant.usable())
            .and_then(|grant| grant.account_initial.as_deref())
            .filter(|value| renewal::valid_account_initial(value)).map(str::to_owned);
        Ok(Snapshot {
            reusable_upload_grant: upload.as_ref().is_some_and(|g| g.grant_id.is_some() && self.settings_usable(g)),
            encryption: self.provider.experiment(HOSTED_ENCRYPTION),
            account_initial,
            uploads_enabled: server.is_some()
                && !self.revocation_pending()
                && config.enabled
                && config.upload_consent
                && self.provider.experiment(HOSTED_SYNC)
                && upload.as_ref().is_some_and(|grant| self.settings_usable(grant)),
            reauthorization_required: upload
                .as_ref()
                .or(read.as_ref())
                .is_some_and(|grant| !self.settings_authorized(grant)),
            server,
            connected,
        })
    }
    /// The sole device-login protocol, with no stdout or automatic browser opening.
    pub fn login_with_approval(
        &self,
        server: &str,
        scope: &str,
        consent: bool,
        allowed: &dyn Fn() -> bool,
        on_approval: &dyn Fn(Approval),
    ) -> std::result::Result<(), SafeError> {
        if !allowed() {
            return Err(SafeError::Cancelled);
        }
        server_url(server).map_err(|_| SafeError::InvalidServer)?;
        self.settings_local_config()?;
        self.login_presented(server, scope, consent, allowed, on_approval, false)
            .map_err(|error| safe_error(&error, allowed))
    }
    /// Bounded authenticated account probe, sharing renewal and cancellation logic.
    /// No queue/config lock is retained across transport or renewal waits.
    pub fn settings_health(&self, allowed: &dyn Fn() -> bool) -> Health {
        if !allowed() {
            return Health::Offline;
        }
        let snapshot = match self.settings_snapshot() {
            Ok(snapshot) => snapshot,
            Err(SafeError::AuthRequired) => return Health::AuthRequired,
            Err(_) => return Health::Offline,
        };
        let server = snapshot.server.as_deref().unwrap_or(DEFAULT_SERVER);
        let credential = ["upload", "read"].into_iter().find_map(|scope| {
            self.settings_grant(scope, server)
                .ok()
                .flatten()
                .filter(Credential::usable)
        });
        let Some(credential) = credential else {
            return Health::AuthRequired;
        };
        if self.provider.experiment(HOSTED_ENCRYPTION)
            && self.endpoint_identity(&credential).is_err()
        {
            return Health::AuthRequired;
        }
        let epoch = match self.cancellation() {
            Ok(epoch) => epoch,
            Err(_) => return Health::Offline,
        };
        let current = || {
            allowed()
                && !self.revocation_pending()
                && self.cancellation().is_ok_and(|value| value == epoch)
        };
        let deadline = Instant::now() + Duration::from_secs(3);
        match self.json_request_until(
            server,
            Some(&credential),
            "GET",
            "/v1/account",
            None,
            Duration::from_secs(3),
            &current,
            Some(deadline),
        ) {
            Ok(_) if current() => Health::Online,
            Err(error) if current() && safe_error(&error, &current) == SafeError::AuthRequired => {
                Health::AuthRequired
            }
            _ => Health::Offline,
        }
    }
    /// Explicit local consent; live upload-grant check then existing writer.
    pub fn settings_resume(&self, server: &str, allowed: &dyn Fn() -> bool) -> std::result::Result<(), SafeError> {
        let attempt = || -> Result<()> {
            ensure!(allowed() && !self.revocation_pending(), "cancelled");
            let epoch = self.cancellation()?;
            ensure!(self.settings_local_config().map_err(|_| anyhow::anyhow!("Local state unavailable"))?.server == server, "auth_required: server changed");
            let grant = self.credential("upload", server)?;
            ensure!(grant.grant_id.is_some() && self.settings_usable(&grant), "auth_required: approve upload access");
            let encryption = self.provider.experiment(HOSTED_ENCRYPTION);
            let current = || allowed() && !self.revocation_pending() && self.cancellation().is_ok_and(|v| v == epoch);
            let deadline = Instant::now() + Duration::from_secs(3);
            let receipt = self.json_request_until(server, Some(&grant), "GET", "/v1/encryption/peers", None, Duration::from_secs(3), &current, Some(deadline))?;
            ensure!(receipt["scope"] == "upload" && receipt["grantId"].as_str() == grant.grant_id.as_deref(), "auth_required: grant changed");
            #[cfg(any(test, feature = "test-support"))]
            test_support::run_hook("resume_before_commit", &self.config);
            let _lock = Lock::acquire_until(&self.state.join("queue.lock"), false, Some(deadline))?;
            ensure!(current(), "cancelled");
            let latest = self.credential("upload", server)?;
            ensure!(latest.generation == grant.generation && latest.grant_id == grant.grant_id && self.settings_usable(&latest)
                && self.provider.experiment(HOSTED_ENCRYPTION) == encryption && self.settings().server == server,
                "auth_required: grant changed");
            self.provider.set_experiment(HOSTED_SYNC, true)?;
            self.provider.set_cloud_allowed(&CloudConfig { enabled:true, upload_consent:true, server:server.into() }, &current)?;
            ensure!(current(), "cancelled");
            Ok(())
        };
        attempt().map_err(|error| safe_error(&error, allowed))
    }
    pub fn settings_disable(&self, logout: bool) -> std::result::Result<(), SafeError> {
        self.disable_until(logout, Some(Instant::now() + Duration::from_secs(3)))
            .map_err(|_| SafeError::LocalState)
    }
}

impl Client {
    fn readers_directory(&self) -> PathBuf {
        self.state.join("readers")
    }

    pub(super) fn named_reader(&self, name: &str) -> Result<Self> {
        ensure!(
            !self.named_reader
                && name != "default"
                && (1..=64).contains(&name.len())
                && name.as_bytes()[0].is_ascii_alphanumeric()
                && name.bytes().all(|byte| {
                    byte.is_ascii_lowercase()
                        || byte.is_ascii_digit()
                        || matches!(byte, b'-' | b'_')
                }),
            "Invalid reader name; use 1–64 lowercase letters, digits, hyphens or underscores, starting with a letter or digit"
        );
        let mut reader = self.clone();
        reader.state = self.readers_directory().join(name);
        reader.named_reader = true;
        Ok(reader)
    }

    pub fn login_reader(&self, name: &str, server: &str, browser: bool) -> Result<()> {
        self.named_reader(name)?
            .login(server, "read", false, browser)
    }

    pub fn logout_reader(&self, name: &str) -> Result<()> {
        let reader = self.named_reader(name)?;
        fs::symlink_metadata(&reader.state).context("Unknown Connect reader profile")?;
        reader.disable(true)
    }

    pub(super) fn read_credential(&self) -> Result<Credential> {
        if self.named_reader {
            ensure!(!self.revocation_pending(), "cancelled: revocation pending");
            let auth = "auth_required: approve the named reader with apparent connect login --reader <name>";
            fs::symlink_metadata(self.state.join("read.credential")).context(auth)?;
            return self.stored_credential("read").context(auth);
        }
        self.credential("read", &server_url(&self.settings().server)?)
    }

    pub(super) fn reader_profiles(&self) -> Result<Vec<(String, Client)>> {
        let directory = self.readers_directory();
        match fs::symlink_metadata(&directory) {
            Ok(_) => private_dir(&directory)?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(error.into()),
        }
        let mut readers = Vec::new();
        for entry in fs::read_dir(directory)? {
            let entry = entry?;
            if let Some(name) = entry.file_name().to_str()
                && entry.file_type()?.is_dir()
                && let Ok(reader) = self.named_reader(name)
                && private_dir(&reader.state).is_ok()
            {
                readers.push((name.to_owned(), reader));
            }
        }
        readers.sort_by(|left, right| left.0.cmp(&right.0));
        Ok(readers)
    }

    pub fn readers(&self) -> Result<Value> {
        let server = self.settings().server;
        let mut readers = vec![json!({
            "name": "default",
            "server": server,
            "auth": self.auth_status("read", &server)
        })];
        for (name, client) in self.reader_profiles()? {
            let server = client
                .stored_credential("read")
                .ok()
                .map(|credential| credential.server);
            let mut auth = client.auth_status("read", server.as_deref().unwrap_or(""));
            if auth.get("action").is_some_and(Value::is_string) {
                auth["action"] =
                    format!("Run apparent connect login --reader {name} for this server").into();
            }
            readers.push(json!({"name": name, "server": server, "auth": auth}));
        }
        Ok(json!(readers))
    }
}
