//! Native provider for Connect's TypeScript-selected v2 transfers.
use super::encryption::{Context as CryptoContext, v2};
use super::*;
impl Client {
    pub fn list_recordings(&self, reader: Option<&str>, limit: u8) -> Result<Value> {
        let (name, client, credential) = match reader {
            Some("default") => ("default".to_owned(), self.clone(), self.read_credential()?),
            Some(name) => {
                let client = self.named_reader(name)?;
                let credential = client.read_credential()?;
                (name.to_owned(), client, credential)
            }
            None => match self.read_credential() {
                Ok(credential) => ("default".to_owned(), self.clone(), credential),
                Err(default_error) => {
                    let mut approved = self.reader_profiles()?.into_iter().filter_map(|(name, client)| {
                        let credential = client.read_credential().ok()?;
                        Some((name, client, credential))
                    });
                    let reader = approved.next().ok_or_else(|| default_error.context(
                        "Connect read approval required; run apparent connect readers to check profiles"
                    ))?;
                    ensure!(approved.next().is_none(),
                        "Multiple Connect readers available; run apparent connect readers and choose --reader <name>");
                    reader
                }
            },
        };
        let response = client.json_request(
            &credential.server,
            Some(&credential),
            "GET",
            &format!("/v1/captures?limit={limit}"),
            None,
            Duration::from_secs(30),
            &|| !client.revocation_pending(),
        )?;
        let captures = response["captures"].as_array().context("Invalid Connect recording list")?;
        ensure!(captures.len() <= usize::from(limit) && captures.iter().all(|capture| {
            capture["id"].as_str().is_some_and(valid_id)
                && matches!(capture["status"].as_str(), Some("pending" | "ready"))
                && match (capture["recordedAt"].as_str(), capture["ageSeconds"].as_u64()) {
                    (Some(time), Some(_)) => time.len() == 24 && time.bytes().all(|byte|
                        byte.is_ascii_digit() || b"-T:.Z".contains(&byte)),
                    (None, None) => capture["recordedAt"].is_null() && capture["ageSeconds"].is_null(),
                    _ => false,
                }
        }), "Invalid Connect recording list");
        Ok(json!({"reader": name, "captures": captures}))
    }
    pub fn files(&self, id: &str) -> Result<Value> {
        self.list_files(id, Some("default"))
    }
    pub fn list_files(&self, id: &str, reader: Option<&str>) -> Result<Value> {
        private_dir(&self.state)?;
        let scratch = Scratch::new(&self.state)?;
        let out = scratch.0.join("listing");
        self.fetch_with_reader(id, &out, 0, Some(&[]), reader)?;
        Ok(serde_json::from_slice(&read_private(
            &out.join(".connect-extraction.json"),
            262144,
        )?)?)
    }
    pub(crate) fn file_transfer_plan(
        index: &v2::Index,
        context: &CryptoContext,
        files: &[Asset],
        selection: Option<&[String]>,
    ) -> Result<Vec<v2::IndexedAsset>> {
        let (runtime, module, electron) = connect_typescript_runtime("transfer")?;
        let mut command = Command::new(runtime);
        if electron {
            command.env("ELECTRON_RUN_AS_NODE", "1");
        } else if module.extension().is_some_and(|s| s == "ts") {
            command.arg("--experimental-strip-types");
        }
        let mut child = PolicyChild(
            command
                .arg(module)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .spawn()?,
        );
        let mut input = child.stdin.take().context("Missing policy input")?;
        let mut output = child.stdout.take().context("Missing policy output")?;
        let mut request = json!({"index":index,"context":context,"transport":files});
        if let Some(selection) = selection {
            request["selection"] = json!(selection);
        }
        policy_write(&mut input, &request)?;
        drop(input);
        let reply: Value = serde_json::from_str(&policy_frame_bounded(
            &mut output,
            Duration::from_secs(10),
            262144,
        )?)?;
        ensure!(
            policy_exit(&mut child)?.success() && reply.get("error").is_none(),
            "invalid_file_selection"
        );
        Ok(serde_json::from_value(reply["files"].clone())?)
    }
}

