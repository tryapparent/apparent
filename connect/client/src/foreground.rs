//! Private capability adapter for the TypeScript foreground uploader.
//! No queue/job/spool publication, retry loop, credentials in argv, or fallback.
use super::*;
use std::sync::atomic::{AtomicU64, Ordering};

// One foreground operation per process and worker.lock across processes. Only
// public progress crosses into the pill; captures and secrets stay in this owner.
static PROGRESS: AtomicU64 = AtomicU64::new(0);
static COPIED_LINK: std::sync::Mutex<Option<PreparedLink>> = std::sync::Mutex::new(None);
pub fn foreground_progress() -> Option<u64> {
    PROGRESS.load(Ordering::Relaxed).checked_sub(1)
}
struct ProgressGuard;
impl Drop for ProgressGuard {
    fn drop(&mut self) {
        PROGRESS.store(0, Ordering::Relaxed);
    }
}

impl Client {
    pub fn foreground_enabled(&self) -> bool {
        self.provider.experiment(FOREGROUND_UPLOAD)
    }

    pub(super) fn foreground_authorized(&self, job: &Job) -> bool {
        self.enabled()
            && now().saturating_sub(job.created) <= RETENTION
            && self.settings().server == job.server
            && self
                .credential("upload", &job.server)
                .is_ok_and(|c| c.generation == job.generation)
            && (job.public_copy && self.provider.experiment(HOSTED_SHARING)
                || !job.public_copy && job.encrypted == self.provider.experiment(HOSTED_ENCRYPTION))
    }

    pub fn upload_foreground(&self, bundle: &Path, allowed: &dyn Fn() -> bool) -> Result<String> {
        self.foreground_transfer(bundle, false, false, allowed)
            .map(|(job, _)| job.id)
    }

    pub fn prepare_foreground_link(
        &self,
        bundle: &Path,
        public_copy: bool,
        allowed: &dyn Fn() -> bool,
    ) -> Result<PreparedLink> {
        ensure!(allowed(), "cancelled");
        let canonical = bundle.canonicalize()?;
        if let Some(link) = COPIED_LINK
            .lock()
            .map_err(|_| anyhow::anyhow!("Foreground link unavailable"))?
            .as_ref()
            .filter(|link| {
                link.client.state == self.state
                    && link.job.bundle == canonical
                    && link.job.public_copy == public_copy
                    && link.authorized()
            })
        {
            return Ok(link.clone());
        }
        ensure!(
            public_copy || !self.provider.experiment(HOSTED_ENCRYPTION),
            "encrypted_sharing_unsupported: encrypted captures require an approved agent client"
        );
        let cancellation = self.cancellation()?;
        let (job, url) = self.foreground_transfer(bundle, true, public_copy, allowed)?;
        let link = PreparedLink {
            client: self.clone(),
            job,
            foreground: true,
            foreground_epoch: cancellation,
            text: format!(
                "I recorded some feedback in Apparent. Open this link for the recording, transcript and original image evidence: {}. Anyone with this link can view this capture; shared captures are not end-to-end encrypted.",
                url.context("Missing foreground link")?
            ),
        };
        // Volatile recopy receipt: clipboard failure retries copying this exact
        // authorized link, never another upload. Restart deliberately forgets it.
        *COPIED_LINK
            .lock()
            .map_err(|_| anyhow::anyhow!("Foreground link unavailable"))? = Some(link.clone());
        Ok(link)
    }

