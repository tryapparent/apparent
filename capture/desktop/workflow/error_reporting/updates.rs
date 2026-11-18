//! Typed updater evidence. Never serialize error text, URLs, headers or paths.
use std::{error::Error, fmt, panic::Location, process::ExitStatus};
use std::os::unix::process::ExitStatusExt;

/// Expected rejection by the native transaction guard, not an updater failure.
#[derive(Debug)]
struct LockContention(std::io::Error);
impl fmt::Display for LockContention {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("another update transaction is running")
    }
}
impl Error for LockContention {
    fn source(&self) -> Option<&(dyn Error + 'static)> { Some(&self.0) }
}
pub(crate) fn lock_contention(source: std::io::Error) -> anyhow::Error {
    anyhow::Error::new(LockContention(source))
}
pub(crate) fn is_lock_contention(error: &anyhow::Error) -> bool {
    error.chain().any(|cause| cause.is::<LockContention>())
}

pub(crate) fn is_rate_limited(error: &anyhow::Error) -> bool {
    error.chain().filter_map(|cause| cause.downcast_ref::<CommandFailure>()).any(|failure| {
        failure.http_status == Some(429)
            || failure.http_status == Some(403)
                && (failure.rate_limit_remaining == Some(0) || failure.retry_after_seconds.is_some())
    })
}

#[cfg(test)]
#[test]
fn only_native_lock_contention_is_expected() {
    let busy = attempted(failure(Stage::Lock,
        lock_contention(std::io::Error::from_raw_os_error(libc::EWOULDBLOCK))), Attempt::default());
    assert!(is_lock_contention(&busy));
    for (stage, code) in [(Stage::Lock, libc::EACCES), (Stage::Lock, libc::EIO),
        (Stage::AssetDownload, libc::EWOULDBLOCK), (Stage::Lock, libc::EWOULDBLOCK)] {
        let error = failure(stage, std::io::Error::from_raw_os_error(code).into());
        assert!(!is_lock_contention(&error), "untyped I/O errors must remain reportable");
    }
}

#[derive(Clone, Copy, Debug, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum Stage {
    Target, Lock, Config, ReleaseListFetch, ReleaseListParse, MainRelease,
    StableRelease, ChecksumFetch, ChecksumParse, Validation, Policy,
    PolicyTimeout, PolicyAssets, PolicyLaunch, PolicyResponse, AssetDownload, ChecksumVerify, Install, Swap,
    ReserveStage, InstallTarget, MarkerWrite, BackupMarker, BackupPublish, MarkerPublish,
    DownloadRead, ImagePermissions, DownloadSync,
    Preflight, PreflightTimeout, Restart, RestartLaunch, UnexpectedResult,
}

#[derive(Clone, Copy, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum Trigger { User, Automatic, Sparkle }

#[derive(Clone, Copy, Debug, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum TargetStep { Metadata, FileType, Ownership, HomeDiscovery, ImageCanonicalization, HomeCanonicalization, HomeBoundary }

#[derive(Clone, Copy, Debug, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum PathClass { Root, Home, Temporary, Opt, Usr, Run, Other }

#[derive(Clone, Debug, serde::Serialize)]
pub(crate) struct Target {
    pub step: TargetStep,
    pub image_absolute: bool,
    pub home_from_environment: bool,
    pub home_matches_account: Option<bool>,
    pub image_regular: Option<bool>,
    pub image_symlink: Option<bool>,
    pub image_owned: Option<bool>,
    pub home_absolute: Option<bool>,
    pub image_path_changed: Option<bool>,
    pub home_path_changed: Option<bool>,
    pub image_under_home_before_canonicalization: Option<bool>,
    pub image_under_home: Option<bool>,
    pub image_location: Option<PathClass>,
    pub home_location: Option<PathClass>,
}

