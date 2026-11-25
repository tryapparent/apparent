use std::fs::File;
use std::io::{Read, Seek};
use std::time::{Duration, Instant};

use crate::embedded_policy::EmbeddedPolicy;

const REQUEST_LIMIT: usize = 256 * 1024;
const DEADLINE: Duration = Duration::from_millis(25);

pub(super) fn evaluate(endpoint: &str, input: &[u8], max_output: usize) -> Option<String> {
    if input.len() > REQUEST_LIMIT {
        return None;
    }
    let input = std::str::from_utf8(input).ok()?;
    let started = Instant::now();
    let runtime = EmbeddedPolicy::open_with_deadline(
        "record-media-policies",
        include_str!(concat!(env!("OUT_DIR"), "/record-media-policies.mjs")),
        &[endpoint],
        started + DEADLINE,
    ).ok()?;
    let output = runtime.call(endpoint, (input,)).ok()?;
    if output.len() > max_output {
        return None;
    }
    match endpoint {
        "nativeAssembly" => crate::capture::desktop::start_metric("record_assembly_embedded_ms", started),
        "nativeScenes" => crate::capture::desktop::start_metric("record_scene_embedded_ms", started),
        "nativeSpeechCues" => crate::capture::desktop::start_metric("record_speech_cues_embedded_ms", started),
        "nativeTranscript" => crate::capture::desktop::start_metric("record_transcript_embedded_ms", started),
        _ => {}
    }
    Some(output)
}

pub(super) fn evaluate_file(
    endpoint: &str,
    input: &mut File,
    max_output: usize,
) -> std::io::Result<Option<String>> {
    if input.metadata()?.len() > REQUEST_LIMIT as u64 {
        return Ok(None);
    }
    let mut bytes = Vec::new();
    (&mut *input).take(REQUEST_LIMIT as u64 + 1).read_to_end(&mut bytes)?;
    input.rewind()?;
    Ok(evaluate(endpoint, &bytes, max_output))
}

#[cfg(test)]
#[path = "policy_tests.rs"]
mod tests;
