pub(crate) mod launch_handler;
pub(crate) mod microphone;
pub(crate) mod update;

use std::{fs, path::Path, process::Command, sync::mpsc, time::Duration};

use anyhow::{Context, Result};
use crate::capture::desktop::workflow::error_reporting::updates::{self, Stage};
use update::UpdateProgress;

pub(super) const CURL_HTTP_STATUS: &str = "%{stderr}\nAPPARENT_RATE_REMAINING:%header{x-ratelimit-remaining}\nAPPARENT_RATE_LIMIT:%header{x-ratelimit-limit}\nAPPARENT_RATE_RESET:%header{x-ratelimit-reset}\nAPPARENT_RETRY_AFTER:%header{retry-after}\nAPPARENT_HTTP_STATUS:%{http_code}\n";

pub(super) fn get(url: &str, download: Option<(&Path, u64, &dyn Fn(UpdateProgress))>) -> Result<Vec<u8>> {
    if !url.starts_with("https://") {
        return Err(updates::failure(Stage::Validation, anyhow::anyhow!("update URL must use HTTPS")));
    }
    let mut cmd = Command::new("curl");
    cmd.args(["--fail", "--silent", "--show-error", "--location", "--proto", "=https", "--proto-redir", "=https", "--connect-timeout", "10", "--user-agent", "Apparent", "--url", url]);
    cmd.args(["--write-out", CURL_HTTP_STATUS]);
    let output = if let Some((path, total_bytes, progress)) = download {
        cmd.args(["--max-time", "1800", "--speed-limit", "1024", "--speed-time", "45", "--max-filesize", "1073741824"])
            .arg("--output").arg(path);
        receive_download(cmd, path, total_bytes, progress)?
    } else {
        cmd.args(["--max-time", "15", "--max-filesize", "4194304"]);
        cmd.output().context("curl is required for updates")?
    };
    download_output(output)
}

fn receive_download(mut cmd: Command, path: &Path, total_bytes: u64, progress: &dyn Fn(UpdateProgress)) -> Result<std::process::Output> {
    let (done, finished) = mpsc::sync_channel(1);
    std::thread::scope(|scope| {
        scope.spawn(move || { let _ = done.send(cmd.output()); });
        let mut last_bytes = 0;
        loop {
            match finished.recv_timeout(Duration::from_millis(250)) {
                Ok(output) => return output.context("curl is required for updates"),
                Err(mpsc::RecvTimeoutError::Disconnected) => anyhow::bail!("download worker stopped"),
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    let downloaded_bytes = fs::metadata(path).map_or(last_bytes, |meta| meta.len());
                    if downloaded_bytes != last_bytes {
                        last_bytes = downloaded_bytes;
                        progress(UpdateProgress::Downloading { downloaded_bytes, total_bytes });
                    }
                }
            }
        }
    })
}

pub(super) fn download_output(result: std::process::Output) -> Result<Vec<u8>> {
    if !result.status.success() {
        let stderr = String::from_utf8_lossy(&result.stderr);
        let http_status = stderr.lines().last().and_then(|line| line.strip_prefix("APPARENT_HTTP_STATUS:"))
            .filter(|value| value.len() == 3 && value.bytes().all(|b| b.is_ascii_digit()))
            .and_then(|value| value.parse::<u16>().ok());
        let numeric = |prefix: &str| stderr.lines().rev().find_map(|line| line.strip_prefix(prefix))
            .filter(|value| !value.is_empty() && value.len() <= 10 && value.bytes().all(|b| b.is_ascii_digit()))
            .and_then(|value| value.parse::<u32>().ok());
        let http = updates::Http {status: http_status, rate_limit_remaining: numeric("APPARENT_RATE_REMAINING:"),
            rate_limit_limit: numeric("APPARENT_RATE_LIMIT:"),
            rate_limit_reset_after_seconds: numeric("APPARENT_RATE_RESET:").and_then(|reset| {
                reset_after_seconds(reset, std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).ok()?.as_secs())
            }),
            retry_after_seconds: numeric("APPARENT_RETRY_AFTER:")};
        return Err(updates::command_failure(updates::Process::Curl, result.status, http,
            anyhow::anyhow!("download failed: {stderr}")));
    }
    Ok(result.stdout)
}

pub(super) fn reset_after_seconds(reset: u32, now: u64) -> Option<u32> {
    u64::from(reset).checked_sub(now).filter(|seconds| *seconds <= 86_400).map(|seconds| seconds as u32)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};

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
}
