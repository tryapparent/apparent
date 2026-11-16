//! Resource adapter for Record's read-only transcript allocation contract.
use anyhow::{Context, Result, ensure};
use serde::{Deserialize, Serialize};
use std::{process::Command, time::Duration};
use crate::{capture::engine::keyframes::SelectedFrames, shared::model::*};

const MAX_BYTES: usize = 16 * 1024 * 1024;

#[derive(Serialize)]
struct Unit<'a> { t0: String, t1: String, text: &'a str }
#[derive(Serialize)]
struct Text<'a> { text: &'a str, words: Vec<Unit<'a>>, segments: Vec<Unit<'a>> }
#[derive(Serialize)]
struct Request<'a> { version: u8, times: Vec<String>, anchors: Vec<String>, transcript: Text<'a> }
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Response { version: u8, said: Vec<Option<String>> }

fn decode(bytes: &[u8], count: usize) -> Result<Vec<Option<String>>> {
    let response: Response = serde_json::from_slice(bytes).context("Invalid Record transcript allocation")?;
    ensure!(response.version == 1 && response.said.len() == count, "Invalid Record transcript allocation");
    Ok(response.said)
}

pub(crate) fn assign(times: &[u64], anchors: &[u64], transcript: &TranscriptData) -> Result<Vec<Option<String>>> {
    if times.is_empty() { return Ok(Vec::new()); }
    let request = Request {
        version: 1,
        times: times.iter().map(u64::to_string).collect(),
        anchors: anchors.iter().map(u64::to_string).collect(),
        transcript: Text {
            text: &transcript.text,
            words: transcript.words.iter().map(|w| Unit {t0:w.t0.to_string(),t1:w.t1.to_string(),text:&w.text}).collect(),
            segments: transcript.segments.iter().map(|s| Unit {t0:s.t0.to_string(),t1:s.t1.to_string(),text:&s.text}).collect(),
        },
    };
    let bytes = serde_json::to_vec(&request)?;
    ensure!(bytes.len() <= MAX_BYTES, "Record transcript request exceeds its resource limit");
    let input = super::worker::private_input(&bytes)?;
    let (node, worker) = super::worker::policy_assets("Record transcript", "record-media", "transcript/worker.js")?;
    let output = super::worker::run_with_input(Command::new(node)
        .env("ELECTRON_RUN_AS_NODE", "1").arg(worker), input, Duration::from_secs(10), MAX_BYTES)?;
    decode(&output, times.len())
}

pub(crate) fn apply(selected: SelectedFrames, transcript: &TranscriptData) -> Result<Vec<(Keyframe, RgbaFrame)>> {
    let times: Vec<_> = selected.frames.iter().map(|(frame, _)| frame.t).collect();
    let said = assign(&times, &selected.anchors, transcript)?;
    let mut frames = selected.frames;
    for ((frame, _), said) in frames.iter_mut().zip(said) { frame.said = said; }
    Ok(frames)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn response_is_versioned_and_matches_every_requested_frame() {
        assert_eq!(decode(br#"{"version":1,"said":["hello",null]}"#,2).unwrap(),vec![Some("hello".into()),None]);
        for data in [br#"{"version":2,"said":[null]}"#.as_slice(),br#"{"version":1,"said":[]}"#,
            br#"{"version":1,"said":[1]}"#,br#"{"version":1,"said":[null],"extra":true}"#] {
            assert!(decode(data,1).is_err());
        }
    }
}
