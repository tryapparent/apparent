use super::*;
use super::super::sparkle_outcomes::SparkleError;
use std::net::TcpListener;

#[test]
fn sparkle_download_cause_crosses_the_consented_reporter_as_typed_data() {
    let scratch = Scratch::new();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let endpoint = format!("http://{}/i/v0/e/", listener.local_addr().unwrap());
    let server = std::thread::spawn(move || {
        let mut stream = accept(&listener);
        let payload = request(&mut stream);
        stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").unwrap();
        payload
    });
    let reporter = Reporter::start(scratch.config(), "phc_synthetic".into(), endpoint).unwrap();
    let baseline = updates::Diagnostics::sparkle(SparkleError::new("SUSparkleErrorDomain", 2001), None);
    let diagnostics = updates::Diagnostics::sparkle(
        SparkleError::new("SUSparkleErrorDomain", 2001), Some(SparkleError::new("NSURLErrorDomain", -1001)),
    );
    let unknown = updates::Diagnostics::sparkle(
        SparkleError::new("SUSparkleErrorDomain", 2001), Some(SparkleError::new("private-domain-canary", 42)),
    );
    assert_eq!(baseline.fingerprint(), diagnostics.fingerprint());
    assert!(serde_json::to_value(&baseline).unwrap().get("sparkle_cause").is_none());
    assert_eq!(serde_json::to_value(&unknown).unwrap()["sparkle_cause"]["domain"], "other");
    assert!(!serde_json::to_string(&unknown).unwrap().contains("private-domain-canary"));
    reporter.enqueue(|consent| {
        let mut report = Report::new(Failure::UpdateCheck, std::panic::Location::caller(), consent);
        report.updater = Some(diagnostics);
        report
    });
    let payload = server.join().unwrap();
    assert_eq!(payload["properties"]["updater"]["sparkle_cause"], serde_json::json!({"domain": "url_loading", "code": -1001}));
    assert_eq!(payload["properties"]["updater"]["sparkle_code"], 2001);
    assert_eq!(payload["properties"]["$exception_list"][0]["type"], "update_sparkle_failed");
}

#[test]
fn updater_projection_bounds_provenance_and_never_sends_arbitrary_release_or_domain_text() {
    use updates::{Diagnose, Stage, Trigger};
    let installed = ("private-channel-canary".into(), "private-fork-canary".into());
    let mut attempt = updates::Attempt::default();
    attempt.selected("main", Some(&installed));
    attempt.candidate("private-channel-canary", "private-target-canary", Some(&installed), "private-compiled-canary");
    let mut error = anyhow::anyhow!("private-error-canary");
    for _ in 0..100 { error = Err::<(), _>(error).stage(Stage::Policy).unwrap_err(); }
    let payload = Report::update(&updates::attempted(error, attempt), Trigger::User, std::panic::Location::caller(), Consent {generation: "private-consent-canary".into()}).payload("phc_synthetic").unwrap();
    assert_eq!(payload["properties"]["updater"]["stages"].as_array().unwrap().len(), 8);
    assert_eq!(payload["properties"]["updater"]["attempt"]["candidate_channel"], "unknown");
    assert!(payload["properties"]["updater"]["attempt"]["candidate_id"].is_null());
    assert!(!payload.to_string().contains("private-"));
    for (domain, expected) in [("SUSparkleErrorDomain", "sparkle"), ("NSURLErrorDomain", "url_loading"), ("private-domain-canary", "other")] {
        let mut report = Report::new(Failure::UpdateCheck, std::panic::Location::caller(), Consent {generation:"initial".into()});
        report.updater = Some(updates::Diagnostics::sparkle(SparkleError::new(domain, -1009), None));
        let payload = report.payload("phc_synthetic").unwrap();
        assert_eq!(payload["properties"]["updater"]["sparkle_domain"], expected);
        assert_eq!(payload["properties"]["updater"]["sparkle_code"], -1009);
        assert_eq!(payload["properties"]["$exception_list"][0]["type"], "update_sparkle_failed");
        assert!(!payload.to_string().contains("private-"));
    }
}
