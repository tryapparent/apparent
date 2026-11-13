#[cfg(test)]
use super::*;
use std::net::{TcpListener, TcpStream};

#[test]
fn finalization_audio_report_identifies_real_writer_backlog_and_retains_saved_bytes() {
    use crate::capture::engine::runtime::{audio::persistence::{Lease, Samples, Writer}, recording::diagnostics::{Diagnose, Stage}};
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};

    let scratch = Scratch::new();
    // No microphone: admit more than the existing two-second writer limit in
    // one batch, so the real writer must fail before Stop rather than race it.
    let samples = Arc::new(Mutex::new(Samples::from(vec![0.25; 48_000])));
    let failure = Arc::new(Mutex::new(None));
    let mut writer = Writer::start(&scratch.0, samples, failure.clone()).unwrap();
    let saved = std::fs::read(scratch.0.join("audio.wav")).unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    while failure.lock().unwrap().is_none() {
        assert!(Instant::now() < deadline, "writer did not report its backlog failure");
        std::thread::sleep(Duration::from_millis(5));
    }
    let error = writer.finish().stage(Stage::AudioStop).unwrap_err();
    assert_eq!(std::fs::read(scratch.0.join("audio.wav")).unwrap(), saved);
    assert!(Lease::acquire(&scratch.0).is_err(), "failed Stop must retain narration ownership");
    let payload = Report::finalization(&error, std::panic::Location::caller(), Consent { generation: "private-audio-consent".into() }).payload("phc_synthetic").unwrap();
    assert_eq!(payload["properties"]["diagnostics_schema_version"], 3);
    let stages = payload["properties"]["finalization"]["stages"].as_array().unwrap();
    assert_eq!(stages.last().unwrap()["stage"], "audio_writer_backlog");
    assert!(payload["properties"]["$exception_fingerprint"].as_str().unwrap().contains("AudioWriterBacklog"));
    for private in [scratch.0.to_str().unwrap(), "private-audio-consent", "Narration disk writer fell"] {
        assert!(!payload.to_string().contains(private), "leaked {private}");
    }
    drop(writer);
    assert!(Lease::acquire(&scratch.0).is_ok(), "writer teardown must release its lease");
}

#[test]
fn finalization_audio_report_classifies_real_wav_failures_without_error_text() {
    use crate::capture::engine::runtime::audio::audio::decode_wav_16k;
    for (bytes, expected_kind, expected_io) in [
        (&b"private-wav-canary"[..], "format", Value::Null),
        // hound 3.5 reports a short read as ErrorKind::Other, not UnexpectedEof.
        (&b"RIFF"[..], "io", json!("other")),
    ] {
        let error = decode_wav_16k(bytes).unwrap_err();
        let payload = Report::finalization(&error, std::panic::Location::caller(), Consent { generation: "initial".into() }).payload("phc_synthetic").unwrap();
        let diagnostics = &payload["properties"]["finalization"];
        assert_eq!(diagnostics["wav_error_kind"], expected_kind);
        assert_eq!(diagnostics["io_kind"], expected_io);
        assert_eq!(diagnostics["stages"].as_array().unwrap().last().unwrap()["stage"], "audio_wav_read");
        assert!(!payload.to_string().contains("private-wav-canary"));
        assert!(!payload.to_string().contains(&error.to_string()));
    }

    // A valid WAV with an unsupported capture spec is a different native
    // invariant from malformed WAV data; the original bytes remain untouched.
    let mut wav = std::io::Cursor::new(Vec::new());
    hound::WavWriter::new(&mut wav, hound::WavSpec {
        channels: 2, sample_rate: 48_000, bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    }).unwrap().finalize().unwrap();
    let error = decode_wav_16k(wav.get_ref()).unwrap_err();
    let payload = Report::finalization(&error, std::panic::Location::caller(), Consent { generation: "initial".into() }).payload("phc_synthetic").unwrap();
    let diagnostics = &payload["properties"]["finalization"];
    assert_eq!(diagnostics["stages"].as_array().unwrap().last().unwrap()["stage"], "audio_wav_format");
    assert!(diagnostics["wav_error_kind"].is_null());
    assert!(diagnostics["io_kind"].is_null());
}

