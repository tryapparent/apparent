//! The Linux side of `apparent-helper`: the same calls as `src/helper.rs`, answered in process.
//! Movies go through GStreamer (`linux::media`), transcription through `transcribe.cpp` with a
//! Parakeet model (`speech`), and permissions through what the session allows
//! (`linux::privacy`). Live device acquisition is retired.

use std::path::{Path, PathBuf};

use anyhow::{Result, bail};
use serde::Deserialize;

use crate::model::{RgbaFrame, TranscriptData};

/// There is no helper executable on Linux; its work happens in process.
pub fn path() -> Result<PathBuf> {
    bail!("apparent-helper is macOS-only")
}


/// What the session lets Apparent use: the microphone, the screen and the input devices.
pub fn permissions()
-> Result<std::collections::BTreeMap<crate::onboarding::Permission, crate::onboarding::Status>> {
    Ok(crate::linux::privacy::permissions())
}

/// One line of macOS's `apparent-helper speech-model [--install]`.
#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
pub struct SpeechModelLine {
    pub status: String,
    #[serde(default)]
    pub engine: Option<String>,
    #[serde(default)]
    pub locale: Option<String>,
    #[serde(default)]
    pub locales: Option<Vec<String>>,
    #[serde(default)]
    pub progress: Option<f64>,
    #[serde(default)]
    pub error: Option<String>,
}

/// Linux transcribes with Parakeet (`speech`): Hex's installed model, else Apparent's own copy,
/// downloaded and checked here.
pub fn install_speech_model(
    _stop: &dyn Fn() -> bool,
    line: impl FnMut(SpeechModelLine),
) -> Result<()> {
    crate::speech::install(line)
}

/// On-device transcription with measured word timings (Parakeet through `transcribe.cpp`).
pub fn transcribe(audio: &Path) -> Result<TranscriptData> {
    crate::speech::transcribe(audio)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Probe {
    pub duration_ms: u64,
    #[serde(default)]
    pub width: u32,
    #[serde(default)]
    pub height: u32,
    #[serde(default)]
    pub audio_tracks: u32,
    /// The video track's nominal frame rate (0 when unknown).
    #[serde(default)]
    pub fps: f64,
}

pub fn probe(movie: &Path) -> Result<Probe> {
    crate::linux::media::probe(movie)
}

/// Re-encodes `movie` into `out` as H.264 with its long edge at most `max_edge`.

/// Mixes a movie's audio to 16 kHz mono WAV, aligned to the movie's start.
pub fn export_audio(movie: &Path, wav: &Path) -> Result<()> {
    crate::linux::media::export_audio(movie, wav)
}

pub enum FrameTimes<'a> {
    /// Nearest decodable frame every N ms, stamped with its actual time.
    Every(u64),
    /// Exactly these times.
    At(&'a [u64]),
}

/// Decodes movie frames into memory; `max_edge` 0 keeps native size.
pub fn frames(movie: &Path, times: FrameTimes, max_edge: u32) -> Result<Vec<RgbaFrame>> {
    crate::linux::media::frames(movie, times, max_edge)
}

/// Renders `text` as a compact Unicode half-block QR code for the terminal.
pub fn qr(_text: &str) -> Result<String> {
    bail!("QR codes need CoreImage (macOS)")
}
