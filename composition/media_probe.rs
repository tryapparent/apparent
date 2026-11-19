//! Native DTO boundary for Record's finite movie-metadata workflows.
//! Record owns interpretation; the application worker adapter owns processes and cleanup.
use anyhow::{Context, Result, ensure};
use serde::Deserialize;
use std::{path::Path, process::Command, time::Duration};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ExportProbe {
    version: u32,
    pub duration_ms: u64,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub audio_tracks: u32,
    pub embedded_audio: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct BundleProbe {
    pub(crate) version: u32,
    pub duration_ms: u64,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub audio_tracks: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum PhoneAudio {
    SkipAbsent,
    Extract,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct PhonePreparation {
    version: u32,
    pub probe: BundleProbe,
    pub audio: PhoneAudio,
}

fn request(movie: &Path, operation: &str) -> Result<Vec<u8>> {
    let (node, worker, engine) = super::worker::assets(
        "Record media",
        "record-media",
        "apparent-engine-media",
        "worker.js",
    )?;
    let movie = std::fs::canonicalize(movie).context("Could not locate export movie")?;
    // Node's argv is UTF-8. Preserve Unix filenames losslessly through a private
    // read-only alias rather than passing a replacement-character path to the SDK.
    let alias = if movie.to_str().is_none() {
        Some(super::worker::private_movie_alias(&movie)?)
    } else {
        None
    };
    let input = alias
        .as_ref()
        .map(|directory| directory.path().join("movie.mp4"))
        .unwrap_or(movie);
    super::worker::run(
        Command::new(node)
            .env("ELECTRON_RUN_AS_NODE", "1")
            .arg(worker)
            .arg(engine)
            .arg(input)
            .arg(operation),
        Duration::from_secs(35),
        32 * 1024,
    )
}

pub(crate) fn bundle_probe(movie: &Path) -> Result<BundleProbe> {
    let bytes = request(movie, "bundle-v1")?;
    let result: BundleProbe =
        serde_json::from_slice(&bytes).context("Invalid Record bundle metadata")?;
    validate_bundle_probe(&result)?;
    Ok(result)
}

fn validate_bundle_probe(result: &BundleProbe) -> Result<()> {
    ensure!(
        result.version == 1
            && result.duration_ms > 0
            && result.width > 0
            && result.height > 0
            && result.fps.is_finite()
            && result.fps >= 0.0
            && result.audio_tracks <= 1024,
        "Invalid Record bundle metadata"
    );
    Ok(())
}

pub(crate) fn phone_preparation(movie: &Path) -> Result<PhonePreparation> {
    let bytes = request(movie, "phone-v1")?;
    let result: PhonePreparation =
        serde_json::from_slice(&bytes).context("Invalid Record phone preparation")?;
    ensure!(result.version == 1, "Invalid Record phone preparation");
    validate_bundle_probe(&result.probe)?;
    Ok(result)
}

pub(crate) fn probe(movie: &Path) -> Result<ExportProbe> {
    let bytes = request(movie, "export-v1")?;
    let result: ExportProbe =
        serde_json::from_slice(&bytes).context("Invalid Record media result")?;
    ensure!(
        result.version == 1
            && result.duration_ms > 0
            && result.width > 0
            && result.height > 0
            && result.fps.is_finite()
            && result.fps >= 0.0
            && result.audio_tracks <= 1024
            && (result.audio_tracks == 0) == result.embedded_audio.is_none(),
        "Invalid Record export metadata"
    );
    Ok(result)
}

pub(crate) mod quiet {
    use crate::{
        capture::engine::export::quiet::{self, Interval, Observations, Parameters},
        shared::model::{ApparentBundle, InteractionEvent},
    };
    use anyhow::{Context, Result, ensure};
    use serde::{Deserialize, Serialize, ser::SerializeSeq};
    use std::{io::Read, os::unix::fs::OpenOptionsExt, process::Command, time::Duration};

    const OUTPUT_LIMIT: usize = 16 * 1024;

    fn clock_text(value: u64) -> String {
        value.to_string()
    }
    struct Spans<'a>(&'a [(u64, u64)]);
    impl Serialize for Spans<'_> {
        fn serialize<S: serde::Serializer>(
            &self,
            serializer: S,
        ) -> std::result::Result<S::Ok, S::Error> {
            let mut sequence = serializer.serialize_seq(Some(self.0.len()))?;
            for &(start, end) in self.0 {
                sequence.serialize_element(&[clock_text(start), clock_text(end)])?;
            }
            sequence.end()
        }
    }
    struct Timeline<'a>(&'a ApparentBundle);
    impl Serialize for Timeline<'_> {
        fn serialize<S: serde::Serializer>(
            &self,
            serializer: S,
        ) -> std::result::Result<S::Ok, S::Error> {
            #[derive(Serialize)]
            #[serde(rename_all = "camelCase")]
            struct Item {
                kind: &'static str,
                start_ms: String,
                end_ms: String,
            }
            let mut sequence = serializer.serialize_seq(None)?;
            let mut emit = |kind, start: u64, end: u64| {
                sequence.serialize_element(&Item {
                    kind,
                    start_ms: clock_text(start),
                    end_ms: clock_text(end),
                })
            };
            let bundle = self.0;
            for event in &bundle.events {
                let start = event.timestamp_ms();
                let end = if let InteractionEvent::Drag { t1, .. } = event {
                    *t1
                } else {
                    start
                };
                emit("event", start, end)?;
            }
            for item in &bundle.strokes {
                emit("stroke", item.t0, item.t1)?;
            }
            for item in &bundle.marks {
                emit("mark", item.t0, item.t1)?;
            }
            for item in &bundle.transcript.segments {
                emit("transcript", item.t0, item.t1)?;
            }
            for item in &bundle.cursor {
                emit("cursor", item.0, item.0)?;
            }
            sequence.end()
        }
    }

    pub(crate) fn quiet_parameters() -> Result<Parameters> {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Data {
            version: u8,
            parameters: Parameters,
        }
        let (_, worker) =
            super::super::worker::policy_assets("Record quiet export", "record-media", "export/worker.js")?;
        let mut bytes = Vec::new();
        let file = std::fs::OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
            .open(worker.with_file_name("parameters.json"))
            .context("Packaged Record export parameters unavailable")?;
        let metadata = file.metadata()?;
        ensure!(
            metadata.is_file() && metadata.len() <= OUTPUT_LIMIT as u64,
            "Invalid packaged Record export parameters"
        );
        file.take((OUTPUT_LIMIT + 1) as u64)
            .read_to_end(&mut bytes)?;
        ensure!(
            bytes.len() <= OUTPUT_LIMIT,
            "Record export parameters exceed their limit"
        );
        let data: Data = serde_json::from_slice(&bytes).context("Invalid Record export parameters")?;
        ensure!(data.version == 1, "Invalid Record export parameter version");
        data.parameters.validate()?;
        Ok(data.parameters)
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct RawInterval {
        start_ms: String,
        end_ms: String,
        rate: u32,
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct Reply {
        version: u8,
        duration_ms: String,
        video_offset_ms: String,
        intervals: Vec<RawInterval>,
    }
    fn clock(value: &str) -> Result<u64> {
        ensure!(
            !value.is_empty()
                && value.len() <= 20
                && value.bytes().all(|b| b.is_ascii_digit())
                && (value == "0" || !value.starts_with('0')),
            "Invalid Record export clock"
        );
        value.parse().context("Invalid Record export clock")
    }
    fn decode(bytes: &[u8], duration: u64, offset: u64) -> Result<Vec<Interval>> {
        let reply: Reply = serde_json::from_slice(bytes).context("Invalid Record export plan")?;
        ensure!(
            reply.version == 1
                && reply.duration_ms == duration.to_string()
                && reply.video_offset_ms == offset.to_string(),
            "Invalid Record export plan identity"
        );
        ensure!(
            reply.intervals.len() <= quiet::MAX_INTERVALS,
            "Record export plan exceeds native limits"
        );
        let intervals = reply
            .intervals
            .into_iter()
            .map(|item| {
                Ok(Interval {
                    start_ms: clock(&item.start_ms)?,
                    end_ms: clock(&item.end_ms)?,
                    rate: item.rate,
                })
            })
            .collect::<Result<Vec<_>>>()?;
        quiet::validate_intervals(&intervals, duration)?;
        Ok(intervals)
    }

    pub(crate) fn quiet_plan(
        bundle: &ApparentBundle,
        duration: u64,
        facts: &Observations,
    ) -> Result<Vec<Interval>> {
        if facts.frozen.is_empty() || facts.silent.is_empty() {
            return Ok(Vec::new());
        }
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Limits {
            maximum_intervals: usize,
            supported_rate: u32,
        }
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Request<'a> {
            version: u8,
            duration_ms: String,
            video_offset_ms: String,
            limits: Limits,
            frozen: Spans<'a>,
            silent: Spans<'a>,
            timeline: Timeline<'a>,
        }
        let input = super::super::worker::private_json(&Request {
            version: 1,
            duration_ms: clock_text(duration),
            video_offset_ms: clock_text(bundle.video_offset_ms),
            limits: Limits {
                maximum_intervals: quiet::MAX_INTERVALS,
                supported_rate: quiet::RETIME_RATE,
            },
            frozen: Spans(&facts.frozen),
            silent: Spans(&facts.silent),
            timeline: Timeline(bundle),
        })?;
        let (node, worker) =
            super::super::worker::policy_assets("Record quiet export", "record-media", "export/worker.js")?;
        let bytes = super::super::worker::run_with_input(
            Command::new(node)
                .env("ELECTRON_RUN_AS_NODE", "1")
                .arg(worker),
            input,
            Duration::from_secs(10),
            OUTPUT_LIMIT,
        )?;
        decode(&bytes, duration, bundle.video_offset_ms)
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        #[test]
        fn quiet_reply_is_bound_to_the_request_and_native_execution_limits() {
            let good = br#"{"version":1,"durationMs":"40000","videoOffsetMs":"1000","intervals":[{"startMs":"5000","endMs":"35000","rate":4}]}"#;
            assert_eq!(decode(good, 40000, 1000).unwrap()[0].start_ms, 5000);
            assert!(decode(good, 39999, 1000).is_err());
            assert!(decode(good, 40000, 999).is_err());
            for (before, after) in [
                ("\"version\":1", "\"version\":2"),
                ("\"rate\":4", "\"rate\":0"),
                ("\"rate\":4", "\"rate\":8"),
                ("\"5000\"", "\"05000\""),
                ("\"35000\"", "\"5000\""),
                ("\"35000\"", "\"40001\""),
            ] {
                let bad = String::from_utf8_lossy(good).replace(before, after);
                assert!(decode(bad.as_bytes(), 40000, 1000).is_err());
            }
            let repeated = serde_json::json!({"version":1,"durationMs":"40000","videoOffsetMs":"1000",
                "intervals":[{"startMs":"5000","endMs":"35000","rate":4},{"startMs":"10000","endMs":"36000","rate":4}]});
            assert!(decode(&serde_json::to_vec(&repeated).unwrap(), 40000, 1000).is_err());
            let full = br#"{"version":1,"durationMs":"18446744073709551615","videoOffsetMs":"0","intervals":[{"startMs":"5000","endMs":"18446744073709546615","rate":4}]}"#;
            assert_eq!(
                decode(full, u64::MAX, 0).unwrap()[0].end_ms,
                u64::MAX - 5000
            );
            let mut large = repeated;
            large["intervals"] = serde_json::Value::Array(vec![large["intervals"][0].clone(); 65]);
            assert!(decode(&serde_json::to_vec(&large).unwrap(), 40000, 1000).is_err());
        }
    }
}
