#[derive(Clone, Copy, Debug, Default)]
pub struct StageTimings {
    pub started_at: Option<std::time::Instant>,
    pub stop_ms: Option<u64>,
    pub audio_ms: Option<u64>,
    pub candidates_ms: Option<u64>,
    pub transcribe_ms: Option<u64>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct FinishTrace {
    pub(super) version: u32,
    pub(super) stop_ms: Option<u64>,
    pub(super) audio_ms: Option<u64>,
    pub(super) candidates_ms: Option<u64>,
    pub(super) transcribe_ms: Option<u64>,
    pub(super) select_ms: u64,
    pub(super) decode_ms: u64,
    pub(super) autocrop_ms: u64,
    pub(super) sheet_ms: u64,
    pub(super) write_ms: u64,
    pub(super) total_ms: u64,
    pub(super) prepared_visuals: bool,
}
