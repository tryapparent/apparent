use super::*;
use std::io::Read;
use std::net::{TcpListener, TcpStream};
use std::time::{Duration, Instant};
fn base() -> Value {
    json!({"api_key":"phc_synthetic", "event":"$exception", "properties":{"$release_id":"new-build", "$exception_list":[{"mechanism":{"handled":true}}]}})
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

#[cfg(target_os = "linux")]
#[test]
fn native_exit_payload_preserves_original_release_and_event_identity_over_http() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let endpoint = format!("http://{}/i/v0/e/", listener.local_addr().unwrap());
    let server = std::thread::spawn(move || {
        let mut stream = accept(&listener);
        let payload = request(&mut stream);
        stream
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            .unwrap();
        payload
    });
    let id = "cb02e8ec-35ed-4fb5-8afc-000000000001";
    let metadata = json!({"build":"0.22.8 · 4373c3f", "commit_sha":"4373c3f", "$app_version":"0.22.8", "package_version":"0.22.8", "release_version":"original", "channel":"main", "environment":"test", "build_modified":false, "$release_id":"cb02e8ec-35ed-4fb5-8afc-000000000002", "private_extra":"must not leave"});
    let diagnostics =
        json!({"signal":9, "exit_code":null, "last_stage":"shortcut", "supervisor_lost":false});
    let payload = native_payload(base(), diagnostics.clone(), id, metadata.clone());
    assert!(send(&endpoint, &payload).unwrap());
    let received = server.join().unwrap();
    assert_eq!(received["uuid"], id);
    assert_eq!(received["distinct_id"], id);
    assert_eq!(received["properties"]["build"], metadata["build"]);
    assert_eq!(
        received["properties"]["$release_id"],
        metadata["$release_id"]
    );
    assert_eq!(received["properties"]["native_exit"], diagnostics);
    assert_eq!(
        received["properties"]["$exception_list"][0]["mechanism"]["handled"],
        false
    );
    assert_eq!(
        received["properties"]["$exception_fingerprint"],
        "desktop:native_process_exit:9:null:shortcut"
    );
    assert!(!received.to_string().contains("must not leave"));
    let without_release = native_payload(base(), diagnostics, id, json!({}));
    assert!(without_release["properties"].get("$release_id").is_none());
}