#[test]
fn finalization_audio_report_projects_wav_variants_and_wrapped_os_errors_without_formatting() {
    for (error, expected) in [
        (hound::Error::FormatError("private-format-canary"), "format"),
        (hound::Error::Unsupported, "unsupported"),
        (hound::Error::TooWide, "too_wide"),
        (hound::Error::UnfinishedSample, "unfinished_sample"),
        (hound::Error::InvalidSampleFormat, "invalid_sample_format"),
        (hound::Error::IoError(std::io::Error::from_raw_os_error(libc::ENOSPC)), "io"),
    ] {
        let payload = Report::finalization(&anyhow::Error::new(error), std::panic::Location::caller(), Consent { generation: "initial".into() }).payload("phc_synthetic").unwrap();
        let diagnostics = &payload["properties"]["finalization"];
        assert_eq!(diagnostics["wav_error_kind"], expected);
        if expected == "io" {
            assert_eq!(diagnostics["io_kind"], "storage_full");
            assert_eq!(diagnostics["os_error_code"], libc::ENOSPC);
        }
        assert!(!payload.to_string().contains("private-format-canary"));
    }
}

#[test]
fn finalization_report_identifies_real_empty_frame_failure_without_private_content() {
    let scratch = Scratch::new();
    let target = serde_json::from_value(json!({"mode":"display","displayId":0,"frame":{"x":0,"y":0,"width":32,"height":32,"scale":1}})).unwrap();
    let error = crate::capture::engine::bundle::bundle_processing::finalize_capture_bundle(
        &scratch.0, target,
        crate::capture::engine::runtime::ScreenRecording {
            frames: vec![], video: Some(scratch.0.join("private-recording-canary.mp4")),
            duration_ms: 100, video_offset_ms: 0, video_ink: None,
        }, vec![], vec![], None, None, Default::default(), None,
    ).unwrap_err();
    let report = Report::finalization(&error, std::panic::Location::caller(), Consent { generation: "private-generation-canary".into() });
    let payload = report.payload("phc_synthetic").unwrap();
    let stages = payload["properties"]["finalization"]["stages"].as_array().expect("structured finalization stages");
    assert!(stages.iter().any(|frame| frame["stage"] == "no_safe_frames"));
    assert!(stages.iter().any(|frame| frame["file"] == "capture/engine/bundle/bundle_processing.rs" && frame["line"].as_u64().unwrap() > 0));
    let serialized = payload.to_string();
    for private in ["private-recording-canary", "private-generation-canary", scratch.0.to_str().unwrap(), "No screen frames were captured"] {
        assert!(!serialized.contains(private), "leaked {private}");
    }
}

