use super::*;

#[test]
fn startup_reports_completed_stages_with_first_observations_only() {
    let startup = Startup::default();
    let origin = Instant::now();
    let at = |millis| origin + std::time::Duration::from_millis(millis);
    startup.record_at(ContextReady, origin);
    startup.record_at(TracksEnter, at(20));
    startup.record_at(TracksEnter, at(90));
    startup.record_at(TracksReturn, at(40));
    startup.record_at(PillRequested, at(35));
    startup.record_at(NotesReady, at(41));
    let stages = startup.stages(origin, 1_000_000_000);
    assert_eq!(stages.len(), 2);
    assert_eq!(stages[0].name, "recording.start.prepare");
    assert_eq!((stages[0].start, stages[0].end), (1_000_000_000, 1_020_000_000));
    assert_eq!(stages[1].name, "recording.start.notes_and_publish");
    assert_eq!((stages[1].start, stages[1].end), (1_040_000_000, 1_041_000_000));
}

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
        startup: vec![Timing {
            name: "recording.start.pill_acknowledge",
            start: 1_250_000_000,
            end: 1_600_000_000,
        }],
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
    assert_eq!(spans[3]["traceId"], spans[0]["traceId"]);
    assert_eq!(spans[3]["name"], "recording.start.timeline");
    assert_eq!(spans[0]["parentSpanId"], spans[3]["spanId"]);
    assert_eq!(spans[4]["parentSpanId"], spans[3]["spanId"]);
    assert_eq!(spans[4]["name"], "recording.start.pill_acknowledge");
    assert_eq!(spans[3]["endTimeUnixNano"], "1600000000");
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

#[test]
fn concurrent_start_spans_keep_worker_and_red_pill_clocks_separate() {
    use std::time::Duration;

    let startup = Startup::default();
    let origin = Instant::now();
    for (point, ms) in [
        (PortalSelect, 2),
        (PortalSourcesSelected, 12),
        (PortalStart, 32),
        (VideoDispatch, 33),
        (VideoDispatched, 35),
        (AudioBegin, 35),
        (AudioReady, 51),
        (VideoBuild, 65),
        (VideoFirstFrame, 92),
        (FirstCandidate, 96),
        (ScreenReadyObserved, 100),
        (RedPillFlushed, 105),
        (RedPillReported, 112),
    ] {
        startup.record_at(point, origin + Duration::from_millis(ms));
    }
    let spans = startup.stages(origin, 0);
    let range = |name| {
        let span = spans.iter().find(|span| span.name == name).unwrap();
        (span.start / 1_000_000, span.end / 1_000_000)
    };
    assert_eq!(range("recording.start.portal_select_sources"), (2, 12));
    assert_eq!(range("recording.start.portal_storage_gate"), (12, 32));
    assert_eq!(range("recording.start.video_dispatch"), (33, 35));
    assert_eq!(range("recording.start.audio_setup"), (35, 51));
    assert_eq!(range("recording.start.video_first_frame"), (65, 92));
    assert_eq!(range("recording.start.first_candidate"), (65, 96));
    assert_eq!(range("recording.start.candidate_to_coordinator"), (96, 100));
    assert_eq!(range("recording.start.red_pill_acknowledge"), (105, 112));
}
