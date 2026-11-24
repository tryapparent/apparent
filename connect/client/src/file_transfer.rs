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
                    "Hosted transport failed (network, timeout or response limit)"
                    | "Hosted transport input failed"
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
                "{error}. Retry from a private working directory, or use apparent fetch --out to choose a private destination"
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

impl Client {
    pub fn style_source(&self, bundle: &Path) -> Option<String> {
        if let Ok(bytes) = read_private(&bundle.join(".connect-style.json"), 256) {
            let receipt: Value = serde_json::from_slice(&bytes).ok()?;
            return receipt["captureId"].as_str().filter(|id| valid_id(id)).map(str::to_owned);
        }
        if !self.provider.experiment("speakingStyle") || !self.enabled() {
            return None;
        }
        let path = bundle.canonicalize().ok()?;
        let job = self.jobs().ok()?.into_iter().find(|job| {
            job.bundle == path && job.speaking_style && job.encrypted && self.active(job)
        })?;
        Some(job.id)
    }

    pub fn visit_style_transcripts(&self, id: &str, profile: Option<&str>, local: Option<&Path>, mut visit: impl FnMut(&str, usize) -> Result<bool>) -> Result<()> {
        ensure!(valid_id(id), "Expected a Connect capture ID");
        let base = format!("/v1/captures/{id}");
        let reader = match profile {
            Some("default") => self.clone(),
            Some(name) => self.named_reader(name)?,
            None => self.resolve_reader(&base, 0, Instant::now())?
                .map(|(client, _, _)| client).unwrap_or_else(|| self.clone()),
        };
        let credential = reader.read_credential()?;
        let current = || reader.read_credential().is_ok_and(|c| c.generation == credential.generation && c.server == credential.server);
        let response = reader.json_request(&credential.server, Some(&credential), "GET",
            &format!("{base}/style-history"), None, Duration::from_secs(15), &current)?;
        let budget = response["tokenBudget"].as_u64().filter(|n| (1..=1024).contains(n))
            .context("Invalid Connect transcript budget")? as usize;
        let ids: Vec<String> = serde_json::from_value(response["ids"].clone())?;
        ensure!(ids.len() <= 12 && ids.iter().all(|other| valid_id(other) && other != id), "Invalid Connect history");
        let read = |source: &str| -> Result<Value> {
            ensure!(current(), "Connect reader changed");
            let scratch = Scratch::new(&reader.state)?;
            let out = scratch.0.join("transcript");
            reader.fetch_inner(source, &out, 0, Some(&["apparent.json".into()]), false)?;
            ensure!(current(), "Connect reader changed");
            let metadata = out.join("apparent.json");
            if source == id && let Some(path) = local {
                ensure!(digest_file(&metadata)? == digest_file(&path.join("apparent.json"))?, "Local recording does not match this Connect capture");
            }
            Ok(serde_json::from_reader(File::open(metadata)?)?)
        };
        if ids.is_empty() { return Ok(()); }
        let anchor = read(id)?;
        let current_id = anchor["id"].as_str().context("Missing recording ID")?;
        for candidate in ids {
            let manifest = match read(&candidate) {
                Ok(value) => value,
                Err(error) if matches!(error.to_string().as_str(), "Hosted API: not_found" | "encryption_decrypt_failed" | "encryption_sender_revoked_or_unapproved") => continue,
                Err(error) => return Err(error),
            };
            let recording = manifest["id"].as_str().context("Missing recording ID")?;
            if recording != current_id && let Some(text) = manifest["transcript"]["text"].as_str() && visit(text, budget)? {
                break;
            }
        }
        Ok(())
    }
}