#[test]
fn finalization_bounds_provenance_keeps_specific_cause_and_does_not_format_unknown_errors() {
    use crate::capture::engine::runtime::recording::diagnostics::{at, Stage};
    struct PrivateError;
    impl std::fmt::Debug for PrivateError {
        fn fmt(&self, _: &mut std::fmt::Formatter<'_>) -> std::fmt::Result { panic!("must never debug private error") }
    }
    impl std::fmt::Display for PrivateError {
        fn fmt(&self, _: &mut std::fmt::Formatter<'_>) -> std::fmt::Result { panic!("must never format private error") }
    }
    impl std::error::Error for PrivateError {}
    let mut result: anyhow::Result<()> = at(Err(anyhow::Error::new(PrivateError)), Stage::NoSafeFrames);
    for _ in 0..16 { result = at(result, Stage::Publication); }
    let report = Report::finalization(&result.unwrap_err(), std::panic::Location::caller(), Consent { generation: "initial".into() });
    let payload = report.payload("phc_synthetic").unwrap();
    let diagnostics = &payload["properties"]["finalization"];
    assert_eq!(diagnostics["stages"].as_array().unwrap().len(), 8);
    assert_eq!(diagnostics["stages"][7]["stage"], "no_safe_frames");
    assert!(diagnostics["io_kind"].is_null());
    let unknown = Report::finalization(&anyhow::Error::new(PrivateError), std::panic::Location::caller(), Consent { generation: "initial".into() }).payload("phc_synthetic").unwrap();
    assert_eq!(unknown["properties"]["finalization"]["stages"], json!([]));
    assert_ne!(payload["properties"]["$exception_fingerprint"], unknown["properties"]["$exception_fingerprint"]);
}

#[test]
fn development_children_cannot_inherit_a_production_reporting_marker() {
    let mut command = Command::new("unused");
    command.env("APPARENT_DESKTOP_REPORTING", "1");
    configure_child(&mut command);
    assert_eq!(command.get_envs().find(|(key, _)| *key == "APPARENT_DESKTOP_REPORTING").unwrap().1.unwrap(), "0");
}

#[test]
fn electron_failures_are_content_free_unhandled_and_attributed_to_the_child() {
    for (failure, process) in [
        (Failure::ElectronMainException, "electron-main"),
        (Failure::ElectronMainRejection, "electron-main"),
        (Failure::ElectronRendererGone, "electron-renderer"),
        (Failure::ElectronChildGone, "electron-child"),
    ] {
        let report = Report::new(failure, std::panic::Location::caller(), Consent { generation: "private-generation".into() });
        let payload = report.payload("phc_synthetic").unwrap();
        assert_eq!(payload["properties"]["process"], process);
        assert_eq!(payload["properties"]["$exception_list"][0]["mechanism"]["handled"], false);
        assert_eq!(payload["properties"]["operation"], failure.code());
        assert!(!payload.to_string().contains("private-generation"));
    }
}

struct Scratch(PathBuf);
impl Scratch {
    fn new() -> Self {
        use std::os::unix::fs::DirBuilderExt;
        let path = std::env::temp_dir().join(format!(
            "apparent-errors-{}",
            crate::shared::ids::make_bundle_id()
        ));
        std::fs::DirBuilder::new()
            .mode(0o700)
            .create(&path)
            .unwrap();
        Self(path)
    }
    fn config(&self) -> PathBuf {
        self.0.join("config.json")
    }
}
impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[test]
fn consent_defaults_on_but_corrupt_or_unreadable_config_never_enables_reporting() {
    let scratch = Scratch::new();
    let path = scratch.config();
    assert!(enabled_in(&path));
    for invalid in [
        "{",
        "[]",
        "null",
        r#"{"errorReporting":"true"}"#,
        r#"{"errorReporting":false}"#,
        r#"{"errorReportingGeneration":3}"#,
    ] {
        std::fs::write(&path, invalid).unwrap();
        assert!(!enabled_in(&path), "{invalid}");
    }
    std::fs::write(&path, " ".repeat(65_537)).unwrap();
    assert!(!enabled_in(&path));
    std::fs::remove_file(&path).unwrap();
    std::fs::create_dir(&path).unwrap();
    assert!(!enabled_in(&path));
    std::fs::remove_dir(&path).unwrap();
    std::os::unix::fs::symlink(scratch.0.join("missing"), &path).unwrap();
    assert!(!enabled_in(&path));
}

#[test]
fn narrow_settings_bridge_reads_default_and_persists_explicit_changes_without_dropping_keys() {
    let scratch = Scratch::new();
    let path = scratch.config();
    assert_eq!(error_reporting_bridge_in(&path, "read", None, || true), Ok(true));
    std::fs::write(&path, r#"{"sentinel":"keep"}"#).unwrap();
    assert_eq!(error_reporting_bridge_in(&path, "set", Some(false), || true), Ok(false));
    let saved: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    assert_eq!(saved["sentinel"], "keep");
    assert_eq!(saved["errorReporting"], false);
    assert_eq!(error_reporting_bridge_in(&path, "read", None, || true), Ok(false));
    assert_eq!(error_reporting_bridge_in(&path, "set", Some(true), || true), Ok(true));
    assert_eq!(error_reporting_bridge_in(&path, "unknown", None, || true), Err("invalid_request"));
    let before = std::fs::read(&path).unwrap();
    assert_eq!(error_reporting_bridge_in(&path, "set", Some(false), || false), Err("admission_expired"));
    assert_eq!(std::fs::read(&path).unwrap(), before);
    std::fs::write(&path, "malformed").unwrap();
    assert_eq!(error_reporting_bridge_in(&path, "read", None, || true), Err("config_read_failed"));
    assert_eq!(error_reporting_bridge_in(&path, "set", Some(true), || true), Err("config_write_failed"));
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "malformed");
}

#[test]
fn disable_reenable_rotates_consent_and_preserves_unrelated_preferences() {
    use std::os::unix::fs::PermissionsExt;
    let scratch = Scratch::new();
    let path = scratch.config();
    std::fs::write(
        &path,
        r#"{"unknown":{"keep":true},"token":"synthetic-private-canary"}"#,
    )
    .unwrap();
    let original = consent_in(&path).unwrap();
    set_enabled_in(&path, false).unwrap();
    assert!(!enabled_in(&path));
    set_enabled_in(&path, true).unwrap();
    assert_ne!(
        consent_in(&path).unwrap(),
        original,
        "old queued reports must not revive"
    );
    let config: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    assert_eq!(config["unknown"]["keep"], true);
    assert_eq!(config["token"], "synthetic-private-canary");
    assert_eq!(
        std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
        0o600
    );
    std::fs::write(&path, "broken").unwrap();
    assert!(set_enabled_in(&path, true).is_err());
    assert_eq!(std::fs::read_to_string(&path).unwrap(), "broken");
}

#[test]
fn exception_names_identify_each_category_without_changing_fingerprints() {
    for (failure, expected_type) in [
        (Failure::ProtectRecording, "recording_storage_failed"),
        (Failure::AudioStart, "audio_start_failed"),
        (Failure::ScreenStart, "screen_start_failed"),
        (Failure::PhoneStart, "phone_start_failed"),
        (Failure::FinalizeCapture, "capture_finalization_failed"),
        (Failure::VideoExport, "video_export_failed"),
        (Failure::ElectronMainException, "electron_main_exception"),
        (Failure::ElectronMainRejection, "electron_main_rejection"),
        (Failure::ElectronRendererGone, "electron_renderer_gone"),
        (Failure::ElectronChildGone, "electron_child_gone"),
        (Failure::RustPanic, "RustPanic"),
    ] {
        let report = Report {
            finalization: None,
            failure,
            file: Some("capture/desktop/mod.rs".into()),
            line: 42,
            consent: Consent { generation: "private-generation".into() },
            delivered: None,
        };
        let payload = report.payload("phc_synthetic").unwrap();
        let properties = &payload["properties"];
        let code = if expected_type == "RustPanic" { "rust_panic" } else { expected_type };
        assert_eq!(properties["$exception_list"][0]["type"], expected_type);
        assert_eq!(properties["$exception_list"][0]["value"], code);
        assert_eq!(properties["operation"], code);
        assert_eq!(properties["$exception_fingerprint"], format!("desktop:{code}:capture/desktop/mod.rs:42"));
        assert!(!payload.to_string().contains("private-generation"));
    }
}

#[test]
fn payload_is_allowlisted_with_no_user_or_error_text() {
    let consent = Consent {
        generation: "private-consent-canary".into(),
    };
    let report = Report::new(
        Failure::FinalizeCapture,
        std::panic::Location::caller(),
        consent,
    );
    let payload = report.payload("phc_synthetic_public_token").unwrap();
    assert_eq!(payload["event"], "$exception");
    assert_eq!(
        payload["properties"]["operation"],
        "capture_finalization_failed"
    );
    assert_eq!(
        payload["properties"]["$exception_list"][0]["stacktrace"]["frames"][0]["platform"],
        "native"
    );
    assert_eq!(payload["properties"]["$process_person_profile"], false);
    assert_eq!(payload["properties"]["$geoip_disable"], true);
    assert!(payload["properties"]["$ip"].is_null());
    let mut keys: Vec<_> = payload["properties"]
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    keys.sort();
    let mut allowed = vec![
        "$process_person_profile",
        "$geoip_disable",
        "$ip",
        "$lib",
        "$app_version",
        "build",
        "commit_sha",
        "build_modified",
        "release_version",
        "package_version",
        "channel",
        "environment",
        "component",
        "process",
        "diagnostics_schema_version",
        "$os",
        "architecture",
        "operation",
        "$exception_level",
        "$exception_fingerprint",
        "$exception_list",
    ];
    if !env!("APPARENT_POSTHOG_RELEASE_ID").is_empty() {
        allowed.push("$release_id");
        assert_eq!(payload["properties"]["$release_id"], env!("APPARENT_POSTHOG_RELEASE_ID"));
    } else {
        assert!(payload["properties"].get("$release_id").is_none());
    }
    allowed.sort();
    assert_eq!(keys, allowed);
    assert_eq!(payload["properties"]["commit_sha"], env!("APPARENT_COMMIT_SHA"));
    assert_eq!(payload["properties"]["release_version"], env!("APPARENT_RELEASE_VERSION"));
    assert_eq!(payload["properties"]["build_modified"], env!("APPARENT_BUILD_MODIFIED") == "true");
    assert!(!payload.to_string().contains("private-consent-canary"));
    assert_ne!(
        payload["distinct_id"],
        report.payload("phc_synthetic_public_token").unwrap()["distinct_id"]
    );
    assert_eq!(source_file("/home/private/customer.rs"), None);
    assert_eq!(source_file("capture/../../private.rs"), None);
    assert_eq!(source_file("capture/private\nsecret.rs"), None);
    assert_eq!(
        source_file("capture/desktop/mod.rs").as_deref(),
        Some("capture/desktop/mod.rs")
    );
}

fn request(stream: &mut TcpStream) -> Value {
    stream
        .set_read_timeout(Some(Duration::from_secs(4)))
        .unwrap();
    let mut bytes = Vec::new();
    let mut chunk = [0; 4096];
    loop {
        let n = stream.read(&mut chunk).unwrap();
        assert!(n > 0);
        bytes.extend_from_slice(&chunk[..n]);
        if let Some(end) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
            let headers = String::from_utf8_lossy(&bytes[..end]);
            assert!(headers.starts_with("POST /i/v0/e/ HTTP/1.1"));
            let length: usize = headers
                .lines()
                .find_map(|line| {
                    line.to_ascii_lowercase()
                        .strip_prefix("content-length: ")
                        .map(str::to_owned)
                })
                .unwrap()
                .parse()
                .unwrap();
            if bytes.len() >= end + 4 + length {
                return serde_json::from_slice(&bytes[end + 4..end + 4 + length]).unwrap();
            }
        }
    }
}

fn accept(listener: &TcpListener) -> TcpStream {
    listener.set_nonblocking(true).unwrap();
    let deadline = Instant::now() + Duration::from_secs(4);
    loop {
        match listener.accept() {
            Ok((stream, _)) => {
                stream.set_nonblocking(false).unwrap();
                return stream;
            }
            Err(error)
                if error.kind() == std::io::ErrorKind::WouldBlock && Instant::now() < deadline =>
            {
                std::thread::sleep(Duration::from_millis(10))
            }
            Err(error) => panic!("synthetic receiver failed: {error}"),
        }
    }
}

#[test]
fn real_curl_transport_posts_the_exception_and_never_follows_redirects() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let endpoint = format!("http://{}/i/v0/e/", listener.local_addr().unwrap());
    let server = std::thread::spawn(move || {
        let mut stream = accept(&listener);
        let payload = request(&mut stream);
        stream.write_all(b"HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:1/forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").unwrap();
        payload
    });
    use crate::capture::engine::runtime::recording::diagnostics::{at, Stage};
    let error = at::<()>(Err(std::io::Error::from_raw_os_error(libc::ENOSPC).into()), Stage::PublicationSync).unwrap_err();
    let original = error.to_string();
    assert_eq!(original, std::io::Error::from_raw_os_error(libc::ENOSPC).to_string());
    let report = Report::finalization(
        &error,
        std::panic::Location::caller(),
        Consent {
            generation: "initial".into(),
        },
    );
    let payload = report.payload("phc_synthetic_public_token").unwrap();
    assert_eq!(payload["properties"]["finalization"]["io_kind"], "storage_full");
    assert_eq!(payload["properties"]["finalization"]["os_error_code"], libc::ENOSPC);
    assert!(send(&endpoint, &payload).unwrap());
    assert_eq!(server.join().unwrap(), payload);
}

