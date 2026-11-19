//! Native provider for Connect's TypeScript-selected v2 transfers.
use super::encryption::{Context as CryptoContext, v2};
use super::*;
impl Client {
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
    pub(super) fn fetch_files_v2(
        &self,
        id: &str,
        server: &str,
        credential: &Credential,
        manifest: &Value,
        spool: &Path,
        out: &Path,
        parent: &Path,
        selection: Option<&[String]>,
    ) -> Result<PathBuf> {
        let files: Vec<Asset> = serde_json::from_value(manifest["files"].clone())?;
        v2::validate_transport(&files)?;
        let identity = self.endpoint_identity(credential)?;
        let peers = self.encryption_peers(credential, &|| true)?;
        let download = |name: &str| -> Result<()> {
            let file = files
                .iter()
                .find(|f| f.path == name)
                .context("invalid_encryption_manifest")?;
            let destination = spool.join(name);
            private_dir(destination.parent().context("invalid_path")?)?;
            self.request(
                server,
                Some(credential),
                "GET",
                &format!("/v1/captures/{id}/files/{name}"),
                None,
                &destination,
                file.size.max(1),
                Duration::from_secs(60),
                &|| true,
            )?;
            ensure!(
                fs::metadata(&destination)?.len() == file.size
                    && digest_file(&destination)? == file.sha256,
                "encrypted_transport_integrity_mismatch"
            );
            Ok(())
        };
        download("envelope.json")?;
        download("sealed/index.age")?;
        let context = v2::context(spool)?;
        ensure!(
            context.origin == server
                && context.account_id == peers.account_id
                && context.capture_id == id,
            "encryption_context_mismatch"
        );
        let sender = peers
            .devices
            .iter()
            .find(|p| p.scope == "upload" && p.grant_id == context.sender_grant_id)
            .context("encryption_sender_revoked_or_unapproved")?;
        let index = v2::open_index(spool, &files, &context, &identity, sender)?;
        let listing = selection.is_some_and(|s| s.is_empty());
        let entries = Self::file_transfer_plan(
            &index,
            &context,
            &files,
            if listing { None } else { selection },
        )?;
        let plain = Scratch::new_output(parent)?;
        if !listing {
            for entry in &entries {
                download(&entry.object)?;
                v2::unpack_file(spool, &plain.0, entry, &files, &identity)?;
            }
        }
        if selection.is_none() {
            let ordinary: Vec<Asset> = entries
                .iter()
                .map(|e| Asset {
                    path: e.path.clone(),
                    size: e.size,
                    sha256: e.sha256.clone(),
                })
                .collect();
            validate_assets(&ordinary)?;
            validate_bundle_references(&plain.0, &ordinary)?;
        } else {
            ensure!(
                out.extension().is_none_or(|s| s != "apparent"),
                "selected_evidence_requires_extraction_directory"
            );
            atomic_json(
                &plain.0.join(".connect-extraction.json"),
                &json!({"format":"apparent-extraction-v1","captureId":id,"completeBundle":false,"files":entries}),
            )?;
        }
        let latest = self.encryption_peers(credential, &|| true)?;
        ensure!(
            latest.account_id == peers.account_id
                && latest.devices.iter().any(|p| p.scope == "upload"
                    && p.grant_id == sender.grant_id
                    && p.key == sender.key),
            "encryption_sender_revoked_or_unapproved"
        );
        publish_noreplace(&plain.0, out)?;
        File::open(parent)?.sync_all()?;
        Ok(out.to_path_buf())
    }
    fn file_transfer_plan(
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
    fn fetch_inner(
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
        trusted_directory_tree(parent, true)?;
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
