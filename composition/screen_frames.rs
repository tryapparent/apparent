//! Finite page resources for Record's screen candidate workflow.
use super::movie_frames::{Reply, read_reply, sampled_times, timed_frame_response};
use crate::shared::model::RgbaFrame;
use anyhow::{Context, Result, bail, ensure};
use serde::Deserialize;
use std::{
    collections::HashSet,
    path::Path,
    time::{Duration, Instant},
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Page {
    reply: Reply,
    next_cursor: serde_json::Value,
}

pub(crate) fn candidates(
    movie: &Path,
    duration: u64,
    offset: u64,
    purpose: &str,
) -> Result<Vec<RgbaFrame>> {
    ensure!(
        duration > 0 && duration <= 9_007_199_254_740_991 && offset <= 9_007_199_254_740_991,
        "Invalid screen movie clock"
    );
    let deadline = Instant::now() + Duration::from_secs(305);
    let mut cursor = "null".to_owned();
    let mut seen = HashSet::from([cursor.clone()]);
    let mut frames: Vec<RgbaFrame> = Vec::new();
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        ensure!(
            remaining.as_millis() > 0,
            "Screen candidate deadline expired"
        );
        let arguments = [
            duration.to_string(),
            offset.to_string(),
            purpose.to_owned(),
            cursor,
            remaining.as_millis().min(300_000).to_string(),
        ];
        let (output, directory, bytes) = timed_frame_response(
            "Record media",
            "record-media",
            "screen-worker.js",
            movie,
            &arguments,
            remaining,
        )?;
        let page: Page = serde_json::from_slice(&bytes).context("Invalid screen candidate page")?;
        let times = sampled_times(&page.reply, offset)?;
        ensure!(
            times
                .first()
                .is_none_or(|first| frames.last().is_none_or(|last| last.t_ms < *first)),
            "Screen candidate clock moved backwards"
        );
        frames.extend(read_reply(
            output.path(),
            &directory,
            page.reply,
            &times,
            0,
        )?);
        ensure!(
            Instant::now() < deadline,
            "Screen candidate deadline expired"
        );
        match next_cursor(page.next_cursor, &mut seen)? {
            None => {
                ensure!(!frames.is_empty(), "No screen candidates");
                return Ok(frames);
            }
            Some(next) => cursor = next,
        }
        // The page's private raw pixels are removed before the next worker starts.
    }
}

fn next_cursor(value: serde_json::Value, seen: &mut HashSet<String>) -> Result<Option<String>> {
    match value {
        serde_json::Value::Null => Ok(None),
        serde_json::Value::String(next) => {
            ensure!(
                !next.is_empty() && next.len() <= 1024 && seen.insert(next.clone()),
                "Screen candidate cursor repeated"
            );
            Ok(Some(next))
        }
        _ => bail!("Invalid screen candidate cursor"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn full_periodic_pages_survive_the_real_worker_transport() {
        let directory = tempfile::tempdir().unwrap();
        let movie = directory.path().join("moving.mp4");
        let encoded = std::process::Command::new("ffmpeg")
            .args([
                "-v",
                "error",
                "-nostdin",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "testsrc2=s=32x32:r=10:d=120",
                "-c:v",
                "libx264",
                "-threads",
                "1",
                "-pix_fmt",
                "yuv420p",
            ])
            .arg(&movie)
            .output()
            .unwrap();
        assert!(encoded.status.success());
        let source = std::fs::read(&movie).unwrap();
        let phone = super::super::movie_frames::record_phone_candidates(&movie, 120_000).unwrap();
        assert_eq!(phone.len(), 480);
        assert_eq!(
            phone.iter().map(|frame| frame.t_ms).collect::<Vec<_>>(),
            (0..480)
                .map(|index| index * 250 / 100 * 100)
                .collect::<Vec<_>>()
        );
        let screen = candidates(&movie, 120_000, 500, "recovery").unwrap();
        assert_eq!(
            screen.iter().map(|frame| frame.t_ms).collect::<Vec<_>>(),
            (0..120_000)
                .step_by(220)
                .map(|time| time / 100 * 100 + 500)
                .collect::<Vec<_>>()
        );
        assert!(phone.iter().chain(&screen).all(|frame| (
            frame.width,
            frame.height,
            frame.rgba.len()
        ) == (32, 32, 32 * 32 * 4)));
        assert_eq!(std::fs::read(movie).unwrap(), source);
    }

    #[test]
    fn pages_require_explicit_continuation_and_refuse_cycles_or_invalid_cursors() {
        assert!(serde_json::from_str::<Page>(r#"{"reply":{"version":1,"frames":[]}}"#).is_err());
        assert!(
            serde_json::from_str::<Page>(
                r#"{"reply":{"version":1,"frames":[]},"nextCursor":null,"extra":0}"#
            )
            .is_err()
        );
        let mut seen = HashSet::from(["null".to_owned()]);
        assert!(
            next_cursor(serde_json::Value::Null, &mut seen)
                .unwrap()
                .is_none()
        );
        assert_eq!(
            next_cursor(serde_json::json!("page-1"), &mut seen).unwrap(),
            Some("page-1".to_owned())
        );
        for invalid in [
            serde_json::json!("page-1"),
            serde_json::json!("null"),
            serde_json::json!(""),
            serde_json::json!("x".repeat(1025)),
            serde_json::json!(0),
        ] {
            assert!(next_cursor(invalid, &mut seen).is_err());
        }
    }
}