#[test]
fn worker_drops_pre_optout_reports_even_after_reenable() {
    let scratch = Scratch::new();
    let path = scratch.config();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let endpoint = format!("http://{}/i/v0/e/", listener.local_addr().unwrap());
    let (entered_tx, entered_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let server = std::thread::spawn(move || {
        let mut stream = accept(&listener);
        let first = request(&mut stream);
        entered_tx.send(()).unwrap();
        release_rx.recv_timeout(Duration::from_secs(4)).unwrap();
        stream
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            .unwrap();
        let mut stream = accept(&listener);
        let second = request(&mut stream);
        stream
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            .unwrap();
        (first, second)
    });
    let reporter =
        Reporter::start(path.clone(), "phc_synthetic_public_token".into(), endpoint).unwrap();
    reporter.capture(Failure::ScreenStart, std::panic::Location::caller());
    entered_rx.recv_timeout(Duration::from_secs(4)).unwrap();
    reporter.capture(Failure::AudioStart, std::panic::Location::caller());
    set_enabled_in(&path, false).unwrap();
    reporter.capture(Failure::PhoneStart, std::panic::Location::caller());
    set_enabled_in(&path, true).unwrap();
    reporter.capture(Failure::VideoExport, std::panic::Location::caller());
    release_tx.send(()).unwrap();
    let (first, second) = server.join().unwrap();
    assert_eq!(first["properties"]["operation"], "screen_start_failed");
    assert_eq!(second["properties"]["operation"], "video_export_failed");
}

#[test]
fn burst_protection_is_bounded_and_recovers_after_one_minute() {
    let now = Instant::now();
    let mut limiter = Limiter::default();
    for _ in 0..20 {
        assert!(limiter.admit(now));
    }
    assert!(!limiter.admit(now + Duration::from_secs(59)));
    assert!(limiter.admit(now + Duration::from_secs(60)));
}

#[test]
fn panic_hook_child() {
    let Some(path) = std::env::var_os("APPARENT_ERROR_TEST_CONFIG") else {
        return;
    };
    let endpoint = std::env::var("APPARENT_ERROR_TEST_ENDPOINT").unwrap();
    std::panic::set_hook(Box::new(|_| eprintln!("previous-hook-ran")));
    install_reporter(
        Reporter::start(path.into(), "phc_synthetic_public_token".into(), endpoint).unwrap(),
    );
    panic!("synthetic-private-panic-canary");
}

#[test]
fn real_panic_hook_flushes_sanitized_event_chains_hook_and_respects_optout() {
    for on in [true, false] {
        let scratch = Scratch::new();
        set_enabled_in(&scratch.config(), on).unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let endpoint = format!("http://{}/i/v0/e/", listener.local_addr().unwrap());
        let denied_listener = (!on).then(|| listener.try_clone().unwrap());
        let server = if on {
            Some(std::thread::spawn(move || {
                let mut stream = accept(&listener);
                let payload = request(&mut stream);
                stream
                    .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                    .unwrap();
                payload
            }))
        } else {
            listener.set_nonblocking(true).unwrap();
            // Keep this listener alive until the child has exited, so a report
            // would leave an observable accepted connection, not a refused port.
            None
        };
        let started = Instant::now();
        let output = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "capture::desktop::workflow::error_reporting::tests::panic_hook_child",
                "--nocapture",
            ])
            .env("APPARENT_ERROR_TEST_CONFIG", scratch.config())
            .env("APPARENT_ERROR_TEST_ENDPOINT", endpoint)
            .stdin(Stdio::null())
            .output()
            .unwrap();
        assert!(!output.status.success());
        assert!(started.elapsed() < Duration::from_secs(4));
        assert!(String::from_utf8_lossy(&output.stderr).contains("previous-hook-ran"));
        if let Some(listener) = denied_listener {
            assert_eq!(
                listener.accept().unwrap_err().kind(),
                std::io::ErrorKind::WouldBlock
            );
        }
        if let Some(server) = server {
            let payload = server.join().unwrap();
            assert_eq!(payload["properties"]["operation"], "rust_panic");
            assert!(
                !payload
                    .to_string()
                    .contains("synthetic-private-panic-canary")
            );
            assert_eq!(
                payload["properties"]["$exception_list"][0]["mechanism"]["handled"],
                false
            );
        }
    }
}
