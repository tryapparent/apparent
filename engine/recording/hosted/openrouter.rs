use crate::capture::engine::runtime::audio::audio::RecordedAudio;
use crate::composition::worker;
use crate::recording_trace::{Operation, span};
use crate::shared::model::TranscriptData;
use serde::{Deserialize, Serialize};
use std::{
    process::Command,
    time::{Duration, Instant},
};

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum Outcome {
    Success,
    CredentialUnavailable,
    AudioUnavailable,
    AudioLimit,
    HttpError,
    Timeout,
    InvalidResponse,
    NetworkError,
    WorkerUnavailable,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Trace {
    outcome: Outcome,
    request_ms: Option<u64>,
    http_status: Option<u16>,
    audio_bytes: Option<u64>,
    audio_ms: Option<u64>,
    words: Option<u64>,
    provider_audio_seconds: Option<f64>,
    cost_usd: Option<f64>,
    #[serde(default)]
    worker_ms: u64,
    #[serde(default)]
    fallback_ms: Option<u64>,
}

impl Trace {
    fn failure(outcome: Outcome, started: Instant, bytes: usize, duration_ms: u64) -> Self {
        Self {
            outcome,
            request_ms: None,
            http_status: None,
            audio_bytes: Some(bytes as u64),
            audio_ms: Some(duration_ms),
            words: None,
            provider_audio_seconds: None,
            cost_usd: None,
            worker_ms: started.elapsed().as_millis() as u64,
            fallback_ms: None,
        }
    }

    fn fallback(&mut self, started: Instant) {
        self.fallback_ms = Some(started.elapsed().as_millis() as u64);
    }
}

fn attempt(bytes: &[u8], duration_ms: u64) -> (Option<TranscriptData>, Option<Trace>) {
    let started = Instant::now();
    let config = crate::shared::handoff::default_config_path();
    if !config
        .with_file_name("openrouter-transcription.json")
        .exists()
    {
        return (None, None);
    }
    let _span = span(Operation::HostedTranscribe);
    let failed = |outcome| {
        (
            None,
            Some(Trace::failure(outcome, started, bytes.len(), duration_ms)),
        )
    };
    if bytes.len() > 16 * 1024 * 1024 {
        return failed(Outcome::AudioLimit);
    }
    #[derive(Deserialize)]
    struct Reply {
        transcript: Option<TranscriptData>,
        trace: Option<Trace>,
    }
    let result = (|| -> anyhow::Result<Reply> {
        let (node, script) =
            worker::policy_assets("OpenRouter transcription", "settings", "openrouter.cjs")?;
        let input = worker::private_input(bytes)?;
        let output = worker::run_with_input(
            Command::new(node)
                .env("ELECTRON_RUN_AS_NODE", "1")
                .arg(script)
                .arg(config)
                .arg(duration_ms.to_string()),
            input,
            Duration::from_secs(18),
            8 * 1024 * 1024,
        )?;
        Ok(serde_json::from_slice(&output)?)
    })();
    match result {
        Ok(Reply { transcript, trace }) => (
            transcript,
            trace.map(|mut trace| {
                trace.worker_ms = started.elapsed().as_millis() as u64;
                trace
            }),
        ),
        Err(_) => failed(Outcome::WorkerUnavailable),
    }
}

pub(super) fn finish(
    trial: bool,
    audio: Option<&RecordedAudio>,
    local: impl FnOnce() -> TranscriptData,
) -> (TranscriptData, Option<Trace>) {
    if trial && let Some(audio) = audio.filter(|audio| audio.sample_count > 0) {
        let (hosted, trace) = attempt(&audio.wav_bytes, audio.duration_ms);
        if let Some(data) = hosted {
            return (data, trace);
        }
        if let Some(mut trace) = trace {
            let _span = span(Operation::TranscriptionFallback);
            let start = Instant::now();
            let data = local();
            trace.fallback(start);
            return (data, Some(trace));
        }
    }
    (local(), None)
}
