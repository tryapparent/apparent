//! Native provider for Connect's TypeScript-selected v2 transfers.
use super::encryption::{Context as CryptoContext, v2};
use super::*;
impl Client {
    pub fn files(&self, id: &str) -> Result<Value> {
        private_dir(&self.state)?;
        let scratch = Scratch::new(&self.state)?;
        let out = scratch.0.join("listing");
        self.fetch_selected(id, &out, 0, Some(&[]))?;
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
