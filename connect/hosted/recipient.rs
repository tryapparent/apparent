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
    ensure!(
        trusted_digest.len() == 64 && trusted_digest.bytes().all(|b| b.is_ascii_hexdigit()),
        "Recipient package pin missing"
    );
    let directory = root
        .parent()
        .context("Recipient package directory missing")?;
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
        manifest["sha256"] == digest && digest == trusted_digest,
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

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn recipient_package_validation_fails_closed() {
        let directory = std::env::temp_dir().join(format!("root-recipient-{}", std::process::id()));
        std::fs::create_dir_all(&directory).unwrap();
        let root = directory.join("apparent");
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
                directory.join("manifest.json"),
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
        std::fs::write(directory.join("apparent-connect-recipient"), b"tampered").unwrap();
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
        let fixture = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("connect/client/target/debug/apparent-connect-recipient");
        std::fs::copy(fixture, directory.join("apparent-connect-recipient"))
            .expect("build the recipient executable fixture first");
        let digest = format!(
            "{:x}",
            Sha256::digest(std::fs::read(directory.join("apparent-connect-recipient")).unwrap())
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
}