impl Client {
    pub fn fetch_with_reader(
        &self,
        id: &str,
        out: &Path,
        wait: u64,
        selection: Option<&[String]>,
        reader: Option<&str>,
    ) -> Result<PathBuf> {
        match reader {
            Some("default") => self.fetch_selected(id, out, wait, selection),
            Some(name) => self
                .named_reader(name)?
                .fetch_selected(id, out, wait, selection),
            None => self.fetch_presented(id, out, wait, selection, true),
        }
    }

    pub fn fetch(&self, id: &str, out: &Path, wait: u64) -> Result<PathBuf> {
        self.fetch_selected(id, out, wait, None)
    }
    pub fn fetch_selected(
        &self,
        id: &str,
        out: &Path,
        wait: u64,
        selection: Option<&[String]>,
    ) -> Result<PathBuf> {
        self.fetch_presented(id, out, wait, selection, false)
    }
    fn fetch_presented(
        &self,
        id: &str,
        out: &Path,
        wait: u64,
        selection: Option<&[String]>,
        discover: bool,
    ) -> Result<PathBuf> {
        self.fetch_inner(id, out, wait, selection, discover)
            .map_err(|error| {
                let kind = match error.to_string().as_str() {
                    "Hosted API: not_found" => "unavailable",
                    message
                        if message.starts_with("auth_required:")
                            || matches!(
                                message,
                                "Hosted API: unauthorized"
                                    | "Hosted API: forbidden"
                                    | "Hosted API: reauthorization_required"
                            ) =>
                    {
                        "authorization"
                    }
                    "Server must use HTTPS"
                    | "Invalid server URL"
                    | "Invalid server host"
                    | "Invalid server port"
                    | "Server must be an origin without a path"
                    | "Plain HTTP is allowed only on loopback" => "server_configuration",
                    message if message.starts_with("Hosted transport failed")
                        || message.starts_with("Hosted request timed out") => "transport",
                    "Hosted transport input failed"
                    | "curl is required for hosted transport"
                    | "Hosted API: http_error" => "transport",
                    _ => return error,
                };
                Self::handoff_policy(json!({"operation":"fetchFailure","kind":kind}))
                    .ok()
                    .and_then(|value| value.as_str().map(str::to_owned))
                    .map(|hint| {
                        anyhow::Error::msg(
                            if matches!(kind, "server_configuration" | "transport") {
                                format!("{error}. {hint}")
                            } else {
                                hint
                            },
                        )
                    })
                    .unwrap_or(error)
            })
    }
    pub(super) fn fetch_inner(
        &self,
        id: &str,
        out: &Path,
        wait: u64,
        selection: Option<&[String]>,
        discover: bool,
    ) -> Result<PathBuf> {
        ensure!(
            valid_id(id),
            "Capture ID must be 32 lowercase hexadecimal characters"
        );
        ensure!(wait <= 900, "--wait must be between 0 and 900 seconds");
        let out = std::path::absolute(out)?;
        no_symlinks(&out)?;
        ensure!(
            fs::symlink_metadata(&out).is_err_and(|e| e.kind() == std::io::ErrorKind::NotFound),
            "Output already exists; choose a new directory (nothing is overwritten)"
        );
        let parent = out.parent().context("Missing output parent")?;
        ensure!(parent.is_dir(), "Output parent must already exist");
        trusted_directory_tree(parent, true).map_err(|error| {
            let message = format!(
                "Connect download destination directory: {error}. Retry from a private working directory, or use apparent inspect --out or apparent fetch --out to choose a private destination"
            );
            error.context(message)
        })?;
        let parent = parent.canonicalize()?;
        let out = parent.join(out.file_name().context("Invalid output name")?);
        let stage = Scratch::new_output(&parent)?;
        #[cfg(any(test, feature = "test-support"))]
        test_support::run_hook("fetch_stage", &stage.0);
        let deadline = Instant::now() + Duration::from_secs(wait);
        let base = format!("/v1/captures/{id}");
        let resolved = if discover {
            self.resolve_reader(&base, wait, deadline)?
        } else {
            None
        };
        let (reader, credential, mut first_manifest) = match resolved {
            Some((reader, credential, manifest)) => (reader, credential, Some(manifest)),
            None => (self.clone(), self.read_credential()?, None),
        };
        let server = &credential.server;
        let manifest = loop {
            let reply = if let Some(manifest) = first_manifest.take() {
                Ok(manifest)
            } else {
                let timeout = if wait == 0 {
                    Duration::from_secs(30)
                } else {
                    deadline
                        .saturating_duration_since(Instant::now())
                        .min(Duration::from_secs(30))
                };
                ensure!(
                    !timeout.is_zero(),
                    "Capture is still pending; retry fetch later"
                );
                reader.json_request(
                    server,
                    Some(&credential),
                    "GET",
                    &base,
                    None,
                    timeout,
                    &|| true,
                )
            };
            let reply = match reply {
                Ok(reply) => reply,
                Err(error)
                    if error.to_string() == "Hosted API: not_found"
                        && wait > 0
                        && Instant::now() < deadline =>
                {
                    std::thread::sleep(
                        Duration::from_millis(500)
                            .min(deadline.saturating_duration_since(Instant::now())),
                    );
                    if Instant::now() >= deadline {
                        return Err(error);
                    }
                    continue;
                }
                Err(error) => return Err(error),
            };
            ensure!(
                reply["id"].as_str() == Some(id),
                "Wrong capture ID in manifest"
            );
            match reply["status"].as_str() {
                Some("ready") => break reply,
                Some("pending") => {
                    ensure!(
                        wait > 0 && Instant::now() < deadline,
                        "Capture is still pending; retry fetch later"
                    );
                    std::thread::sleep(
                        Duration::from_millis(500)
                            .min(deadline.saturating_duration_since(Instant::now())),
                    );
                }
                _ => bail!("Invalid capture status"),
            }
        };
        let files: Vec<Asset> =
            serde_json::from_value(manifest["files"].clone()).context("Invalid hosted manifest")?;
        match manifest
            .get("format")
            .and_then(Value::as_str)
            .unwrap_or("plaintext-v1")
        {
            "apparent-encrypted-v2" => {
                ensure!(
                    reader.provider.experiment(HOSTED_ENCRYPTION),
                    "encryption_required"
                );
                return reader.fetch_files_v2(
                    id,
                    server,
                    &credential,
                    &manifest,
                    &stage.0,
                    &out,
                    &parent,
                    selection,
                );
            }
            "apparent-encrypted-v1" => {
                ensure!(
                    selection.is_none(),
                    "selective_fetch_requires_v2: request a fresh upload or fetch the full legacy bundle"
                );
                ensure!(
                    reader.provider.experiment(HOSTED_ENCRYPTION),
                    "encryption_required: enable hostedEncryption to fetch this capture"
                );
                return reader.fetch_encrypted(
                    id,
                    server,
                    &credential,
                    &manifest,
                    &stage.0,
                    &out,
                    &parent,
                );
            }
            "plaintext-v1" => ensure!(
                !reader.named_reader && !reader.provider.experiment(HOSTED_ENCRYPTION),
                "encryption_downgrade_refused: use the default reader with encryption deliberately disabled to fetch legacy plaintext"
            ),
            _ => bail!("unsupported_encryption_format"),
        }
        ensure!(selection.is_none(), "selective_fetch_requires_v2");
        validate_assets(&files)?;
        for file in &files {
            let destination = stage.0.join(&file.path);
            if let Some(parent) = destination.parent() {
                fs::create_dir_all(parent)?;
            }
            reader.request(
                server,
                Some(&credential),
                "GET",
                &format!("{base}/files/{}", file.path),
                None,
                &destination,
                file.size.max(1),
                Duration::from_secs(60),
                &|| true,
            )?;
            ensure!(
                fs::metadata(&destination)?.len() == file.size
                    && digest_file(&destination)? == file.sha256,
                "Hosted file integrity mismatch"
            );
        }
        validate_bundle_references(&stage.0, &files)?;
        publish_noreplace(&stage.0, &out)?;
        File::open(&parent)?.sync_all()?;
        Ok(out)
    }
}

