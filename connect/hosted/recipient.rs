//! Staged package adapter. Production routing remains on the existing client until
//! packaging supplies an authenticated manifest and pins the published digest.
use anyhow::{Context, Result, ensure};
use apparent_connect_client::recipient_protocol::Request;
use sha2::{Digest, Sha256};
use std::{
    io::{BufRead, BufReader, Write},
    path::Path,
    process::{Command, Stdio},
};

/// Resolve only beside the installed root executable (Contents/MacOS on macOS).
/// The trusted digest must come from package assembly, never the adjacent manifest.
pub(super) fn invoke(
    root: &Path,
    config: &Path,
    trusted_digest: &str,
    request: &Request,
    approval: &dyn Fn(&str, &str),
    allowed: &dyn Fn() -> bool,
) -> Result<serde_json::Value> {
    ensure!(allowed(), "Recipient operation cancelled");
    request.validate()?;
    #[cfg(not(target_os = "macos"))]
    ensure!(
        trusted_digest.len() == 64 && trusted_digest.bytes().all(|b| b.is_ascii_hexdigit()),
        "Recipient package pin missing"
    );
    let directory = root
        .parent()
        .context("Recipient package directory missing")?
        .join("recipient");
    #[cfg(target_os = "macos")]
    verify_mac_package(root, &directory)?;
    let executable = directory.join("apparent-connect-recipient");
    let manifest: serde_json::Value = serde_json::from_slice(
        &std::fs::read(directory.join("manifest.json")).context("Recipient manifest missing")?,
    )
    .map_err(|_| anyhow::anyhow!("Invalid recipient manifest"))?;
    let target = format!(
        "{}-{}",
        std::env::consts::ARCH,
        if cfg!(target_os = "macos") {
            "apple-darwin"
        } else {
            "unknown-linux-gnu"
        }
    );
    ensure!(
        manifest["schema"] == 1
            && manifest["protocol"] == 1
            && manifest["target"] == target
            && manifest["executable"] == "apparent-connect-recipient",
        "Incompatible recipient package"
    );
    ensure!(
        manifest["sourceSha"]
            .as_str()
            .is_some_and(|s| s.len() == 40 && s.bytes().all(|b| b.is_ascii_hexdigit()))
            && manifest["version"].as_str().is_some_and(|s| !s.is_empty()),
        "Invalid recipient identity"
    );
    let digest = format!(
        "{:x}",
        Sha256::digest(std::fs::read(&executable).context("Recipient executable missing")?)
    );
    ensure!(
        manifest["sha256"] == digest && (cfg!(target_os = "macos") || digest == trusted_digest),
        "Recipient package digest mismatch"
    );
    ensure!(allowed(), "Recipient operation cancelled");
    let mut child = Command::new(executable)
        .env("APPARENT_CONFIG", config)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .context("Recipient executable unavailable")?;
    let outcome = (|| -> Result<serde_json::Value> {
        serde_json::to_writer(
            child
                .stdin
                .as_mut()
                .context("Recipient input unavailable")?,
            request,
        )?;
        child.stdin.take().unwrap().flush()?;
        let mut result = None;
        let stdout = child
            .stdout
            .take()
            .context("Recipient output unavailable")?;
        let (send, receive) = std::sync::mpsc::sync_channel(8);
        let reader = std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                if send.send(line).is_err() {
                    break;
                }
            }
        });
        loop {
            if !allowed() {
                unsafe {
                    libc::kill(child.id() as i32, libc::SIGTERM);
                }
                // Let the recipient invalidate its transaction before forced cleanup.
                let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
                while child.try_wait()?.is_none() && std::time::Instant::now() < deadline {
                    std::thread::sleep(std::time::Duration::from_millis(20));
                }
                anyhow::bail!("Recipient operation cancelled");
            }
            let line = match receive.recv_timeout(std::time::Duration::from_millis(50)) {
                Ok(line) => line,
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => continue,
                Err(_) => break,
            };
            let value: serde_json::Value = serde_json::from_str(&line?)
                .map_err(|_| anyhow::anyhow!("Invalid recipient response"))?;
            ensure!(value["protocol"] == 1, "Incompatible recipient response");
            if value.get("error").is_some() {
                anyhow::bail!("Recipient operation failed");
            }
            if value["event"] == "approval" {
                approval(
                    value["verificationUri"]
                        .as_str()
                        .context("Invalid approval")?,
                    value["userCode"].as_str().context("Invalid approval")?,
                );
            } else {
                ensure!(
                    result.is_none() && value.get("result").is_some(),
                    "Invalid recipient response"
                );
                result = Some(value["result"].clone());
            }
        }
        reader
            .join()
            .map_err(|_| anyhow::anyhow!("Recipient output unavailable"))?;
        ensure!(child.wait()?.success(), "Recipient operation failed");
        ensure!(allowed(), "Recipient operation cancelled");
        result.context("Recipient result missing")
    })();
    if outcome.is_err() {
        let _ = child.kill();
        let _ = child.wait();
    }
    outcome
}

