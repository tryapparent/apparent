use serde_json::{Value, json};
use std::fs::File;
use std::io::Read;
use std::sync::{OnceLock, mpsc};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

include!(concat!(env!("OUT_DIR"), "/recording-performance.rs"));

const BOUNDS: [u32; 16] = [
    10, 25, 50, 100, 250, 500, 750, 1000, 1500, 2000, 3000, 5000, 7500, 10000, 20000, 60000,
];
const METRICS: &str = "https://eu.i.posthog.com/i/v1/metrics";
const TRACES: &str = "https://eu.i.posthog.com/i/v1/traces";

pub(crate) const SETTING: &str = "recordingPerformance";
pub(crate) const GENERATION: &str = "recordingPerformanceGeneration";

struct Timing {
    name: &'static str,
    start: u128,
    end: u128,
}

impl Timing {
    fn measure(name: &'static str, started: Instant) -> Self {
        let end = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        Self {
            name,
            start: end.saturating_sub(started.elapsed().as_nanos()),
            end,
        }
    }
}

pub(crate) struct RecordingPerformance {
    consent: String,
    start: Instant,
    ready: Option<Timing>,
    trace_ids: [String; 2],
}

struct Report {
    consent: String,
    trace_ids: [String; 2],
    start: Timing,
    finish: Timing,
    finalizer: Timing,
    recording_ms: u64,
    saved: bool,
    stages: crate::recording_trace::Collected,
}

pub(crate) fn generation(config: &Value) -> Option<&str> {
    if config["experiments"][SETTING] != true {
        return None;
    }
    config[GENERATION]
        .as_str()
        .filter(|value| !value.is_empty() && value.len() <= 128)
}

fn consent() -> Option<String> {
    let path = crate::shared::handoff::default_config_path();
    let config = crate::capture::desktop::workflow::error_reporting::reporting_config_in(&path)?;
    generation(&config).map(str::to_owned)
}

impl RecordingPerformance {
    pub(crate) fn finalize<T, E>(
        performance: Option<Self>,
        finish: Instant,
        work: impl FnOnce() -> (Result<T, E>, u64),
    ) -> (Result<T, E>, u64) {
        let started = Instant::now();
        let (result, stages) = crate::recording_trace::collect(performance.is_some(), work);
        if let Some(performance) = performance {
            performance.finish(finish, started, result.1, result.0.is_ok(), stages);
        }
        result
    }

    pub(crate) fn begin(start: Instant) -> Option<Self> {
        crate::capture::desktop::workflow::error_reporting::compiled_token()?;
        let consent = consent()?;
        let mut bytes = [0; 34];
        File::open("/dev/urandom")
            .ok()?
            .read_exact(&mut bytes)
            .ok()?;
        let draw = u16::from_be_bytes([bytes[0], bytes[1]]);
        if u32::from(draw) * 100 >= u32::from(SAMPLE_PERCENT) * 65536 {
            return None;
        }
        let trace_ids = [2, 18].map(|offset| {
            bytes[offset..offset + 16]
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect()
        });
        Some(Self {
            consent,
            start,
            ready: None,
            trace_ids,
        })
    }

    pub(crate) fn needs_ready(&self) -> bool {
        self.ready.is_none()
    }

    pub(crate) fn live(&mut self) {
        self.ready = Some(Timing::measure("recording.start.duration", self.start));
    }

    pub(crate) fn finish(
        self,
        finish: Instant,
        finalizer_started: Instant,
        recording_ms: u64,
        saved: bool,
        stages: crate::recording_trace::Collected,
    ) {
        let Some(start) = self.ready else {
            return;
        };
        let finish_timing = Timing::measure("recording.finish.duration", finish);
        let finalizer = Timing {
            name: "recording.bundle.finalize",
            start: finish_timing
                .end
                .saturating_sub(finalizer_started.elapsed().as_nanos())
                .max(finish_timing.start),
            end: finish_timing.end,
        };
        if consent().as_deref() != Some(&self.consent) {
            return;
        }
        let report = Report {
            consent: self.consent,
            trace_ids: self.trace_ids,
            start,
            finish: finish_timing,
            finalizer,
            recording_ms,
            saved,
            stages,
        };
        if let Some(sender) = sender() {
            let _ = sender.try_send(report);
        }
    }
}