pub(super) fn publish_noreplace(from: &Path, to: &Path) -> Result<()> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    let from = CString::new(from.as_os_str().as_bytes())?;
    let to = CString::new(to.as_os_str().as_bytes())?;
    #[cfg(target_os = "linux")]
    let result = unsafe {
        libc::renameat2(
            libc::AT_FDCWD,
            from.as_ptr(),
            libc::AT_FDCWD,
            to.as_ptr(),
            libc::RENAME_NOREPLACE,
        )
    };
    #[cfg(target_os = "macos")]
    let result = unsafe { libc::renamex_np(from.as_ptr(), to.as_ptr(), libc::RENAME_EXCL) };
    ensure!(
        result == 0,
        "Could not publish capture without replacing existing output: {}",
        std::io::Error::last_os_error()
    );
    Ok(())
}

#[cfg(test)]
pub(super) fn test_stalled_transport(client: &Client, id: &str, out: &Path, authorize: impl Fn(&str)) {
    use std::net::TcpListener;

    let stalled = TcpListener::bind("127.0.0.1:0").unwrap();
    let origin = format!("http://{}", stalled.local_addr().unwrap());
    authorize(&origin);
    let error = client.fetch(id, out, 1).unwrap_err().to_string();
    assert!(error.contains("stage=manifest, "), "{error}");
    assert!(error.contains("curl_exit=28") || error.contains("client_deadline"), "{error}");
    assert!(error.contains("https://app.tryapparent.com/connect/mcp"), "{error}");
    for private in [origin.as_str(), id, &out.display().to_string()] {
        assert!(!error.contains(private), "{error}");
    }
    assert!(!out.exists());
    let asset_route = format!("/v1/captures/{id}/files/apparent.json");
    for (method, route, stage) in [
        ("GET", asset_route.as_str(), "file"),
        ("GET", "/v1/encryption/peers", "peer_authorization"),
        ("POST", "/v1/token/refresh", "credential_renewal"),
    ] {
        let scratch = Scratch::new(&client.state).unwrap();
        let error = client.raw_request(
            &origin, Some("synthetic-read-secret"), method, route, None,
            &scratch.0.join("response"), 1024, Duration::from_millis(150), &|| true,
        ).unwrap_err().to_string();
        assert!(error.contains(&format!("stage={stage}, ")), "{error}");
        assert!(error.contains("curl_exit=28") || error.contains("client_deadline"), "{error}");
        for private in [route, origin.as_str(), "synthetic-read-secret"] {
            assert!(!error.contains(private), "{error}");
        }
    }
}

