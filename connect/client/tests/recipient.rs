use std::{io::Write, process::{Command, Stdio}};
use apparent_connect_client::{ConfigProvider, CloudConfig, config_provider::ProductionConfig};
#[test]
fn executable_rejects_protocol_without_config_access() {
    for request in [r#"{"protocol":2,"operation":{"kind":"status","account":false}}"#, r#"{"protocol":1,"operation":{"kind":"upload"}}"#] {
        let mut child = Command::new(env!("CARGO_BIN_EXE_apparent-connect-recipient")).env("APPARENT_CONFIG", "/nonexistent/private/config.json").stdin(Stdio::piped()).stdout(Stdio::piped()).spawn().unwrap();
        child.stdin.take().unwrap().write_all(request.as_bytes()).unwrap();
        let output = child.wait_with_output().unwrap();
        assert!(!output.status.success());
        let value: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(value["protocol"], 1);
        assert!(value["error"]["message"].is_string());
        assert!(!String::from_utf8(output.stdout).unwrap().contains("/nonexistent/private"));
    }
}
#[test]
fn provider_preserves_unknown_secrets_and_cancelled_transaction() {
    let dir = std::env::current_dir().unwrap().join(format!("recipient-config-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    { use std::os::unix::fs::PermissionsExt; std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700)).unwrap(); }
    let path = dir.join("config.json");
    let original = br#"{"secret":"keep-private","unknown":{"nested":42},"experiments":{"other":false}}"#;
    std::fs::write(&path, original).unwrap();
    let provider = ProductionConfig(path.clone());
    assert!(provider.set_cloud_allowed(&CloudConfig::default(), &|| false).is_err());
    assert_eq!(std::fs::read(&path).unwrap(), original);
    provider.set_cloud(&CloudConfig {server:"https://example.test".into(), ..Default::default()}).unwrap();
    let value: serde_json::Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    assert_eq!(value["secret"], "keep-private");
    assert_eq!(value["unknown"]["nested"], 42);
    assert_eq!(value["experiments"]["other"], false);
    use std::os::unix::fs::PermissionsExt;
    assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
    std::fs::remove_dir_all(dir).unwrap();
}
#[test]
fn executable_status_is_json_and_never_discloses_config_secrets() {
    let dir = std::env::current_dir().unwrap().join(format!("recipient-status-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    { use std::os::unix::fs::PermissionsExt; std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700)).unwrap(); }
    let path = dir.join("config.json");
    std::fs::write(&path, br#"{"secret":"synthetic-secret-never-print","cloud":{"server":"https://example.test"}}"#).unwrap();
    let mut child = Command::new(env!("CARGO_BIN_EXE_apparent-connect-recipient")).env("APPARENT_CONFIG", &path).stdin(Stdio::piped()).stdout(Stdio::piped()).spawn().unwrap();
    child.stdin.take().unwrap().write_all(br#"{"protocol":1,"operation":{"kind":"status","account":false}}"#).unwrap();
    let output = child.wait_with_output().unwrap();
    assert!(output.status.success(), "{} {}", String::from_utf8_lossy(&output.stdout), String::from_utf8_lossy(&output.stderr));
    let value: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(value["result"]["readSignedIn"], false);
    assert!(!String::from_utf8_lossy(&output.stdout).contains("synthetic-secret"));
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn executable_http_failure_never_echoes_remote_credentials() {
    use std::{io::Read, net::TcpListener};
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let server = format!("http://{}", listener.local_addr().unwrap());
    let fixture = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut request = [0; 8192];
        let n = stream.read(&mut request).unwrap();
        assert!(String::from_utf8_lossy(&request[..n]).contains("/v1/device/start"));
        let body = r#"{"error":"synthetic-private-token-never-print"}"#;
        write!(stream, "HTTP/1.1 400 Bad Request\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body).unwrap();
    });
    let directory = std::env::temp_dir().join(format!("recipient-http-{}", std::process::id()));
    std::fs::create_dir_all(&directory).unwrap();
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o700)).unwrap();
    let config = directory.join("config.json");
    let original = br#"{"unknown":"keep","cloud":{"enabled":false,"uploadConsent":false}}"#;
    std::fs::write(&config, original).unwrap();
    let mut child = Command::new(env!("CARGO_BIN_EXE_apparent-connect-recipient"))
        .current_dir(&directory).env("APPARENT_CONFIG", &config)
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().unwrap();
    serde_json::to_writer(child.stdin.take().unwrap(), &serde_json::json!({"protocol":1,"operation":{"kind":"login","server":server,"browser":false}})).unwrap();
    let output = child.wait_with_output().unwrap();
    fixture.join().unwrap();
    assert!(!output.status.success());
    assert!(!String::from_utf8_lossy(&output.stdout).contains("synthetic-private-token"));
    assert!(output.stderr.is_empty());
    assert_eq!(std::fs::read(&config).unwrap(), original);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn executable_http_login_and_validated_fetches_outside_checkout() {
    use std::{io::Read, net::TcpListener};
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
    let run = |operation: serde_json::Value| {
        let mut child = Command::new(env!("CARGO_BIN_EXE_apparent-connect-recipient")).current_dir(&directory).env("APPARENT_CONFIG", &config).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().unwrap();
        serde_json::to_writer(child.stdin.take().unwrap(), &serde_json::json!({"protocol":1,"operation":operation})).unwrap();
        let output = child.wait_with_output().unwrap();
        assert!(output.status.success(), "{} {}", String::from_utf8_lossy(&output.stdout), String::from_utf8_lossy(&output.stderr));
        assert!(output.stderr.is_empty());
        let text = String::from_utf8(output.stdout).unwrap();
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
    let value: serde_json::Value = serde_json::from_slice(&std::fs::read(&config).unwrap()).unwrap();
    assert_eq!(value["cloud"]["enabled"],false);
    assert_eq!(value["cloud"]["uploadConsent"],false);
    assert_eq!(value["unknown"]["kept"],42);
    fixture.join().unwrap();
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn executable_cancelled_login_does_not_publish_credentials_or_upload_consent() {
    use std::{io::{BufRead, BufReader, Read}, net::TcpListener};
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let server = format!("http://{}",listener.local_addr().unwrap());
    let origin = server.clone();
    let fixture = std::thread::spawn(move || {
        let (mut stream,_) = listener.accept().unwrap();
        let mut buffer = [0;8192];
        stream.read(&mut buffer).unwrap();
        let body = serde_json::json!({"deviceCode":"cancel-private","userCode":"TEST-CODE","verificationUri":format!("{origin}/device"),"expiresIn":30,"interval":1}).to_string();
        write!(stream,"HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",body.len(),body).unwrap();
    });
    let directory = std::env::temp_dir().join(format!("recipient-cancel-{}",std::process::id()));
    std::fs::create_dir_all(&directory).unwrap();
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(&directory,std::fs::Permissions::from_mode(0o700)).unwrap();
    let config = directory.join("config.json");
    let original = br#"{"unknown":"keep","cloud":{"enabled":false,"uploadConsent":false}}"#;
    std::fs::write(&config,original).unwrap();
    let mut child = Command::new(env!("CARGO_BIN_EXE_apparent-connect-recipient")).current_dir(&directory).env("APPARENT_CONFIG",&config).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().unwrap();
    serde_json::to_writer(child.stdin.take().unwrap(),&serde_json::json!({"protocol":1,"operation":{"kind":"login","server":server,"browser":false}})).unwrap();
    let mut reader = BufReader::new(child.stdout.take().unwrap());
    let mut approval = String::new();
    reader.read_line(&mut approval).unwrap();
    assert!(approval.contains("TEST-CODE"));
    unsafe { libc::kill(child.id() as i32,libc::SIGTERM); }
    let mut response = String::new();
    reader.read_to_string(&mut response).unwrap();
    assert!(!child.wait().unwrap().success());
    assert_eq!(serde_json::from_str::<serde_json::Value>(&response).unwrap()["error"]["code"],"cancelled");
    assert_eq!(std::fs::read(config).unwrap(),original);
    assert!(!directory.join("hosted/read.credential").exists());
    assert!(!directory.join("hosted/upload.credential").exists());
    assert!(!response.contains("cancel-private"));
    fixture.join().unwrap();
    std::fs::remove_dir_all(directory).unwrap();
}
