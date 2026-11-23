//! Desktop-only, content-free PostHog errors. Never forward log/error/panic text.
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{OnceLock, mpsc};
use std::time::{Duration, Instant};

use serde_json::{Value, json};

const ENDPOINT: &str = "https://eu.i.posthog.com/i/v0/e/";
const QUEUE_SIZE: usize = 16;
static REPORTER: OnceLock<Reporter> = OnceLock::new();
#[path = "../../../engine/diagnostics/transport.rs"]
pub(crate) mod transport;
use transport::send;
mod finalization;
pub(crate) mod updates;

#[cfg(target_os = "linux")]
#[path = "../../../engine/diagnostics/supervisor.rs"]
pub(super) mod native_supervisor;

/// Only installed release children inherit production reporting admission.
pub(crate) fn configure_child(command: &mut Command) {
    command.env("APPARENT_DESKTOP_REPORTING", if REPORTER.get().is_some() && !cfg!(debug_assertions) { "1" } else { "0" });
}

/// Only reviewed, static failure categories can enter the reporting boundary.
#[derive(Clone, Copy, Debug)]
pub(crate) enum Failure {
    ProtectRecording,
    AudioStart,
    ScreenStart,
    PhoneStart,
    FinalizeCapture,
    VideoExport,
    UpdateCheck,
    RustPanic,
    ElectronMainException,
    ElectronMainRejection,
    ElectronRendererGone,
    ElectronChildGone,
    NativeProcessExit,
}

impl Failure {
    fn code(self) -> &'static str {
        match self {
            Self::ProtectRecording => "recording_storage_failed",
            Self::AudioStart => "audio_start_failed",
            Self::ScreenStart => "screen_start_failed",
            Self::PhoneStart => "phone_start_failed",
            Self::FinalizeCapture => "capture_finalization_failed",
            Self::VideoExport => "video_export_failed",
            Self::UpdateCheck => "update_check_failed",
            Self::RustPanic => "rust_panic",
            Self::ElectronMainException => "electron_main_exception",
            Self::ElectronMainRejection => "electron_main_rejection",
            Self::ElectronRendererGone => "electron_renderer_gone",
            Self::ElectronChildGone => "electron_child_gone",
            Self::NativeProcessExit => "native_process_exit",
        }
    }
}

#[cfg(any(target_os = "macos", test))]
#[path = "../../../engine/diagnostics/sparkle_outcomes.rs"]
mod sparkle_outcomes;
#[cfg(target_os = "macos")]
pub(crate) use sparkle_outcomes::sparkle_error_should_report;

#[derive(Clone, Debug, PartialEq, Eq)]
struct Consent {
    generation: String,
}

/// A missing file/key defaults on; corrupt, unreadable, oversized, symlinked or
/// wrongly typed config fails closed. Do not use the forgiving general loader.
pub(crate) fn reporting_config_in(path: &Path) -> Option<Value> {
    use std::os::unix::fs::OpenOptionsExt;
    let file = std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(path);
    let value: Value = match file {
        Ok(file) => {
            if !file.metadata().ok()?.is_file() {
                return None;
            }
            let mut bytes = Vec::new();
            file.take(65_537).read_to_end(&mut bytes).ok()?;
            if bytes.len() > 65_536 {
                return None;
            }
            serde_json::from_slice(&bytes).ok()?
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => json!({}),
        Err(_) => return None,
    };
    value.as_object()?;
    Some(value)
}

fn consent_in(path: &Path) -> Option<Consent> {
    let value = reporting_config_in(path)?;
    match value.get("errorReporting") {
        None | Some(Value::Bool(true)) => {}
        _ => return None,
    }
    let generation = match value.get("errorReportingGeneration") {
        None => "initial".to_owned(),
        Some(Value::String(value)) if value.len() <= 128 => value.clone(),
        _ => return None,
    };
    Some(Consent { generation })
}

pub(crate) fn enabled_in(path: &Path) -> bool {
    consent_in(path).is_some()
}

pub(crate) fn set_enabled_in(path: &Path, on: bool) -> anyhow::Result<()> {
    set_enabled_admitted_in(path, on, || true).map_err(anyhow::Error::msg)
}

fn set_enabled_admitted_in(path: &Path, on: bool, admit: impl FnOnce() -> bool) -> Result<(), &'static str> {
    let mut expired = false;
    let result = crate::shared::handoff::update_config_in(path, |config| {
        // This check runs against the fresh config after acquiring its flock.
        if !admit() {
            expired = true;
            anyhow::bail!("expired");
        }
        config["errorReporting"] = json!(on);
        // Rotate on EVERY explicit change, so disable/re-enable cannot revive a
        // queued report, even if another process makes both edits between reads.
        config["errorReportingGeneration"] = json!(crate::shared::ids::make_bundle_id());
        Ok(())
    });
    result.map_err(|_| if expired { "admission_expired" } else { "config_write_failed" })
}

