use super::publication;
use anyhow::Result;
use std::path::Path;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct FinishTrace {
    pub(super) version: u32,
    pub(super) stop_ms: Option<u64>,
    pub(super) audio_ms: Option<u64>,
    pub(super) candidates_ms: Option<u64>,
    pub(super) transcribe_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) hosted_transcription: Option<super::openrouter::Trace>,
    pub(super) select_ms: u64,
    pub(super) decode_ms: u64,
    pub(super) autocrop_ms: u64,
    pub(super) sheet_ms: u64,
    pub(super) write_ms: u64,
    pub(super) total_ms: u64,
    pub(super) prepared_visuals: bool,
}

pub(super) fn save_finish_trace(bundle_dir: &Path, trace: &FinishTrace) -> Result<()> {
    publication::write(
        bundle_dir,
        "finish-trace.json",
        &serde_json::to_vec_pretty(trace)?,
    )?;
    Ok(())
}

#[derive(Clone, Copy, Debug, Default)]
pub struct StageTimings {
    pub started_at: Option<std::time::Instant>,
    pub stop_ms: Option<u64>,
    pub audio_ms: Option<u64>,
    pub candidates_ms: Option<u64>,
    pub transcribe_ms: Option<u64>,
    pub(crate) hosted_transcription: Option<super::openrouter::Trace>,
}