#[cfg(any(target_os = "macos", test))]
fn signing_team(text: &str) -> Result<String> {
    let mut teams = text
        .lines()
        .filter_map(|line| line.strip_prefix("TeamIdentifier="));
    let value = teams.next().context("Missing signing team")?;
    ensure!(
        teams.next().is_none()
            && value.len() == 10
            && value
                .bytes()
                .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit()),
        "Invalid signing team"
    );
    Ok(value.to_owned())
}

/// Only the running, sealed application can authenticate a mutable signing receipt.
#[cfg(target_os = "macos")]
fn verify_mac_package(root: &Path, directory: &Path) -> Result<()> {
    let running = std::env::current_exe()?.canonicalize()?;
    ensure!(
        root.canonicalize()? == running,
        "Recipient root is not running app"
    );
    let macos = running.parent().context("Missing MacOS directory")?;
    ensure!(
        macos.file_name().is_some_and(|n| n == "MacOS"),
        "Invalid app layout"
    );
    let contents = macos.parent().context("Missing Contents directory")?;
    ensure!(
        contents.file_name().is_some_and(|n| n == "Contents"),
        "Invalid app layout"
    );
    let app = contents.parent().context("Missing app bundle")?;
    ensure!(
        directory.canonicalize()? == macos.join("recipient"),
        "Recipient outside app"
    );
    let verify = |path: &Path| -> Result<()> {
        ensure!(
            Command::new("/usr/bin/codesign")
                .args(["--verify", "--strict", "--deep"])
                .arg(path)
                .status()?
                .success(),
            "Invalid sealed recipient app"
        );
        Ok(())
    };
    let team = |path: &Path| -> Result<String> {
        let output = Command::new("/usr/bin/codesign")
            .args(["--display", "--verbose=4"])
            .arg(path)
            .output()?;
        ensure!(output.status.success(), "Missing signing identity");
        let text = String::from_utf8(output.stderr)?;
        signing_team(&text)
    };
    verify(app)?;
    verify(&running)?;
    let expected = team(&running)?;
    ensure!(team(app)? == expected, "App signing team mismatch");
    let recipient = directory.join("apparent-connect-recipient");
    verify(&recipient)?;
    ensure!(
        team(&recipient)? == expected,
        "Recipient signing team mismatch"
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn signing_team_rejects_unsigned_and_ambiguous_identity() {
        for value in [
            "",
            "TeamIdentifier=not set",
            "TeamIdentifier=",
            "TeamIdentifier=ABCDEFGHIJ\nTeamIdentifier=ABCDEFGHIJ",
            "TeamIdentifier=abcdefghij",
        ] {
            assert!(signing_team(value).is_err());
        }
        assert_eq!(
            signing_team("Authority=Developer ID\nTeamIdentifier=AB12345678\n").unwrap(),
            "AB12345678"
        );
    }
    #[test]
    #[cfg(not(target_os = "macos"))]
    #[ignore = "requires standalone recipient binary; run explicitly with APPARENT_TEST_RECIPIENT_EXECUTABLE"]
    fn recipient_package_validation_fails_closed() {
        let directory = std::env::temp_dir().join(format!("root-recipient-{}", std::process::id()));
        std::fs::create_dir_all(&directory).unwrap();
        let root = directory.join("apparent");
        let package = directory.join("recipient");
        std::fs::create_dir_all(&package).unwrap();
        let request = Request {
            protocol: 1,
            operation: apparent_connect_client::recipient_protocol::Operation::Status {
                account: false,
            },
        };
        let pin = "0".repeat(64);
        let config = directory.join("config.json");
        let call = |pin: &str| {
            invoke(
                &root,
                &config,
                pin,
                &request,
                &|_, _| panic!("unexpected approval"),
                &|| true,
            )
        };
        assert!(call("").unwrap_err().to_string().contains("pin missing"));
        assert!(
            call(&pin)
                .unwrap_err()
                .to_string()
                .contains("manifest missing")
        );
        let mut manifest = serde_json::json!({"schema":2,"protocol":1,"target":format!("{}-{}",std::env::consts::ARCH,if cfg!(target_os="macos") {"apple-darwin"} else {"unknown-linux-gnu"}),"sourceSha":"a".repeat(40),"version":"synthetic","executable":"apparent-connect-recipient","sha256":pin});
        let write = |manifest: &serde_json::Value| {
            std::fs::write(
                package.join("manifest.json"),
                serde_json::to_vec(manifest).unwrap(),
            )
            .unwrap()
        };
        write(&manifest);
        assert!(call(&pin).unwrap_err().to_string().contains("Incompatible"));
        manifest["schema"] = 1.into();
        write(&manifest);
        manifest["protocol"] = 2.into();
        write(&manifest);
        assert!(call(&pin).unwrap_err().to_string().contains("Incompatible"));
        manifest["protocol"] = 1.into();
        write(&manifest);
        assert!(
            call(&pin)
                .unwrap_err()
                .to_string()
                .contains("executable missing")
        );
        std::fs::write(package.join("apparent-connect-recipient"), b"tampered").unwrap();
        assert!(
            call(&pin)
                .unwrap_err()
                .to_string()
                .contains("digest mismatch")
        );
        assert!(
            invoke(&root, &config, &pin, &request, &|_, _| (), &|| false)
                .unwrap_err()
                .to_string()
                .contains("cancelled")
        );
        // The client fixture lane builds this real executable first. Copy it into
        // an isolated package; production resolution never consults this path.
        let fixture = std::env::var_os("APPARENT_TEST_RECIPIENT_EXECUTABLE")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("connect/client/target/debug/apparent-connect-recipient"));
        std::fs::copy(fixture, package.join("apparent-connect-recipient"))
            .expect("build the recipient executable fixture first");
        let digest = format!(
            "{:x}",
            Sha256::digest(std::fs::read(package.join("apparent-connect-recipient")).unwrap())
        );
        manifest["sha256"] = digest.clone().into();
        write(&manifest);
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o700)).unwrap();
        std::fs::write(
            &config,
            br#"{"private":"synthetic-secret","cloud":{"enabled":false}}"#,
        )
        .unwrap();
        let result = call(&digest).unwrap();
        assert_eq!(result["readSignedIn"], false);
        assert!(!result.to_string().contains("synthetic-secret"));
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    #[cfg(target_os = "linux")]
#[ignore = "requires standalone recipient binary; run explicitly with APPARENT_TEST_RECIPIENT_EXECUTABLE"]
fn root_adapter_http_login_and_validated_fetches() {
    use std::{io::{Read, Write}, net::TcpListener};
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let server = format!("http://{}", listener.local_addr().unwrap());
    let origin = server.clone();
    let id = "0123456789abcdef0123456789abcdef";
    let fixture = std::thread::spawn(move || {
        // Login start/poll, then manifest and three validated assets twice.
        for _ in 0..10 {
            let (mut stream, _) = listener.accept().unwrap();
            stream.set_read_timeout(Some(std::time::Duration::from_secs(10))).unwrap();
            let mut bytes = Vec::new();
            let mut buffer = [0; 8192];
            loop {
                let count = stream.read(&mut buffer).unwrap();
                bytes.extend_from_slice(&buffer[..count]);
                if let Some(end) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                    let head = String::from_utf8_lossy(&bytes[..end]);
                    let length: usize = head.lines().find_map(|l| l.to_ascii_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse().unwrap())).unwrap_or(0);
                    if bytes.len() >= end + 4 + length { break; }
                }
                assert!(count > 0);
            }
            let request = String::from_utf8_lossy(&bytes);
            let route = request.split_whitespace().nth(1).unwrap();
            let body = if route == "/v1/device/start" {
                assert!(request.contains("\"scope\":\"read\""));
                serde_json::json!({"deviceCode":"fixture-device-private","userCode":"TEST-CODE","verificationUri":format!("{origin}/device?code=TEST-CODE"),"expiresIn":30,"interval":1}).to_string()
            } else if route == "/v1/device/poll" {
                serde_json::json!({"status":"approved","scope":"read","accessToken":"fixture-access-private","refreshToken":"fixture-refresh-private","expiresIn":3600,"refreshExpiresIn":86400,"grantId":"fixture-grant"}).to_string()
            } else if route == format!("/v1/captures/{id}") {
                assert!(request.contains("fixture-access-private"));
                serde_json::json!({"id":id,"status":"ready","files":(["apparent.json","summary.md","contact-sheet.png"].map(|path| serde_json::json!({"path":path,"size":2,"sha256":"44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a"})))}).to_string()
            } else { assert!(route.contains("/files/")); "{}".into() };
            write!(stream,"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",body.len(),body).unwrap();
        }
    });
    let directory = std::env::temp_dir().join(format!("recipient-fetch-{}", std::process::id()));
    std::fs::create_dir_all(&directory).unwrap();
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o700)).unwrap();
    let config = directory.join("config.json");
    std::fs::write(&config, br#"{"experiments":{"hostedEncryption":false},"unknown":{"kept":42},"cloud":{"enabled":false,"uploadConsent":false}}"#).unwrap();
    let package = directory.join("recipient");
    std::fs::create_dir(&package).unwrap();
    let fixture_binary = std::env::var_os("APPARENT_TEST_RECIPIENT_EXECUTABLE")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| Path::new(env!("CARGO_MANIFEST_DIR")).join("connect/client/target/debug/apparent-connect-recipient"));
    std::fs::copy(fixture_binary, package.join("apparent-connect-recipient")).unwrap();
    let digest = format!("{:x}", Sha256::digest(std::fs::read(package.join("apparent-connect-recipient")).unwrap()));
    let manifest = serde_json::json!({"schema":1,"protocol":1,"target":format!("{}-unknown-linux-gnu",std::env::consts::ARCH),"sourceSha":"a".repeat(40),"version":"test","executable":"apparent-connect-recipient","sha256":digest});
    std::fs::write(package.join("manifest.json"), serde_json::to_vec(&manifest).unwrap()).unwrap();
    let run = |operation: serde_json::Value| {
        let request = serde_json::from_value(serde_json::json!({"protocol":1,"operation":operation})).unwrap();
        let approval = std::sync::Mutex::new(String::new());
        let result = invoke(&directory.join("apparent"), &config, &digest, &request,
            &|uri, code| { *approval.lock().unwrap() = format!("{uri} {code}"); }, &|| true).unwrap();
        let text = format!("{} {}", result, approval.lock().unwrap());
        for secret in ["fixture-device-private","fixture-access-private","fixture-refresh-private"] { assert!(!text.contains(secret)); }
        text
    };
    let approval = run(serde_json::json!({"kind":"login","server":server,"browser":false}));
    assert!(approval.contains("TEST-CODE"));
    for evidence_only in [true,false] {
        let out = directory.join(if evidence_only {"evidence.apparent"} else {"full.apparent"});
        run(serde_json::json!({"kind":"fetch","id":id,"out":out,"wait":0,"evidence_only":evidence_only}));
        assert_eq!(std::fs::read(out.join("apparent.json")).unwrap(), b"{}");
    }
    // Existing destinations must survive adapter-level fetch attempts intact.
    let out = directory.join("full.apparent");
    let original = std::fs::read(out.join("apparent.json")).unwrap();
    let request = serde_json::from_value(serde_json::json!({"protocol":1,"operation":{"kind":"fetch","id":id,"out":out,"wait":0,"evidence_only":false}})).unwrap();
    assert!(invoke(&directory.join("apparent"), &config, &digest, &request, &|_, _| (), &|| true).is_err());
    assert_eq!(std::fs::read(out.join("apparent.json")).unwrap(), original);
    let value: serde_json::Value = serde_json::from_slice(&std::fs::read(&config).unwrap()).unwrap();
    assert_eq!(value["cloud"]["enabled"],false);
    assert_eq!(value["cloud"]["uploadConsent"],false);
    assert_eq!(value["unknown"]["kept"],42);
    fixture.join().unwrap();
    // Cancel at APPROVAL, before polling or durable credential publication.
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let server = format!("http://{}", listener.local_addr().unwrap());
    let origin = server.clone();
    let cancelled_fixture = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut bytes = [0; 8192];
        stream.read(&mut bytes).unwrap();
        let body = serde_json::json!({"deviceCode":"cancel-private","userCode":"CANCEL","verificationUri":format!("{origin}/device"),"expiresIn":30,"interval":1}).to_string();
        write!(stream,"HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",body.len(),body).unwrap();
    });
    let before = std::fs::read(&config).unwrap();
    let allowed = std::sync::atomic::AtomicBool::new(true);
    let request = serde_json::from_value(serde_json::json!({"protocol":1,"operation":{"kind":"login","server":server,"browser":false}})).unwrap();
    let error = invoke(&directory.join("apparent"), &config, &digest, &request,
        &|_, code| { assert_eq!(code, "CANCEL"); allowed.store(false, std::sync::atomic::Ordering::SeqCst); },
        &|| allowed.load(std::sync::atomic::Ordering::SeqCst)).unwrap_err();
    assert!(error.to_string().contains("cancelled"));
    assert!(!error.to_string().contains("cancel-private"));
    assert_eq!(std::fs::read(&config).unwrap(), before);
    assert!(!directory.join("hosted/upload.credential").exists());
    cancelled_fixture.join().unwrap();
    std::fs::remove_dir_all(directory).unwrap();
}

}
