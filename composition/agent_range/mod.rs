//! Agent-owned range policy; composition only validates the finite wire reply.
use anyhow::{Context, Result, bail, ensure};
use serde::Deserialize;
use std::{process::Command, time::Duration};

pub(crate) struct FrameRangePlan {
    pub fps: u32,
    pub step_ms: u64,
    pub lower_ms: u64,
    pub upper_ms: u64,
}

#[derive(Deserialize)]
#[serde(
    tag = "status",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum Reply {
    Plan {
        version: u8,
        from_ms: String,
        to_ms: String,
        fps: u32,
        step_ms: String,
        lower_ms: String,
        upper_ms: String,
    },
    Error {
        version: u8,
        message: String,
    },
}

fn decode(bytes: &[u8], from: u64, to: u64, requested_fps: Option<u32>) -> Result<FrameRangePlan> {
    let reply: Reply = serde_json::from_slice(bytes).context("Invalid Agent frame range plan")?;
    match reply {
        Reply::Error { version, message } => {
            ensure!(
                version == 1 && message.len() <= 128 && !message.chars().any(char::is_control),
                "Invalid Agent frame range error"
            );
            bail!("{message}")
        }
        Reply::Plan {
            version,
            from_ms,
            to_ms,
            fps,
            step_ms,
            lower_ms,
            upper_ms,
        } => {
            let parse = |value: String| {
                value
                    .parse::<u64>()
                    .context("Invalid Agent frame range clock")
            };
            let (from_ms, to_ms, step_ms, lower_ms, upper_ms) = (
                parse(from_ms)?,
                parse(to_ms)?,
                parse(step_ms)?,
                parse(lower_ms)?,
                parse(upper_ms)?,
            );
            ensure!(
                version == 1
                    && from_ms == from
                    && to_ms == to
                    && from_ms <= to_ms
                    && fps > 0
                    && fps <= 240
                    && step_ms > 0
                    && lower_ms <= from
                    && upper_ms >= to
                    && requested_fps.is_none_or(|value| fps == value),
                "Invalid Agent frame range identity"
            );
            Ok(FrameRangePlan {
                fps,
                step_ms,
                lower_ms,
                upper_ms,
            })
        }
    }
}

pub(crate) fn plan(from: u64, to: u64, fps: Option<u32>) -> Result<FrameRangePlan> {
    let (node, worker) =
        super::worker::policy_assets("Agent range", "agent-media", "range-worker.js")?;
    let bytes = super::worker::run(
        Command::new(node)
            .env("ELECTRON_RUN_AS_NODE", "1")
            .arg(worker)
            .arg(from.to_string())
            .arg(to.to_string())
            .arg(fps.map_or_else(|| "-".into(), |value| value.to_string())),
        Duration::from_secs(5),
        1024,
    )?;
    decode(&bytes, from, to, fps)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn plan_is_versioned_and_bound_to_the_request_without_native_defaults() {
        let good = br#"{"version":1,"status":"plan","fromMs":"0","toMs":"1000","fps":4,"stepMs":"250","lowerMs":"0","upperMs":"1125"}"#;
        assert_eq!(decode(good, 0, 1000, None).unwrap().fps, 4);
        assert!(decode(good, 1, 1000, None).is_err());
        assert!(decode(good, 0, 999, None).is_err());
        assert!(decode(good, 0, 1000, Some(7)).is_err());
        for (from, to) in [
            ("\"version\":1", "\"version\":2"),
            ("\"stepMs\":\"250\"", "\"stepMs\":\"0\""),
            ("\"upperMs\":\"1125\"", "\"upperMs\":\"999\""),
            ("\"fps\":4", "\"fps\":0"),
            ("\"fps\":4", "\"fps\":241"),
        ] {
            let bad = String::from_utf8_lossy(good).replace(from, to);
            assert!(decode(bad.as_bytes(), 0, 1000, None).is_err());
        }
        let reversed = String::from_utf8_lossy(good)
            .replace("\"fromMs\":\"0\"", "\"fromMs\":\"1000\"")
            .replace("\"toMs\":\"1000\"", "\"toMs\":\"0\"");
        assert!(decode(reversed.as_bytes(), 1000, 0, None).is_err());
        let exact = br#"{"version":1,"status":"plan","fromMs":"18446744073709551615","toMs":"18446744073709551615","fps":7,"stepMs":"142","lowerMs":"18446744073709551544","upperMs":"18446744073709551615"}"#;
        assert_eq!(
            decode(exact, u64::MAX, u64::MAX, Some(7)).unwrap().upper_ms,
            u64::MAX
        );
    }
}

use clap::Subcommand;
use std::path::PathBuf;