fn read_enabled_in(path: &Path) -> Result<bool, &'static str> {
    let config = reporting_config_in(path).ok_or("config_read_failed")?;
    if config.get("errorReportingGeneration").is_some_and(|v| !v.as_str().is_some_and(|s| s.len() <= 128)) {
        return Err("config_read_failed");
    }
    match config.get("errorReporting") {
        None | Some(Value::Bool(true)) => Ok(true),
        Some(Value::Bool(false)) => Ok(false),
        _ => Err("config_read_failed"),
    }
}

pub(crate) fn error_reporting_bridge_in(path: &Path, operation: &str, enabled: Option<bool>, admit: impl FnOnce() -> bool) -> Result<bool, &'static str> {
    match (operation, enabled) {
        ("read", None) => read_enabled_in(path),
        ("set", Some(value)) => {
            set_enabled_admitted_in(path, value, admit)?;
            read_enabled_in(path)
        }
        _ => Err("invalid_request"),
    }
}

#[derive(Clone)]
struct Report {
    failure: Failure,
    file: Option<String>,
    line: u32,
    consent: Consent,
    delivered: Option<mpsc::SyncSender<()>>,
    finalization: Option<finalization::Diagnostics>,
    updater: Option<updates::Diagnostics>,
}

impl Report {
    fn update(error: &anyhow::Error, trigger: updates::Trigger, location: &std::panic::Location<'_>, consent: Consent) -> Self {
        let mut report = Self::new(Failure::UpdateCheck, location, consent);
        report.updater = Some(updates::Diagnostics::from_error(error, trigger));
        report
    }
    fn finalization(error: &anyhow::Error, location: &std::panic::Location<'_>, consent: Consent) -> Self {
        let mut report = Self::new(Failure::FinalizeCapture, location, consent);
        report.finalization = Some(finalization::Diagnostics::from_error(error));
        report
    }

    fn new(failure: Failure, location: &std::panic::Location<'_>, consent: Consent) -> Self {
        Self {
            failure,
            file: source_file(location.file()),
            line: location.line(),
            consent,
            delivered: None,
            finalization: None,
            updater: None,
        }
    }

