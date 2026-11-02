//! Private opt-in workflow observations, not command execution or automatic QA.
//! The caller MUST check `videoTracing` before calling either public entry point.
//! Automatic attempts accept fixed CLI operation labels only; never pass argv.
use anyhow::{Context, Result, bail, ensure};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs::File;
use std::io::{Read, Write};
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

mod store;
#[cfg(test)]
mod tests;

const MAX_ARTIFACT: u64 = 2 * 1024 * 1024 * 1024;
const LIMITS: &str = "Opt-in observations only. Repeated attempts are not necessarily retries. Durations exclude agent thinking and can overlap. Success is command success, not content QA. Friction ownership is operator judgment. Historical/synthetic modes are not live measurements. Resolve does not control processes or invent elapsed time.";

/// Shared with CLI selection so tracing cannot admit arbitrary caller text or
/// drift away from the set of finite authoring commands.
pub(crate) fn allows_operation(operation: &str) -> bool {
    matches!(
        operation,
        "capture.start"
            | "capture.state"
            | "capture.inspect"
            | "capture.stop"
            | "capture.cancel"
            | "record"
            | "inspect"
            | "frames"
            | "zoom"
            | "export"
            | "reprocess"
            | "retranscribe"
            | "recover"
            | "fixture"
            | "capture-sim"
            | "decoder-check"
            | "encoder-check"
            | "skill"
    )
}

#[derive(Debug, clap::Subcommand)]
pub(crate) enum Command {
    Start {
        label: String,
        #[arg(long, default_value = "live")]
        mode: String,
    },
    Report {
        id: Option<String>,
    },
    Note {
        id: String,
        #[arg(long)]
        phase: String,
        #[arg(long)]
        step: String,
        #[arg(long, default_value = "unknown")]
        owner: String,
        #[arg(long)]
        kind: String,
        #[arg(long)]
        text: String,
    },
    Artifact {
        id: String,
        #[arg(long)]
        phase: String,
        #[arg(long)]
        step: String,
        #[arg(long)]
        path: PathBuf,
        #[arg(long)]
        keep: bool,
    },
    Verify {
        id: String,
    },
    End {
        id: String,
        #[arg(long)]
        status: String,
    },
    Resolve {
        id: String,
        #[arg(long)]
        event: String,
        #[arg(long)]
        text: String,
    },
}

#[derive(Serialize, Deserialize)]
struct Trace {
    schema: u32,
    id: String,
    label: String,
    mode: String,
    started_unix_ms: u64,
    ended_unix_ms: Option<u64>,
    status: String,
    executable: Executable,
    events: Vec<Event>,
}

#[derive(Serialize, Deserialize)]
struct Executable {
    version: String,
    os: String,
    sha256: String,
}

