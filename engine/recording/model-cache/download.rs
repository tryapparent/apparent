use std::path::{Path, PathBuf};
use anyhow::{Context, Result, bail};
use super::{Artifact, fetch, receipt_path};

pub fn download(artifact: &Artifact, dir: &Path, progress: &mut dyn FnMut(f64)) -> Result<PathBuf> {
    static DOWNLOAD: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _download = DOWNLOAD.lock().map_err(|_| anyhow::anyhow!("Model preparation unavailable"))?;
    std::fs::create_dir_all(dir).with_context(|| format!("Could not create {}", dir.display()))?;
    let model = dir.join(artifact.filename);
    if !model.is_file() || verify(&model, artifact).is_err() {
        let _ = std::fs::remove_file(receipt_path(&model));
        let suffix = if crate::shared::handoff::is_nightly() { "nightly.partial" } else { "partial" };
        let partial = dir.join(format!("{}.{suffix}", artifact.filename));
        if std::fs::metadata(&partial).map_or(0, |m| m.len()) < artifact.bytes {
            fetch(artifact.url, &partial, artifact.bytes, progress)?;
        }
        if let Err(error) = verify(&partial, artifact) {
            let _ = std::fs::remove_file(&partial);
            return Err(error);
        }
        std::fs::rename(&partial, &model)?;
    }
    let receipt = serde_json::json!({
        "sha256": artifact.sha256,
        "bytes": artifact.bytes,
        "url": artifact.url,
    });
    let path = receipt_path(&model);
    let staged = path.with_extension(format!("{}.tmp", std::process::id()));
    std::fs::write(&staged, receipt.to_string())?;
    std::fs::rename(staged, path)?;
    Ok(model)
}

fn verify(path: &Path, artifact: &Artifact) -> Result<()> {
    use sha2::{Digest, Sha256};
    let len = std::fs::metadata(path)?.len();
    if len != artifact.bytes {
        bail!(
            "{} is {len} bytes, expected {}",
            artifact.filename,
            artifact.bytes
        );
    }
    let mut hasher = Sha256::new();
    std::io::copy(&mut std::fs::File::open(path)?, &mut hasher)?;
    let sha256 = format!("{:x}", hasher.finalize());
    if sha256 != artifact.sha256 {
        bail!("{} failed its checksum ({sha256})", artifact.filename);
    }
    Ok(())
}