#[derive(Subcommand)]
pub(super) enum VideoCommand {
    #[command(about = "Create timestamped full-frame contact sheets and JSON metadata for up to eight local media files")]
    Inspect {
        #[arg(required = true, value_name = "MEDIA")]
        media: Vec<PathBuf>,
        #[arg(long, default_value_t = 12, value_parser = clap::value_parser!(u8).range(2..=18), help = "Frames per video (2–18)")]
        frames: u8,
        #[arg(long, help = "First timestamp in milliseconds for a single video")]
        from_ms: Option<u32>,
        #[arg(long, help = "Last timestamp in milliseconds for a single video")]
        to_ms: Option<u32>,
        #[arg(long, help = "Include an editable three-scene JSON starter plan with empty narration")]
        starter_plan: bool,
        #[arg(long, value_name = "DIRECTORY")]
        out: PathBuf,
    },
    #[command(about = "Render a version 1 JSON scene plan to a new private directory",
        after_help = "Example: apparent video render plan.json --out review
Plan: {\"version\":1,\"scenes\":[{\"shots\":[{\"file\":\"screen.png\"}],\"say\":[\"Here is the result.\"]}]}
Use two shots for a side-by-side comparison. Video shots accept atMs or fromMs/toMs, in source milliseconds. Optional label and box share the full frame. Box coordinates are fractions 0–1 in [left,top,width,height] order, for example [0.2,0.3,0.12,0.08]. Use boxPixels for the same coordinates in source pixels.
Use up to 20 scenes and 1–6 spoken lines per scene, up to 108 characters per line.
review.jpg samples the opening, middle and end of each scene. verification.json lists scene and cue frames.
Set a spoken caption's start relative to its scene with {\"text\":\"Now paste the note.\",\"startMs\":1500}. Plain strings start after the previous line.
Run apparent video inspect to find source times and dimensions.
Requires ffmpeg with libass, drawtext, H.264 and AAC, ffprobe, and a provisioned local Apparent narrator.")]
    Render {
        #[arg(value_name = "PLAN")]
        plan: PathBuf,
        #[arg(long, value_name = "DIRECTORY", help = "Reuse unchanged local narration cues in a private cache")]
        voice_cache: Option<PathBuf>,
        #[arg(long, value_name = "DIRECTORY", help = "New directory for video.mp4, captions.srt, review.jpg, and verification.json")]
        out: PathBuf,
    },
}

pub(super) fn video_command(command: VideoCommand) -> Result<()> {
    use crate::composition::worker as process;
    let temp = tempfile::Builder::new().prefix("apparent-dev-video-worker-").tempdir()?;
    for (name, source) in [
        ("voice.mjs", include_str!(concat!(env!("OUT_DIR"), "/video-worker/voice.mjs"))),
        ("plan.mjs", include_str!(concat!(env!("OUT_DIR"), "/video-worker/plan.mjs"))),
        ("inspect.mjs", include_str!(concat!(env!("OUT_DIR"), "/video-worker/inspect.mjs"))),
        ("media.mjs", include_str!(concat!(env!("OUT_DIR"), "/video-worker/media.mjs"))),
        ("video.mjs", include_str!(concat!(env!("OUT_DIR"), "/video-worker/video.mjs"))),
        ("video-plan.mjs", include_str!(concat!(env!("OUT_DIR"), "/video-worker/video-plan.mjs"))),
    ] {
        std::fs::write(temp.path().join(name), source)?;
    }
    let mut runner = if let Some(node) = process::bundled_node()? {
        let mut bundled = std::process::Command::new(node);
        bundled.env("ELECTRON_RUN_AS_NODE", "1");
        bundled
    } else {
        std::process::Command::new("node")
    };
    runner.arg(temp.path().join("video.mjs"));
    match command {
        VideoCommand::Inspect { media, frames, out, from_ms, to_ms, starter_plan } => {
            runner.arg("inspect").arg(temp.path()).arg(out).arg(frames.to_string())
                .arg(from_ms.map_or_else(|| "-".into(), |ms| ms.to_string()))
                .arg(to_ms.map_or_else(|| "-".into(), |ms| ms.to_string()))
                .arg(starter_plan.to_string()).args(media);
        }
        VideoCommand::Render { plan, out, voice_cache } => {
            ensure!(crate::shared::handoff::experiment("exportNarration"),
                "Local narration is disabled by experiments.exportNarration=false");
            runner.arg("render").arg(temp.path()).arg(out).arg(plan);
            if let Some(cache) = voice_cache {
                runner.arg(cache);
            }
        }
    }
    let bytes = process::run(&mut runner, Duration::from_secs(900), 128 * 1024)
        .context("Video worker failed. Check Node, ffmpeg and the local narrator")?;
    let reply: serde_json::Value = serde_json::from_slice(&bytes).context("Invalid video worker reply")?;
    if let Some(error) = reply.get("error").and_then(serde_json::Value::as_str) {
        anyhow::bail!("{error}");
    }
    println!("{}", reply.get("result").context("Missing video result")?);
    Ok(())
}
