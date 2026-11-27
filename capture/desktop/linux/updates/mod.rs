pub(crate) mod launch_handler;
pub(crate) mod microphone;
pub(crate) mod update;

use std::{fs, path::Path, process::Command, sync::mpsc, time::Duration};

use anyhow::{Context, Result};
use crate::capture::desktop::workflow::error_reporting::updates::{self, Stage};
use update::UpdateProgress;

pub(super) const CURL_HTTP_STATUS: &str = "%{stderr}\nAPPARENT_RATE_REMAINING:%header{x-ratelimit-remaining}\nAPPARENT_RATE_LIMIT:%header{x-ratelimit-limit}\nAPPARENT_RATE_RESET:%header{x-ratelimit-reset}\nAPPARENT_RETRY_AFTER:%header{retry-after}\nAPPARENT_TRANSFER_SECONDS:%{time_total}\nAPPARENT_DOWNLOADED_BYTES:%{size_download}\nAPPARENT_HTTP_STATUS:%{http_code}\n";

#[derive(Debug)]
pub(super) struct PublicReleaseLimit;

impl std::fmt::Display for PublicReleaseLimit {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("GitHub limits public release discovery to 1000 results")
    }
}

impl std::error::Error for PublicReleaseLimit {}

pub(super) fn get(url: &str, download: Option<(&Path, u64, &dyn Fn(UpdateProgress))>) -> Result<Vec<u8>> {
    if !url.starts_with("https://") {
        return Err(updates::failure(Stage::Validation, anyhow::anyhow!("update URL must use HTTPS")));
    }
    let mut cmd = Command::new("curl");
    cmd.args(["--silent", "--show-error", "--location", "--proto", "=https", "--proto-redir", "=https", "--connect-timeout", "10", "--user-agent", "Apparent", "--url", url]);
    cmd.args(["--write-out", CURL_HTTP_STATUS]);
    let output = if let Some((path, total_bytes, progress)) = download {
        cmd.args(["--fail", "--max-time", "1800", "--speed-limit", "1024", "--speed-time", "45", "--max-filesize", "1073741824"])
            .arg("--output").arg(path);
        receive_download(cmd, path, total_bytes, progress)?
    } else {
        cmd.args(["--fail-with-body", "--max-time", "15", "--max-filesize", "4194304"]);
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
        let public_release_limit = http_status == Some(422) && result.stdout.len() <= 4096
            && serde_json::from_slice::<serde_json::Value>(&result.stdout).is_ok_and(|body| {
                body["message"] == "Only the first 1000 results are available."
            });
        let numeric = |prefix: &str| stderr.lines().rev().find_map(|line| line.strip_prefix(prefix))
            .filter(|value| !value.is_empty() && value.len() <= 10 && value.bytes().all(|b| b.is_ascii_digit()))
            .and_then(|value| value.parse::<u32>().ok());
        let transfer_ms = stderr.lines().rev().find_map(|line| line.strip_prefix("APPARENT_TRANSFER_SECONDS:"))
            .and_then(|raw| raw.parse::<f64>().ok())
            .filter(|seconds| (0.0..=600.0).contains(seconds))
            .map(|seconds| (seconds * 1000.0).round() as u32);
        let http = updates::Http {
            status: http_status,
            transfer_ms,
            downloaded_bytes: numeric("APPARENT_DOWNLOADED_BYTES:").filter(|bytes| *bytes <= 1_073_741_824),
            rate_limit_remaining: numeric("APPARENT_RATE_REMAINING:"),
            rate_limit_limit: numeric("APPARENT_RATE_LIMIT:"),
            rate_limit_reset_after_seconds: numeric("APPARENT_RATE_RESET:").and_then(|reset| {
                reset_after_seconds(reset, std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).ok()?.as_secs())
            }),
            retry_after_seconds: numeric("APPARENT_RETRY_AFTER:")};
        let cause = if public_release_limit {
            anyhow::Error::new(PublicReleaseLimit)
        } else {
            anyhow::anyhow!("download failed: {stderr}")
        };
        return Err(updates::command_failure(updates::Process::Curl, result.status, http, cause));
    }
    Ok(result.stdout)
}

pub(super) fn reset_after_seconds(reset: u32, now: u64) -> Option<u32> {
    u64::from(reset).checked_sub(now).filter(|seconds| *seconds <= 86_400).map(|seconds| seconds as u32)
}

#[cfg(test)]
#[path = "../../../../engine/native/desktop/updates/transfer_tests.rs"]
mod tests;