#[derive(Serialize, Deserialize)]
struct Event {
    id: String,
    started_unix_ms: u64,
    #[serde(flatten)]
    data: EventData,
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum EventData {
    Attempt {
        operation: String,
        pid: u32,
        status: String,
        ended_unix_ms: Option<u64>,
        elapsed_ms: Option<u64>,
        success: Option<bool>,
        reconciliation: Option<String>,
    },
    Note {
        phase: String,
        step: String,
        owner: String,
        classification: String,
        text: String,
    },
    Artifact {
        phase: String,
        step: String,
        path: PathBuf,
        retained: Option<String>,
        sha256: String,
        bytes: u64,
    },
}

fn now() -> Result<u64> {
    Ok(SystemTime::now()
        .duration_since(UNIX_EPOCH)?
        .as_millis()
        .try_into()?)
}

fn ident() -> Result<String> {
    Ok(store::random()?
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

fn token(value: &str) -> Result<()> {
    ensure!(
        !value.is_empty()
            && value.len() <= 80
            && value.as_bytes()[0].is_ascii_alphanumeric()
            && value
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"_.-".contains(&b)),
        "use a short non-sensitive token: letters, digits, ._-"
    );
    Ok(())
}

fn filename(value: &str) -> Result<()> {
    ensure!(
        !value.is_empty()
            && value.len() <= 128
            && value != "."
            && value != ".."
            && value
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"_.-".contains(&b)),
        "invalid storage filename"
    );
    Ok(())
}

fn choice(value: &str, values: &[&str]) -> Result<()> {
    ensure!(values.contains(&value), "invalid tracing classification");
    Ok(())
}

fn text(value: &str) -> Result<()> {
    ensure!(
        !value.trim().is_empty() && value.chars().count() <= 4000,
        "text must contain 1–4000 characters"
    );
    Ok(())
}

fn coordinates(phase: &str, step: &str) -> Result<()> {
    token(phase)?;
    token(step)
}

fn root() -> Result<PathBuf> {
    let path = match std::env::var_os("APPARENT_TRACE_ROOT") {
        Some(path) => PathBuf::from(path),
        None => PathBuf::from(std::env::var_os("HOME").context("HOME is unavailable")?)
            .join(".local/share/apparent/workflow-traces"),
    };
    store::absolute(&path)
}

fn load(store: &store::Store, id: &str) -> Result<Trace> {
    token(id)?;
    let file = store.read(&format!("{id}.json"))?;
    ensure!(
        file.metadata()?.len() <= 64 * 1024 * 1024,
        "trace JSON exceeds read limit"
    );
    let trace: Trace = serde_json::from_reader(file)?;
    ensure!(
        trace.schema == 1 && trace.id == id,
        "unsupported or mismatched trace"
    );
    Ok(trace)
}

fn save(store: &store::Store, trace: &Trace, new: bool) -> Result<()> {
    token(&trace.id)?;
    store.write_json(&format!("{}.json", trace.id), trace, new)
}

fn active(trace: &Trace) -> Result<()> {
    ensure!(trace.status == "open", "trace is closed; start a new trace");
    Ok(())
}

fn add(trace: &mut Trace, data: EventData) -> Result<String> {
    active(trace)?;
    let id = ident()?;
    trace.events.push(Event {
        id: id.clone(),
        started_unix_ms: now()?,
        data,
    });
    Ok(id)
}

fn start(store: &store::Store, label: &str, mode: &str) -> Result<Trace> {
    token(label)?;
    choice(
        mode,
        &[
            "live",
            "observer",
            "explainer",
            "synthetic-test",
            "historical",
        ],
    )?;
    // Only the actual current executable, never $APPIMAGE, argv, cwd or environment.
    // /proc pins the running image even when an updater has replaced its pathname.
    #[cfg(target_os = "linux")]
    let mut exe = File::open("/proc/self/exe")?;
    #[cfg(target_os = "macos")]
    let mut exe = File::open(std::env::current_exe()?)?;
    let (sha256, _) = digest(&mut exe, None)?;
    let trace = Trace {
        schema: 1,
        id: ident()?,
        label: label.to_owned(),
        mode: mode.to_owned(),
        started_unix_ms: now()?,
        ended_unix_ms: None,
        status: "open".into(),
        executable: Executable {
            version: env!("CARGO_PKG_VERSION").into(),
            os: std::env::consts::OS.into(),
            sha256,
        },
        events: Vec::new(),
    };
    let _guard = store.lock()?;
    save(store, &trace, true)?;
    Ok(trace)
}

/// A durable running event is committed before returning. Drop intentionally does
/// nothing: kill, panic and missing finish must remain visible as unfinished work.
pub(crate) struct Attempt {
    root: PathBuf,
    trace: String,
    event: String,
    clock: Instant,
}

impl Attempt {
    pub(crate) fn begin(id: &str, operation: &str) -> Result<Self> {
        Self::begin_at(&root()?, id, operation)
    }

    fn begin_at(root: &Path, id: &str, operation: &str) -> Result<Self> {
        token(id)?;
        // Intentionally closed vocabulary. Extend here when wiring a new built-in;
        // user text that happens to look like a token is NOT an operation label.
        ensure!(allows_operation(operation), "unsupported tracing operation");
        let store = store::Store::open(root)?;
        let _guard = store.lock()?;
        let mut trace = load(&store, id)?;
        let event = add(
            &mut trace,
            EventData::Attempt {
                operation: operation.into(),
                pid: std::process::id(),
                status: "running".into(),
                ended_unix_ms: None,
                elapsed_ms: None,
                success: None,
                reconciliation: None,
            },
        )?;
        save(&store, &trace, false)?;
        Ok(Self {
            root: store.root.clone(),
            trace: id.into(),
            event,
            clock: Instant::now(),
        })
    }