#[derive(Debug)]
struct TargetFailure { target: Target, source: anyhow::Error }
impl fmt::Display for TargetFailure {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result { fmt::Display::fmt(&self.source, f) }
}
impl Error for TargetFailure {
    fn source(&self) -> Option<&(dyn Error + 'static)> { Some(self.source.as_ref()) }
}
pub(crate) fn target_failure(source: anyhow::Error, target: Target) -> anyhow::Error {
    anyhow::Error::new(TargetFailure {target, source})
}

#[derive(Debug)]
struct Boundary {
    stage: Stage,
    location: &'static Location<'static>,
    source: anyhow::Error,
}
impl fmt::Display for Boundary {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result { fmt::Display::fmt(&self.source, f) }
}
impl Error for Boundary {
    fn source(&self) -> Option<&(dyn Error + 'static)> { Some(self.source.as_ref()) }
}
#[track_caller]
pub(crate) fn failure(stage: Stage, source: anyhow::Error) -> anyhow::Error {
    anyhow::Error::new(Boundary {stage, location: Location::caller(), source})
}

pub(crate) trait Diagnose<T> {
    #[track_caller]
    fn stage(self, stage: Stage) -> anyhow::Result<T>;
}
impl<T, E: Into<anyhow::Error>> Diagnose<T> for Result<T, E> {
    #[track_caller]
    fn stage(self, stage: Stage) -> anyhow::Result<T> {
        let location = Location::caller();
        self.map_err(|error| anyhow::Error::new(Boundary {stage, location, source: error.into()}))
    }
}

#[derive(Clone, Copy, Debug, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum Process { Curl, Policy, Preflight }
#[derive(Debug)]
struct CommandFailure {
    process: Process,
    exit_code: Option<i32>,
    signal: Option<i32>,
    http_status: Option<u16>,
    rate_limit_remaining: Option<u32>,
    rate_limit_limit: Option<u32>,
    rate_limit_reset_after_seconds: Option<u32>,
    retry_after_seconds: Option<u32>,
    source: anyhow::Error,
}
impl fmt::Display for CommandFailure {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result { fmt::Display::fmt(&self.source, f) }
}
impl Error for CommandFailure {
    fn source(&self) -> Option<&(dyn Error + 'static)> { Some(self.source.as_ref()) }
}
#[derive(Default)]
pub(crate) struct Http {
    pub status: Option<u16>,
    pub rate_limit_remaining: Option<u32>,
    pub rate_limit_limit: Option<u32>,
    pub rate_limit_reset_after_seconds: Option<u32>,
    pub retry_after_seconds: Option<u32>,
}
pub(crate) fn command_failure(process: Process, status: ExitStatus, http: Http, source: anyhow::Error) -> anyhow::Error {
    anyhow::Error::new(CommandFailure {process, exit_code: status.code(), signal: status.signal(),
        http_status: http.status.filter(|code| (100..=599).contains(code)),
        rate_limit_remaining: http.rate_limit_remaining, rate_limit_limit: http.rate_limit_limit,
        rate_limit_reset_after_seconds: http.rate_limit_reset_after_seconds, retry_after_seconds: http.retry_after_seconds, source})
}

#[derive(Clone, Debug, Default, serde::Serialize)]
pub(crate) struct Attempt {
    selected_channel: Option<&'static str>,
    installed_channel: Option<&'static str>,
    installed_identity_kind: Option<&'static str>,
    candidate_channel: Option<&'static str>,
    candidate_id: Option<String>,
    installed_matches_target: Option<bool>,
    compiled_matches_target: Option<bool>,
}
fn channel(value: &str) -> &'static str {
    match value { "main" => "main", "stable" => "stable", _ => "unknown" }
}
fn public_release_id(value: &str) -> bool {
    value.len() == 40 && value.bytes().all(|b| b.is_ascii_hexdigit()) ||
        (value.len() <= 64 && value.strip_prefix('v').is_some_and(|version|
            version.split('.').count() == 3 && version.split('.').all(|part|
                !part.is_empty() && part.bytes().all(|b| b.is_ascii_digit()))))
}
impl Attempt {
    pub(crate) fn selected(&mut self, selected: &str, installed: Option<&(String, String)>) {
        self.selected_channel = Some(channel(selected));
        self.installed_channel = installed.map(|(feed, _)| channel(feed));
        // Never send the installed marker's arbitrary fork ID, even if it looks
        // like a SHA. Candidate IDs come only from validated public releases.
        self.installed_identity_kind = Some(match installed {
            None => "missing",
            Some((_, id)) if id.len() == 40 && id.bytes().all(|b| b.is_ascii_hexdigit()) => "revision",
            Some((_, id)) if public_release_id(id) => "version",
            _ => "unrecognized",
        });
    }
    pub(crate) fn candidate(&mut self, feed: &str, id: &str, installed: Option<&(String, String)>, compiled: &str) {
        self.candidate_channel = Some(channel(feed));
        self.candidate_id = public_release_id(id).then(|| id.to_owned());
        self.installed_matches_target = installed.map(|(installed_feed, installed_id)| installed_feed == feed && installed_id == id);
        self.compiled_matches_target = Some(compiled == id);
    }
}
#[derive(Clone, Copy, Debug, serde::Serialize)]
pub(crate) struct ReleaseDiscovery {
    pub page: u8,
    pub requests_in_process: u32,
    pub elapsed_seconds: u32,
}
#[derive(Debug)]
struct DiscoveryFailure { discovery: ReleaseDiscovery, source: anyhow::Error }
impl fmt::Display for DiscoveryFailure {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result { fmt::Display::fmt(&self.source, f) }
}
impl Error for DiscoveryFailure {
    fn source(&self) -> Option<&(dyn Error + 'static)> { Some(self.source.as_ref()) }
}
pub(crate) fn discovery_failure(source: anyhow::Error, discovery: ReleaseDiscovery) -> anyhow::Error {
    anyhow::Error::new(DiscoveryFailure {discovery, source})
}

#[derive(Debug)]
struct AttemptFailure { attempt: Attempt, source: anyhow::Error }
impl fmt::Display for AttemptFailure {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result { fmt::Display::fmt(&self.source, f) }
}
impl Error for AttemptFailure {
    fn source(&self) -> Option<&(dyn Error + 'static)> { Some(self.source.as_ref()) }
}
pub(crate) fn attempted(error: anyhow::Error, attempt: Attempt) -> anyhow::Error {
    anyhow::Error::new(AttemptFailure {attempt, source: error})
}

#[derive(Clone, serde::Serialize)]
pub(super) struct Diagnostics {
    trigger: Trigger,
    stages: Vec<Frame>,
    attempt: Attempt,
    target: Option<Target>,
    release_discovery: Option<ReleaseDiscovery>,
    process: Option<Process>,
    exit_code: Option<i32>,
    signal: Option<i32>,
    http_status: Option<u16>,
    rate_limit_remaining: Option<u32>,
    rate_limit_limit: Option<u32>,
    rate_limit_reset_after_seconds: Option<u32>,
    retry_after_seconds: Option<u32>,
    io_kind: Option<&'static str>,
    os_error_code: Option<i32>,
    json_error_kind: Option<&'static str>,
    sparkle_domain: Option<&'static str>,
    sparkle_code: Option<isize>,
}
#[derive(Clone, serde::Serialize)]
struct Frame { stage: Stage, file: Option<String>, line: u32 }
impl Diagnostics {
    pub(super) fn from_error(error: &anyhow::Error, trigger: Trigger) -> Self {
        let mut value = Self {trigger, stages: vec![], attempt: Attempt::default(), target: None, release_discovery: None, process: None,
            exit_code: None, signal: None, http_status: None, rate_limit_remaining: None, rate_limit_limit: None, rate_limit_reset_after_seconds: None, retry_after_seconds: None, io_kind: None, os_error_code: None,
            json_error_kind: None, sparkle_domain: None, sparkle_code: None};
        for cause in error.chain().take(64) {
            if let Some(boundary) = cause.downcast_ref::<Boundary>() {
                if value.stages.len() == 8 { value.stages.remove(0); }
                value.stages.push(Frame {stage: boundary.stage, file: super::source_file(boundary.location.file()), line: boundary.location.line()});
            }
            if let Some(failure) = cause.downcast_ref::<DiscoveryFailure>() { value.release_discovery = Some(failure.discovery); }
            if let Some(failure) = cause.downcast_ref::<AttemptFailure>() { value.attempt = failure.attempt.clone(); }
            if let Some(failure) = cause.downcast_ref::<TargetFailure>() { value.target = Some(failure.target.clone()); }
            if let Some(failure) = cause.downcast_ref::<CommandFailure>() {
                value.process = Some(failure.process);
                value.exit_code = failure.exit_code;
                value.signal = failure.signal;
                value.http_status = failure.http_status;
                value.rate_limit_remaining = failure.rate_limit_remaining;
                value.rate_limit_limit = failure.rate_limit_limit;
                value.rate_limit_reset_after_seconds = failure.rate_limit_reset_after_seconds;
                value.retry_after_seconds = failure.retry_after_seconds;
            }
            if let Some(error) = cause.downcast_ref::<std::io::Error>() {
                use std::io::ErrorKind;
                value.io_kind = Some(match error.kind() {
                    ErrorKind::NotFound => "not_found", ErrorKind::PermissionDenied => "permission_denied",
                    ErrorKind::AlreadyExists => "already_exists", ErrorKind::InvalidInput => "invalid_input",
                    ErrorKind::InvalidData => "invalid_data", ErrorKind::TimedOut => "timed_out",
                    ErrorKind::StorageFull => "storage_full", ErrorKind::ReadOnlyFilesystem => "read_only_filesystem",
                    ErrorKind::WouldBlock => "would_block", ErrorKind::Interrupted => "interrupted", _ => "other",
                });
                value.os_error_code = error.raw_os_error();
            }
            if let Some(error) = cause.downcast_ref::<serde_json::Error>() {
                value.json_error_kind = Some(match error.classify() {
                    serde_json::error::Category::Io => "io", serde_json::error::Category::Syntax => "syntax",
                    serde_json::error::Category::Data => "data", serde_json::error::Category::Eof => "eof",
                });
            }
        }
        value
    }
    pub(super) fn sparkle(domain: &str, code: isize) -> Self {
        let mut value = Self::from_error(&anyhow::anyhow!("native updater"), Trigger::Sparkle);
        value.sparkle_domain = Some(match domain {
            "SUSparkleErrorDomain" => "sparkle", "NSURLErrorDomain" => "url_loading",
            "NSCocoaErrorDomain" => "cocoa", "NSPOSIXErrorDomain" => "posix", _ => "other",
        });
        value.sparkle_code = Some(code);
        value
    }
    pub(super) fn fingerprint(&self) -> String {
        let stage = self.stages.last().map(|frame| format!("{:?}:{}:{}", frame.stage, frame.file.as_deref().unwrap_or("external"), frame.line))
            .unwrap_or_else(|| "unclassified".into());
        format!("desktop:update:{stage}:{:?}:{:?}:{:?}:{:?}:{:?}:{:?}:{:?}:{}", self.process, self.exit_code, self.http_status,
            self.sparkle_domain.map(|domain| (domain, self.sparkle_code)), self.io_kind, self.os_error_code, self.json_error_kind,
            self.rate_limit_remaining == Some(0))
    }
    pub(super) fn exception_type(&self) -> String {
        self.stages.last().map(|frame| format!("update_{}_failed", stage_code(frame.stage)))
            .unwrap_or_else(|| if self.sparkle_domain.is_some() { "update_sparkle_failed".into() } else { "update_check_failed".into() })
    }
    pub(super) fn summary(&self) -> String {
        let mut parts = vec![self.stages.last().map(|frame| format!("Update failed at {}", stage_code(frame.stage)))
            .unwrap_or_else(|| "Update failed".into())];
        if let Some(code) = self.http_status { parts.push(format!("HTTP {code}")); }
        if let Some(process) = self.process { parts.push(format!("{process:?} exit {:?}, signal {:?}", self.exit_code, self.signal)); }
        if let Some(remaining) = self.rate_limit_remaining { parts.push(format!("rate limit remaining {remaining}")); }
        if let Some(seconds) = self.retry_after_seconds { parts.push(format!("retry after {seconds}s")); }
        if let Some(kind) = self.io_kind { parts.push(format!("I/O {kind}, OS code {:?}", self.os_error_code)); }
        if let Some(kind) = self.json_error_kind { parts.push(format!("JSON {kind}")); }
        if let Some(domain) = self.sparkle_domain { parts.push(format!("native {domain}, code {:?}", self.sparkle_code)); }
        parts.join("; ")
    }
    pub(super) fn frames(&self) -> Vec<serde_json::Value> {
        self.stages.iter().map(|frame| {
            let mut value = serde_json::json!({"platform":"native", "lang":"rust", "function":format!("update_{}", stage_code(frame.stage)),
                "in_app":true,"synthetic":true,"client_resolved":true});
            if let Some(file) = &frame.file { value["filename"] = serde_json::json!(file); value["lineno"] = serde_json::json!(frame.line); }
            value
        }).collect()
    }
}

fn stage_code(stage: Stage) -> String {
    serde_json::to_value(stage).ok().and_then(|value| value.as_str().map(str::to_owned)).unwrap_or_else(|| "unknown".into())
}
