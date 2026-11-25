use std::path::Path;

use anyhow::{Context, Result, ensure};
use transcribe_cpp::{DeviceType, Model, RunOptions, Session, SessionOptions, TimestampKind};

use crate::capture::engine::runtime::audio::{audio::decode_wav_16k, persistence::header};
use crate::recording_trace::{self, Operation};
use crate::shared::model::{TranscriptData, TranscriptSegment, WordTiming};

use super::{KHZ, init_backends, installed_models, model_name};

pub(super) fn read_whole_file_audio(audio: &Path) -> Result<(Vec<u8>, Vec<f32>)> {
    let _span = recording_trace::span(Operation::PrepareSpeechAudio);
    let wav =
        std::fs::read(audio).with_context(|| format!("Could not read {}", audio.display()))?;
    let (_, samples) = saved_audio_tail(&wav, 0)?;
    Ok((wav, samples))
}

fn canonical_pcm16(wav: &[u8]) -> Option<&[u8]> {
    let (actual_header, payload) = wav.split_at_checked(44)?;
    let bytes = u32::try_from(payload.len()).ok()?;
    (bytes % 2 == 0 && bytes <= u32::MAX - 36 && actual_header == header(bytes)).then_some(payload)
}

pub(in crate::capture::engine::runtime::audio::transcription) fn saved_audio_tail(
    wav: &[u8],
    consumed: usize,
) -> Result<(usize, Vec<f32>)> {
    if let Some(payload) = canonical_pcm16(wav) {
        let sample_count = payload.len() / 2;
        ensure!(consumed <= sample_count, "Stream exceeds saved audio");
        let tail = payload[consumed * 2..]
            .chunks_exact(2)
            .map(|sample| f32::from(i16::from_le_bytes([sample[0], sample[1]])) / 32_768.0)
            .collect();
        return Ok((sample_count, tail));
    }
    let mut audio = decode_wav_16k(wav)?;
    let sample_count = audio.len();
    ensure!(consumed <= sample_count, "Stream exceeds saved audio");
    audio.drain(..consumed);
    Ok((sample_count, audio))
}

pub(super) fn open_whole_file_session(path: &Path) -> Result<(Model, Session)> {
    let model = {
        let _span = recording_trace::span(Operation::LoadSpeechModel);
        init_backends()?;
        Model::load(path).with_context(|| format!("Could not load {}", path.display()))?
    };
    let _span = recording_trace::span(Operation::OpenSpeechSession);
    let session = model.session()?;
    Ok((model, session))
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(in crate::capture::engine::runtime::audio::transcription) enum RecognitionPhase {
    Recording,
    Finishing,
}

pub struct Incremental {
    session: Option<(i32, Session)>,
    model: Model,
    cpu_backend: bool,
    name: String,
}

impl Incremental {
    pub fn new() -> Result<Self> {
        let path = installed_models()
            .into_iter()
            .next()
            .context("No Parakeet model installed")?;
        Self::load(&path)
    }

    pub fn load(path: &Path) -> Result<Self> {
        init_backends()?;
        let model = Model::load(path)?;
        let cpu_backend = cfg!(target_os = "linux")
            && model
                .device()
                .is_ok_and(|device| device.device_type == DeviceType::Cpu);
        Ok(Self {
            session: None,
            model,
            cpu_backend,
            name: model_name(path),
        })
    }

    pub(in crate::capture::engine::runtime::audio::transcription) fn transcribe(
        &mut self,
        samples: &[f32],
        offset_ms: u64,
        phase: RecognitionPhase,
    ) -> Result<TranscriptData> {
        let threads = i32::from(self.cpu_backend && phase == RecognitionPhase::Recording);
        if self
            .session
            .as_ref()
            .is_none_or(|(current, _)| *current != threads)
        {
            self.session = None;
            let session = self.model.session_with(&SessionOptions {
                n_threads: threads,
                ..Default::default()
            })?;
            self.session = Some((threads, session));
            crate::capture::engine::runtime::apparent_log(format!(
                "Parakeet: opened session with {} CPU thread budget",
                if threads == 0 { "automatic" } else { "one" }
            ));
        }
        let options = RunOptions {
            timestamps: TimestampKind::Word,
            language: Some("en".into()),
            ..Default::default()
        };
        let (_, session) = self.session.as_mut().unwrap();
        let result = session.run(samples, &options)?;
        let text = result.text.split_whitespace().collect::<Vec<_>>().join(" ");
        let at = |ms: i64| offset_ms + ms.max(0) as u64;
        let mut transcript = TranscriptData {
            source: format!("parakeet:{}", self.name),
            model: Some(self.name.clone()),
            text: text.clone(),
            ..Default::default()
        };
        if text.is_empty() {
            return Ok(transcript);
        }
        transcript.words = result
            .words
            .iter()
            .filter(|w| !w.text.trim().is_empty())
            .map(|w| WordTiming {
                t0: at(w.t0_ms),
                t1: at(w.t1_ms.max(w.t0_ms)),
                text: w.text.trim().to_owned(),
            })
            .collect();
        if transcript.words.is_empty() {
            let (segments, words) = crate::shared::hex::spread_words(
                &text,
                offset_ms,
                offset_ms + samples.len() as u64 / KHZ,
            );
            transcript.estimated = true;
            transcript.segments = segments;
            transcript.words = words;
        } else {
            transcript.segments = result
                .segments
                .iter()
                .filter(|s| !s.text.trim().is_empty())
                .map(|s| TranscriptSegment {
                    t0: at(s.t0_ms),
                    t1: at(s.t1_ms.max(s.t0_ms)),
                    text: s.text.trim().to_owned(),
                })
                .collect();
            if transcript.segments.is_empty() {
                transcript.segments.push(TranscriptSegment {
                    t0: transcript.words[0].t0,
                    t1: transcript.words.last().unwrap().t1,
                    text,
                });
            }
        }
        Ok(transcript)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saved_tail_matches_full_decode_at_sample_boundaries() {
        use crate::capture::engine::runtime::audio::audio::encode_wav_16k;

        let wav = encode_wav_16k(&[-1.0, -0.5 / 32_768.0, 0.0, 0.5 / 32_768.0, 1.0]).unwrap();
        assert!(canonical_pcm16(&wav).is_some());
        let mut with_chunk = wav.clone();
        with_chunk.splice(36..36, *b"JUNK\x02\0\0\0\0\0");
        with_chunk[4..8].copy_from_slice(&(wav.len() as u32 + 2).to_le_bytes());
        assert!(canonical_pcm16(&with_chunk).is_none());
        let expected = decode_wav_16k(&wav).unwrap();
        for input in [&wav, &with_chunk] {
            for consumed in 0..=expected.len() {
                assert_eq!(
                    saved_audio_tail(input, consumed).unwrap(),
                    (expected.len(), expected[consumed..].to_vec())
                );
            }
            assert!(saved_audio_tail(input, expected.len() + 1).is_err());
        }
        for truncated in [&wav[..43], &wav[..wav.len() - 1], &wav[..44]] {
            assert!(canonical_pcm16(truncated).is_none());
            assert_eq!(
                saved_audio_tail(truncated, 0).unwrap_err().to_string(),
                decode_wav_16k(truncated).unwrap_err().to_string()
            );
            assert!(saved_audio_tail(truncated, expected.len()).is_err());
        }
        let mut unsupported = wav;
        unsupported[24..28].copy_from_slice(&44_100_u32.to_le_bytes());
        assert_eq!(
            saved_audio_tail(&unsupported, 0).unwrap_err().to_string(),
            decode_wav_16k(&unsupported).unwrap_err().to_string()
        );
    }
}