fn sender() -> Option<&'static mpsc::SyncSender<Report>> {
    static SENDER: OnceLock<Option<mpsc::SyncSender<Report>>> = OnceLock::new();
    SENDER.get_or_init(|| {
        let token = crate::capture::desktop::workflow::error_reporting::compiled_token()?;
        let (send, receive) = mpsc::sync_channel::<Report>(8);
        std::thread::Builder::new().name("recording-performance".into()).spawn(move || {
            let authorization = format!("Authorization: Bearer {token}");
            while let Ok(report) = receive.recv() {
                if consent().as_deref() != Some(&report.consent) { continue; }
                let (metrics, traces) = payloads(&report);
                for (endpoint, body) in [(METRICS, metrics), (TRACES, traces)] {
                    if consent().as_deref() != Some(&report.consent) { break; }
                    let _ = crate::capture::desktop::workflow::error_reporting::transport::send_json(endpoint, &body, Some(&authorization));
                }
            }
        }).ok()?;
        Some(send)
    }).as_ref()
}

fn attribute(key: &str, value: &str) -> Value {
    json!({"key":key,"value":{"stringValue":value}})
}

fn payloads(report: &Report) -> (Value, Value) {
    let length = match report.recording_ms {
        n if n < SHORT_RECORDING_MS => "under_30_seconds",
        n if n < MEDIUM_RECORDING_MS => "30_to_119_seconds",
        _ => "120_seconds_or_more",
    };
    let resource = json!({"attributes":[
        attribute("service.name", "apparent-desktop"),
        attribute("service.version", env!("APPARENT_COMMIT_SHA")),
        attribute("os.type", std::env::consts::OS)
    ]});
    let scope = json!({"name":"apparent.recording"});
    let mut metrics = Vec::with_capacity(2);
    let mut spans = Vec::with_capacity(3 + report.stages.spans.len());
    for (index, timing) in [&report.start, &report.finish].into_iter().enumerate() {
        let ok = index == 0 || report.saved;
        let attributes = [
            attribute("recording.length_bucket", length),
            attribute("outcome", if ok { "success" } else { "failure" }),
        ];
        let duration_ms = (timing.end - timing.start) as f64 / 1_000_000.0;
        let bucket = BOUNDS.partition_point(|bound| f64::from(*bound) < duration_ms);
        let bucket_counts = (0..=BOUNDS.len())
            .map(|slot| if slot == bucket { "1" } else { "0" })
            .collect::<Vec<_>>();
        let start = timing.start.to_string();
        let end = timing.end.to_string();
        metrics.push(json!({
            "name":timing.name,"unit":"ms",
            "histogram":{"aggregationTemporality":1,"dataPoints":[{
                "attributes":attributes,"startTimeUnixNano":start,"timeUnixNano":end,
                "count":"1","sum":duration_ms,"min":duration_ms,"max":duration_ms,
                "explicitBounds":BOUNDS,"bucketCounts":bucket_counts
            }]}
        }));
        spans.push(json!({
            "traceId":report.trace_ids[index],"spanId":"0000000000000001","name":timing.name,
            "kind":1,"startTimeUnixNano":start,"endTimeUnixNano":end,"attributes":attributes,
            "status":{"code":if ok {1} else {2}}
        }));
    }
    spans.push(json!({
        "traceId":report.trace_ids[1],
        "spanId":"0000000000000002","parentSpanId":"0000000000000001",
        "name":report.finalizer.name,"kind":1,
        "startTimeUnixNano":report.finalizer.start.to_string(),
        "endTimeUnixNano":report.finalizer.end.to_string(),
        "attributes":[{"key":"recording.spans_dropped","value":{"intValue":report.stages.dropped.to_string()}}]
    }));
    for stage in &report.stages.spans {
        spans.push(json!({
            "traceId":report.trace_ids[1],
            "spanId":format!("{:016x}", stage.id),
            "parentSpanId":format!("{:016x}", stage.parent),
            "name":stage.operation.name(),"kind":1,
            "startTimeUnixNano":stage.start.to_string(),
            "endTimeUnixNano":stage.end.to_string()
        }));
    }
    (
        json!({"resourceMetrics":[{"resource":resource,"scopeMetrics":[{"scope":scope,"metrics":metrics}]}]}),
        json!({"resourceSpans":[{"resource":resource,"scopeSpans":[{"scope":scope,"spans":spans}]}]}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn performance_requires_explicit_consent_and_generation() {
        assert_eq!(generation(&json!({})), None);
        assert_eq!(generation(&json!({"experiments": {SETTING: true}})), None);
        for enabled in [json!(false), json!("true"), json!(true)] {
            let state = json!({"experiments":{SETTING: enabled}, GENERATION: "revision"});
            assert_eq!(generation(&state), (enabled == true).then_some("revision"));
        }
    }

    #[test]
    fn exports_sampled_histograms_and_parented_finish_spans() {
        let report = Report {
            consent: "private-generation".into(),
            trace_ids: ["09".repeat(16), "10".repeat(16)],
            start: Timing {
                name: "recording.start.duration",
                start: 1_000_000_000,
                end: 1_500_000_000,
            },
            finish: Timing {
                name: "recording.finish.duration",
                start: 90_000_000_000,
                end: 92_000_000_000,
            },
            finalizer: Timing {
                name: "recording.bundle.finalize",
                start: 91_000_000_000,
                end: 92_000_000_000,
            },
            recording_ms: 89000,
            saved: false,
            stages: crate::recording_trace::collect(true, || {
                let _build =
                    crate::recording_trace::span(crate::recording_trace::Operation::BundleBuild);
                std::thread::scope(|scope| {
                    scope
                        .spawn(crate::recording_trace::propagate(|| {
                            let _speech = crate::recording_trace::span(
                                crate::recording_trace::Operation::Transcribe,
                            );
                        }))
                        .join()
                        .unwrap();
                });
            })
            .1,
        };
        let (metrics, traces) = payloads(&report);
        let datapoint = &metrics["resourceMetrics"][0]["scopeMetrics"][0]["metrics"][0]["histogram"]
            ["dataPoints"][0];
        assert_eq!(datapoint["sum"], 500.0);
        assert_eq!(datapoint["count"], "1");
        assert_eq!(datapoint["bucketCounts"][5], "1");
        assert_eq!(
            datapoint["bucketCounts"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|value| **value == "1")
                .count(),
            1
        );
        let spans = &traces["resourceSpans"][0]["scopeSpans"][0]["spans"];
        assert_ne!(spans[0]["traceId"], spans[1]["traceId"]);
        assert_eq!(spans[1]["traceId"], spans[2]["traceId"]);
        assert_eq!(spans[1]["spanId"], spans[2]["parentSpanId"]);
        assert_eq!(spans[1]["status"]["code"], 2);
        let details = spans.as_array().unwrap();
        let build = details
            .iter()
            .find(|s| s["name"] == "recording.bundle.build")
            .unwrap();
        let speech = details
            .iter()
            .find(|s| s["name"] == "recording.transcribe")
            .unwrap();
        assert_eq!(build["parentSpanId"], spans[2]["spanId"]);
        assert_eq!(speech["parentSpanId"], build["spanId"]);
        assert_eq!(speech["traceId"], spans[1]["traceId"]);
        for stage in [build, speech] {
            assert_eq!(stage.as_object().unwrap().len(), 7);
            assert!(stage["status"].is_null());
            assert!(
                stage["startTimeUnixNano"]
                    .as_str()
                    .unwrap()
                    .parse::<u128>()
                    .unwrap()
                    <= stage["endTimeUnixNano"]
                        .as_str()
                        .unwrap()
                        .parse::<u128>()
                        .unwrap()
            );
        }
        assert!(!metrics.to_string().contains("private-generation"));
        assert!(!traces.to_string().contains("private-generation"));
    }
}