    fn payload(&self, token: &str) -> std::io::Result<Value> {
        let mut random = [0u8; 16];
        std::fs::File::open("/dev/urandom")?.read_exact(&mut random)?;
        let event_id: String = random.iter().map(|byte| format!("{byte:02x}")).collect();
        let code = self.failure.code();
        let mut frame = json!({"platform":"native", "lang":"rust", "function":code, "in_app":true, "synthetic":true, "client_resolved":true});
        if let Some(file) = &self.file {
            frame["filename"] = json!(file);
            frame["lineno"] = json!(self.line);
        }
        let mut payload = json!({
            "api_key": token,
            "event": "$exception",
            // A fresh event identity, not a person, installation or session.
            "distinct_id": event_id,
            "properties": {
                "$process_person_profile": false,
                "$geoip_disable": true,
                "$ip": null,
                "$lib": "apparent-desktop",
                "$app_version": env!("CARGO_PKG_VERSION"),
                "build": env!("APPARENT_VERSION_LABEL"),
                "commit_sha": env!("APPARENT_COMMIT_SHA"),
                "build_modified": env!("APPARENT_BUILD_MODIFIED") == "true",
                "release_version": env!("APPARENT_RELEASE_VERSION"),
                "package_version": env!("CARGO_PKG_VERSION"),
                "channel": env!("APPARENT_RELEASE_CHANNEL"),
                "environment": env!("APPARENT_REPORTING_ENVIRONMENT"),
                "component": "desktop",
                "process": match self.failure {
                    Failure::ElectronMainException | Failure::ElectronMainRejection => "electron-main",
                    Failure::ElectronRendererGone => "electron-renderer",
                    Failure::ElectronChildGone => "electron-child",
                    _ => "rust",
                },
                "diagnostics_schema_version": 6,
                "$os": std::env::consts::OS,
                "architecture": std::env::consts::ARCH,
                "operation": code,
                "$exception_level": "error",
                "$exception_fingerprint": format!("desktop:{code}:{}:{}", self.file.as_deref().unwrap_or("external"), if self.file.is_some() { self.line } else { 0 }),
                "$exception_list": [{
                    "type": if matches!(self.failure, Failure::RustPanic) { "RustPanic" } else { code },
                    "value": code,
                    "mechanism": { "type":"generic", "handled": !matches!(self.failure, Failure::RustPanic | Failure::ElectronMainException | Failure::ElectronMainRejection | Failure::ElectronRendererGone | Failure::ElectronChildGone), "synthetic": true },
                    "stacktrace": { "type":"raw", "frames":[frame] }
                }]
            }
        });
        // Packaging registers the release; the native transport only forwards
        // its compiled public ID, including for panics without a JS host.
        let release_id = env!("APPARENT_POSTHOG_RELEASE_ID");
        if let Some(diagnostics) = &self.finalization {
            payload["properties"]["finalization"] = serde_json::to_value(diagnostics)?;
            payload["properties"]["$exception_fingerprint"] = json!(diagnostics.fingerprint());
        }
        if let Some(diagnostics) = &self.updater {
            payload["properties"]["updater"] = serde_json::to_value(diagnostics)?;
            payload["properties"]["$exception_fingerprint"] = json!(diagnostics.fingerprint());
            payload["properties"]["$exception_list"][0]["type"] = json!(diagnostics.exception_type());
            payload["properties"]["$exception_list"][0]["value"] = json!(diagnostics.summary());
            let frames = diagnostics.frames();
            if !frames.is_empty() {
                payload["properties"]["$exception_list"][0]["stacktrace"]["frames"] = json!(frames);
            }
        }
        if !release_id.is_empty() {
            payload["properties"]["$release_id"] = json!(release_id);
        }
        Ok(payload)
    }
}

/// Source location only, never runtime paths or dependency/build-root paths.
fn source_file(file: &str) -> Option<String> {
    let relative = file
        .strip_prefix(concat!(env!("CARGO_MANIFEST_DIR"), "/"))
        .unwrap_or(file);
    let allowed = ["capture/", "composition/", "shared/"]
        .iter()
        .any(|prefix| relative.starts_with(prefix))
        || relative == "main.rs";
    (allowed
        && relative.len() <= 256
        && relative.ends_with(".rs")
        && relative.split('/').all(|part| {
            !part.is_empty()
                && part != ".."
                && part
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"_-.".contains(&b))
        }))
    .then(|| relative.to_owned())
}

struct Reporter {
    config: PathBuf,
    sender: mpsc::SyncSender<Report>,
}

impl Reporter {
    fn start(config: PathBuf, token: String, endpoint: String) -> std::io::Result<Self> {
        let (sender, receiver) = mpsc::sync_channel::<Report>(QUEUE_SIZE);
        let path = config.clone();
        std::thread::Builder::new()
            .name("error-reports".into())
            .spawn(move || {
                let mut limiter = Limiter::default();
                while let Ok(mut report) = receiver.recv() {
                    let delivered = report.delivered.take();
                    // The final admission happens immediately before transport, not
                    // when the failing operation queued its report. No config lock
                    // spans network I/O. An already admitted request may finish.
                    if consent_in(&path).as_ref() != Some(&report.consent) {
                        continue;
                    }
                    if !limiter.admit(Instant::now()) {
                        continue;
                    }
                    if let Ok(payload) = report.payload(&token) {
                        let _ = send(&endpoint, &payload);
                    }
                    if let Some(delivered) = delivered {
                        let _ = delivered.try_send(());
                    }
                }
            })?;
        Ok(Self { config, sender })
    }

    fn capture(&self, failure: Failure, location: &std::panic::Location<'_>) {
        self.enqueue(|consent| Report::new(failure, location, consent));
    }

    fn enqueue(&self, build: impl FnOnce(Consent) -> Report) {
        if let Some(consent) = consent_in(&self.config) {
            // Never wait for network or for queue capacity on a capture/UI thread.
            let _ = self
                .sender
                .try_send(build(consent));
        }
    }