#[cfg(any(test, feature = "test-support"))]
#[cfg_attr(test, test)]
pub fn hosted_transport_network_timeout_and_cancellation() {
    use crate::test_support::{Fixture, Server};

    let f = Fixture::new();
    let server = Server::new("slow");
    let stage = Scratch::new(&f.client.state).unwrap();
    let start = Instant::now();
    let capture = "a".repeat(32);
    let secret = "synthetic-secret";
    let error = f.client.raw_request(
        &server.url, Some(secret), "GET", &format!("/v1/captures/{capture}/files/{secret}"),
        None, &stage.0.join("timeout"), 100, Duration::from_millis(100), &|| true,
    ).unwrap_err().to_string();
    assert!(start.elapsed() < Duration::from_secs(1));
    assert!(error.contains("[stage=file, "), "{error}");
    assert!(error.contains("curl_exit=28, http_status=0") || error.contains("client_deadline"), "{error}");
    assert!(error.contains("request_timeout_ms=100]"), "{error}");
    for private in [server.url.as_str(), &capture, secret] {
        assert!(!error.contains(private), "{error}");
    }
    let cancelled = stage.0.join("cancelled");
    assert!(f.client.request(
        &server.url, None, "GET", "/v1/account", None, &cancelled, 100,
        Duration::from_secs(1), &|| false,
    ).is_err());
    assert!(!cancelled.exists());
}

pub(super) fn config_escape(value: &str) -> Result<String> {
    ensure!(
        !value.bytes().any(|b| b.is_ascii_control()),
        "Invalid transport value"
    );
    Ok(value.replace('\\', "\\\\").replace('"', "\\\""))
}
