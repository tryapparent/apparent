//! Exercise the public upload command's output boundary in an isolated process.
use super::*;
use std::os::unix::fs::PermissionsExt;

const CHILD: &str = "APPARENT_TEST_HOSTED_LOGGING";
const SENTINEL: &str = "SENSITIVE_HOSTED_LOGGING_SENTINEL";

#[test]
fn hosted_upload_logging_child() {
    let Some(bundle) = std::env::var_os(CHILD) else {
        return;
    };
    crate::handoff::enable_experiment(HOSTED_SYNC);
    let bundle = PathBuf::from(bundle);
    // Establish fixture sensitivity at the unchanged, pre-redaction boundary.
    // A generic earlier trust failure must not make the output test pass.
    let raw = crate::handoff::resolve_bundle_dir(&bundle)
        .and_then(|bundle| Client::default().enqueue_explicit(&bundle));
    let error = match raw {
        Err(error) => error,
        Ok(_) => panic!("logging fixture unexpectedly admitted a capture"),
    };
    assert!(
        format!("{error:?}").contains(SENTINEL),
        "logging fixture did not reach a sensitive failure"
    );
    // Match main's anyhow error reporting, including the entire source chain.
    if let Err(error) = command(ConnectCommand::Upload { bundle }) {
        eprintln!("Error: {error:?}");
    }
}

#[test]
fn hosted_upload_logging_omits_sensitive_paths_and_error_contents() {
    let root = std::env::temp_dir().join(format!("hosted-logging-{}", random_id().unwrap()));
    fs::DirBuilder::new().mode(0o700).create(&root).unwrap();
    // Darwin's temporary-directory aliases must not trigger the symlink guard
    // before this fixture reaches its deliberately malformed credential.
    let root = root.canonicalize().unwrap();
    struct Cleanup(PathBuf);
    impl Drop for Cleanup {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    let _cleanup = Cleanup(root.clone());
    let config = root.join("config.json");
    fs::write(
        &config,
        serde_json::to_vec(&json!({
            "cloud": {"enabled": true, "uploadConsent": true,
                      "server": "https://example.invalid"}
        }))
        .unwrap(),
    )
    .unwrap();
    let bundle = root.join(format!("{SENTINEL}.apparent"));
    fs::DirBuilder::new().mode(0o700).create(&bundle).unwrap();
    fs::write(bundle.join("apparent.json"), b"{}").unwrap();
    let state = root.join("hosted");
    fs::DirBuilder::new().mode(0o700).create(&state).unwrap();
    let credential = state.join("upload.credential");
    // A syntactically valid JSON string yields a serde diagnostic containing
    // its contents when the production credential reader expects a struct.
    fs::write(&credential, serde_json::to_vec(SENTINEL).unwrap()).unwrap();
    fs::set_permissions(&credential, fs::Permissions::from_mode(0o600)).unwrap();

    for (input, classification) in [
        (bundle.clone(), "queue_unavailable"),
        (
            root.join(format!("missing-{SENTINEL}.apparent")),
            "invalid_bundle",
        ),
    ] {
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "hosted::logging_tests::hosted_upload_logging_child",
                "--nocapture",
            ])
            .env(CHILD, input)
            .env("APPARENT_CONFIG", &config)
            .output()
            .unwrap();
        assert!(output.status.success());
        let stdout = String::from_utf8(output.stdout).unwrap();
        let stderr = String::from_utf8(output.stderr).unwrap();
        assert!(!stdout.contains(SENTINEL), "sensitive stdout");
        assert!(!stderr.contains(SENTINEL), "sensitive stderr");
        assert!(
            stderr.contains(classification),
            "missing diagnostic classification"
        );
        assert!(
            !stdout.contains("Queued hosted capture"),
            "false success acknowledgement"
        );
        assert!(
            !fs::read_dir(&state).unwrap().any(|entry| {
                entry
                    .unwrap()
                    .path()
                    .extension()
                    .is_some_and(|ext| ext == "job")
            }),
            "failed admission published a job"
        );
    }
}
