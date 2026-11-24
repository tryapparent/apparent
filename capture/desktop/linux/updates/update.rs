//! AppImage updates. The running inode remains in use; the new image starts on the next launch.
//! Never replace a debug build, a symlink, or somebody else's /opt installation.
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, Write};
use std::os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt};
use std::os::fd::AsRawFd;

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Mutex, TryLockError};
use super::get;
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use crate::capture::desktop::workflow::error_reporting::{self, updates::{self, Diagnose, Stage, Trigger}};

macro_rules! ensure_update {
    ($condition:expr, $($message:tt)*) => {
        if !$condition {
            return Err(updates::failure(Stage::Validation, anyhow::anyhow!($($message)*)));
        }
    };
}
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const REPO: &str = "tryapparent/apparent";
static CHECK: Mutex<()> = Mutex::new(());

pub fn set_channel_in(path: &Path, channel: &str) -> Result<()> {
    ensure_update!(matches!(channel, "stable" | "main"), "channel must be stable or main");
    crate::shared::handoff::set_config_value_in(path, "updateChannel", channel.into())
}

fn write_runtime_in(path: &Path, pid: u32, ticks: u64) -> Result<()> {
    let revision = option_env!("GITHUB_SHA").filter(|s| s.len() == 40 && s.bytes().all(|b| b.is_ascii_hexdigit()));
    let installed = target()?.and_then(|image| installed_id(&image));
    crate::shared::handoff::set_config_value_in(path, "running", serde_json::json!({
        "version": env!("CARGO_PKG_VERSION"), "revision": revision,
        "pid": pid, "startTicks": ticks,
        "executable": fs::read_link("/proc/self/exe")?,
        "updateId": installed.as_ref().map(|(_, id)| id),
        "updateChannel": installed.as_ref().map(|(channel, _)| channel),
    }))
}

fn process_ticks(pid: u32) -> Option<u64> {
    let stat = fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    stat.rsplit_once(") ")?.1.split_whitespace().nth(19)?.parse().ok()
}

fn same_executable(current: &Path, recorded: &str) -> bool {
    // Linux appends this suffix to /proc/PID/exe after the AppImage is exchanged.
    // The running process keeps its old version even though its inode moved.
    current.to_str().is_some_and(|path| path.strip_suffix(" (deleted)").unwrap_or(path) == recorded)
}

pub fn record_running() -> Result<()> {
    let pid = std::process::id();
    write_runtime_in(&crate::shared::handoff::default_config_path(), pid,
        process_ticks(pid).context("cannot read Apparent process start time")?)
}

/// Mark the GPUI application as initialized for the update relaunch helper.
pub fn mark_relaunch_ready() -> Result<()> {
    let Some(path) = std::env::var_os("APPARENT_UPDATE_READY").map(PathBuf::from) else { return Ok(()) };
    let image = target()?.context("relaunch readiness requires an AppImage")?;
    let expected = format!(".{}.ready-", image.file_name().unwrap().to_string_lossy());
    ensure_update!(path.parent() == image.parent() && path.file_name().is_some_and(|name| name.to_string_lossy().starts_with(&expected)),
        "invalid relaunch readiness path");
    OpenOptions::new().write(true).create_new(true).open(path)?.sync_all()?;
    Ok(())
}

pub fn status_at(path: &Path) -> Result<serde_json::Value> {
    let config: serde_json::Value = match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes)?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => serde_json::json!({}),
        Err(error) => return Err(error.into()),
    };
    ensure_update!(config.is_object(), "config must be an object");
    let channel = if config["updateChannel"] == "main" { "main" } else { "stable" };
    let recorded = &config["running"];
    let running = match (recorded["pid"].as_u64().and_then(|n| u32::try_from(n).ok()), recorded["startTicks"].as_u64()) {
        (Some(pid), Some(ticks)) if process_ticks(pid) == Some(ticks)
            && fs::read_link(format!("/proc/{pid}/exe")).ok().as_deref()
                .zip(recorded["executable"].as_str())
                .is_some_and(|(current, original)| same_executable(current, original)) => recorded.clone(),
        _ => serde_json::Value::Null,
    };
    let image = target()?;
    let installed = image.as_ref().and_then(|path| installed_id(path));
    let pending_restart = installed.as_ref().is_some_and(|(feed, id)| {
        running.is_object() && (running["updateId"].as_str() != Some(id.as_str()) ||
            running["updateChannel"].as_str() != Some(feed.as_str()))
    });
    Ok(serde_json::json!({
        "channel": channel, "running": running,
        "installed": installed.as_ref().map(|(feed, id)| serde_json::json!({"channel": feed, "id": id})),
        "pendingRestart": pending_restart, "canUpdate": image.is_some(),
    }))
}

pub fn status() -> Result<serde_json::Value> {
    status_at(&crate::shared::handoff::default_config_path())
}

pub fn check_cli() -> Result<&'static str> {
    check_with_progress(&|_| {})
}

#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize)]
#[serde(tag = "phase", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub(crate) enum UpdateProgress {
    Downloading { downloaded_bytes: u64, total_bytes: u64 },
    Verifying,
    Installing,
}

pub(crate) fn check_with_progress(progress: &dyn Fn(UpdateProgress)) -> Result<&'static str> {
    let result = check_cli_inner(progress);
    if let Err(error) = &result { error_reporting::report_update(error, Trigger::User); }
    result
}

fn check_cli_inner(progress: &dyn Fn(UpdateProgress)) -> Result<&'static str> {
    target().stage(Stage::Target)?
        .context("Updates require an AppImage owned by you under your home directory").stage(Stage::Target)?;
    let _guard = CHECK.try_lock().map_err(|error| match error {
        TryLockError::WouldBlock => updates::lock_contention(std::io::Error::from(std::io::ErrorKind::WouldBlock)),
        TryLockError::Poisoned(_) => anyhow::anyhow!("update check lock poisoned"),
    }).stage(Stage::Lock)?;
    Ok(if check(progress)? {
        "installed; restart Apparent to use it"
    } else {
        let status = status().stage(Stage::Config)?;
        if restart_pending(&status) && status["installed"]["channel"] == status["channel"] {
            "already installed; restart Apparent to use it"
        } else {
            "up to date"
        }
    })
}

pub(crate) fn restart_pending(status: &serde_json::Value) -> bool {
    status["pendingRestart"] == true
}

/// Start the installed AppImage after this process exits, not the old running inode.
pub fn relaunch_staged() -> Result<()> {
    let image = target()?.context("Updates require an owned AppImage under your home directory")?;
    let name = image.file_name().context("AppImage has no name")?.to_string_lossy();
    let backup = image.with_file_name(format!(".{name}.previous"));
    // Own the transaction from validation through post-exit readiness/recovery.
    let mut command = relaunch_command(&image, &backup, std::process::id())?;
    ensure_update!(restart_pending(&status()?), "no installed update is waiting for a restart");
    ensure_update!(backup.is_file(), "previous AppImage is unavailable for recovery");
    ensure_update!(fs::metadata(&backup)?.permissions().mode() & 0o111 != 0, "previous AppImage is not executable");
    // A successful shell spawn proves nothing about the image it will execute later.
    // Check the new image before leaving the running app, and keep the old one as a
    // recovery path if the image disappears or fails to start after this process exits.
    preflight_image(&image, Duration::from_secs(5)).stage(Stage::Preflight)?;
    command.spawn()
        .context("cannot start updated AppImage after exit").stage(Stage::RestartLaunch)?;
    Ok(())
}

fn preflight_image(image: &Path, timeout: Duration) -> Result<()> {
    let mut child = Command::new(image).arg("--help")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null()).spawn()
        .context("updated AppImage could not start")?;
    let start = Instant::now();
    loop {
        if let Some(status) = child.try_wait()? {
            if !status.success() {
                return Err(updates::command_failure(updates::Process::Preflight, status, updates::Http::default(), anyhow::anyhow!("updated AppImage failed its startup check")));
            }
            return Ok(());
        }
        if start.elapsed() >= timeout {
            let _ = child.kill();
            let _ = child.wait();
            return Err(updates::failure(Stage::PreflightTimeout, anyhow::anyhow!("updated AppImage startup check timed out")));
        }
        std::thread::sleep(Duration::from_millis(25));
    }
}

