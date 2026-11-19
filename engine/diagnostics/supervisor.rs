use anyhow::{Context, Result, ensure};
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    os::{
        fd::AsRawFd,
        unix::{
            fs::{DirBuilderExt, MetadataExt, OpenOptionsExt},
            process::ExitStatusExt,
        },
    },
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};

#[path = "supervisor/finish.rs"]
mod finish;
#[path = "supervisor/oom.rs"]
mod oom;
use oom::OomSample;
#[path = "supervisor/trace.rs"]
mod trace;
use trace::{Observation, Stage, Trace};
pub(in crate::capture::desktop) use finish::FinishPhase;

const CHILD: &str = "APPARENT_SUPERVISOR_PID";

#[derive(Clone)]
pub(crate) struct Hooks {
    pub directory: PathBuf,
    pub consent: fn() -> Option<String>,
    pub deliver: fn(&str, serde_json::Value, &str, serde_json::Value) -> bool,
    pub requested: fn() -> bool,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Record {
    id: String,
    consent: Option<String>,
    supervisor: u32,
    identity: String,
    child: u32,
    child_identity: String,
    created_ms: u64,
    exited_ms: Option<u64>,
    build: String,
    revision: String,
    version: String,
    release: String,
    release_id: String,
    channel: String,
    environment: String,
    modified: bool,
    stage: Stage,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    finish_phase: Option<FinishPhase>,
    #[serde(default, skip_serializing_if = "Trace::is_empty")]
    trace: Trace,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    cgroup_oom_kill_increased: Option<bool>,
    code: Option<i32>,
    signal: Option<i32>,
    core_dumped: bool,
    runtime_ms: u64,
}

impl Record {
    fn diagnostics(&self) -> serde_json::Value {
        serde_json::json!({
            "exit_code": self.code,
            "signal": self.signal,
            "core_dumped": self.core_dumped,
            "last_stage": self.stage,
            "last_finish_phase": self.finish_phase,
            "recent_steps": self.trace,
            "cgroup_oom_kill_increased": self.cgroup_oom_kill_increased,
            "runtime_ms": self.runtime_ms,
            "started_at_ms": self.created_ms,
            "exited_at_ms": self.exited_ms,
            "supervisor_lost": self.supervisor != 0,
        })
    }
}

pub(crate) fn is_child() -> bool {
    let expected = unsafe { libc::getppid() }.to_string();
    std::env::var(CHILD).ok().as_deref() == Some(expected.as_str())
}

fn identity(pid: u32) -> Option<String> {
    let stat = fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    stat.rsplit_once(')')?
        .1
        .split_whitespace()
        .nth(19)
        .map(str::to_owned)
}

fn directory(path: &Path) -> Result<PathBuf> {
    match fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(&path)
    {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(error) => return Err(error.into()),
    }
    let meta = fs::symlink_metadata(&path)?;
    ensure!(
        meta.is_dir() && meta.uid() == unsafe { libc::geteuid() } && meta.mode() & 0o777 == 0o700,
        "Unsafe native diagnostics directory"
    );
    Ok(path.to_owned())
}

fn save(path: &Path, record: &Record) -> Result<()> {
    if record.consent.is_none() {
        match fs::remove_file(path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
        return Ok(());
    }
    let mut file =
        tempfile::NamedTempFile::new_in(path.parent().context("Missing diagnostics directory")?)?;
    serde_json::to_writer(&mut file, record)?;
    file.as_file().sync_all()?;
    file.persist(path)?;
    File::open(path.parent().context("Missing diagnostics directory")?)?.sync_all()?;
    Ok(())
}

fn read(path: &Path) -> Option<Record> {
    let file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(path)
        .ok()?;
    let meta = file.metadata().ok()?;
    if !meta.is_file()
        || meta.uid() != unsafe { libc::geteuid() }
        || meta.mode() & 0o777 != 0o600
        || meta.len() > 4096
    {
        return None;
    }
    let record: Record = serde_json::from_reader(file.take(4097)).ok()?;
    let safe = |s: &str| {
        s.len() <= 200
            && s.chars()
                .all(|c| c.is_ascii_alphanumeric() || " .-_·+".contains(c))
    };
    if record
        .consent
        .as_ref()
        .is_none_or(|value| value.len() > 128)
        || record.id.len() != 36
        || !record
            .id
            .bytes()
            .all(|c| c.is_ascii_hexdigit() || c == b'-')
        || !safe(&record.build)
        || !safe(&record.revision)
        || !safe(&record.version)
        || !safe(&record.release)
        || !safe(&record.release_id)
        || !safe(&record.channel)
        || !safe(&record.environment)
    {
        return None;
    }
    record.trace.is_bounded().then_some(record)
}

fn replay(directory: &Path, hooks: &Hooks) {
    replay_with(directory, hooks.consent, |record| {
        let metadata = serde_json::json!({"build": record.build, "commit_sha": record.revision, "$app_version": record.version, "package_version": record.version, "release_version": record.release, "$release_id": record.release_id, "channel": record.channel, "environment": record.environment, "build_modified": record.modified});
        record
            .consent
            .as_ref()
            .is_some_and(|consent| (hooks.deliver)(consent, record.diagnostics(), &record.id, metadata))
    });
}

fn replay_with(
    directory: &Path,
    consent: impl Fn() -> Option<String>,
    deliver: impl Fn(&Record) -> bool,
) {
    let Ok(lock) = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(directory.join("lock"))
    else {
        return;
    };
    if !lock.metadata().is_ok_and(|meta| {
        meta.is_file() && meta.uid() == unsafe { libc::geteuid() } && meta.mode() & 0o777 == 0o600
    }) || unsafe { libc::flock(lock.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } != 0
    {
        return;
    }
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };
    let mut entries: Vec<_> = entries.flatten().collect();
    entries.sort_by_key(|entry| {
        std::cmp::Reverse(entry.metadata().and_then(|meta| meta.modified()).ok())
    });
    let mut attempts = 0;
    let mut retained = 0;
    for entry in entries {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        let Some(record) = read(&path) else {
            continue;
        };
        if identity(record.supervisor).as_deref() == Some(record.identity.as_str())
            || identity(record.child).as_deref() == Some(record.child_identity.as_str())
        {
            continue;
        }
        let expired = crate::shared::clock::now_epoch_ms().saturating_sub(record.exited_ms.unwrap_or(record.created_ms))
            > 7 * 24 * 3600 * 1000;
        if expired || consent() != record.consent {
            let _ = fs::remove_file(&path);
            continue;
        }
        if retained >= 16 {
            let _ = fs::remove_file(path);
            continue;
        }
        retained += 1;
        if attempts >= 4 {
            continue;
        }
        attempts += 1;
        if deliver(&record) {
            let _ = fs::remove_file(path);
        }
    }
}

fn observe(
    mut pipe: impl Read + std::os::fd::AsRawFd,
    stop: Arc<AtomicBool>,
    record: Arc<Mutex<Option<(PathBuf, Record)>>>,
) {
    let observed_since = Instant::now();
    let fd = pipe.as_raw_fd();
    let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
    if flags < 0 || unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) } < 0 {
        return;
    }
    let mut buffer = [0u8; 4096];
    let mut line = Vec::new();
    let mut oversized = false;
    let mut drained = 0;
    loop {
        match pipe.read(&mut buffer) {
            Ok(0) => break,
            Ok(count) => {
                let _ = std::io::stderr().write_all(&buffer[..count]);
                for byte in &buffer[..count] {
                    if *byte == b'\n' {
                        if !oversized
                            && let Some(observation) = Observation::read(&line)
                            && let Ok(mut slot) = record.lock()
                            && let Some((path, record)) = slot.as_mut()
                            && observation.apply(record, observed_since.elapsed().as_millis() as u64)
                        {
                            let _ = save(path, record);
                        }
                        line.clear();
                        oversized = false;
                    } else if line.len() < 4096 {
                        line.push(*byte);
                    } else {
                        oversized = true;
                    }
                }
                if stop.load(Ordering::Acquire) {
                    drained += count;
                    if drained >= 65_536 {
                        break;
                    }
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                if stop.load(Ordering::Acquire) {
                    break;
                }
                std::thread::sleep(Duration::from_millis(20));
            }
            Err(_) => break,
        }
    }
}

fn refresh_consent(path: &Path, record: &mut Record, consent: Option<String>) {
    if record.consent != consent {
        record.consent = consent;
        record.stage = Stage::Starting;
        record.finish_phase = None;
        record.trace = Trace::default();
        let _ = save(path, record);
    }
}

pub(crate) fn run(hooks: Hooks) -> Result<()> {
    let parent = std::process::id();
    let root = directory(&hooks.directory).ok();
    if let Some(root) = root.clone() {
        let replay_hooks = hooks.clone();
        std::thread::spawn(move || replay(&root, &replay_hooks));
    }
    let mut bytes = [0u8; 16];
    File::open("/dev/urandom")?.read_exact(&mut bytes)?;
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    let hex: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
    let id = format!(
        "{}-{}-{}-{}-{}",
        &hex[..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..]
    );
    let pending = root.as_ref().map(|root| {
        let record = Record {
            id: id.clone(),
            consent: (hooks.consent)(),
            supervisor: parent,
            identity: identity(parent).unwrap_or_default(),
            child: 0,
            child_identity: String::new(),
            created_ms: crate::shared::clock::now_epoch_ms(),
            exited_ms: None,
            build: env!("APPARENT_VERSION_LABEL").into(),
            revision: env!("APPARENT_COMMIT_SHA").into(),
            version: env!("CARGO_PKG_VERSION").into(),
            release: env!("APPARENT_RELEASE_VERSION").into(),
            release_id: env!("APPARENT_POSTHOG_RELEASE_ID").into(),
            channel: env!("APPARENT_RELEASE_CHANNEL").into(),
            environment: env!("APPARENT_REPORTING_ENVIRONMENT").into(),
            modified: env!("APPARENT_BUILD_MODIFIED") == "true",
            stage: Stage::Starting,
            finish_phase: None,
            trace: Trace::default(),
            cgroup_oom_kill_increased: None,
            code: None,
            signal: None,
            core_dumped: false,
            runtime_ms: 0,
        };
        (root.join(format!("{id}.json")), record)
    });
    let record = Arc::new(Mutex::new(pending));
    let mut child = Command::new(std::env::current_exe()?)
        .args(std::env::args_os().skip(1))
        .env(CHILD, parent.to_string())
        .stderr(Stdio::piped())
        .spawn()?;
    let mut oom = None;
    if let Some((path, state)) = record.lock().unwrap().as_mut() {
        state.child = child.id();
        if state.consent.is_some() {
            oom = OomSample::start(state.child);
        }
        state.child_identity = identity(child.id()).unwrap_or_default();
        let _ = save(path, state);
    }
    let stop = Arc::new(AtomicBool::new(false));
    let pipe = child
        .stderr
        .take()
        .context("Missing recorder diagnostics pipe")?;
    let stop_reader = stop.clone();
    let reader_record = record.clone();
    let reader = std::thread::spawn(move || observe(pipe, stop_reader, reader_record));
    let started = Instant::now();
    let mut checked = Instant::now();
    let mut forwarded = false;
    let status = loop {
        if let Some(status) = child.try_wait()? {
            break status;
        }
        if checked.elapsed() >= Duration::from_secs(1) {
            if let Some((path, record)) = record.lock().unwrap().as_mut() {
                let consent = (hooks.consent)();
                if record.consent != consent {
                    oom = consent.as_ref().and_then(|_| OomSample::start(record.child));
                }
                refresh_consent(path, record, consent);
            }
            checked = Instant::now();
        }
        if (hooks.requested)() && !forwarded {
            unsafe {
                libc::kill(child.id() as libc::pid_t, libc::SIGTERM);
            }
            forwarded = true;
        }
        std::thread::sleep(Duration::from_millis(20));
    };
    stop.store(true, Ordering::Release);
    let _ = reader.join();
    if let Some((path, mut record)) = record.lock().unwrap().take() {
        if status.success() || record.consent.is_none() || (hooks.consent)() != record.consent {
            let _ = fs::remove_file(path);
        } else {
            record.code = status.code();
            record.signal = status.signal();
            if record.signal == Some(libc::SIGKILL) {
                record.cgroup_oom_kill_increased = oom.and_then(OomSample::increased);
            }
            record.core_dumped = status.core_dumped();
            record.runtime_ms = started.elapsed().as_millis() as u64;
            record.exited_ms = Some(crate::shared::clock::now_epoch_ms());
            record.supervisor = 0;
            record.identity.clear();
            save(&path, &record)?;
            if let Some(root) = root {
                replay(&root, &hooks);
            }
        }
    }
    ensure!(status.success(), "Native recorder exited with {status}");
    Ok(())
}

#[cfg(test)]
#[path = "supervisor/tests.rs"]
mod tests;
