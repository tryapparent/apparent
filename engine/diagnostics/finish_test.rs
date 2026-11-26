use super::*;

#[test]
fn finalization_report_identifies_real_empty_frame_failure_without_private_content() {
    use crate::capture::engine::runtime::recording::diagnostics::{
        Stage, sampling::{Rejection, Route, Sampling}, with_sampling,
    };

    let scratch = Scratch::new();
    let movie = scratch.0.join("private-recording-canary.mp4");
    std::fs::write(&movie, b"synthetic movie").unwrap();
    let target = serde_json::from_value(json!({"mode":"display","displayId":0,"frame":{"x":0,"y":0,"width":32,"height":32,"scale":1}})).unwrap();
    let finalized = crate::capture::engine::bundle::bundle_processing::finalize_capture_bundle(
        &scratch.0, target,
        crate::capture::engine::runtime::ScreenRecording {
            frames: vec![], video: Some(movie),
            duration_ms: 100, video_offset_ms: 0, video_ink: None,
        }, vec![], vec![], None, None, Default::default(), None,
    );
    let sampling = Sampling {
        route: Route::Screenshot,
        last_rejection: Some(Rejection::PrivacyPrompt),
    };
    let error = with_sampling(finalized, Stage::Publication, Some(sampling)).unwrap_err();
    assert!(error.to_string().contains("private-recording-canary.mp4"));
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let endpoint = format!("http://{}/i/v0/e/", listener.local_addr().unwrap());
    let server = std::thread::spawn(move || {
        let mut stream = accept(&listener);
        let payload = request(&mut stream);
        stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").unwrap();
        payload
    });
    let reporter = Reporter::start(scratch.config(), "phc_synthetic".into(), endpoint).unwrap();
    reporter.enqueue(|consent| Report::finalization(&error, std::panic::Location::caller(), consent));
    let payload = server.join().unwrap();
    assert_eq!(payload["properties"]["finalization"]["screen_sampling"], json!({
        "route": "screenshot",
        "last_rejection": "privacy_prompt",
    }));
    let stages = payload["properties"]["finalization"]["stages"].as_array().expect("structured finalization stages");
    assert!(stages.iter().any(|frame| frame["stage"] == "no_safe_frames"));
    assert!(stages.iter().any(|frame| frame["file"] == "capture/engine/bundle/bundle_processing.rs" && frame["line"].as_u64().unwrap() > 0));
    let serialized = payload.to_string();
    for private in ["private-recording-canary", "synthetic movie", scratch.0.to_str().unwrap(), "No screen frames were captured"] {
        assert!(!serialized.contains(private), "leaked {private}");
    }
}

#[test]
fn finalization_notes_report_projects_timeout_disconnect_and_refusal_without_private_data() {
    use crate::capture::desktop::workflow::notes::{FinishFailure, FinishResult};
    use crate::capture::engine::runtime::recording::diagnostics::{Diagnose, Stage};
    use std::time::Duration;

    let (sender, receiver) = flume::bounded::<FinishResult>(1);
    let timeout = FinishFailure::from(receiver.recv_timeout(Duration::ZERO).unwrap_err());
    drop(sender);
    let disconnected = FinishFailure::from(receiver.recv_timeout(Duration::ZERO).unwrap_err());
    let refused = FinishFailure::Refused {
        ready: true,
        admitted: true,
        startup_protocol_failed: false,
        drained: false,
        failed_writes: false,
        transport_failed: true,
        startup_exit: false,
    };
    for (failure, expected) in [
        (timeout, json!({"kind": "timed_out"})),
        (disconnected, json!({"kind": "disconnected"})),
        (refused, json!({
            "kind": "refused",
            "ready": true,
            "admitted": true,
            "startup_protocol_failed": false,
            "drained": false,
            "failed_writes": false,
            "transport_failed": true,
            "startup_exit": false,
        })),
    ] {
        let error = Err::<(), _>(anyhow::Error::new(failure).context("private-note-canary"))
            .stage(Stage::NotesReceipt)
            .stage(Stage::Publication)
            .unwrap_err();
        let report = Report::finalization(
            &error,
            std::panic::Location::caller(),
            Consent { generation: "private-consent-canary".into() },
        );
        let payload = report.payload("phc_synthetic").unwrap();
        let diagnostics = &payload["properties"]["finalization"];
        assert_eq!(diagnostics["notes_receipt"], expected);
        assert_eq!(diagnostics["stages"][1]["stage"], "notes_receipt");
        assert!(!payload.to_string().contains("private-"));
    }
}
