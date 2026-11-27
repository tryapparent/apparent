use super::*;
use std::io::{Read, Write};

#[test]
fn only_the_documented_public_history_cap_is_classified() {
    use std::os::unix::process::ExitStatusExt;
    for (code, body, expected) in [
        (422, r#"{"message":"Only the first 1000 results are available."}"#, true),
        (422, r#"{"message":"Validation Failed"}"#, false),
        (503, r#"{"message":"Only the first 1000 results are available."}"#, false),
    ] {
        let error = download_output(std::process::Output {
            status: std::process::ExitStatus::from_raw(22 << 8),
            stdout: body.as_bytes().to_vec(),
            stderr: format!("APPARENT_HTTP_STATUS:{code}\n").into_bytes(),
        }).unwrap_err();
        assert_eq!(error.chain().any(|cause| cause.is::<PublicReleaseLimit>()), expected);
    }
}

#[test]
fn asset_download_reports_partial_bytes_before_real_curl_exits() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("image.download");
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let (observed, finish) = mpsc::channel();
    let server = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        stream.set_read_timeout(Some(Duration::from_secs(4))).unwrap();
        stream.read(&mut [0; 4096]).unwrap();
        stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 16384\r\nConnection: close\r\n\r\n").unwrap();
        stream.write_all(&[1; 8192]).unwrap();
        assert_eq!(finish.recv_timeout(Duration::from_secs(4)).unwrap(),
            UpdateProgress::Downloading { downloaded_bytes: 8192, total_bytes: 16384 });
        stream.write_all(&[2; 8192]).unwrap();
    });
    let mut cmd = Command::new("curl");
    cmd.args(["--silent", "--show-error", "--fail", "--noproxy", "*", "--max-time", "5", "--url", &url, "--output"]).arg(&path);
    let result = receive_download(cmd, &path, 16384, &|event| { let _ = observed.send(event); }).unwrap();
    assert!(result.status.success());
    server.join().unwrap();
    let bytes = fs::read(path).unwrap();
    assert_eq!(bytes.len(), 16384);
    assert!(bytes[..8192].iter().all(|&byte| byte == 1));
    assert!(bytes[8192..].iter().all(|&byte| byte == 2));
}
