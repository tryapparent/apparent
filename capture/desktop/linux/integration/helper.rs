//! The Linux side of `apparent-helper`: the same calls as `src/helper.rs`, answered in process.
//! Movies go through GStreamer (`linux::media`), transcription through `transcribe.cpp` with a
//! Parakeet model (`speech`), and permissions through what the session allows
//! (`linux::privacy`). There is no cabled-iPhone mirror on Linux.

use std::path::{Path, PathBuf};

use anyhow::{Result, bail};
use serde::Deserialize;

use crate::shared::model::TranscriptData;

/// There is no helper executable on Linux; its work happens in process.
pub fn path() -> Result<PathBuf> {
    bail!("apparent-helper is macOS-only")
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct PhoneDevice {
    pub id: String,
    pub name: String,
    pub model: String,
    pub width: u32,
    pub height: u32,
}

/// What the session lets Apparent use: the microphone, the screen and the input devices.
pub fn permissions()
-> Result<std::collections::BTreeMap<crate::permission_facts::Permission, crate::permission_facts::Status>> {
    Ok(crate::capture::desktop::linux::privacy::permissions())
}

/// Cabled iPhones need AVFoundation's screen capture devices, which only macOS has.
pub fn devices() -> Result<Vec<PhoneDevice>> {
    Ok(Vec::new())
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
    stop: &dyn Fn() -> bool,
    line: impl FnMut(SpeechModelLine),
) -> Result<()> {
    crate::capture::engine::runtime::audio::transcription::speech::install(stop, line)
}

/// On-device transcription with measured word timings (Parakeet through `transcribe.cpp`).
pub fn transcribe(audio: &Path) -> Result<TranscriptData> {
    crate::capture::engine::runtime::audio::transcription::speech::transcribe(audio)
}

/// Re-encodes `movie` into `out` as H.264 with its long edge at most `max_edge`.
pub fn shrink(movie: &Path, out: &Path, max_edge: u32) -> Result<crate::capture::engine::bundle::retention::Shrunk> {
    crate::capture::desktop::linux::media::shrink(movie, out, max_edge)
}

/// Mixes a movie's audio to 16 kHz mono WAV, aligned to the movie's start.
pub fn export_audio(movie: &Path, wav: &Path) -> Result<()> {
    crate::capture::desktop::linux::media::export_audio(movie, wav)
}

/// Renders `text` as a compact Unicode half-block QR code for the terminal.
pub fn qr(_text: &str) -> Result<String> {
    bail!("QR codes need CoreImage (macOS)")
}