    pub(crate) fn finish(self, success: bool) -> Result<()> {
        // Capture elapsed before lock contention or storage work.
        let elapsed_ms: u64 = self.clock.elapsed().as_millis().try_into()?;
        let store = store::Store::open(&self.root)?;
        let _guard = store.lock()?;
        let mut trace = load(&store, &self.trace)?;
        active(&trace)?;
        let event = trace
            .events
            .iter_mut()
            .find(|event| event.id == self.event)
            .context("missing attempt")?;
        match &mut event.data {
            EventData::Attempt {
                status,
                ended_unix_ms,
                elapsed_ms: elapsed,
                success: outcome,
                ..
            } if status == "running" => {
                *status = if success { "succeeded" } else { "failed" }.into();
                *ended_unix_ms = Some(now()?);
                *elapsed = Some(elapsed_ms);
                *outcome = Some(success);
            }
            _ => bail!("attempt is no longer running"),
        }
        save(&store, &trace, false)
    }
}

fn resolve(trace: &mut Trace, event_id: &str, explanation: &str) -> Result<()> {
    token(event_id)?;
    text(explanation)?;
    active(trace)?;
    let event = trace
        .events
        .iter_mut()
        .find(|e| e.id == event_id)
        .context("unknown event")?;
    match &mut event.data {
        EventData::Attempt {
            status,
            ended_unix_ms,
            reconciliation,
            ..
        } if status == "running" => {
            *status = "interrupted".into();
            *ended_unix_ms = Some(now()?);
            *reconciliation = Some(explanation.into());
        }
        _ => bail!("event is not a running attempt"),
    }
    Ok(())
}

fn end(trace: &mut Trace, status: &str) -> Result<()> {
    choice(status, &["delivered", "blocked", "abandoned"])?;
    active(trace)?;
    ensure!(
        !trace
            .events
            .iter()
            .any(|e| matches!(&e.data, EventData::Attempt { status, .. } if status == "running")),
        "running attempts remain; inspect owned processes and explicitly resolve first"
    );
    trace.status = status.into();
    trace.ended_unix_ms = Some(now()?);
    Ok(())
}

fn snapshot(meta: &std::fs::Metadata) -> (u64, i64, i64, i64, i64) {
    (
        meta.len(),
        meta.mtime(),
        meta.mtime_nsec(),
        meta.ctime(),
        meta.ctime_nsec(),
    )
}

fn digest(source: &mut File, mut sink: Option<&mut File>) -> Result<(String, u64)> {
    let before = source.metadata()?;
    ensure!(
        before.is_file() && before.len() <= MAX_ARTIFACT,
        "file must be regular and at most 2 GiB"
    );
    let mut hash = Sha256::new();
    let mut total = 0u64;
    let mut buffer = [0; 128 * 1024];
    loop {
        let count = source.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        total += count as u64;
        ensure!(total <= MAX_ARTIFACT, "file grew beyond 2 GiB");
        hash.update(&buffer[..count]);
        if let Some(sink) = &mut sink {
            sink.write_all(&buffer[..count])?;
        }
    }
    ensure!(
        snapshot(&before) == snapshot(&source.metadata()?) && total == before.len(),
        "file changed while hashing"
    );
    Ok((format!("{:x}", hash.finalize()), total))
}

fn artifact(
    store: &store::Store,
    id: &str,
    phase: &str,
    step: &str,
    path: &Path,
    keep: bool,
) -> Result<String> {
    token(id)?;
    coordinates(phase, step)?;
    // Check admission before copying, but do not lock during potentially large IO.
    {
        let _guard = store.lock()?;
        active(&load(store, id)?)?;
    }
    let path = store::absolute(path)?;
    let mut source = store::input(&path)?;
    let retained = if keep {
        Some(format!("artifact-{}", ident()?))
    } else {
        None
    };
    let mut publication_started = false;
    let result = (|| -> Result<String> {
        let mut sink = retained
            .as_ref()
            .map(|name| store.create(name))
            .transpose()?;
        let (sha256, bytes) = digest(&mut source, sink.as_mut())?;
        if let Some(sink) = sink {
            sink.sync_all()?;
        }
        let _guard = store.lock()?;
        let mut trace = load(store, id)?;
        let event = add(
            &mut trace,
            EventData::Artifact {
                phase: phase.into(),
                step: step.into(),
                path,
                retained: retained.clone(),
                sha256,
                bytes,
            },
        )?;
        // A directory fsync can fail after rename has already published the event.
        // Preserve the evidence on any uncertain commit instead of breaking it.
        publication_started = true;
        save(store, &trace, false)?;
        Ok(event)
    })();
    if result.is_err() && !publication_started {
        if let Some(name) = retained {
            let _ = store.remove(&name);
        }
    }
    result
}

fn verify(store: &store::Store, trace: &Trace) -> Value {
    let results: Vec<Value> = trace
        .events
        .iter()
        .filter_map(|event| {
            let EventData::Artifact {
                path,
                retained,
                sha256,
                bytes,
                ..
            } = &event.data
            else {
                return None;
            };
            let result = (|| -> Result<bool> {
                let mut file = if let Some(name) = retained {
                    ensure!(
                        name.starts_with("artifact-"),
                        "invalid retained artifact name"
                    );
                    store.read(name)?
                } else {
                    ensure!(path.is_absolute(), "artifact reference must be absolute");
                    store::input(path)?
                };
                let (actual, size) = digest(&mut file, None)?;
                Ok(actual == *sha256 && size == *bytes)
            })();
            Some(
                json!({"event": event.id, "retained": retained.is_some(), "status": match result {
                    Ok(true) => "ok", Ok(false) => "changed", Err(_) => "missing_or_unreadable",
                }}),
            )
        })
        .collect();
    let ok = results.iter().all(|r| r["status"] == "ok");
    json!({"schema": 1, "id": trace.id, "ok": ok, "artifacts": results})
}

fn report(trace: &Trace) -> Value {
    let mut operations: BTreeMap<&str, Value> = BTreeMap::new();
    let mut friction: BTreeMap<(&str, &str, &str), u64> = BTreeMap::new();
    for event in &trace.events {
        match &event.data {
            EventData::Attempt {
                operation,
                status,
                elapsed_ms,
                success,
                ..
            } => {
                let group = operations.entry(operation).or_insert_with(|| {
                    json!({
                        "operation": operation, "attempts": 0, "succeeded": 0, "failed": 0,
                        "running": 0, "interrupted": 0, "measured_ms": 0,
                    })
                });
                for (key, amount) in [
                    ("attempts", 1),
                    ("succeeded", u64::from(*success == Some(true))),
                    ("failed", u64::from(*success == Some(false))),
                    ("running", u64::from(status == "running")),
                    ("interrupted", u64::from(status == "interrupted")),
                    ("measured_ms", elapsed_ms.unwrap_or(0)),
                ] {
                    group[key] = json!(group[key].as_u64().unwrap_or(0).saturating_add(amount));
                }
            }
            EventData::Note {
                phase,
                step,
                owner,
                classification,
                ..
            } if classification == "friction" => {
                *friction.entry((owner, phase, step)).or_default() += 1;
            }
            _ => {}
        }
    }
    let repeated: u64 = operations
        .values()
        .map(|v| v["attempts"].as_u64().unwrap_or(0).saturating_sub(1))
        .sum();
    let friction: Vec<_> = friction.into_iter().map(|((owner, phase, step), count)|
        json!({"owner": owner, "phase": phase, "step": step, "friction_notes": count})).collect();
    json!({"schema": 1, "trace": trace, "operations": operations.into_values().collect::<Vec<_>>(),
        "friction": friction, "repeated_operation_attempts": repeated, "limits": LIMITS})
}

pub(crate) fn command(command: Command) -> Result<()> {
    let store = store::Store::open(&root()?)?;
    let output = execute(&store, command)?;
    let failed_verification = output.get("ok") == Some(&Value::Bool(false));
    let stdout = std::io::stdout();
    let mut stdout = stdout.lock();
    serde_json::to_writer_pretty(&mut stdout, &output)?;
    writeln!(stdout)?;
    if failed_verification {
        bail!("trace artifact verification failed");
    }
    Ok(())
}

fn execute(store: &store::Store, command: Command) -> Result<Value> {
    match command {
        Command::Start { label, mode } => {
            let trace = start(store, &label, &mode)?;
            Ok(json!({"schema": 1, "id": trace.id, "mode": trace.mode, "root": store.root}))
        }
        Command::Artifact {
            id,
            phase,
            step,
            path,
            keep,
        } => Ok(json!({"event": artifact(store, &id, &phase, &step, &path, keep)?})),
        Command::Report { id } => {
            let _guard = store.lock()?;
            let ids = match id {
                Some(id) => {
                    token(&id)?;
                    vec![id]
                }
                None => store.trace_ids()?,
            };
            let traces: Vec<_> = ids
                .iter()
                .map(|id| load(store, id).map(|trace| report(&trace)))
                .collect::<Result<_>>()?;
            // Aggregates remain inside each trace and carry that trace's mode.
            Ok(json!({"schema": 1, "traces": traces, "limits": LIMITS}))
        }
        Command::Verify { id } => {
            let trace = {
                let _guard = store.lock()?;
                load(store, &id)?
            };
            Ok(verify(store, &trace))
        }
        command => {
            let _guard = store.lock()?;
            let id = match &command {
                Command::Note { id, .. }
                | Command::End { id, .. }
                | Command::Resolve { id, .. } => id,
                _ => unreachable!(),
            };
            let mut trace = load(store, id)?;
            let output = match command {
                Command::Note {
                    phase,
                    step,
                    owner,
                    kind,
                    text: note,
                    ..
                } => {
                    coordinates(&phase, &step)?;
                    token(&owner)?;
                    choice(&kind, &["friction", "recovery", "observation"])?;
                    text(&note)?;
                    json!({"event": add(&mut trace, EventData::Note { phase, step, owner, classification: kind, text: note })?})
                }
                Command::Resolve { event, text, .. } => {
                    resolve(&mut trace, &event, &text)?;
                    json!({"event": event, "status": "interrupted", "process_control": "none"})
                }
                Command::End { status, .. } => {
                    end(&mut trace, &status)?;
                    json!({"id": trace.id, "status": status})
                }
                _ => unreachable!(),
            };
            save(store, &trace, false)?;
            Ok(output)
        }
    }
}