fn file_identity(path: &Path) -> Result<String> {
    match fs::symlink_metadata(path) {
        Ok(meta) => {
            ensure_update!(meta.is_file() && !meta.file_type().is_symlink() && meta.uid() == unsafe { libc::geteuid() },
                "update recovery input must be an owned regular file");
            Ok(format!("{}:{}", meta.dev(), meta.ino()))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok("-".into()),
        Err(error) => Err(error.into()),
    }
}

fn marker_contents(path: &Path) -> Result<String> {
    match fs::read_to_string(path) {
        Ok(text) => Ok(text.trim_end_matches('\n').to_owned()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(error) => Err(error.into()),
    }
}

fn relaunch_command(image: &Path, backup: &Path, pid: u32) -> Result<Command> {
    let lock = transaction_lock(image)?;
    let marker = image.with_extension("AppImage.apparent-update.json");
    let previous_marker = backup.with_file_name(format!("{}.apparent-update.json", backup.file_name().unwrap().to_string_lossy()));
    let failed_marker = image.with_file_name(format!(".{}.failed-update.json", image.file_name().unwrap().to_string_lossy()));
    let ready = image.with_file_name(format!(".{}.ready-{pid}", image.file_name().unwrap().to_string_lossy()));
    let mut command = Command::new("/bin/sh");
    command
        .arg("-c")
        .arg(r#"pid=$1; image=$2; backup=$3; marker=$4; previous_marker=$5; failed_marker=$6; ready=$7
image_id=$8; backup_id=$9; shift 9; marker_id=$1; previous_id=$2; marker_text=$3; previous_text=$4
same() {
    [ ! -L "$1" ] || return 1
    if [ "$2" = '-' ]; then [ ! -e "$1" ]; else [ "$(stat -c '%d:%i' "$1" 2>/dev/null)" = "$2" ]; fi
}
unchanged() {
    { same "$image" "$image_id" || { [ ! -e "$image" ] && [ ! -L "$image" ]; }; } &&
    same "$backup" "$backup_id" && same "$marker" "$marker_id" && same "$previous_marker" "$previous_id" &&
    [ "$(cat "$marker" 2>/dev/null)" = "$marker_text" ] && [ "$(cat "$previous_marker" 2>/dev/null)" = "$previous_text" ]
}
i=0
while kill -0 "$pid" 2>/dev/null && [ "$i" -lt 100 ]; do sleep 0.1; i=$((i+1)); done
kill -0 "$pid" 2>/dev/null && exit 1
unchanged || exit 1
rm -f "$ready"
APPARENT_UPDATE_READY="$ready" APPARENT_UPDATE_REOPEN_SETTINGS=1 "$image" app </dev/null & child=$!
i=0
while [ "$i" -lt 150 ]; do
    if [ -f "$ready" ] && kill -0 "$child" 2>/dev/null; then rm -f "$ready"; exit 0; fi
    if ! kill -0 "$child" 2>/dev/null; then break; fi
    sleep 0.1; i=$((i+1))
done
if kill -0 "$child" 2>/dev/null; then
    kill "$child" 2>/dev/null
    i=0
    while kill -0 "$child" 2>/dev/null && [ "$i" -lt 20 ]; do sleep 0.1; i=$((i+1)); done
    # SIGTERM may only queue cooperative Stop. Do not hold the transaction
    # forever, force-kill a possibly busy app, or replace an image still live.
    kill -0 "$child" 2>/dev/null && exit 1
fi
wait "$child" 2>/dev/null
rm -f "$ready"
# A non-cooperating writer must not make us roll back or blacklist its image.
unchanged || exit 1
if [ -x "$backup" ]; then
    if mv -f "$backup" "$image"; then
        if [ -f "$marker" ]; then mv -f "$marker" "$failed_marker" || rm -f "$marker"; fi
        if [ -f "$previous_marker" ]; then mv -f "$previous_marker" "$marker" || rm -f "$marker"; else rm -f "$marker"; fi
        APPARENT_UPDATE_REOPEN_SETTINGS=1 exec "$image" app </dev/null
    fi
    APPARENT_UPDATE_REOPEN_SETTINGS=1 exec "$backup" app </dev/null
fi
exit 1"#)
        .arg("apparent-update-relaunch")
        .arg(pid.to_string())
        .arg(image)
        .arg(backup)
        .arg(&marker)
        .arg(&previous_marker)
        .arg(failed_marker)
        .arg(ready)
        .arg(file_identity(image)?)
        .arg(file_identity(backup)?)
        .arg(file_identity(&marker)?)
        .arg(file_identity(&previous_marker)?)
        .arg(marker_contents(&marker)?)
        .arg(marker_contents(&previous_marker)?)
        .env_remove("APPIMAGE")
        .env_remove("APPDIR")
        // Carry the same open-file-description lock across exec with no
        // unlock/relock gap. The shell reads its program from -c, not stdin;
        // launched app children reopen /dev/null and cannot retain the lock.
        .stdin(std::process::Stdio::from(lock))
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    Ok(command)
}

// Main previews are published from main as GitHub releases.

#[derive(Debug, Deserialize, Serialize)]
struct Release {
    tag_name: String,
    #[serde(default)]
    prerelease: bool,
    #[serde(default)]
    draft: bool,
    published_at: Option<String>,
    assets: Vec<ReleaseAsset>,
}

#[derive(Debug, Deserialize, Serialize)]
struct ReleaseAsset {
    name: String,
    #[serde(skip_serializing)]
    browser_download_url: String,
    #[serde(default, skip_serializing)]
    size: u64,
}

struct Candidate {
    id: String,
    channel: &'static str,
    url: String,
    sha256: String,
    size: u64,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
enum Selection {
    Unsupported,
    NoRelease,
    Selected { release: usize, image: usize, checksum: usize },
}

#[derive(Serialize)]
struct SelectionRequest<'a> {
    operation: &'static str,
    channel: &'static str,
    arch: &'a str,
    releases: &'a [Release],
}

fn candidate_from_history(
    releases: &[Release],
    channel: &'static str,
    arch: &str,
    fetch: &impl Fn(&str) -> Result<Vec<u8>>,
) -> Result<Option<Candidate>> {
    let selection = run_update_policy(&SelectionRequest {
        operation: "selectRelease",
        channel,
        arch,
        releases,
    }).stage(Stage::Policy)?;
    let (release, image, checksum) = match selection {
        Selection::Unsupported => return Err(anyhow::anyhow!("no AppImage for this CPU")).stage(Stage::Target),
        Selection::NoRelease => return Ok(None),
        Selection::Selected { release, image, checksum } => {
            let release = releases.get(release).context("invalid selected release").stage(Stage::PolicyResponse)?;
            let image = release.assets.get(image).context("invalid selected image").stage(Stage::PolicyResponse)?;
            let checksum = release.assets.get(checksum).context("invalid selected checksum").stage(Stage::PolicyResponse)?;
            (release, image, checksum)
        }
    };
    candidate_from_selection(release, image, checksum, channel, arch, fetch).map(Some)
}

fn candidate_from_selection(
    release: &Release,
    image: &ReleaseAsset,
    checksum: &ReleaseAsset,
    channel: &'static str,
    arch: &str,
    fetch: &impl Fn(&str) -> Result<Vec<u8>>,
) -> Result<Candidate> {
    let id = if channel == "main" {
        let sha = release.tag_name.strip_prefix("linux-main-v2-").context("not a main preview")?;
        ensure_update!(sha.len() == 40 && sha.bytes().all(|b| b.is_ascii_hexdigit()), "invalid main revision");
        let suffix = format!("-linux-{arch}.AppImage");
        let version = image.name.strip_prefix("Apparent-").and_then(|name| name.strip_suffix(&suffix))
            .context("main preview has no AppImage for this CPU")?;
        ensure_update!(!version.is_empty() && version.bytes().all(|b| b.is_ascii_digit() || b == b'.'), "invalid main AppImage version");
        sha
    } else {
        let version = release.tag_name.strip_prefix('v').context("not a stable release")?;
        ensure_update!(image.name == format!("Apparent-{version}-linux-{arch}.AppImage"), "unexpected stable AppImage name");
        &release.tag_name
    };
    ensure_update!(checksum.name == format!("{}.sha256", image.name), "unexpected release checksum asset");
    let prefix = format!("https://github.com/{REPO}/releases/download/{}/", release.tag_name);
    ensure_update!(image.browser_download_url == format!("{prefix}{}", image.name)
        && checksum.browser_download_url == format!("{prefix}{}", checksum.name), "unexpected release asset URL");
    let body = fetch(&checksum.browser_download_url).stage(Stage::ChecksumFetch)?;
    let text = std::str::from_utf8(&body).stage(Stage::ChecksumParse)?;
    let (hash, name) = text.trim().split_once(char::is_whitespace).context("invalid release checksum").stage(Stage::ChecksumParse)?;
    ensure_update!(name.trim() == image.name, "checksum refers to another file");
    ensure_update!(hash.len() == 64 && hash.bytes().all(|b| b.is_ascii_hexdigit()), "invalid SHA-256");
    Ok(Candidate { id: id.to_owned(), channel, url: image.browser_download_url.clone(), sha256: hash.to_owned(), size: image.size })
}

fn latest_candidate_with(
    channel: &'static str,
    arch: &str,
    fetch: &impl Fn(&str) -> Result<Vec<u8>>,
) -> Result<Option<Candidate>> {
    let candidate = candidate_from_history(&release_history(fetch)?, channel, arch, fetch)?;
    if channel == "main" {
        return candidate.context("no published Linux main preview yet").map(Some);
    }
    Ok(candidate)
}

fn release_history(fetch: &impl Fn(&str) -> Result<Vec<u8>>) -> Result<Vec<Release>> {
    use std::sync::{OnceLock, atomic::{AtomicU32, Ordering}};
    static REQUESTS: AtomicU32 = AtomicU32::new(0);
    static START: OnceLock<Instant> = OnceLock::new();
    let start = START.get_or_init(Instant::now);
    let mut releases = Vec::new();
    let mut complete = false;
    for page in 1..=10 {
        let requests = REQUESTS.fetch_update(Ordering::Relaxed, Ordering::Relaxed, |value| Some(value.saturating_add(1))).unwrap().saturating_add(1);
        let body = fetch(&format!("https://api.github.com/repos/{REPO}/releases?per_page=100&page={page}"))
            .map_err(|error| updates::discovery_failure(error, updates::ReleaseDiscovery {
                page, requests_in_process: requests,
                elapsed_seconds: start.elapsed().as_secs().min(u64::from(u32::MAX)) as u32,
            })).stage(Stage::ReleaseListFetch)?;
        let page_releases: Vec<Release> = serde_json::from_slice(&body).context("invalid release list").stage(Stage::ReleaseListParse)?;
        ensure_update!(page_releases.len() <= 100, "oversized release page");
        complete = page_releases.len() < 100;
        releases.extend(page_releases);
        if complete { break; }
    }
    ensure_update!(complete, "release discovery exceeded its page limit");
    Ok(releases)
}

fn installed_id(image: &Path) -> Option<(String, String)> {
    update_id(&image.with_extension("AppImage.apparent-update.json"))
}

fn update_id(marker: &Path) -> Option<(String, String)> {
    let value: serde_json::Value = serde_json::from_slice(&fs::read(marker).ok()?).ok()?;
    Some((value["channel"].as_str()?.to_owned(), value["id"].as_str()?.to_owned()))
}

fn previously_failed(marker: &Path, candidate: &Candidate) -> bool {
    update_id(marker) == Some((candidate.channel.to_owned(), candidate.id.clone()))
}

fn needs_channel_release(candidate: &Candidate, installed: Option<(String, String)>) -> Result<bool> {
    run_update_policy(&serde_json::json!({
        "operation": "needsChannelRelease",
        "candidate": {"channel": candidate.channel, "id": candidate.id},
        "installed": installed.map(|(channel, id)| serde_json::json!({"channel":channel,"id":id})),
        "revision": env!("APPARENT_COMMIT_SHA"),
        "modified": env!("APPARENT_BUILD_MODIFIED") == "true",
    }))
}

fn run_update_policy<T: serde::de::DeserializeOwned>(facts: &impl Serialize) -> Result<T> {
    let (runtime, script) = update_policy_assets().context("packaged update policy is unavailable").stage(Stage::PolicyAssets)?;
    let mut input = tempfile::tempfile().stage(Stage::PolicyLaunch)?;
    serde_json::to_writer(&mut input, facts).stage(Stage::PolicyLaunch)?;
    input.rewind().stage(Stage::PolicyLaunch)?;
    let mut child = Command::new(runtime).env("ELECTRON_RUN_AS_NODE", "1")
        .arg(script).stdin(input).stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null()).spawn().stage(Stage::PolicyLaunch)?;
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        if let Some(status) = child.try_wait()? {
            if !status.success() {
                return Err(updates::command_failure(updates::Process::Policy, status, updates::Http::default(), anyhow::anyhow!("update policy failed")));
            }
            let mut output = String::new();
            child.stdout.take().context("missing update policy output").stage(Stage::PolicyResponse)?.take(129).read_to_string(&mut output).stage(Stage::PolicyResponse)?;
            ensure_update!(output.len() <= 128, "oversized update policy response");
            return serde_json::from_str(&output).context("invalid update policy decision").stage(Stage::PolicyResponse);
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err(updates::failure(Stage::PolicyTimeout, anyhow::anyhow!("update policy timed out")));
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}

fn update_policy_assets() -> Option<(PathBuf, PathBuf)> {
    let executable = std::env::current_exe().ok()?;
    let root = executable.parent()?.parent()?.join("share/apparent/settings");
    let mut candidates = vec![(root.join("runtime/electron"), root.join("app/electron/settings/update-worker.cjs"))];
    if cfg!(any(test, debug_assertions)) {
        let source = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("capture/desktop/ui/frontend");
        candidates.push((source.join("node_modules/electron/dist/electron"), source.join("electron/settings/update-worker.cjs")));
    }
    candidates.into_iter().find(|(runtime, script)| runtime.is_file() && script.is_file())
}

fn target() -> Result<Option<PathBuf>> {
    let Some(path) = std::env::var_os("APPIMAGE").map(PathBuf::from) else { return Ok(None) };
    let home_override = std::env::var_os("HOME").is_some_and(|value| !value.is_empty());
    validate_target(&path, dirs::home_dir().as_deref(), account_home().as_deref(), home_override).map(Some)
}

fn account_home() -> Option<PathBuf> {
    use std::{ffi::{CStr, OsStr}, os::unix::ffi::OsStrExt};
    let mut size = 4096;
    while size <= 65536 {
        let mut buffer = vec![0u8; size];
        let mut record = std::mem::MaybeUninit::<libc::passwd>::uninit();
        let mut found = std::ptr::null_mut();
        // getpwuid_r writes the record and its strings into caller-owned storage.
        let rc = unsafe { libc::getpwuid_r(libc::geteuid(), record.as_mut_ptr(), buffer.as_mut_ptr().cast(), buffer.len(), &mut found) };
        if rc == libc::ERANGE { size *= 2; continue; }
        if rc != 0 || found.is_null() { return None; }
        let record = unsafe { record.assume_init() };
        if record.pw_dir.is_null() { return None; }
        let bytes = unsafe { CStr::from_ptr(record.pw_dir) }.to_bytes();
        return (!bytes.is_empty()).then(|| PathBuf::from(OsStr::from_bytes(bytes)));
    }
    None
}

fn path_class(path: &Path) -> updates::PathClass {
    use updates::PathClass;
    if path == Path::new("/") { PathClass::Root }
    else if path.starts_with("/home") || path.starts_with("/root") { PathClass::Home }
    else if path.starts_with("/tmp") || path.starts_with("/var/tmp") { PathClass::Temporary }
    else if path.starts_with("/opt") { PathClass::Opt }
    else if path.starts_with("/usr") { PathClass::Usr }
    else if path.starts_with("/run") { PathClass::Run }
    else { PathClass::Other }
}

pub(crate) fn validate_target(image: &Path, home: Option<&Path>, account: Option<&Path>, home_from_environment: bool) -> Result<PathBuf> {
    use updates::TargetStep;
    let mut facts = updates::Target { step: TargetStep::Metadata, image_absolute: image.is_absolute(), home_from_environment,
        home_matches_account: home.zip(account).map(|(selected, account)| selected == account),
        image_regular: None, image_symlink: None, image_owned: None, home_absolute: None,
        image_path_changed: None, home_path_changed: None, image_under_home_before_canonicalization: None,
        image_under_home: None, image_location: None, home_location: None };
    let result = (|| {
        let meta = fs::symlink_metadata(image)?;
        facts.image_regular = Some(meta.is_file());
        facts.image_symlink = Some(meta.file_type().is_symlink());
        facts.image_owned = Some(meta.uid() == unsafe { libc::geteuid() });
        facts.step = TargetStep::FileType;
        ensure_update!(meta.is_file() && !meta.file_type().is_symlink(), "update target must be an ordinary AppImage");
        facts.step = TargetStep::Ownership;
        ensure_update!(facts.image_owned == Some(true), "update target belongs to another user");
        facts.step = TargetStep::HomeDiscovery;
        let home = home.context("home directory unavailable")?;
        facts.home_absolute = Some(home.is_absolute());
        facts.image_under_home_before_canonicalization = Some(image.starts_with(home));
        facts.step = TargetStep::ImageCanonicalization;
        let path = image.canonicalize()?;
        facts.image_path_changed = Some(path != image);
        facts.image_location = Some(path_class(&path));
        facts.step = TargetStep::HomeCanonicalization;
        let canonical_home = home.canonicalize()?;
        facts.home_path_changed = Some(canonical_home != home);
        facts.home_location = Some(path_class(&canonical_home));
        facts.image_under_home = Some(path.starts_with(&canonical_home));
        facts.step = TargetStep::HomeBoundary;
        ensure_update!(facts.image_under_home == Some(true), "refusing to replace an AppImage outside your home");
        Ok(path)
    })();
    result.map_err(|error| updates::target_failure(error, facts))
}

fn verify_download(stage: &Path, hash: &str) -> Result<()> {
    let mut hasher = Sha256::new();
    let mut file = File::open(stage).stage(Stage::DownloadRead)?;
    let mut bytes = [0u8; 128 * 1024];
    loop {
        let n = file.read(&mut bytes).stage(Stage::DownloadRead)?;
        if n == 0 { break; }
        hasher.update(&bytes[..n]);
    }
    ensure_update!(format!("{:x}", hasher.finalize()) == hash, "AppImage checksum mismatch");
    let mut perms = fs::metadata(stage).stage(Stage::ImagePermissions)?.permissions();
    perms.set_mode(0o700);
    fs::set_permissions(stage, perms).stage(Stage::ImagePermissions)?;
    File::open(stage).stage(Stage::DownloadSync)?.sync_all().stage(Stage::DownloadSync)?;
    Ok(())
}

fn exchange(stage: &Path, image: &Path) -> Result<()> {
    let a = std::ffi::CString::new(stage.as_os_str().as_encoded_bytes())?;
    let b = std::ffi::CString::new(image.as_os_str().as_encoded_bytes())?;
    let rc = unsafe { libc::renameat2(libc::AT_FDCWD, a.as_ptr(), libc::AT_FDCWD, b.as_ptr(), libc::RENAME_EXCHANGE) };
    if rc != 0 {
        return Err(std::io::Error::last_os_error()).context("atomic AppImage swap failed").stage(Stage::Swap);
    }
    Ok(())
}

fn install(candidate: &Candidate, image: &Path, progress: &dyn Fn(UpdateProgress)) -> Result<()> {
    let parent = image.parent().context("AppImage has no parent")?;
    let name = image.file_name().context("AppImage has no name")?.to_string_lossy();
    let stage = parent.join(format!(".{name}.download-{}", std::process::id()));
    let backup = parent.join(format!(".{name}.previous"));
    let sidecar = image.with_extension("AppImage.apparent-update.json");
    let previous_sidecar = parent.join(format!(".{name}.previous.apparent-update.json"));
    let staged_sidecar = parent.join(format!(".{name}.update-{}", std::process::id()));
    // Reserve only our own temporary path; never reuse another process's download.
    let _reserved = OpenOptions::new().write(true).create_new(true).open(&stage).stage(Stage::ReserveStage)?;
    let mut swapped = false;
    let result = (|| -> Result<()> {
        get(&candidate.url, Some((&stage, candidate.size, progress))).stage(Stage::AssetDownload)?;
        progress(UpdateProgress::Verifying);
        verify_download(&stage, &candidate.sha256).stage(Stage::ChecksumVerify)?;
        progress(UpdateProgress::Installing);
        // Fail closed if the launcher changed while the download was in flight.
        let current = fs::symlink_metadata(image).stage(Stage::InstallTarget)?;
        ensure_update!(current.is_file() && !current.file_type().is_symlink() && current.uid() == unsafe { libc::geteuid() }, "installed AppImage changed while downloading");
        let config = crate::shared::handoff::load_config_from(&crate::shared::handoff::default_config_path());
        let selected = if config.update_channel.as_deref() == Some("main") { "main" } else { "stable" };
        ensure_update!(selected == candidate.channel, "channel changed while downloading");
        let mut f = OpenOptions::new().write(true).create_new(true).open(&staged_sidecar).stage(Stage::MarkerWrite)?;
        f.write_all(serde_json::to_string(&serde_json::json!({"channel": candidate.channel, "id": candidate.id}))?.as_bytes()).stage(Stage::MarkerWrite)?;
        f.sync_all().stage(Stage::MarkerWrite)?;
        // Keep the old version marker with its old image, or remove a stale one.
        if fs::symlink_metadata(&previous_sidecar).is_ok() {
            fs::remove_file(&previous_sidecar).stage(Stage::BackupMarker)?;
        }
        match fs::symlink_metadata(&sidecar) {
            Ok(meta) => {
                ensure_update!(meta.is_file() && !meta.file_type().is_symlink() && meta.uid() == unsafe { libc::geteuid() }, "update marker is not an owned regular file");
                fs::copy(&sidecar, &previous_sidecar).stage(Stage::BackupMarker)?;
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {},
            Err(error) => return Err(error.into()),
        }
        exchange(&stage, image)?;
        swapped = true;
        // The old AppImage is now at stage; it remains a rollback copy.
        if let Err(error) = fs::rename(&stage, &backup) {
            exchange(&stage, image).context("could not restore installed AppImage after backup failed")?;
            swapped = false;
            return Err(error).context("could not retain the previous AppImage").stage(Stage::BackupPublish);
        }
        if let Err(error) = fs::rename(&staged_sidecar, &sidecar) {
            exchange(&backup, image).context("could not restore installed AppImage after marker failed")?;
            let _ = fs::remove_file(&backup);
            return Err(error).context("could not publish the updated version marker").stage(Stage::MarkerPublish);
        }
        Ok(())
    })();
    // If the swap succeeded, stage no longer exists; never touch the installed image here.
    if !swapped && stage.exists() { let _ = fs::remove_file(&stage); }
    if staged_sidecar.exists() { let _ = fs::remove_file(&staged_sidecar); }
    result
}

fn transaction_lock(image: &Path) -> Result<File> {
    let name = image.file_name().context("AppImage has no name")?.to_string_lossy();
    let path = image.with_file_name(format!(".{name}.lock"));
    // Do not unlink this inode on release: a waiter must never lock a different
    // file while the previous transaction still holds the original one.
    let lock = OpenOptions::new().read(true).write(true).create(true).mode(0o600)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC).open(path)?;
    let meta = lock.metadata()?;
    ensure_update!(meta.is_file() && meta.uid() == unsafe { libc::geteuid() }
        && meta.nlink() == 1 && meta.mode() & 0o077 == 0, "update lock must be a private owned file");
    if unsafe { libc::flock(lock.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } != 0 {
        let error = std::io::Error::last_os_error();
        let error = if error.kind() == std::io::ErrorKind::WouldBlock {
            updates::lock_contention(error)
        } else {
            anyhow::Error::from(error).context("cannot acquire update transaction lock")
        };
        return Err(error).stage(Stage::Lock);
    }
    Ok(lock)
}

fn check(progress: &dyn Fn(UpdateProgress)) -> Result<bool> {
    let mut attempt = updates::Attempt::default();
    check_attempt(&mut attempt, progress).map_err(|error| updates::attempted(error, attempt))
}

fn check_attempt(attempt: &mut updates::Attempt, progress: &dyn Fn(UpdateProgress)) -> Result<bool> {
    let Some(image) = target().stage(Stage::Target)? else { return Ok(false) };
    // CLI processes and the GUI's hourly/manual worker share this lock. Acquire
    // before reading identity or discovering a release; hold through the swap.
    let _transaction = transaction_lock(&image).stage(Stage::Lock)?;
    let status = status().stage(Stage::Config)?;
    let installed = installed_id(&image);
    attempt.selected(status["channel"].as_str().unwrap_or("unknown"), installed.as_ref());
    let (channel, stage) = if status["channel"] == "main" {
        ("main", Stage::MainRelease)
    } else {
        ("stable", Stage::StableRelease)
    };
    let Some(candidate) = latest_candidate_with(channel, std::env::consts::ARCH, &|url| get(url, None)).stage(stage)?
        else { return Ok(false); };
    attempt.candidate(candidate.channel, &candidate.id, installed.as_ref(), env!("APPARENT_COMMIT_SHA"));
    let name = image.file_name().context("AppImage has no name")?.to_string_lossy();
    let failed = image.with_file_name(format!(".{name}.failed-update.json"));
    ensure_update!(!previously_failed(&failed, &candidate), "this update failed to start previously; waiting for a newer release");
    if !needs_channel_release(&candidate, installed).stage(Stage::Policy)? { return Ok(false) }
    progress(UpdateProgress::Downloading { downloaded_bytes: 0, total_bytes: candidate.size });
    install(&candidate, &image, progress).stage(Stage::Install)?;
    super::super::integration::shell::notify("Apparent updated", "The new version will start the next time you open Apparent. Your previous AppImage is kept beside it.");
    Ok(true)
}

pub fn check_now() {
    if let Ok(_guard) = CHECK.try_lock()
        && let Err(error) = check(&|_| {})
    {
        crate::capture::engine::runtime::apparent_log(format!("Linux update: {error:#}"));
        error_reporting::report_update(&error, Trigger::Automatic);
    }
}

pub fn start() {
    if std::env::var_os("APPIMAGE").is_none() { return }
    std::thread::spawn(|| loop {
        check_now();
        std::thread::sleep(Duration::from_secs(3600));
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::{CURL_HTTP_STATUS, download_output, reset_after_seconds};

    #[test]
    fn target_location_categories_use_components_and_never_expose_private_suffixes() {
        for (path, expected) in [
            ("/", "root"), ("/home/private-account/app", "home"), ("/root/app", "home"),
            ("/tmp/private-session/app", "temporary"), ("/var/tmp/private-session/app", "temporary"),
            ("/opt/private-install/app", "opt"), ("/usr/local/bin/app", "usr"), ("/run/private-session/app", "run"),
            ("/home-other/private-account/app", "other"), ("/tmp-other/app", "other"), ("relative/private-app", "other"),
        ] {
            assert_eq!(serde_json::to_value(path_class(Path::new(path))).unwrap(), expected);
        }
    }

    #[test]
    fn target_diagnostics_reproduce_home_mismatch_and_symlink_escape_without_paths() {
        use std::os::unix::fs::symlink;
        let scratch = tempfile::tempdir().unwrap();
        let home = scratch.path().join("private-home-canary");
        let outside = scratch.path().join("private-other-canary");
        fs::create_dir(&home).unwrap();
        fs::create_dir(&outside).unwrap();
        let image = outside.join("private-image-canary.AppImage");
        fs::write(&image, b"synthetic image").unwrap();
        let failure = |image: &Path, home: Option<&Path>, account: Option<&Path>| {
            let error = validate_target(image, home, account, true).stage(Stage::Target).unwrap_err();
            error_reporting::update_payload_for_test(&error, Trigger::Automatic)
        };
        let payload = failure(&image, Some(&home), Some(&outside));
        let facts = &payload["properties"]["updater"]["target"];
        assert_eq!(facts["step"], "home_boundary");
        assert_eq!(facts["home_from_environment"], true);
        assert_eq!(facts["home_matches_account"], false);
        assert_eq!(facts["image_owned"], true);
        assert_eq!(facts["image_under_home_before_canonicalization"], false);
        assert_eq!(facts["image_under_home"], false);
        assert_eq!(facts["image_path_changed"], false);
        // Both are siblings beneath the caller's TMPDIR, which CI places under
        // /home rather than /tmp. Their common category must survive reporting.
        assert_eq!(facts["image_location"], facts["home_location"]);
        assert!(facts["image_location"].is_string());
        assert!(!payload.to_string().contains("private-"));
        assert!(!payload.to_string().contains(scratch.path().to_str().unwrap()));
        symlink(&outside, home.join("linked")).unwrap();
        let payload = failure(&home.join("linked/private-image-canary.AppImage"), Some(&home), Some(&home));
        let facts = &payload["properties"]["updater"]["target"];
        assert_eq!(facts["home_matches_account"], true);
        assert_eq!(facts["image_under_home_before_canonicalization"], true);
        assert_eq!(facts["image_under_home"], false);
        assert_eq!(facts["image_path_changed"], true);
        assert!(!payload.to_string().contains("private-"));
        symlink(&image, home.join("image-link")).unwrap();
        assert_eq!(failure(&home.join("image-link"), Some(&home), Some(&home))["properties"]["updater"]["target"]["step"], "file_type");
        assert_eq!(failure(&image, None, None)["properties"]["updater"]["target"]["step"], "home_discovery");
        assert_eq!(failure(&image, Some(&home.join("missing")), None)["properties"]["updater"]["target"]["step"], "home_canonicalization");
        let payload = failure(&home.join("missing"), Some(&home), Some(&home));
        assert_eq!(payload["properties"]["updater"]["target"]["step"], "metadata");
        assert_eq!(payload["properties"]["updater"]["io_kind"], "not_found");
        let accepted = home.join("valid.AppImage");
        fs::write(&accepted, b"synthetic").unwrap();
        assert_eq!(validate_target(&accepted, Some(&home), Some(&home), false).unwrap(), accepted);
        symlink(&home, scratch.path().join("home-alias")).unwrap();
        assert_eq!(validate_target(&accepted, Some(&scratch.path().join("home-alias")), Some(&home), true).unwrap(), accepted);
    }

    #[test]
    fn actual_curl_failures_report_http_rate_limits_and_safe_exception_details() {
        use std::net::TcpListener;
        let mut fingerprints = Vec::new();
        for (status, remaining, retry) in [(200, "1", "0"), (403, "0", "60"), (429, "0", "15"), (503, "private-header-canary", "private-retry-canary")] {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            listener.set_nonblocking(true).unwrap();
            let endpoint = format!("http://{}", listener.local_addr().unwrap());
            let server = std::thread::spawn(move || {
                let deadline = Instant::now() + Duration::from_secs(4);
                let mut stream = loop {
                    match listener.accept() {
                        Ok((stream, _)) => break stream,
                        Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                            assert!(Instant::now() < deadline, "curl did not reach the fixture");
                            std::thread::sleep(Duration::from_millis(5));
                        }
                        Err(error) => panic!("fixture accept failed: {error}"),
                    }
                };
                stream.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
                let mut request = [0; 4096];
                stream.read(&mut request).unwrap();
                let limit = if status == 503 { "private-limit-canary" } else { "60" };
                let reset = if status == 503 { "private-reset-canary".to_owned() } else {
                    (std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() + 120).to_string()
                };
                write!(stream, "HTTP/1.1 {status} Fixture\r\nX-RateLimit-Remaining: {remaining}\r\nX-RateLimit-Limit: {limit}\r\nX-RateLimit-Reset: {reset}\r\nRetry-After: {retry}\r\nContent-Length: 2\r\nConnection: close\r\n\r\n[]").unwrap();
            });
            let output = Command::new("curl").args(["--silent", "--show-error", "--fail", "--noproxy", "*", "--max-time", "3", "--write-out", CURL_HTTP_STATUS, "--url", &endpoint]).output().unwrap();
            server.join().unwrap();
            if status == 200 {
                assert_eq!(download_output(output).unwrap(), b"[]");
                continue;
            }
            let output = std::cell::RefCell::new(Some(output));
            let error = release_history(&|_| download_output(output.borrow_mut().take().unwrap())).err().unwrap()
                .context(format!("private-local-context {endpoint}/?token=private-token-canary"));
            assert_eq!(updates::is_rate_limited(&error), matches!(status, 403 | 429));
            if status == 503 { assert!(format!("{error:#}").contains("private-header-canary")); }
            let installed = ("main".into(), "a".repeat(40));
            let mut attempt = updates::Attempt::default();
            attempt.selected("main", Some(&installed));
            attempt.candidate("main", &"b".repeat(40), Some(&installed), &"c".repeat(40));
            let payload = error_reporting::update_payload_for_test(&updates::attempted(error, attempt), Trigger::Automatic);
            let diagnostics = &payload["properties"]["updater"];
            assert_eq!(diagnostics["http_status"], status);
            assert_eq!(diagnostics["release_discovery"]["page"], 1);
            if status == 503 {
                assert!(diagnostics["rate_limit_limit"].is_null());
                assert!(diagnostics["rate_limit_reset_after_seconds"].is_null());
            } else {
                assert_eq!(diagnostics["rate_limit_limit"], 60);
                assert!((115..=120).contains(&diagnostics["rate_limit_reset_after_seconds"].as_u64().unwrap()));
            }
            assert_eq!(diagnostics["process"], "curl");
            assert_eq!(diagnostics["exit_code"], 22);
            assert_eq!(diagnostics["downloaded_bytes"], 0);
            assert!(diagnostics["transfer_ms"].as_u64().unwrap() <= 600_000);
            assert_eq!(diagnostics["trigger"], "automatic");
            assert_eq!(diagnostics["attempt"]["selected_channel"], "main");
            assert_eq!(diagnostics["attempt"]["installed_identity_kind"], "revision");
            assert_eq!(diagnostics["attempt"]["candidate_id"], "b".repeat(40));
            assert_eq!(diagnostics["attempt"]["installed_matches_target"], false);
            assert_eq!(diagnostics["rate_limit_remaining"], if status == 503 { serde_json::Value::Null } else { serde_json::json!(0) });
            assert_eq!(diagnostics["retry_after_seconds"], match status {403 => serde_json::json!(60), 429 => serde_json::json!(15), _ => serde_json::Value::Null});
            let exception = &payload["properties"]["$exception_list"][0];
            assert_eq!(exception["type"], "update_release_list_fetch_failed");
            assert!(exception["value"].as_str().unwrap().contains(&format!("HTTP {status}")));
            let frame = exception["stacktrace"]["frames"].as_array().unwrap().last().unwrap();
            assert_eq!(frame["filename"], "capture/desktop/linux/updates/update.rs");
            assert!(frame["lineno"].as_u64().unwrap() > 0);
            for private in ["private-", &endpoint, &"a".repeat(40)] {
                assert!(!payload.to_string().contains(private));
            }
            fingerprints.push(payload["properties"]["$exception_fingerprint"].clone());
        }
        assert_ne!(fingerprints[0], fingerprints[1]);
        assert_ne!(fingerprints[1], fingerprints[2]);
    }

    #[test]
    fn rate_reset_diagnostics_reject_past_and_unbounded_timestamps() {
        assert_eq!(reset_after_seconds(1_800_000_120, 1_800_000_000), Some(120));
        assert_eq!(reset_after_seconds(1_800_000_000, 1_800_000_000), Some(0));
        assert_eq!(reset_after_seconds(1_799_999_999, 1_800_000_000), None);
        assert_eq!(reset_after_seconds(1_800_086_401, 1_800_000_000), None);
        assert_eq!(reset_after_seconds(u32::MAX, u64::MAX), None);
    }

    #[test]
    fn failed_release_page_has_bounded_discovery_context() {
        let first_page = serde_json::to_vec(&vec![serde_json::json!({
            "tag_name":"private-tag", "published_at":null, "assets":[]
        }); 100]).unwrap();
        let calls = std::cell::Cell::new(0);
        let error = latest_candidate_with("main", "x86_64", &|_| {
            calls.set(calls.get() + 1);
            if calls.get() == 1 { Ok(first_page.clone()) }
            else { anyhow::bail!("private-url-and-response") }
        }).err().unwrap();
        let payload = error_reporting::update_payload_for_test(&error, Trigger::Automatic);
        let discovery = &payload["properties"]["updater"]["release_discovery"];
        assert_eq!(discovery["page"], 2);
        assert!(discovery["requests_in_process"].as_u64().unwrap() >= 2);
        assert!(discovery["elapsed_seconds"].is_u64());
        assert_eq!(calls.get(), 2, "never retry or continue an incomplete history");
        assert!(!payload.to_string().contains("private-"));
    }

    #[test]
    fn actual_release_parse_checksum_and_file_errors_have_distinct_reported_boundaries() {
        let malformed = latest_candidate_with("main", "x86_64", &|_| Ok(b"{private-bad-json".to_vec())).err().unwrap();
        let payload = error_reporting::update_payload_for_test(&malformed, Trigger::User);
        assert_eq!(payload["properties"]["updater"]["json_error_kind"], "data");
        assert_eq!(payload["properties"]["$exception_list"][0]["type"], "update_release_list_parse_failed");
        let dir = std::env::temp_dir().join(crate::shared::ids::make_bundle_id());
        fs::create_dir(&dir).unwrap();
        let stage = dir.join("private-image-canary");
        let error = verify_download(&stage, &"0".repeat(64)).stage(Stage::ChecksumVerify).unwrap_err();
        let missing = error_reporting::update_payload_for_test(&error, Trigger::User);
        assert_eq!(missing["properties"]["updater"]["io_kind"], "not_found");
        assert_eq!(missing["properties"]["updater"]["os_error_code"], libc::ENOENT);
        assert_eq!(missing["properties"]["$exception_list"][0]["type"], "update_download_read_failed");
        fs::write(&stage, b"private-file-content-canary").unwrap();
        let error = verify_download(&stage, &"0".repeat(64)).stage(Stage::ChecksumVerify).unwrap_err();
        let mismatch = error_reporting::update_payload_for_test(&error, Trigger::User);
        assert!(mismatch["properties"]["updater"]["io_kind"].is_null());
        assert_ne!(missing["properties"]["$exception_fingerprint"], mismatch["properties"]["$exception_fingerprint"]);
        for payload in [payload, missing, mismatch] {
            assert!(!payload.to_string().contains("private-"));
            assert!(!payload.to_string().contains(dir.to_str().unwrap()));
        }
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn update_transaction_lock_child() {
        let Some(image) = std::env::var_os("APPARENT_TEST_UPDATE_LOCK_IMAGE").map(PathBuf::from) else { return };
        let mode = std::env::var("APPARENT_TEST_UPDATE_LOCK_MODE").unwrap();
        let lock = transaction_lock(&image);
        if mode == "contended" {
            let error = updates::attempted(lock.unwrap_err(), updates::Attempt::default());
            assert!(updates::is_lock_contention(&error), "expected contention must not become a production exception");
            assert_eq!(error.chain().find_map(|cause| cause.downcast_ref::<std::io::Error>()).unwrap().kind(),
                std::io::ErrorKind::WouldBlock);
            return;
        }
        let _lock = lock.unwrap();
        let (channel, current) = installed_id(&image).unwrap();
        assert_eq!(channel, "main");
        assert_eq!(current, "c".repeat(40));
        // Identity is read only after acquiring the lock; discovery follows it.
        assert_eq!(fs::read(&image).unwrap(), b"newer C image");
    }

    #[test]
    fn updater_processes_serialize_before_identity_selection_and_cannot_finish_stale() {
        let dir = std::env::temp_dir().join(format!("apparent-update-lock-{}", crate::shared::ids::make_bundle_id()));
        fs::create_dir(&dir).unwrap();
        let image = dir.join("Apparent.AppImage");
        fs::write(&image, b"old A image").unwrap();
        let run_child = |mode: &str| {
            let test = format!("{}::update_transaction_lock_child", module_path!().split_once("::").unwrap().1);
            let output = Command::new(std::env::current_exe().unwrap()).args(["--exact", &test, "--nocapture"])
                .env("APPARENT_TEST_UPDATE_LOCK_IMAGE", &image).env("APPARENT_TEST_UPDATE_LOCK_MODE", mode)
                .output().unwrap();
            assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
            assert!(String::from_utf8_lossy(&output.stdout).contains("1 passed"), "child test must actually execute");
        };
        let lock = transaction_lock(&image).unwrap();
        let inode = fs::metadata(image.with_file_name(".Apparent.AppImage.lock")).unwrap().ino();
        run_child("contended");
        let stage = dir.join("C.download");
        fs::write(&stage, b"newer C image").unwrap();
        exchange(&stage, &image).unwrap();
        fs::write(image.with_extension("AppImage.apparent-update.json"), serde_json::to_vec(
            &serde_json::json!({"channel":"main","id":"c".repeat(40)})).unwrap()).unwrap();
        drop(lock);
        run_child("stale");
        assert_eq!(fs::metadata(image.with_file_name(".Apparent.AppImage.lock")).unwrap().ino(), inode);
        assert_eq!(fs::read(&stage).unwrap(), b"old A image");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn transaction_lock_rejects_symlinks_hardlinks_and_public_files() {
        let dir = std::env::temp_dir().join(format!("apparent-lock-safety-{}", crate::shared::ids::make_bundle_id()));
        fs::create_dir(&dir).unwrap();
        let image = dir.join("image");
        let path = dir.join(".image.lock");
        let other = dir.join("other");
        fs::write(&other, b"untouched").unwrap();
        std::os::unix::fs::symlink(&other, &path).unwrap();
        assert!(transaction_lock(&image).is_err());
        fs::remove_file(&path).unwrap();
        fs::hard_link(&other, &path).unwrap();
        assert!(transaction_lock(&image).is_err());
        fs::remove_file(&path).unwrap();
        fs::write(&path, b"untouched").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
        assert!(transaction_lock(&image).is_err());
        assert_eq!(fs::read(&other).unwrap(), b"untouched");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn canonical_main_preview_is_not_hidden_by_the_legacy_bridge() {
        let image = "Apparent-0.3.13-linux-x86_64.AppImage";
        let release = |tag: String, published: &str| Release {
            assets: [image.to_owned(), format!("{image}.sha256")].into_iter().map(|name| ReleaseAsset {
                browser_download_url: format!("https://github.com/{REPO}/releases/download/{tag}/{name}"), name, size: 0,
            }).collect(),
            tag_name: tag, prerelease: true, draft: false, published_at: Some(published.into()),
        };
        let releases = vec![
            release(format!("linux-main-{}", "a".repeat(40)), "2099-01-01T00:00:00Z"),
            release(format!("linux-main-v2-{}", "b".repeat(40)), "2026-11-04T00:00:00Z"),
        ];
        let candidate = candidate_from_history(&releases, "main", "x86_64", &|_| {
            Ok(format!("{}  {image}", "c".repeat(64)).into_bytes())
        }).unwrap().unwrap();
        assert_eq!(candidate.id, "b".repeat(40));
    }

    #[test]
    fn main_channel_rejects_other_architecture_and_unpublished_releases() {
        let tag = format!("linux-main-v2-{}", "a".repeat(40));
        let image = "Apparent-0.3.13-linux-aarch64.AppImage";
        let release = || Release {
            tag_name: tag.clone(), prerelease: true, draft: false, published_at: Some("2026-11-01T01:00:00Z".into()),
            assets: [image.to_owned(), format!("{image}.sha256")].into_iter().map(|name| ReleaseAsset {
                browser_download_url: format!("https://github.com/{REPO}/releases/download/{tag}/{name}"), name, size: 0,
            }).collect(),
        };
        assert!(candidate_from_history(&[release()], "main", "x86_64", &|_| panic!("foreign architecture must not fetch")).unwrap().is_none());
        let mut draft = release();
        draft.draft = true;
        let mut unpublished = release();
        unpublished.published_at = None;
        assert!(candidate_from_history(&[draft, unpublished], "main", "aarch64", &|_| panic!("private releases must not fetch")).unwrap().is_none());
        let candidate = candidate_from_history(&[release()], "main", "aarch64", &|_| Ok(format!("{}  {image}", "c".repeat(64)).into_bytes())).unwrap().unwrap();
        assert!(candidate.url.ends_with("-linux-aarch64.AppImage"));
    }

    fn stable_release_fixture(tag: &str, arch: &str) -> serde_json::Value {
        let name = format!("Apparent-{}-linux-{arch}.AppImage", tag.strip_prefix('v').unwrap_or(tag));
        let prefix = format!("https://github.com/{REPO}/releases/download/{tag}/");
        serde_json::json!({"tag_name": tag, "draft": false, "prerelease": false,
            "published_at": "2026-11-01T00:00:00Z", "assets": [
                {"name": name, "browser_download_url": format!("{prefix}{name}")},
                {"name": format!("{name}.sha256"), "browser_download_url": format!("{prefix}{name}.sha256")}]})
    }

    #[test]
    fn stable_discovers_desktop_versions_after_component_release_pages() {
        let candidate = latest_candidate_with("stable", "x86_64", &|url| {
            if url.ends_with("?per_page=100&page=1") {
                return Ok(serde_json::to_vec(&vec![stable_release_fixture("recipient-component", "x86_64"); 100])?);
            }
            if url.ends_with("?per_page=100&page=2") {
                return Ok(serde_json::to_vec(&vec![stable_release_fixture("v0.3.9", "x86_64"),
                    stable_release_fixture("v0.3.14", "x86_64"), stable_release_fixture("v0.3.10", "x86_64")])?);
            }
            assert_eq!(url, format!("https://github.com/{REPO}/releases/download/v0.3.14/Apparent-0.3.14-linux-x86_64.AppImage.sha256"));
            Ok(format!("{}  Apparent-0.3.14-linux-x86_64.AppImage", "c".repeat(64)).into_bytes())
        }).unwrap().unwrap();
        assert_eq!(candidate.id, "v0.3.14");
        assert_eq!(candidate.channel, "stable");
        assert_eq!(candidate.sha256, "c".repeat(64));
    }

    #[test]
    fn stable_with_no_compatible_desktop_release_has_no_update() {
        let mut preview = stable_release_fixture("v0.3.15", "x86_64");
        preview["prerelease"] = true.into();
        let mut draft = stable_release_fixture("v0.3.15", "x86_64");
        draft["draft"] = true.into();
        let mut unpublished = stable_release_fixture("v0.3.15", "x86_64");
        unpublished["published_at"] = serde_json::Value::Null;
        let mut incomplete = stable_release_fixture("v0.3.15", "x86_64");
        incomplete["assets"].as_array_mut().unwrap().pop();
        let mut legacy = stable_release_fixture("v0.3.13", "x86_64");
        for asset in legacy["assets"].as_array_mut().unwrap() {
            asset["name"] = asset["name"].as_str().unwrap().replace("Apparent-", "OtherRecorder-").into();
        }
        let releases = vec![preview, draft, unpublished, incomplete, legacy,
            stable_release_fixture("v0.3.15", "aarch64"),
            stable_release_fixture("preview-mac-12-2", "x86_64"),
            stable_release_fixture("recipient-component", "x86_64")];
        assert!(latest_candidate_with("stable", "x86_64", &|url| {
            assert!(url.ends_with("?per_page=100&page=1"), "no checksum or download may be requested");
            Ok(serde_json::to_vec(&releases)?)
        }).unwrap().is_none());
    }

    #[test]
    fn stable_network_metadata_and_integrity_failures_remain_errors() {
        assert!(latest_candidate_with("stable", "x86_64", &|_| anyhow::bail!("offline")).is_err());
        assert!(latest_candidate_with("stable", "x86_64", &|_| Ok(b"not JSON".to_vec())).is_err());
        for checksum in ["invalid".to_owned(), format!("{}  unrelated.AppImage", "c".repeat(64))] {
            assert!(latest_candidate_with("stable", "x86_64", &|url| {
                if url.contains("/releases?") {
                    Ok(serde_json::to_vec(&vec![stable_release_fixture("v0.3.14", "x86_64")])?)
                } else { Ok(checksum.clone().into_bytes()) }
            }).is_err());
        }
        let mut foreign = stable_release_fixture("v0.3.14", "x86_64");
        foreign["assets"][0]["browser_download_url"] = "https://untrusted.example/app.AppImage".into();
        assert!(latest_candidate_with("stable", "x86_64", &|url| {
            assert!(url.contains("/releases?"), "foreign asset must be rejected before fetching");
            Ok(serde_json::to_vec(&vec![foreign.clone()])?)
        }).is_err());
        assert!(latest_candidate_with("stable", "x86_64", &|_| {
            Ok(serde_json::to_vec(&vec![stable_release_fixture("recipient-component", "x86_64"); 100])?)
        }).is_err(), "incomplete discovery cannot be reported as no update");
    }

    #[test]
    fn main_channel_selects_latest_published_main_release() {
        let release = |tag: &str, date: &str, draft: bool, name: &str| Release {
            tag_name: tag.into(), prerelease: true, draft, published_at: Some(date.into()),
            assets: [name.to_owned(), format!("{name}.sha256")].into_iter().map(|name| ReleaseAsset {
                browser_download_url: format!("https://github.com/{REPO}/releases/download/{tag}/{name}"), name, size: 0,
            }).collect(),
        };
        let apparent = "Apparent-0.3.13-linux-x86_64.AppImage";
        let releases = vec![
            release("preview-mac-1", "2026-10-29T01:00:00Z", false, apparent),
            release(&format!("linux-main-v2-{}", "a".repeat(40)), "2026-10-27T01:00:00Z", false, apparent),
            release(&format!("linux-main-v2-{}", "b".repeat(40)), "2026-10-28T01:00:00Z", false, apparent),
            release(&format!("linux-main-v2-{}", "c".repeat(40)), "2026-10-29T01:00:00Z", true, apparent),
            release(&format!("linux-main-v2-{}", "d".repeat(40)), "2026-10-30T01:00:00Z", false,
                "OtherRecorder-0.3.13-linux-x86_64.AppImage"),
        ];
        let candidate = candidate_from_history(&releases, "main", "x86_64", &|url| {
            assert!(url.contains(&format!("linux-main-v2-{}", "b".repeat(40))));
            Ok(format!("{}  {apparent}", "c".repeat(64)).into_bytes())
        }).unwrap().unwrap();
        assert_eq!(candidate.id, "b".repeat(40));
        assert!(candidate_from_history(&[], "main", "x86_64", &|_| panic!("empty history")).unwrap().is_none());
    }

    #[test]
    fn main_channel_never_installs_an_older_release_when_the_target_checksum_fails() {
        let image = format!("Apparent-{}-linux-x86_64.AppImage", env!("CARGO_PKG_VERSION"));
        let release = |letter: &str, date: &str| {
            let tag = format!("linux-main-v2-{}", letter.repeat(40));
            let url = format!("https://github.com/{REPO}/releases/download/{tag}/");
            Release {
                tag_name: tag, prerelease: true, draft: false, published_at: Some(date.into()),
                assets: [image.clone(), format!("{image}.sha256")].into_iter().map(|name| ReleaseAsset {
                    browser_download_url: format!("{url}{name}"), name, size: 0,
                }).collect(),
            }
        };
        let releases = vec![
            release("a", "2026-10-28T01:00:00Z"),
            release("b", "2026-10-29T01:00:00Z"),
        ];
        let result = candidate_from_history(&releases, "main", "x86_64", &|url| {
            assert!(url.contains(&format!("linux-main-v2-{}", "b".repeat(40))));
            Ok(b"invalid checksum".to_vec())
        });
        assert!(result.is_err());
    }

    #[test]
    fn main_channel_orders_publications_across_release_pages() {
        let image = "Apparent-0.3.13-linux-x86_64.AppImage";
        let release = |letter: &str, date: &str| {
            let tag = format!("linux-main-v2-{}", letter.repeat(40));
            let assets: Vec<_> = [image.to_owned(),format!("{image}.sha256")].into_iter().map(|name| {
                serde_json::json!({"browser_download_url":format!("https://github.com/{REPO}/releases/download/{tag}/{name}"),"name":name})
            }).collect();
            serde_json::json!({"tag_name":tag,"prerelease":true,"draft":false,"published_at":date,
                "assets":assets})
        };
        // A later page can contain a later publication when GitHub orders by tag creation.
        let candidate = latest_candidate_with("main", "x86_64", &|url| {
            if url.ends_with("?per_page=100&page=1") {
                return Ok(serde_json::to_vec(&vec![release("a", "2026-10-28T01:00:00Z"); 100])?);
            }
            if url.ends_with("?per_page=100&page=2") {
                return Ok(serde_json::to_vec(&vec![release("b", "2026-10-29T01:00:00Z")])?);
            }
            assert!(url.ends_with(".sha256"), "stop after the final partial page");
            Ok(format!("{}  {image}", "c".repeat(64)).into_bytes())
        }).unwrap().unwrap();
        assert_eq!(candidate.id, "b".repeat(40));
        assert!(latest_candidate_with("main", "x86_64", &|url| {
            assert!(url.contains("/releases?per_page=100&page="));
            Ok(serde_json::to_vec(&vec![stable_release_fixture("recipient-component", "x86_64"); 100])?)
        }).is_err(), "incomplete history must fail before fetching an asset");
    }

    #[test]
    fn main_release_rejects_foreign_name_and_digest() {
        let expected = format!("Apparent-{}-linux-x86_64.AppImage", env!("CARGO_PKG_VERSION"));
        let url = format!("https://github.com/{REPO}/releases/download/linux-main-v2-{}/", "a".repeat(40));
        let release = |name: &str| Release {
            tag_name: format!("linux-main-v2-{}", "a".repeat(40)),
            prerelease: true, draft: false, published_at: Some("2026-10-28T01:00:00Z".into()),
            assets: [name.to_owned(), format!("{expected}.sha256")].iter().map(|name| ReleaseAsset {
                name: name.clone(), browser_download_url: format!("{url}{name}"), size: 0,
            }).collect(),
        };
        let checksum = format!("{}  {expected}", "b".repeat(64));
        let selected = |release: &Release, text: &str| {
            candidate_from_selection(release, &release.assets[0], &release.assets[1], "main", "x86_64",
                &|_| Ok(text.as_bytes().to_vec()))
        };
        assert!(selected(&release("other.AppImage"), &checksum).is_err());
        assert!(selected(&release(&expected), "invalid").is_err());
        let candidate = selected(&release(&expected), &checksum).unwrap();
        assert!(candidate.url.contains("linux-main-v2-"));
        assert!(selected(&release(&expected), &format!("{}  other.AppImage", "b".repeat(64))).is_err());
        let mut foreign = release(&expected);
        foreign.assets[1].browser_download_url = "https://example.org/checksum".into();
        assert!(candidate_from_selection(&foreign, &foreign.assets[0], &foreign.assets[1], "main", "x86_64",
            &|_| panic!("foreign URL must not be fetched")).is_err());
        assert!(!needs_channel_release(&candidate, Some(("main".into(), "a".repeat(40)))).unwrap());
        assert!(needs_channel_release(&candidate, Some(("stable".into(), "v0.3.13".into()))).unwrap());
    }

    #[test]
    fn hung_updated_image_fails_preflight_without_waiting_for_it() {
        let dir = std::env::temp_dir().join(format!("apparent-preflight-{}", crate::shared::ids::make_bundle_id()));
        fs::create_dir(&dir).unwrap();
        let image = dir.join("hung.AppImage");
        fs::write(&image, b"#!/bin/sh\nexec sleep 5\n").unwrap();
        let mut permissions = fs::metadata(&image).unwrap().permissions();
        permissions.set_mode(0o700);
        fs::set_permissions(&image, permissions).unwrap();
        let start = Instant::now();
        assert!(preflight_image(&image, Duration::from_millis(100)).unwrap_err()
            .to_string().contains("timed out"));
        assert!(start.elapsed() < Duration::from_secs(2));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn relaunch_recovery_serializes_updates_and_never_blacklists_a_different_image() {
        for bypass_lock in [false, true] {
            let dir = std::env::temp_dir().join(format!("apparent-recovery-race-{}", crate::shared::ids::make_bundle_id()));
            fs::create_dir(&dir).unwrap();
            let image = dir.join("Apparent.AppImage");
            let backup = dir.join(".Apparent.AppImage.previous");
            let marker = image.with_extension("AppImage.apparent-update.json");
            let previous_marker = dir.join(".Apparent.AppImage.previous.apparent-update.json");
            let failed_marker = dir.join(".Apparent.AppImage.failed-update.json");
            let started = dir.join("started");
            let fail = dir.join("fail");
            let recovered = dir.join("recovered");
            fs::write(&image, b"#!/bin/sh\ntouch \"$TEST_STARTED\"\nwhile [ ! -f \"$TEST_FAIL\" ]; do sleep 0.02; done\nexit 1\n").unwrap();
            fs::write(&backup, b"#!/bin/sh\ntouch \"$TEST_RECOVERED\"\n").unwrap();
            for path in [&image, &backup] { fs::set_permissions(path, fs::Permissions::from_mode(0o700)).unwrap(); }
            let identity = |id: &str| serde_json::to_vec(&serde_json::json!({"channel":"main","id":id.repeat(40)})).unwrap();
            fs::write(&marker, identity("b")).unwrap();
            fs::write(&previous_marker, identity("a")).unwrap();
            let mut command = relaunch_command(&image, &backup, u32::MAX).unwrap();
            let mut helper = command.env("TEST_STARTED", &started).env("TEST_FAIL", &fail)
                .env("TEST_RECOVERED", &recovered).spawn().unwrap();
            drop(command); // Only the post-exit helper now holds the flock.
            let deadline = Instant::now() + Duration::from_secs(5);
            while !started.exists() && Instant::now() < deadline { std::thread::sleep(Duration::from_millis(10)); }
            assert!(started.exists(), "actual attempted B must reach its gated startup");
            assert!(transaction_lock(&image).is_err(), "C cannot stage while B readiness/recovery is unresolved");
            assert!(relaunch_command(&image, &backup, u32::MAX).is_err(), "competing restart must also refuse");
            if bypass_lock {
                // An external writer deliberately ignores the lock: production
                // exchange/backup operations must not fool rollback identity.
                let stage = dir.join("C.download");
                fs::write(&stage, b"newer C image").unwrap();
                exchange(&stage, &image).unwrap();
                fs::rename(&stage, &backup).unwrap();
                fs::copy(&marker, &previous_marker).unwrap();
                let next_marker = dir.join("C.marker");
                fs::write(&next_marker, identity("c")).unwrap();
                fs::rename(next_marker, &marker).unwrap();
            }
            fs::write(&fail, b"fail B now").unwrap();
            assert_eq!(helper.wait().unwrap().success(), !bypass_lock);
            let _lock = transaction_lock(&image).expect("helper must release its lock on either outcome");
            if bypass_lock {
                assert_eq!(fs::read(&image).unwrap(), b"newer C image");
                assert_eq!(installed_id(&image), Some(("main".into(), "c".repeat(40))));
                assert!(!failed_marker.exists(), "C was never attempted and cannot be blacklisted");
                assert!(!recovered.exists());
            } else {
                assert!(recovered.exists());
                assert_eq!(installed_id(&image), Some(("main".into(), "a".repeat(40))));
                assert_eq!(fs::read(&failed_marker).unwrap(), identity("b"));
            }
            fs::remove_dir_all(dir).unwrap();
        }
    }

    #[test]
    fn startup_timeout_releases_lock_without_killing_a_live_term_handler() {
        let dir = std::env::temp_dir().join(format!("apparent-startup-term-{}", crate::shared::ids::make_bundle_id()));
        fs::create_dir(&dir).unwrap();
        let tools = dir.join("tools");
        fs::create_dir(&tools).unwrap();
        // Execute the production helper verbatim. Accelerate only its sleep
        // utility, not its readiness/termination policy or real signal effects.
        let sleep = tools.join("sleep");
        fs::write(&sleep, b"#!/bin/sh\nexec /bin/sleep 0.001\n").unwrap();
        fs::set_permissions(&sleep, fs::Permissions::from_mode(0o700)).unwrap();
        let image = dir.join("Apparent.AppImage");
        let backup = dir.join(".Apparent.AppImage.previous");
        let marker = image.with_extension("AppImage.apparent-update.json");
        let previous_marker = dir.join(".Apparent.AppImage.previous.apparent-update.json");
        let failed_marker = dir.join(".Apparent.AppImage.failed-update.json");
        let started = dir.join("started");
        let term = dir.join("term-requested");
        let recovered = dir.join("recovered");
        fs::write(&image, b"#!/bin/sh\ntrap 'touch \"$TEST_TERM\"' TERM\nprintf '%s' \"$$\" > \"$TEST_STARTED\"\nwhile :; do /bin/sleep 0.02; done\n").unwrap();
        fs::write(&backup, b"#!/bin/sh\ntouch \"$TEST_RECOVERED\"\n").unwrap();
        for path in [&image, &backup] { fs::set_permissions(path, fs::Permissions::from_mode(0o700)).unwrap(); }
        let next = br#"{"channel":"main","id":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}"#;
        let previous = br#"{"channel":"main","id":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}"#;
        fs::write(&marker, next).unwrap();
        fs::write(&previous_marker, previous).unwrap();
        let backup_bytes = fs::read(&backup).unwrap();
        let mut command = relaunch_command(&image, &backup, u32::MAX).unwrap();
        let mut helper = command.env("PATH", format!("{}:/usr/bin:/bin", tools.display()))
            .env("TEST_STARTED", &started).env("TEST_TERM", &term).env("TEST_RECOVERED", &recovered)
            .spawn().unwrap();
        drop(command);
        let deadline = Instant::now() + Duration::from_secs(12);
        let mut result = None;
        while Instant::now() < deadline {
            if let Some(status) = helper.try_wait().unwrap() { result = Some(status); break; }
            std::thread::sleep(Duration::from_millis(10));
        }
        let fixture_pid: i32 = fs::read_to_string(&started).unwrap().parse().unwrap();
        let fixture_cmd = fs::read(format!("/proc/{fixture_pid}/cmdline")).unwrap();
        assert!(fixture_cmd.split(|b| *b == 0).any(|arg| arg == image.as_os_str().as_encoded_bytes()), "cleanup must own this exact fixture");
        let terminated_cooperatively = term.exists();
        let still_alive = unsafe { libc::kill(fixture_pid, 0) } == 0;
        let lock_released = transaction_lock(&image).is_ok();
        let left_images_untouched = fs::read(&marker).unwrap() == next
            && fs::read(&previous_marker).unwrap() == previous
            && fs::read(&backup).unwrap() == backup_bytes
            && !recovered.exists() && !failed_marker.exists();
        // Only this synthetic fixture is killed for test cleanup. Production
        // must not turn a startup timeout into SIGKILL of a possibly busy app.
        unsafe { libc::kill(fixture_pid, libc::SIGKILL); }
        if result.is_none() { let _ = helper.wait(); }
        fs::remove_dir_all(dir).unwrap();
        assert!(result.is_some(), "readiness timeout must not wait forever or retain its transaction lock");
        assert!(!result.unwrap().success(), "unresolved startup is not successful recovery");
        assert!(terminated_cooperatively && still_alive, "SIGTERM must be observed without forcing exit");
        assert!(lock_released, "later updates must remain possible");
        assert!(left_images_untouched, "a live child forbids rollback or blacklisting");
    }

    #[test]
    fn successful_update_relaunch_requests_settings() {
        let dir = std::env::temp_dir().join(format!("apparent-update-settings-{}", crate::shared::ids::make_bundle_id()));
        fs::create_dir(&dir).unwrap();
        let image = dir.join("Apparent.AppImage");
        let backup = dir.join("previous.AppImage");
        let receipt = dir.join("settings-requested");
        fs::write(&image, b"#!/bin/sh\nprintf '%s' \"$APPARENT_UPDATE_REOPEN_SETTINGS\" > \"$TEST_SETTINGS_RECEIPT\"\ntouch \"$APPARENT_UPDATE_READY\"\nsleep 1\n").unwrap();
        fs::write(&backup, b"#!/bin/sh\nexit 1\n").unwrap();
        for path in [&image, &backup] {
            fs::set_permissions(path, fs::Permissions::from_mode(0o700)).unwrap();
        }
        assert!(relaunch_command(&image, &backup, u32::MAX).unwrap()
            .env("TEST_SETTINGS_RECEIPT", &receipt).status().unwrap().success());
        assert_eq!(fs::read(&receipt).unwrap(), b"1");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn failed_post_exit_launch_recovers_the_previous_image() {
        let dir = std::env::temp_dir().join(format!("apparent-relaunch-{}", crate::shared::ids::make_bundle_id()));
        fs::create_dir(&dir).unwrap();
        let image = dir.join("new.AppImage");
        let backup = dir.join("previous.AppImage");
        let marker = dir.join("recovered");
        let sidecar = image.with_extension("AppImage.apparent-update.json");
        let previous_sidecar = backup.with_file_name("previous.AppImage.apparent-update.json");
        let failed_sidecar = image.with_file_name(".new.AppImage.failed-update.json");
        fs::write(&image, b"#!/bin/sh\nexit 1\n").unwrap();
        fs::write(&backup, b"#!/bin/sh\nprintf recovered > \"$TEST_RECOVERY_MARKER\"\n").unwrap();
        fs::write(&sidecar, br#"{"channel":"stable","id":"v99.0.0"}"#).unwrap();
        fs::write(&previous_sidecar, br#"{"channel":"stable","id":"v1.0.0"}"#).unwrap();
        for path in [&image, &backup] {
            let mut permissions = fs::metadata(path).unwrap().permissions();
            permissions.set_mode(0o700);
            fs::set_permissions(path, permissions).unwrap();
        }
        assert!(relaunch_command(&image, &backup, u32::MAX)
            .unwrap().env("TEST_RECOVERY_MARKER", &marker).status().unwrap().success());
        assert_eq!(fs::read(&marker).unwrap(), b"recovered");
        assert_eq!(fs::read(&image).unwrap(), b"#!/bin/sh\nprintf recovered > \"$TEST_RECOVERY_MARKER\"\n");
        assert_eq!(installed_id(&image), Some(("stable".into(), "v1.0.0".into())), "rollback must restore the old version marker");
        let bad = Candidate { id: "v99.0.0".into(), channel: "stable", url: String::new(), sha256: String::new(), size: 0 };
        let next = Candidate { id: "v100.0.0".into(), channel: "stable", url: String::new(), sha256: String::new(), size: 0 };
        assert!(previously_failed(&failed_sidecar, &bad), "the broken release must not be reinstalled on startup");
        assert!(!previously_failed(&failed_sidecar, &next), "a newer release must remain eligible");
        fs::remove_file(&marker).unwrap();
        assert!(Command::new(&image).env("TEST_RECOVERY_MARKER", &marker).status().unwrap().success());
        assert_eq!(fs::read(&marker).unwrap(), b"recovered", "the desktop launcher must work on the next start");
        fs::write(&backup, fs::read(&image).unwrap()).unwrap();
        let mut permissions = fs::metadata(&backup).unwrap().permissions();
        permissions.set_mode(0o700);
        fs::set_permissions(&backup, permissions).unwrap();
        fs::remove_file(&image).unwrap();
        fs::remove_file(&marker).unwrap();
        assert!(relaunch_command(&image, &backup, u32::MAX)
            .unwrap().env("TEST_RECOVERY_MARKER", &marker).status().unwrap().success());
        assert_eq!(fs::read(&marker).unwrap(), b"recovered");
        fs::write(&backup, fs::read(&image).unwrap()).unwrap();
        let mut permissions = fs::metadata(&backup).unwrap().permissions();
        permissions.set_mode(0o700);
        fs::set_permissions(&backup, permissions).unwrap();
        fs::remove_file(&marker).unwrap();
        fs::write(&image, b"#!/bin/sh\nexit 0\n").unwrap();
        let mut permissions = fs::metadata(&image).unwrap().permissions();
        permissions.set_mode(0o700);
        fs::set_permissions(&image, permissions).unwrap();
        assert!(relaunch_command(&image, &backup, u32::MAX)
            .unwrap().env("TEST_RECOVERY_MARKER", &marker).status().unwrap().success());
        assert_eq!(fs::read(&marker).unwrap(), b"recovered", "a clean early exit without a running app still needs recovery");
        fs::write(&backup, fs::read(&image).unwrap()).unwrap();
        let mut permissions = fs::metadata(&backup).unwrap().permissions();
        permissions.set_mode(0o700);
        fs::set_permissions(&backup, permissions).unwrap();
        fs::write(&image, b"#!/bin/sh\nsleep 5\nexit 1\n").unwrap();
        let mut permissions = fs::metadata(&image).unwrap().permissions();
        permissions.set_mode(0o700);
        fs::set_permissions(&image, permissions).unwrap();
        fs::remove_file(&marker).unwrap();
        assert!(relaunch_command(&image, &backup, u32::MAX)
            .unwrap().env("TEST_RECOVERY_MARKER", &marker).status().unwrap().success());
        assert_eq!(fs::read(&marker).unwrap(), b"recovered", "a slow failure before GPUI readiness needs recovery");
        fs::write(&backup, fs::read(&image).unwrap()).unwrap();
        let mut permissions = fs::metadata(&backup).unwrap().permissions();
        permissions.set_mode(0o700);
        fs::set_permissions(&backup, permissions).unwrap();
        fs::write(&image, b"#!/bin/sh\ntouch \"$APPARENT_UPDATE_READY\"\nsleep 5\nexit 1\n").unwrap();
        let mut permissions = fs::metadata(&image).unwrap().permissions();
        permissions.set_mode(0o700);
        fs::set_permissions(&image, permissions).unwrap();
        fs::remove_file(&marker).unwrap();
        assert!(relaunch_command(&image, &backup, u32::MAX)
            .unwrap().env("TEST_RECOVERY_MARKER", &marker).status().unwrap().success());
        std::thread::sleep(Duration::from_secs(6));
        assert!(!marker.exists(), "a failure after GPUI readiness must not resurrect the old image");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn update_identity_reads_its_sidecar() {
        let dir = std::env::temp_dir().join(crate::shared::ids::make_bundle_id());
        fs::create_dir(&dir).unwrap();
        let image = dir.join("Apparent.AppImage");
        fs::write(image.with_extension("AppImage.apparent-update.json"), br#"{"channel":"main","id":"new"}"#).unwrap();
        assert_eq!(installed_id(&image), Some(("main".into(), "new".into())));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn bad_download_cannot_replace_the_image_and_exchange_preserves_the_previous_one() {
        let dir = std::env::temp_dir().join(format!("apparent-update-test-{}", crate::shared::ids::make_bundle_id()));
        fs::create_dir(&dir).unwrap();
        let image = dir.join("Apparent.AppImage");
        let stage = dir.join("download");
        fs::write(&image, b"old image").unwrap();
        fs::write(&stage, b"new image").unwrap();
        assert!(verify_download(&stage, &"0".repeat(64)).is_err());
        assert_eq!(fs::read(&image).unwrap(), b"old image");
        let hash = format!("{:x}", Sha256::digest(b"new image"));
        verify_download(&stage, &hash).unwrap();
        exchange(&stage, &image).unwrap();
        assert_eq!(fs::read(&image).unwrap(), b"new image");
        assert_eq!(fs::read(&stage).unwrap(), b"old image");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn stable_converges_even_from_a_newer_or_unmarked_build() {
        let candidate = Candidate { id: "v0.3.13".into(), channel: "stable", url: String::new(), sha256: String::new(), size: 0 };
        assert!(needs_channel_release(&candidate, Some(("stable".into(), "v0.3.14".into()))).unwrap());
        assert!(needs_channel_release(&candidate, None).unwrap());
        assert!(!needs_channel_release(&candidate, Some(("stable".into(), "v0.3.13".into()))).unwrap());
        assert!(needs_channel_release(&candidate, Some(("stable".into(), "v0.3.12".into()))).unwrap());
        assert!(needs_channel_release(&candidate, Some(("main".into(), "a".repeat(40)))).unwrap());
    }

    #[test]
    fn channel_command_preserves_other_config_and_rejects_invalid_choices() {
        let dir = std::env::temp_dir().join(crate::shared::ids::make_bundle_id());
        fs::create_dir(&dir).unwrap();
        let path = dir.join("config.json");
        fs::write(&path, br#"{"ingestToken":"private","autoSend":false}"#).unwrap();
        set_channel_in(&path, "main").unwrap();
        let value: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(value["updateChannel"], "main");
        assert_eq!(value["ingestToken"], "private");
        assert_eq!(value["autoSend"], false);
        let before = fs::read(&path).unwrap();
        assert!(set_channel_in(&path, "edge").is_err());
        assert_eq!(fs::read(&path).unwrap(), before);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn config_records_the_running_version_without_touching_preferences() {
        let dir = std::env::temp_dir().join(crate::shared::ids::make_bundle_id());
        fs::create_dir(&dir).unwrap();
        let path = dir.join("config.json");
        fs::write(&path, br#"{"updateChannel":"main","ingestToken":"private"}"#).unwrap();
        write_runtime_in(&path, 42, 99).unwrap();
        let value: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(value["running"]["version"], env!("CARGO_PKG_VERSION"));
        assert_eq!(value["running"]["pid"], 42);
        assert_eq!(value["running"]["startTicks"], 99);
        assert_eq!(value["updateChannel"], "main");
        assert_eq!(value["ingestToken"], "private");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn status_only_reports_a_live_process_with_the_recorded_start_time() {
        let dir = std::env::temp_dir().join(crate::shared::ids::make_bundle_id());
        fs::create_dir(&dir).unwrap();
        let path = dir.join("config.json");
        let pid = std::process::id();
        let ticks = process_ticks(pid).unwrap();
        write_runtime_in(&path, pid, ticks).unwrap();
        assert_eq!(status_at(&path).unwrap()["running"]["version"], env!("CARGO_PKG_VERSION"));
        write_runtime_in(&path, pid, ticks + 1).unwrap();
        assert!(status_at(&path).unwrap()["running"].is_null());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn exchanged_appimage_still_identifies_its_running_process() {
        assert!(same_executable(Path::new("/home/user/Apparent.AppImage"), "/home/user/Apparent.AppImage"));
        assert!(same_executable(Path::new("/home/user/Apparent.AppImage (deleted)"), "/home/user/Apparent.AppImage"));
        assert!(!same_executable(Path::new("/home/user/Other.AppImage (deleted)"), "/home/user/Apparent.AppImage"));
    }
}