    fn foreground_transfer(
        &self,
        bundle: &Path,
        share: bool,
        public_copy: bool,
        caller: &dyn Fn() -> bool,
    ) -> Result<(Job, Option<String>)> {
        ensure!(caller() && self.enabled(), "Upload consent required");
        ensure!(
            !share || self.provider.experiment(HOSTED_SHARING),
            "Sharing disabled"
        );
        private_dir(&self.state)?;
        // Refuse switching while legacy work remains. Never cancel, migrate or
        // silently take over an existing job, including a retained failed job.
        let _worker = Lock::acquire(&self.state.join("worker.lock"), true)?;
        {
            let _queue = Lock::acquire(&self.state.join("queue.lock"), false)?;
            ensure!(
                !self
                    .jobs()?
                    .iter()
                    .any(|j| matches!(j.status.as_str(), "pending" | "failed" | "awaiting_share")),
                "legacy_uploads_pending: finish or explicitly cancel existing uploads before switching"
            );
        }
        ensure!(
            PROGRESS
                .compare_exchange(0, 1, Ordering::SeqCst, Ordering::SeqCst)
                .is_ok(),
            "Foreground upload already active"
        );
        let _progress = ProgressGuard;
        let settings = self.settings();
        let credential = self.credential("upload", &settings.server)?;
        let cancellation = self.cancellation()?;
        let mut job = Job {
            id: random_id()?,
            bundle: bundle.canonicalize()?,
            server: server_url(&settings.server)?,
            generation: credential.generation.clone(),
            created: now(),
            attempts: 0,
            next_attempt: 0,
            status: "pending".into(),
            error: None,
            files: Vec::new(),
            shared: share,
            public_copy,
            encrypted: !public_copy && self.provider.experiment(HOSTED_ENCRYPTION),
            encryption: None,
        };
        ensure!(
            job.bundle.extension().is_some_and(|s| s == "apparent"),
            "Expected completed .apparent bundle"
        );
        let stage = Scratch::new(&self.state)?;
        if job.encrypted {
            // Borrow only the immutable fields, not job, while building its manifest.
            let encrypted = job.encrypted;
            let preparing = || {
                caller()
                    && self.enabled()
                    && self.settings().server == settings.server
                    && self.cancellation().is_ok_and(|epoch| epoch == cancellation)
                    && self
                        .credential("upload", &settings.server)
                        .is_ok_and(|c| c.generation == credential.generation)
                    && self.provider.experiment(HOSTED_ENCRYPTION) == encrypted
            };
            self.foreground_encrypted_snapshot(&mut job, &stage.0, &preparing)?;
        } else {
            job.files = snapshot(&job.bundle, &stage.0)?;
        }
        // Recreate after manifest preparation so the closure borrows the finished job.
        let allowed = || {
            caller()
                && self.enabled()
                && self.settings().server == settings.server
                && self.cancellation().is_ok_and(|epoch| epoch == cancellation)
                && self
                    .credential("upload", &settings.server)
                    .is_ok_and(|c| c.generation == credential.generation)
                && (!share || self.provider.experiment(HOSTED_SHARING))
                && (public_copy || self.provider.experiment(HOSTED_ENCRYPTION) == job.encrypted)
        };
        ensure!(allowed(), "cancelled");
        let (runtime, module, electron) = connect_typescript_runtime("foreground")?;
        let mut command = Command::new(runtime);
        if electron {
            command.env("ELECTRON_RUN_AS_NODE", "1");
        } else if module.extension().is_some_and(|s| s == "ts") {
            command.arg("--experimental-strip-types");
        }
        let mut child = SharesPolicyChild(
            command
                .arg(module)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .spawn()?,
        );
        let mut input = child.stdin.take().context("Missing upload input")?;
        let mut output = child.stdout.take().context("Missing upload output")?;
        let format = if job.encrypted {
            "apparent-encrypted-v1"
        } else {
            "plaintext-v1"
        };
        shares_policy_write(
            &mut input,
            &json!({"id":job.id,"server":job.server,"format":format,"files":job.files,"share":share}),
        )?;
        let base = format!("/v1/captures/{}", job.id);
        for _ in 0..1600 {
            ensure!(allowed(), "cancelled");
            let line = shares_policy_frame_bounded(&mut output, Duration::from_secs(5), 4096)?;
            let request: Value = serde_json::from_str(&line)?;
            let operation = request["operation"]
                .as_str()
                .context("Invalid upload operation")?;
            if operation == "done" {
                ensure!(request["id"] == job.id && allowed(), "cancelled");
                let url = if share {
                    let url = request["url"].as_str().context("Missing share URL")?;
                    validate_share_url(&job.server, url)?;
                    Some(url.to_owned())
                } else {
                    ensure!(request["url"].is_null(), "Unexpected link");
                    None
                };
                drop(input);
                ensure!(
                    shares_policy_exit(&mut child)?.success(),
                    "Foreground upload failed"
                );
                return Ok((job, url));
            }
            ensure!(
                operation != "error",
                "Foreground upload failed; local recording is unchanged"
            );
            if operation == "progress" {
                let total: u64 = job.files.iter().map(|f| f.size).sum();
                let uploaded = request["uploadedBytes"]
                    .as_u64()
                    .context("Invalid progress")?;
                ensure!(
                    request["totalBytes"].as_u64() == Some(total) && uploaded <= total,
                    "Invalid progress"
                );
                PROGRESS.store(
                    if total == 0 {
                        1
                    } else {
                        1 + uploaded * 100 / total
                    },
                    Ordering::Relaxed,
                );
                shares_policy_write(&mut input, &json!({"ok":true,"body":null}))?;
                continue;
            }
            if job.encrypted {
                self.foreground_recipients_current(&job, &allowed)?;
            }
            let result = match operation {
                "reserve" => self.json_request(
                    &job.server,
                    Some(&credential),
                    "POST",
                    &base,
                    Some(if job.encrypted {
                        json!({"format":format,"files":job.files})
                    } else {
                        json!({"files":job.files})
                    }),
                    Duration::from_secs(30),
                    &allowed,
                ),
                "put" => {
                    let index = request["index"].as_u64().context("Invalid file index")?;
                    let file = job
                        .files
                        .get(usize::try_from(index)?)
                        .context("Invalid file index")?;
                    let ack = stage.0.join(format!("ack-{}", random_id()?));
                    self.request(
                        &job.server,
                        Some(&credential),
                        "PUT",
                        &format!("{base}/files/{}", file.path),
                        Some(&stage.0.join(&file.path)),
                        &ack,
                        JSON_LIMIT,
                        Duration::from_secs(60),
                        &allowed,
                    )
                    .map(|_| Value::Null)
                }
                "complete" => self.json_request(
                    &job.server,
                    Some(&credential),
                    "POST",
                    &format!("{base}/complete"),
                    None,
                    Duration::from_secs(30),
                    &allowed,
                ),
                "verify" => self.json_request(
                    &job.server,
                    Some(&credential),
                    "GET",
                    &base,
                    None,
                    Duration::from_secs(30),
                    &allowed,
                ),
                "share" if share && !job.encrypted => self.json_request(
                    &job.server,
                    Some(&credential),
                    "POST",
                    &format!("{base}/share"),
                    None,
                    Duration::from_secs(30),
                    &allowed,
                ),
                _ => bail!("Invalid upload capability"),
            };
            // Do not copy native diagnostic text, file paths or remote strings to
            // the policy's public error channel. Native errors retain their source.
            let body = result?;
            ensure!(allowed(), "cancelled");
            shares_policy_write(&mut input, &json!({"ok":true,"body":body}))?;
        }
        bail!("Too many upload operations")
    }
}
