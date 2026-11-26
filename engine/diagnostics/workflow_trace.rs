use anyhow::{Context, Result, bail, ensure};
use serde::{Deserialize, Serialize};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::time::Instant;

const MAX_ATTEMPTS: usize = 256;
const MAX_BYTES: u64 = 256 * 1024;

pub(crate) const PREFERENCE: &str = "labs.videoTracing";

pub(crate) struct Store(PathBuf);

enum Admission {
    Disabled,
    Closed,
    Full,
    Begin,
}

include!(concat!(env!("OUT_DIR"), "/trace.rs"));

fn admit(enabled: bool, closed: bool, full: bool) -> Result<()> {
    let index = usize::from(enabled) | (usize::from(closed) << 1) | (usize::from(full) << 2);
    match ADMISSION[index] {
        Admission::Disabled => bail!("Enable CLI workflow tracing in Settings → Labs first"),
        Admission::Closed => bail!("Trace has ended; start a new trace"),
        Admission::Full => bail!("Trace has reached {MAX_ATTEMPTS} commands; start a new trace"),
        Admission::Begin => Ok(()),
    }
}

#[derive(Serialize, Deserialize)]
struct Workflow {
    schema: u8,
    trace_id: String,
    started_ms: u64,
    ended_ms: Option<u64>,
    attempts: Vec<Attempt>,
}

#[derive(Serialize, Deserialize)]
struct Attempt {
    command: String,
    build: String,
    started_ms: u64,
    result: Option<Completion>,
}

#[derive(Serialize, Deserialize)]
struct Completion {
    elapsed_ms: u64,
    succeeded: bool,
}

pub(crate) struct Pending {
    directory: PathBuf,
    index: usize,
    started: Instant,
}

fn private_metadata(meta: &fs::Metadata) -> bool {
    meta.uid() == unsafe { libc::geteuid() } && meta.mode() & 0o077 == 0
}

fn private_directory(path: &Path) -> Result<()> {
    let meta = fs::symlink_metadata(path)?;
    ensure!(
        meta.is_dir() && private_metadata(&meta),
        "Trace directory must be private"
    );
    Ok(())
}

fn open_private(path: &Path, locking: bool) -> Result<File> {
    let file = OpenOptions::new()
        .read(true)
        .write(locking)
        .create(locking)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(path)?;
    let meta = file.metadata()?;
    ensure!(
        meta.is_file() && private_metadata(&meta),
        "Trace file must be private"
    );
    Ok(file)
}

fn lock(directory: &Path) -> Result<File> {
    let file = open_private(&directory.join("lock"), true)?;
    file.lock()?;
    Ok(file)
}

fn read(directory: &Path) -> Result<Workflow> {
    let file = open_private(&directory.join("trace.json"), false)?;
    let mut bytes = Vec::new();
    file.take(MAX_BYTES + 1).read_to_end(&mut bytes)?;
    ensure!(
        bytes.len() as u64 <= MAX_BYTES,
        "Trace exceeds the size limit"
    );
    let trace: Workflow = serde_json::from_slice(&bytes)?;
    ensure!(
        trace.schema == 1
            && directory
                .file_name()
                .is_some_and(|name| name == trace.trace_id.as_str()),
        "Trace identity is invalid"
    );
    Ok(trace)
}

fn write(directory: &Path, trace: &Workflow) -> Result<()> {
    let mut file = tempfile::NamedTempFile::new_in(directory)?;
    serde_json::to_writer(file.as_file_mut(), trace)?;
    file.write_all(b"\n")?;
    file.as_file().sync_all()?;
    file.persist(directory.join("trace.json"))?;
    File::open(directory)?.sync_all()?;
    Ok(())
}

impl Store {
    pub(crate) fn local() -> Self {
        let config = crate::shared::handoff::default_config_path();
        let parent = config
            .parent()
            .unwrap_or(Path::new("."))
            .join("workflow-traces");
        Self(parent)
    }

    pub(crate) fn start(&self) -> Result<String> {
        self.create(enabled()?)
    }

    fn create(&self, enabled: bool) -> Result<String> {
        admit(enabled, false, false)?;
        fs::DirBuilder::new()
            .mode(0o700)
            .recursive(true)
            .create(&self.0)?;
        private_directory(&self.0)?;
        let directory = tempfile::Builder::new()
            .prefix("trace-")
            .rand_bytes(20)
            .permissions(fs::Permissions::from_mode(0o700))
            .tempdir_in(&self.0)?;
        let trace_id = directory
            .path()
            .file_name()
            .unwrap()
            .to_str()
            .unwrap()
            .to_owned();
        let trace = Workflow {
            schema: 1,
            trace_id: trace_id.clone(),
            started_ms: crate::shared::clock::now_epoch_ms(),
            ended_ms: None,
            attempts: Vec::new(),
        };
        write(directory.path(), &trace)?;
        let _ = directory.keep();
        Ok(trace_id)
    }

