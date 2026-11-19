//! Conservative presentation-only compression. Detection uses full source frames, never keyframes.
use super::{Done, Plan};
use crate::shared::model::ApparentBundle;
use anyhow::{Context, Result, ensure};
use serde::{Deserialize, Serialize};
use std::{path::Path, process::Command};

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Interval {
    pub(crate) start_ms: u64,
    pub(crate) end_ms: u64,
    pub(crate) rate: u32,
}

pub(crate) const RETIME_RATE: u32 = 4;
pub(crate) const MAX_INTERVALS: usize = 64;

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Parameters {
    pub(crate) freeze_noise_db: f64,
    pub(crate) freeze_duration_ms: u32,
    pub(crate) silence_noise_db: f64,
    pub(crate) silence_duration_ms: u32,
}
impl Parameters {
    pub(crate) fn validate(&self) -> Result<()> {
        ensure!(
            [self.freeze_noise_db, self.silence_noise_db]
                .iter()
                .all(|value| value.is_finite() && (-120.0..=0.0).contains(value))
                && self.freeze_duration_ms > 0
                && self.silence_duration_ms > 0,
            "Invalid quiet-export observation parameters"
        );
        Ok(())
    }
}

pub(crate) struct Observations {
    pub(crate) frozen: Vec<(u64, u64)>,
    pub(crate) silent: Vec<(u64, u64)>,
}

pub(crate) fn validate_intervals(intervals: &[Interval], duration: u64) -> Result<()> {
    ensure!(
        intervals.len() <= MAX_INTERVALS,
        "Too many native retiming intervals"
    );
    let mut previous = 0;
    for interval in intervals {
        ensure!(
            interval.start_ms >= previous
                && interval.start_ms < interval.end_ms
                && interval.end_ms <= duration
                && interval.rate == RETIME_RATE,
            "Invalid native retiming interval"
        );
        previous = interval.end_ms;
    }
    Ok(())
}

