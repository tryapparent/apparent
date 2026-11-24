use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};

use super::{
    Artifact,
    model_cache::{self, FileIdentity},
    own_models_dir, receipt_path,
};
use crate::capture::engine::runtime::audio::transcription::transcribe::Engine;
use anyhow::{Context, Result, ensure};

include!(concat!(env!("OUT_DIR"), "/final-stream.rs"));

pub(super) const NEMOTRON: Artifact = Artifact {
    filename: "nemotron-speech-streaming-en-0.6b-Q4_K_M.gguf",
    url: "https://huggingface.co/handy-computer/nemotron-speech-streaming-en-0.6b-gguf/resolve/7d9b719206789e4068d87c6398262ab4dfd4e45d/nemotron-speech-streaming-en-0.6b-Q4_K_M.gguf",
    bytes: 475_436_032,
    sha256: "dc959ca31499b114e395c44eb4f0778968f20e5cfb03305a08a39925b2da8e1e",
};

#[derive(PartialEq, Eq)]
struct VerifiedModel {
    path: PathBuf,
    model: FileIdentity,
    receipt: FileIdentity,
}

impl VerifiedModel {
    fn read(directory: &Path) -> Option<Self> {
        let path = directory.join("preview").join(NEMOTRON.filename);
        let model = FileIdentity::read(&path)?;
        let receipt = FileIdentity::read(&receipt_path(&path))?;
        Some(Self {
            path,
            model,
            receipt,
        })
    }
}

static VERIFIED: Mutex<Option<VerifiedModel>> = Mutex::new(None);

fn eligible(installed: bool) -> bool {
    allows_resident_final(
        Engine::preferred() == Engine::Apple,
        installed,
        crate::shared::handoff::experiment("localStreamingTranscription"),
    )
}

pub(super) fn wants_install(installed: bool, preparing_parakeet: bool) -> bool {
    allows_resident_install(
        eligible(installed),
        Engine::configured() == Engine::Apple,
        preparing_parakeet,
    )
}

pub(super) fn install(
    directory: &Path,
    stop: &dyn Fn() -> bool,
    progress: &mut dyn FnMut(f64),
) -> Result<()> {
    ensure!(!stop(), "Model preparation cancelled");
    if VerifiedModel::read(directory)
        .as_ref()
        .is_some_and(is_verified)
    {
        return Ok(());
    }
    let (path, model) =
        model_cache::prepare(&NEMOTRON, &directory.join("preview"), progress, Some(stop))?;
    let candidate = VerifiedModel::read(directory).context("Verified model or receipt missing")?;
    let receipt = fs::File::open(receipt_path(&path))?;
    ensure!(
        candidate.path == path
            && Some(&candidate.model) == model.as_ref()
            && candidate.receipt.bytes <= 4096,
        "Verified model or receipt changed during installation"
    );
    let receipt: serde_json::Value = serde_json::from_reader(std::io::Read::take(receipt, 4096))?;
    ensure!(
        receipt["sha256"].as_str() == Some(NEMOTRON.sha256)
            && receipt["bytes"].as_u64() == Some(NEMOTRON.bytes)
            && receipt["url"].as_str() == Some(NEMOTRON.url)
            && VerifiedModel::read(directory).as_ref() == Some(&candidate),
        "Verified model or receipt changed during installation"
    );
    ensure!(!stop(), "Model preparation cancelled");
    let mut verified = VERIFIED
        .lock()
        .map_err(|_| anyhow::anyhow!("Model readiness unavailable"))?;
    *verified = Some(candidate);
    Ok(())
}

pub(crate) fn selected(installed: bool) -> Option<PathBuf> {
    if !eligible(installed) {
        return None;
    }
    let candidate = VerifiedModel::read(&own_models_dir())?;
    is_verified(&candidate).then_some(candidate.path)
}

fn is_verified(candidate: &VerifiedModel) -> bool {
    VERIFIED
        .try_lock()
        .is_ok_and(|verified| verified.as_ref() == Some(candidate))
}
