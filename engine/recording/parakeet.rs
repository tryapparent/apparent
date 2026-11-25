use std::path::Path;

use anyhow::{Context, Result};
use transcribe_cpp::{DeviceType, Model, RunOptions, Session, SessionOptions, TimestampKind};

use crate::shared::model::{TranscriptData, TranscriptSegment, WordTiming};

use super::{KHZ, init_backends, installed_models, model_name};

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

pub(super) fn whole_file_session(model: &Model) -> Result<Session> {
    #[cfg(target_os = "linux")]
    if model
        .device()
        .is_ok_and(|device| device.device_type == DeviceType::Cpu)
        && model.arch() == "parakeet"
    {
        let available = std::thread::available_parallelism().map_or(0, |cpus| cpus.get());
        return Ok(model.session_with(&SessionOptions {
            n_threads: super::resident_final::whole_file_cpu_threads(available),
            ..Default::default()
        })?);
    }
    Ok(model.session()?)
}
