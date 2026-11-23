//! Resource adapter for Record's read-only transcript allocation contract.
pub(crate) mod speech;
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
    if let Some(Ok(said)) = super::record_policy::evaluate("nativeTranscript", &bytes, MAX_BYTES)
        .map(|output| decode(output.as_bytes(), times.len()))
    {
        return Ok(said);
    }
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
    fn style_samples_count_separators_and_keep_valid_unicode() {
        let tokenizer = tiktoken_rs::cl100k_base_singleton();
        for sample in [" some words", "👩🏽‍🔬", " 点一下"] {
            let mut examples = StyleExamples::new();
            assert!(!examples.append("   ", 32).unwrap());
            assert!(!examples.append("First passage", 32).unwrap());
            assert!(examples.append(&sample.repeat(128), 32).unwrap());
            assert!(examples.text.starts_with("First passage\n\n"));
            assert!(tokenizer.encode_ordinary(&examples.text).len() <= 32);
        }
    }
    #[test]
    fn response_is_versioned_and_matches_every_requested_frame() {
        assert_eq!(decode(br#"{"version":1,"said":["hello",null]}"#,2).unwrap(),vec![Some("hello".into()),None]);
        for data in [br#"{"version":2,"said":[null]}"#.as_slice(),br#"{"version":1,"said":[]}"#,
            br#"{"version":1,"said":[1]}"#,br#"{"version":1,"said":[null],"extra":true}"#] {
            assert!(decode(data,1).is_err());
        }
    }
}

struct StyleExamples {
    text: String,
}

impl StyleExamples {
    pub(crate) fn new() -> Self {
        Self { text: String::new() }
    }

    pub(crate) fn append(&mut self, transcript: &str, budget: usize) -> Result<bool> {
        let transcript = transcript.trim();
        if transcript.is_empty() {
            return Ok(false);
        }
        if !self.text.is_empty() {
            self.text.push_str("\n\n");
        }
        let end = transcript.floor_char_boundary(transcript.len().min(budget * 256));
        self.text.push_str(&transcript[..end]);
        let tokenizer = tiktoken_rs::cl100k_base_singleton();
        let tokens = tokenizer.encode_ordinary(&self.text);
        if tokens.len() < budget {
            return Ok(false);
        }
        let bytes = tokenizer.decode_bytes(&tokens[..budget])?;
        let end = self.text.floor_char_boundary(bytes.len());
        self.text.truncate(end);
        Ok(true)
    }

    pub(crate) fn print(&self) {
        if self.text.is_empty() {
            println!("No earlier transcript examples are available.");
        } else {
            println!("Earlier speech, for wording and tone only:\n{}", self.text);
        }
    }
}

pub(crate) fn inspect(bundle: std::path::PathBuf, reader: Option<String>, json: bool, marks: bool, style_examples: bool, experiments: Vec<String>) -> Result<()> {
    use crate::shared::handoff;
    use crate::capture::agent::context as agent_context;
    use crate::capture::engine::sketch::summary_markdown;
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    use crate::connect::hosted;
    for name in &experiments {
        handoff::enable_experiment(name);
    }
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    if style_examples {
        let client = hosted::client();
        let remote = hosted::inspect_capture_id(&bundle);
        let local = if remote.is_none() { Some(handoff::resolve_bundle_dir(&bundle)?) } else { None };
        let id = remote.map(str::to_owned).or_else(|| client.style_source(local.as_deref()?))
            .context("No Connect speaking-style request for this recording")?;
        let mut examples = StyleExamples::new();
        client.visit_style_transcripts(&id, reader.as_deref(), local.as_deref(), |text, budget| examples.append(text, budget))?;
        examples.print();
        return Ok(());
    }
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    let bundle = hosted::inspect_source(&bundle, reader.as_deref())?;
    let (dir, loaded) = handoff::load_bundle(&bundle)?;
    if marks {
        let entries = agent_context::mark_entries(&loaded);
        if json {
            let list: Vec<_> = entries.iter().map(|e| e.json()).collect();
            println!("{}", serde_json::to_string_pretty(&list)?);
        } else if entries.is_empty() {
            println!("No marks");
        } else {
            for entry in &entries {
                println!("{}", entry.line());
            }
        }
    } else if json {
        println!("{}", serde_json::to_string_pretty(&loaded)?);
    } else {
        print!("{}", summary_markdown(&loaded, &dir));
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        if hosted::client().style_source(&dir).is_some() {
            println!("\nMatch the user's speaking style. For examples, run apparent inspect <source> --style-examples with the original handoff source and Connect reader.");
        }
    }
    Ok(())
}
