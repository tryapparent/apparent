//! Finite private-input adapter for Record's speech-cue policy.
use anyhow::{Context, Result, ensure};
use serde::{Deserialize, Serialize};
use std::{process::Command, time::Duration};
use crate::{capture::engine::keyframes::{SpeechCue, SpeechInput}, shared::model::TranscriptData};

const MAX_BYTES: usize = 16 * 1024 * 1024;

#[derive(Serialize)]
struct Request<'a> { version: u8, estimated: bool, words: Vec<&'a str> }
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Response { version: u8, cues: Vec<SpeechCue> }

fn decode<'a>(bytes: &[u8], transcript: &'a TranscriptData) -> Result<SpeechInput<'a>> {
    let response: Response = serde_json::from_slice(bytes).context("Invalid Record speech cues")?;
    ensure!(response.version == 1, "Invalid Record speech cues");
    SpeechInput::from_plan(transcript, response.cues)
}

pub(crate) fn plan(transcript: &TranscriptData) -> Result<SpeechInput<'_>> {
    if transcript.words.is_empty() { return Ok(SpeechInput::empty(transcript)); }
    let request = Request { version: 1, estimated: transcript.estimated,
        words: transcript.words.iter().map(|word| word.text.as_str()).collect() };
    let bytes = serde_json::to_vec(&request)?;
    ensure!(bytes.len() <= MAX_BYTES, "Record speech input exceeds its resource limit");
    if let Some(Ok(speech)) = crate::composition::record_policy::evaluate("nativeSpeechCues", &bytes, MAX_BYTES)
        .map(|output| decode(output.as_bytes(), transcript))
    {
        return Ok(speech);
    }
    let input = crate::composition::worker::private_input(&bytes)?;
    let (node, worker) = crate::composition::worker::policy_assets("Record speech", "record-media", "selection/worker.js")?;
    let output = crate::composition::worker::run_with_input(Command::new(node)
        .env("ELECTRON_RUN_AS_NODE", "1").arg(worker), input, Duration::from_secs(10), MAX_BYTES)?;
    decode(&output, transcript)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reply_is_versioned_and_bound_to_original_word_indices() {
        let transcript = TranscriptData { words: vec![crate::shared::model::WordTiming {
            t0: 10, t1: 20, text: "Look!".into(),
        }], ..Default::default() };
        let valid = br#"{"version":1,"cues":[{"index":0,"cue":"look","score":58,"strong":true}]}"#;
        assert!(decode(valid, &transcript).is_ok());
        for data in [br#"{"version":2,"cues":[]}"#.as_slice(),
            br#"{"version":1,"cues":[],"extra":true}"#,
            br#"{"version":1,"cues":[{"index":1,"cue":"look","score":58,"strong":true}]}"#,
            br#"{"version":1,"cues":[{"index":0,"cue":"look","score":-1,"strong":true}]}"#,
            br#"{"version":1,"cues":[{"index":0,"cue":"","score":58,"strong":true}]}"#,
            br#"{"version":1,"cues":[{"index":0,"cue":"look","score":58,"strong":true,"extra":1}]}"#,
            br#"{"version":1,"cues":[{"index":0,"cue":"look","score":58,"strong":true},{"index":0,"cue":"look","score":58,"strong":true}]}"#] {
            assert!(decode(data, &transcript).is_err());
        }
    }
}

pub(crate) fn parse_engine(
    name: &str,
) -> Result<crate::capture::engine::runtime::audio::transcription::transcribe::Engine, String> {
    crate::capture::engine::runtime::audio::transcription::transcribe::Engine::parse(name)
        .ok_or_else(|| "expected `apple`, `hex` or `command`".to_owned())
}
