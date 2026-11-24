use std::{
    fs,
    os::unix::fs::MetadataExt,
    path::{Path, PathBuf},
};

use super::{Artifact, receipt_path};
use anyhow::{Context, Result, bail, ensure};
use std::time::Duration;

#[derive(PartialEq, Eq)]
pub(super) struct FileIdentity {
    device: u64,
    inode: u64,
    pub(super) bytes: u64,
    modified: (i64, i64),
    changed: (i64, i64),
}

impl FileIdentity {
    pub(super) fn read(path: &Path) -> Option<Self> {
        let metadata = fs::symlink_metadata(path).ok()?;
        Self::from_metadata(&metadata)
    }

    fn from_metadata(metadata: &fs::Metadata) -> Option<Self> {
        metadata.is_file().then(|| Self {
            device: metadata.dev(),
            inode: metadata.ino(),
            bytes: metadata.len(),
            modified: (metadata.mtime(), metadata.mtime_nsec()),
            changed: (metadata.ctime(), metadata.ctime_nsec()),
        })
    }

    fn after_rename(&self, path: &Path) -> Result<Self> {
        let current = Self::read(path).context("Verified model disappeared during installation")?;
        ensure!(
            current.device == self.device
                && current.inode == self.inode
                && current.bytes == self.bytes
                && current.modified == self.modified,
            "Verified model changed during installation"
        );
        Ok(current)
    }
}

pub fn download(artifact: &Artifact, dir: &Path, progress: &mut dyn FnMut(f64)) -> Result<PathBuf> {
    prepare(artifact, dir, progress, None).map(|(model, _)| model)
}

fn check_stop(stop: Option<&dyn Fn() -> bool>) -> Result<()> {
    ensure!(
        !stop.is_some_and(|stop| stop()),
        "Model preparation cancelled"
    );
    Ok(())
}

pub(super) fn prepare(
    artifact: &Artifact,
    dir: &Path,
    progress: &mut dyn FnMut(f64),
    stop: Option<&dyn Fn() -> bool>,
) -> Result<(PathBuf, Option<FileIdentity>)> {
    static DOWNLOAD: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _download = DOWNLOAD
        .lock()
        .map_err(|_| anyhow::anyhow!("Model preparation unavailable"))?;
    check_stop(stop)?;
    fs::create_dir_all(dir).with_context(|| format!("Could not create {}", dir.display()))?;
    let model = dir.join(artifact.filename);
    let identity = match checked_file(&model, artifact, stop) {
        Ok(identity) => identity,
        Err(_) => {
            check_stop(stop)?;
            let _ = fs::remove_file(receipt_path(&model));
            let suffix = if crate::shared::handoff::is_nightly() {
                "nightly.partial"
            } else {
                "partial"
            };
            let partial = dir.join(format!("{}.{suffix}", artifact.filename));
            if stop.is_some() && fs::symlink_metadata(&partial).is_ok() {
                ensure!(
                    FileIdentity::read(&partial).is_some(),
                    "Model partial is not a regular file"
                );
            }
            if fs::metadata(&partial).map_or(0, |m| m.len()) < artifact.bytes {
                fetch(artifact.url, &partial, artifact.bytes, progress, stop)?;
            }
            check_stop(stop)?;
            let identity = match checked_file(&partial, artifact, stop) {
                Ok(identity) => identity,
                Err(error) => {
                    let _ = fs::remove_file(&partial);
                    return Err(error);
                }
            };
            check_stop(stop)?;
            fs::rename(&partial, &model)?;
            identity
                .map(|identity| identity.after_rename(&model))
                .transpose()?
        }
    };
    check_stop(stop)?;
    let receipt = serde_json::json!({
        "sha256": artifact.sha256,
        "bytes": artifact.bytes,
        "url": artifact.url,
    });
    let path = receipt_path(&model);
    let staged = path.with_extension(format!("{}.tmp", std::process::id()));
    fs::write(&staged, receipt.to_string())?;
    fs::rename(staged, path)?;
    Ok((model, identity))
}

fn checked_file(
    path: &Path,
    artifact: &Artifact,
    stop: Option<&dyn Fn() -> bool>,
) -> Result<Option<FileIdentity>> {
    let identity = if stop.is_some() {
        Some(FileIdentity::read(path).context("Model is not a regular file")?)
    } else {
        ensure!(path.is_file(), "Model is not a regular file");
        None
    };
    let mut file = fs::File::open(path)?;
    if let Some(identity) = &identity {
        ensure!(
            FileIdentity::from_metadata(&file.metadata()?).as_ref() == Some(identity),
            "Model changed before verification"
        );
    }
    verify(&mut file, artifact)?;
    if let Some(identity) = &identity {
        ensure!(
            FileIdentity::read(path).as_ref() == Some(identity),
            "Model changed during verification"
        );
    }
    Ok(identity)
}

fn verify(file: &mut fs::File, artifact: &Artifact) -> Result<()> {
    use sha2::{Digest, Sha256};
    let len = file.metadata()?.len();
    if len != artifact.bytes {
        bail!(
            "{} is {len} bytes, expected {}",
            artifact.filename,
            artifact.bytes
        );
    }
    let mut hasher = Sha256::new();
    std::io::copy(file, &mut hasher)?;
    let sha256 = format!("{:x}", hasher.finalize());
    if sha256 != artifact.sha256 {
        bail!("{} failed its checksum ({sha256})", artifact.filename);
    }
    Ok(())
}

fn fetch(
    url: &str,
    partial: &Path,
    total: u64,
    progress: &mut dyn FnMut(f64),
    stop: Option<&dyn Fn() -> bool>,
) -> Result<()> {
    use std::io::Read;
    let (program, mut child) = spawn_fetch(url, partial)?;
    loop {
        if stop.is_some_and(|stop| stop()) {
            let _ = child.kill();
            child.wait()?;
            bail!("Model preparation cancelled");
        }
        if let Some(status) = child.try_wait()? {
            if status.success() {
                progress(1.0);
                return Ok(());
            }
            let mut error = String::new();
            if let Some(mut stderr) = child.stderr.take() {
                let _ = stderr.read_to_string(&mut error);
            }
            bail!(
                "the download failed ({program}, {status}): {}",
                error.trim()
            );
        }
        let have = std::fs::metadata(partial).map_or(0, |m| m.len());
        progress((have as f64 / total as f64).min(0.99));
        std::thread::sleep(Duration::from_millis(500));
    }
}

const CURL_ARGS: [&str; 9] = [
    "--fail",
    "--location",
    "--silent",
    "--show-error",
    "--retry",
    "3",
    "--continue-at",
    "-",
    "--output",
];

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn spawn_fetch(url: &str, partial: &Path) -> Result<(String, std::process::Child)> {
    let mut command = if crate::shared::handoff::on_path("curl").is_some() {
        let mut command = std::process::Command::new("curl");
        command.args(CURL_ARGS).arg(partial).arg(url);
        command
    } else if crate::shared::handoff::on_path("wget").is_some() {
        let mut command = std::process::Command::new("wget");
        command
            .args(["--quiet", "--continue", "--tries=3", "--output-document"])
            .arg(partial)
            .arg(url);
        command
    } else {
        bail!("downloading the speech model needs curl or wget");
    };
    let program = command.get_program().to_string_lossy().into_owned();
    let child = command
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .with_context(|| format!("Could not run {program}"))?;
    Ok((program, child))
}