    fn capture_panic(&self, location: &std::panic::Location<'_>) {
        if std::thread::current().name() == Some("error-reports") {
            return;
        }
        let Some(consent) = consent_in(&self.config) else {
            return;
        };
        let (sender, receiver) = mpsc::sync_channel(1);
        let mut report = Report::new(Failure::RustPanic, location, consent);
        report.delivered = Some(sender);
        if self.sender.try_send(report).is_ok() {
            // Only the dying thread waits; ordinary failures never wait for I/O.
            let _ = receiver.recv_timeout(Duration::from_secs(2));
        }
    }
}

#[derive(Default)]
struct Limiter {
    window: Option<Instant>,
    count: usize,
}
impl Limiter {
    fn admit(&mut self, now: Instant) -> bool {
        if self
            .window
            .is_none_or(|start| now.duration_since(start) >= Duration::from_secs(60))
        {
            self.window = Some(now);
            self.count = 0;
        }
        if self.count >= 20 {
            return false;
        }
        self.count += 1;
        true
    }
}

/// The publishable project token is supplied by packaging, not user credentials.
pub(crate) fn compiled_token() -> Option<&'static str> {
    option_env!("APPARENT_POSTHOG_TOKEN").filter(|token| {
        token.starts_with("phc_") && (20..=200).contains(&token.len())
            && token.bytes().all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
    })
}

#[cfg(target_os = "linux")]
pub(crate) fn native_consent() -> Option<String> {
    compiled_token()?;
    consent_in(&crate::shared::handoff::default_config_path()).map(|consent| consent.generation)
}

#[cfg(target_os = "linux")]
pub(crate) fn deliver_native(generation: &str, diagnostics: Value, id: &str, metadata: Value) -> bool {
    if native_consent().as_deref() != Some(generation) { return false; }
    let Some(token) = compiled_token() else { return false; };
    let report = Report::new(Failure::NativeProcessExit, std::panic::Location::caller(), Consent { generation: generation.into() });
    let Ok(payload) = report.payload(token) else { return false; };
    send(ENDPOINT, &transport::native_payload(payload, diagnostics, id, metadata)).unwrap_or(false)
}

pub(crate) fn install() {
    if cfg!(test) || REPORTER.get().is_some() {
        return;
    }
    let Some(token) = compiled_token() else {
        return;
    };
    let Ok(reporter) = Reporter::start(
        crate::shared::handoff::default_config_path(),
        token.to_owned(),
        ENDPOINT.to_owned(),
    ) else {
        return;
    };
    install_reporter(reporter);
}

fn install_reporter(reporter: Reporter) {
    if REPORTER.set(reporter).is_err() {
        return;
    }
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        // Deliberately ignore payload, thread name and arbitrary panic text.
        // Best effort, bounded flush before process-wide panic exit.
        if let (Some(reporter), Some(location)) = (REPORTER.get(), info.location()) {
            reporter.capture_panic(location);
        }
        previous(info);
    }));
}

#[track_caller]
pub(crate) fn report(failure: Failure) {
    if let Some(reporter) = REPORTER.get() {
        reporter.capture(failure, std::panic::Location::caller());
    }
}

#[track_caller]
pub(crate) fn report_finalization(error: &anyhow::Error) {
    let location = std::panic::Location::caller();
    if let Some(reporter) = REPORTER.get() {
        reporter.enqueue(|consent| Report::finalization(error, location, consent));
    }
}

#[track_caller]
pub(crate) fn report_update(error: &anyhow::Error, trigger: updates::Trigger) {
    if updates::is_lock_contention(error) { return; }
    let location = std::panic::Location::caller();
    if let Some(reporter) = REPORTER.get() {
        reporter.enqueue(|consent| Report::update(error, trigger, location, consent));
    }
}

#[cfg(test)]
pub(crate) fn update_payload_for_test(error: &anyhow::Error, trigger: updates::Trigger) -> Value {
    Report::update(error, trigger, std::panic::Location::caller(), Consent {generation: "initial".into()})
        .payload("phc_synthetic").unwrap()
}

#[track_caller]
pub(crate) fn report_sparkle_update(domain: &str, code: isize) {
    let location = std::panic::Location::caller();
    if let Some(reporter) = REPORTER.get() {
        reporter.enqueue(|consent| {
            let mut report = Report::new(Failure::UpdateCheck, location, consent);
            report.updater = Some(updates::Diagnostics::sparkle(domain, code));
            report
        });
    }
}

#[cfg(test)]
mod tests;