    fn directory(&self, id: &str) -> Result<PathBuf> {
        ensure!(
            id.strip_prefix("trace-").is_some_and(|suffix| {
                suffix.len() == 20 && suffix.bytes().all(|byte| byte.is_ascii_alphanumeric())
            }),
            "Invalid trace ID"
        );
        private_directory(&self.0).context("Cannot open trace store")?;
        let directory = self.0.join(id);
        private_directory(&directory).context("Cannot open trace")?;
        Ok(directory)
    }

    pub(crate) fn report(&self, id: &str) -> Result<()> {
        let trace = read(&self.directory(id)?)?;
        println!("{}", serde_json::to_string_pretty(&trace)?);
        Ok(())
    }

    pub(crate) fn end(&self, id: &str) -> Result<()> {
        let directory = self.directory(id)?;
        let _lock = lock(&directory)?;
        let mut trace = read(&directory)?;
        if trace.ended_ms.is_none() {
            trace.ended_ms = Some(crate::shared::clock::now_epoch_ms());
            write(&directory, &trace)?;
        }
        Ok(())
    }

    pub(crate) fn begin(&self, id: &str, command: &'static str) -> Result<Pending> {
        self.append(id, command, enabled()?)
    }

    fn append(&self, id: &str, command: &'static str, enabled: bool) -> Result<Pending> {
        admit(enabled, false, false)?;
        let directory = self.directory(id)?;
        let _lock = lock(&directory)?;
        let mut trace = read(&directory)?;
        let index = trace.attempts.len();
        admit(enabled, trace.ended_ms.is_some(), index >= MAX_ATTEMPTS)?;
        trace.attempts.push(Attempt {
            command: command.to_owned(),
            build: env!("APPARENT_VERSION_LABEL").to_owned(),
            started_ms: crate::shared::clock::now_epoch_ms(),
            result: None,
        });
        write(&directory, &trace)?;
        Ok(Pending {
            directory,
            index,
            started: Instant::now(),
        })
    }
}

impl Pending {
    pub(crate) fn finish(self, succeeded: bool) -> Result<()> {
        let elapsed_ms = self.started.elapsed().as_millis() as u64;
        let _lock = lock(&self.directory)?;
        let mut trace = read(&self.directory)?;
        trace
            .attempts
            .get_mut(self.index)
            .context("Trace attempt is missing")?
            .result = Some(Completion {
            elapsed_ms,
            succeeded,
        });
        write(&self.directory, &trace)
    }
}

fn enabled() -> Result<bool> {
    use crate::shared::handoff::{default_config_path, preference_value, read_preferences};
    let config =
        read_preferences(&default_config_path()).context("Cannot read tracing preference")?;
    Ok(preference_value(&config, PREFERENCE).and_then(|value| value.as_bool()) == Some(true))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn concurrent_trace_attempts_are_preserved_when_the_trace_ends() {
        let job = tempfile::tempdir().unwrap();
        let store = Store(job.path().join("traces"));
        assert!(store.create(false).is_err());
        assert!(!store.0.exists());
        let id = store.create(true).unwrap();
        let in_flight = store.append(&id, "capture start", true).unwrap();
        let interrupted = store.append(&id, "capture stop", true).unwrap();
        drop(interrupted);

        std::thread::scope(|scope| {
            for _ in 0..8 {
                scope.spawn(|| {
                    store
                        .append(&id, "video inspect", true)
                        .unwrap()
                        .finish(true)
                        .unwrap();
                });
            }
        });

        store.end(&id).unwrap();
        assert!(store.append(&id, "video inspect", true).is_err());
        in_flight.finish(false).unwrap();
        let report = read(&store.directory(&id).unwrap()).unwrap();
        assert!(report.ended_ms.is_some());
        assert_eq!(report.attempts.len(), 10);
        assert!(!report.attempts[0].result.as_ref().unwrap().succeeded);
        assert!(report.attempts[1].result.is_none());
        assert!(report.attempts[2..].iter().all(|attempt| {
            attempt.command == "video inspect" && attempt.result.as_ref().unwrap().succeeded
        }));
    }
}
