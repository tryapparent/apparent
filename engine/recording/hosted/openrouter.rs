use crate::capture::engine::runtime::audio::audio::RecordedAudio;
use crate::composition::worker;
use crate::recording_trace::{Operation, span};
use crate::shared::model::TranscriptData;
use anyhow::{Context, Result, ensure};
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
    UnsupportedModel,
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

fn run(mode: &str, args: &[&str], bytes: &[u8], output_limit: usize) -> Result<Vec<u8>> {
    let (node, script) = worker::policy_assets("OpenRouter speech", "settings", "openrouter.cjs")?;
    worker::run_with_input(
        Command::new(node)
            .env("ELECTRON_RUN_AS_NODE", "1")
            .arg(script)
            .arg(crate::shared::handoff::default_config_path())
            .arg(mode)
            .args(args),
        worker::private_input(bytes)?,
        Duration::from_secs(18),
        output_limit,
    )
}

pub(crate) fn key(stdin: bool, remove: bool) -> Result<()> {
    use std::io::{IsTerminal, Read};
    let request = if stdin {
        ensure!(
            !std::io::stdin().is_terminal(),
            "Pipe an OpenRouter key to stdin"
        );
        let mut key = String::new();
        std::io::stdin().take(258).read_to_string(&mut key)?;
        ensure!(key.len() < 258, "OpenRouter key exceeds input limit");
        serde_json::json!({"action": "save", "key": key.trim()})
    } else {
        serde_json::json!({"action": if remove { "remove" } else { "read" }})
    };
    let output = run("settings", &[], &serde_json::to_vec(&request)?, 1024)?;
    let status: serde_json::Value = serde_json::from_slice(&output)?;
    println!(
        "OpenRouter key {}",
        if status["saved"] == true {
            "saved for this profile"
        } else {
            "absent"
        }
    );
    Ok(())
}

pub(crate) fn speech(model: &str, voice: &str, input: &str) -> Result<Vec<i16>> {
    let audio = run("speech", &[model, voice], input.as_bytes(), 6 * 1024 * 1024)
        .context("OpenRouter narration failed. Check the profile key, model, and voice")?;
    let pcm = worker::run_with_input(
        Command::new("ffmpeg").args([
            "-v",
            "error",
            "-nostdin",
            "-protocol_whitelist",
            "pipe",
            "-format_whitelist",
            "mp3,wav",
            "-i",
            "pipe:0",
            "-t",
            "121",
            "-ac",
            "1",
            "-ar",
            "24000",
            "-f",
            "s16le",
            "pipe:1",
        ]),
        worker::private_input(&audio)?,
        Duration::from_secs(18),
        24_000 * 2 * 120,
    )
    .context("Could not decode OpenRouter narration. This export requires ffmpeg")?;
    ensure!(pcm.len().is_multiple_of(2), "Invalid narration PCM");
    Ok(pcm
        .chunks_exact(2)
        .map(|sample| i16::from_le_bytes([sample[0], sample[1]]))
        .collect())
}

pub(crate) fn transcribe_file(
    bundle: &std::path::Path,
    audio: &str,
    model: &str,
) -> Result<TranscriptData> {
    use std::io::Read;
    let mut file = super::publication::Directory::open(bundle, false)?
        .file(audio)
        .context("A private bundle WAV is required for OpenRouter transcription")?;
    const LIMIT: usize = 16 * 1024 * 1024;
    let mut bytes = Vec::new();
    (&mut file)
        .take((LIMIT + 1) as u64)
        .read_to_end(&mut bytes)?;
    ensure!(
        bytes.len() <= LIMIT,
        "Bundle WAV exceeds the 16 MiB OpenRouter limit"
    );
    let reader = hound::WavReader::new(std::io::Cursor::new(&bytes))?;
    ensure!(
        reader.duration() > 0 && reader.spec().sample_rate > 0,
        "Bundle WAV contains no usable audio"
    );
    let duration = u64::from(reader.duration()) * 1000 / u64::from(reader.spec().sample_rate);
    let (transcript, trace) = attempt(&bytes, duration, Some(model));
    transcript.with_context(|| {
        format!(
            "OpenRouter transcription failed: {:?}",
            trace.map(|t| t.outcome)
        )
    })
}

fn attempt(
    bytes: &[u8],
    duration_ms: u64,
    model: Option<&str>,
) -> (Option<TranscriptData>, Option<Trace>) {
    let started = Instant::now();
    let config = crate::shared::handoff::default_config_path();
    if !config
        .with_file_name("openrouter-transcription.json")
        .exists()
    {
        return (
            None,
            model.map(|_| {
                Trace::failure(
                    Outcome::CredentialUnavailable,
                    started,
                    bytes.len(),
                    duration_ms,
                )
            }),
        );
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
        let args: Vec<_> = model.into_iter().collect();
        let output = run(&duration_ms.to_string(), &args, bytes, 8 * 1024 * 1024)?;
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
        let (hosted, trace) = attempt(&audio.wav_bytes, audio.duration_ms, None);
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