fn ffmpeg(command: &mut Command) -> Result<String> {
    let output = command.output().context(
        "Quiet-stretch speedup needs ffmpeg on PATH; use --no-speedup to preserve recorded timing",
    )?;
    ensure!(
        output.status.success(),
        "Quiet-stretch processing failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    Ok(String::from_utf8_lossy(&output.stderr).into_owned())
}

// FFmpeg reports the start retroactively once the minimum duration is reached.
fn ranges(log: &str, prefix: &str, duration: u64) -> Vec<(u64, u64)> {
    let mut start = None;
    let mut out = Vec::new();
    for line in log.lines() {
        for (suffix, opening) in [("start:", true), ("end:", false)] {
            let key = format!("{prefix}_{suffix}");
            if let Some((_, tail)) = line.split_once(&key) {
                if let Some(ms) = tail
                    .split_whitespace()
                    .next()
                    .and_then(|v| v.parse::<f64>().ok())
                    .filter(|v| v.is_finite() && *v >= 0.0)
                    .map(|v| (v * 1000.0).round() as u64)
                {
                    if opening {
                        start = Some(ms);
                    } else if let Some(begin) = start.take() {
                        out.push((begin, ms.min(duration)));
                    }
                }
            }
        }
    }
    if let Some(begin) = start {
        out.push((begin, duration));
    }
    out
}

fn seconds(milliseconds: u32) -> String {
    if milliseconds % 1000 == 0 {
        (milliseconds / 1000).to_string()
    } else {
        format!("{}.{:03}", milliseconds / 1000, milliseconds % 1000)
    }
}

fn observe(
    video: &Path,
    audio: Option<&Path>,
    offset: u64,
    duration: u64,
    parameters: &Parameters,
) -> Result<Observations> {
    parameters.validate()?;
    let freeze = format!(
        "freezedetect=n={}dB:d={}",
        parameters.freeze_noise_db,
        seconds(parameters.freeze_duration_ms)
    );
    let log = ffmpeg(
        Command::new("ffmpeg")
            .args(["-nostdin", "-hide_banner", "-i"])
            .arg(video)
            .args(["-an", "-vf", &freeze, "-f", "null", "-"]),
    )?;
    let frozen = ranges(&log, "freeze", duration);
    if frozen.is_empty() {
        return Ok(Observations {
            frozen,
            silent: Vec::new(),
        });
    }
    let silent = if let Some(audio) = audio {
        let silence = format!(
            "silencedetect=n={}dB:d={}",
            parameters.silence_noise_db,
            seconds(parameters.silence_duration_ms)
        );
        let log = ffmpeg(
            Command::new("ffmpeg")
                .args(["-nostdin", "-hide_banner", "-ss"])
                .arg(format!("{:.3}", offset as f64 / 1000.0))
                .arg("-i")
                .arg(audio)
                .args(["-vn", "-af", &silence, "-f", "null", "-"]),
        )?;
        ranges(&log, "silence", duration)
    } else {
        vec![(0, duration)]
    };
    Ok(Observations { frozen, silent })
}

// A fixed vector 4x badge keeps export independent of fonts and optional drawtext builds.
fn badge_filter(enabled: &str) -> String {
    let mut filters = vec![format!(
        "drawbox=x=iw-48:y=10:w=38:h=27:color=black@0.7:t=fill:enable='{enabled}'"
    )];
    for (row, pixels) in ["1010000", "1010101", "1110010", "0010101", "0010000"]
        .iter()
        .enumerate()
    {
        for (column, pixel) in pixels.bytes().enumerate() {
            if pixel == b'1' {
                filters.push(format!(
                    "drawbox=x=iw-40+{}:y={}:w=3:h=3:color=white:t=fill:enable='{enabled}'",
                    column * 3,
                    16 + row * 3
                ));
            }
        }
    }
    filters.join(",")
}

pub(super) fn pace(
    plan: &Plan<'_>,
    bundle: &ApparentBundle,
    parameters: Option<&Parameters>,
    done: Done,
) -> Result<Done> {
    let Some(parameters) = parameters else { return Ok(done); };
    let audio = plan.audio.is_some();
    let observations = observe(plan.video, audio.then_some(plan.out), 0, plan.duration_ms, parameters)?;
    let intervals = crate::composition::media_probe::quiet::quiet_plan(bundle, plan.duration_ms, &observations)?;
    if !observations.frozen.is_empty() {
        eprintln!("Quiet-stretch speedup (source video milliseconds): {}", serde_json::to_string(&intervals)?);
    }
    if intervals.is_empty() { return Ok(done); }
    retime(plan.out, &intervals, plan.duration_ms, audio, plan.codec == "hevc", plan.fps)
}

fn retime(
    movie: &Path,
    intervals: &[Interval],
    duration: u64,
    audio: bool,
    hevc: bool,
    fps: u32,
) -> Result<Done> {
    validate_intervals(intervals, duration)?;
    let output = movie.with_extension("paced.mp4");
    let result = (|| {
        let mut spans = Vec::new();
        let mut cursor = 0;
        for i in intervals {
            if cursor < i.start_ms {
                spans.push((cursor, i.start_ms, 1));
            }
            spans.push((i.start_ms, i.end_ms, i.rate));
            cursor = i.end_ms;
        }
        if cursor < duration {
            spans.push((cursor, duration, 1));
        }
        let mut filters = Vec::new();
        let mut inputs = String::new();
        let mut expected = 0.0;
        let mut savings = Vec::new();
        let mut badge_times = Vec::new();
        for (i, (start, end, rate)) in spans.iter().enumerate() {
            let a = *start as f64 / 1000.0;
            let b = *end as f64 / 1000.0;
            if *rate > 1 {
                badge_times.push(format!(
                    "between(t,{expected:.6},{:.6})",
                    expected + (b - a) / *rate as f64
                ));
                savings.push(format!(
                    "min(max(T-{a:.6},0),{:.6})*{:.6}",
                    b - a,
                    1.0 - 1.0 / *rate as f64
                ));
            }
            expected += (b - a) / *rate as f64;
            if audio {
                filters.push(format!("[0:a]apad,atrim=start={a:.3}:end={b:.3},asetpts=PTS-STARTPTS,atempo={rate}[a{i}]"));
                inputs.push_str(&format!("[a{i}]"));
            }
        }
        // One continuous source->output map avoids rounding a frame duration at every join.
        filters.push(format!(
            "[0:v]setpts='PTS-STARTPTS-({})/TB',{}[v]",
            savings.join("+"),
            badge_filter(&badge_times.join("+"))
        ));
        if audio {
            filters.push(format!("{inputs}concat=n={}:v=0:a=1[a]", spans.len()));
        }
        let mut command = Command::new("ffmpeg");
        command
            .args(["-nostdin", "-v", "error", "-i"])
            .arg(movie)
            .args(["-filter_complex", &filters.join(";"), "-map", "[v]"]);
        if audio {
            command.args(["-map", "[a]", "-c:a", "aac"]);
        }
        command
            .args([
                "-c:v",
                if hevc { "libx265" } else { "libx264" },
                "-pix_fmt",
                "yuv420p",
                "-r",
            ])
            .arg(fps.to_string())
            .args(["-movflags", "+faststart", "-metadata"])
            .arg(format!(
                "comment=Apparent quiet-stretch source intervals: {}",
                serde_json::to_string(intervals)?
            ))
            .args(["-y"])
            .arg(&output);
        ffmpeg(&mut command)?;
        let bytes = std::fs::metadata(&output)?.len();
        ensure!(bytes > 0, "Empty paced export");
        let probe = Command::new("ffprobe")
            .args([
                "-v",
                "error",
                "-show_entries",
                "format=duration:stream=codec_type",
                "-of",
                "json",
            ])
            .arg(&output)
            .output()
            .context("Speedup verification needs ffprobe on PATH")?;
        ensure!(probe.status.success(), "Could not verify paced export");
        let value: serde_json::Value = serde_json::from_slice(&probe.stdout)?;
        let actual: f64 = value["format"]["duration"]
            .as_str()
            .context("Missing paced duration")?
            .parse()?;
        ensure!(
            (actual - expected).abs() < 0.25,
            "Paced export duration mismatch: {actual} vs {expected}"
        );
        let streams = value["streams"]
            .as_array()
            .context("Missing paced streams")?;
        ensure!(
            streams.iter().any(|s| s["codec_type"] == "video"),
            "Paced export lost video"
        );
        ensure!(
            !audio || streams.iter().any(|s| s["codec_type"] == "audio"),
            "Paced export lost audio"
        );
        std::fs::rename(&output, movie)?;
        Ok(Done {
            duration_ms: (actual * 1000.0).round() as u64,
            bytes,
        })
    })();
    let _ = std::fs::remove_file(output);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn detector_boundaries_include_terminal_holds() {
        assert_eq!(
            ranges(
                "[freezedetect] freeze_start: 2\n[freezedetect] freeze_end: 25",
                "freeze",
                30000
            ),
            vec![(2000, 25000)]
        );
        assert_eq!(
            ranges("silence_start: 0", "silence", 30000),
            vec![(0, 30000)]
        );
    }
    #[test]
    fn retime_keeps_audio_and_video_on_one_clock() {
        let fixture = tempfile::tempdir().unwrap();
        let root = fixture.path();
        let movie = root.join("test.mp4");
        ffmpeg(
            Command::new("ffmpeg")
                .args([
                    "-v",
                    "error",
                    "-f",
                    "lavfi",
                    "-i",
                    "color=c=blue:s=160x90:r=10:d=40",
                    "-f",
                    "lavfi",
                    "-i",
                    "aevalsrc=if(gte(t\\,38)\\,0.3*sin(2*PI*440*t)\\,0):s=24000:d=40",
                    "-c:v",
                    "libx264",
                    "-c:a",
                    "aac",
                    "-y",
                ])
                .arg(&movie),
        )
        .unwrap();
        let log = ffmpeg(
            Command::new("ffmpeg")
                .args(["-nostdin", "-hide_banner", "-i"])
                .arg(&movie)
                .args(["-an", "-vf", "freezedetect=n=-60dB:d=12", "-f", "null", "-"]),
        )
        .unwrap();
        assert!(!ranges(&log, "freeze", 40000).is_empty());

        let intervals = vec![Interval {
            start_ms: 5000,
            end_ms: 35000,
            rate: 4,
        }];
        let done = retime(&movie, &intervals, 40000, true, false, 10).unwrap();
        assert!((done.duration_ms as i64 - 17500).abs() < 250);
        let rms = |time: &str| {
            let out = Command::new("ffmpeg")
                .args(["-v", "error", "-ss", time, "-i"])
                .arg(&movie)
                .args(["-t", "0.2", "-f", "s16le", "-ac", "1", "-ar", "24000", "-"])
                .output()
                .unwrap();
            assert!(out.status.success());
            out.stdout
                .chunks_exact(2)
                .map(|s| i16::from_le_bytes([s[0], s[1]]).unsigned_abs() as u64)
                .sum::<u64>()
        };
        assert!(
            rms("15.8") > rms("14.0") + 100000,
            "source sound at 38s maps to 15.5s"
        );
    }
    #[test]
    fn many_fractional_boundaries_do_not_accumulate_timeline_drift() {
        let fixture = tempfile::tempdir().unwrap();
        let root = fixture.path();
        let movie = root.join("test.mp4");
        ffmpeg(
            Command::new("ffmpeg")
                .args([
                    "-v",
                    "error",
                    "-f",
                    "lavfi",
                    "-i",
                    "color=c=blue:s=160x90:r=10:d=220",
                    "-f",
                    "lavfi",
                    "-i",
                    "anullsrc=r=24000:cl=mono",
                    "-t",
                    "220",
                    "-c:v",
                    "libx264",
                    "-c:a",
                    "aac",
                    "-y",
                ])
                .arg(&movie),
        )
        .unwrap();
        let intervals: Vec<_> = (0..10)
            .map(|i| Interval {
                start_ms: 5137 + i * 20000,
                end_ms: 15354 + i * 20000,
                rate: 4,
            })
            .collect();
        let done = retime(&movie, &intervals, 220000, true, false, 10).unwrap();
        assert!((done.duration_ms as i64 - 143373).abs() < 250);
    }
}
