//! Local, same-user control of the running GUI. Never launches an app or sends a capture.
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::os::fd::{AsRawFd, FromRawFd};
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::{FileTypeExt, MetadataExt, OpenOptionsExt, PermissionsExt};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::PathBuf;
use std::time::{Duration, Instant};

use anyhow::{Context, Result, bail, ensure};
use serde::Serialize;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    Idle,
    Selecting,
    Starting,
    Recording,
    Processing,
    Completed,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct State {
    pub phase: Phase,
    /// Opaque, per-capture identity. Absent outside a pending or active capture.
    pub capture_id: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Action {
    Start,
    Inspect,
    Stop,
    Cancel,
}

/// Small in-process receipts, not capture history on disk. Media stays in the bundle.
#[derive(Default)]
pub struct Registry(HashMap<String, serde_json::Value>);

impl Registry {
    pub fn decide(&self, state: &State, action: Action, id: &str) -> Outcome {
        if action == Action::Stop
            && matches!(
                self.inspect(id)["status"].as_str(),
                Some("processing" | "saved" | "cancelled" | "failed")
            )
        {
            return Outcome::AlreadyEnded;
        }
        decide(state, action, id)
    }
    /// Called on the GUI thread, before any recording side effect. Rejected IDs are
    /// tombstoned too: retrying a rejected/expired request cannot launch later.
    pub fn admit(&mut self, id: &str, occupied: bool, expired: bool) -> bool {
        if self.0.contains_key(id) {
            return false;
        }
        if expired || occupied {
            self.set(
                id,
                "rejected",
                None,
                Some(if expired {
                    "admission_expired"
                } else {
                    "occupied"
                }),
            );
            return false;
        }
        self.begin(id);
        true
    }

    pub fn begin(&mut self, id: &str) {
        self.set(id, "starting", None, None);
    }

    pub fn set(
        &mut self,
        id: &str,
        status: &str,
        path: Option<&std::path::Path>,
        error: Option<&str>,
    ) {
        self.0.insert(
            id.into(),
            serde_json::json!({
                "capture_id": id, "status": status, "bundle_path": path, "error": error,
            }),
        );
    }

    /// Only the successful production finalizer can publish a saved path.
    pub fn finish(&mut self, id: &str, result: Result<&std::path::Path, String>) {
        match result {
            Ok(path) => self.set(id, "saved", Some(path), None),
            Err(message) => {
                self.set(id, "failed", None, Some("finalization_failed"));
                self.0.get_mut(id).unwrap()["message"] = message.into();
            }
        }
    }

    pub fn inspect(&self, id: &str) -> serde_json::Value {
        self.0.get(id).cloned().unwrap_or_else(|| serde_json::json!({
            "capture_id": id, "status": "unknown", "bundle_path": null, "error": "unknown_capture",
        }))
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Outcome {
    Stopping,
    Cancelled,
    AlreadyEnded,
    WrongCapture,
    NotReady,
}

pub fn decide(state: &State, action: Action, id: &str) -> Outcome {
    let Some(current) = &state.capture_id else {
        return Outcome::AlreadyEnded;
    };
    if id != current {
        return Outcome::WrongCapture;
    }
    match (&state.phase, action) {
        (Phase::Recording, Action::Stop) => Outcome::Stopping,
        (Phase::Starting | Phase::Recording, Action::Cancel) => Outcome::Cancelled,
        _ => Outcome::NotReady,
    }
}

pub fn new_id() -> Result<String> {
    let mut bytes = [0u8; 16];
    std::fs::File::open("/dev/urandom")?.read_exact(&mut bytes)?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn socket_path(create: bool) -> Result<PathBuf> {
    let home = std::env::var_os("HOME").context("HOME is not set")?;
    let dir = PathBuf::from(home).join(".config/apparent/agent-control");
    if create {
        std::fs::create_dir_all(&dir)?;
    }
    let meta = std::fs::symlink_metadata(&dir)?;
    ensure!(
        meta.is_dir() && meta.uid() == unsafe { libc::geteuid() },
        "unsafe control directory"
    );
    if create {
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700))?;
    }
    ensure!(
        std::fs::metadata(&dir)?.permissions().mode() & 0o077 == 0,
        "control directory is not private"
    );
    Ok(dir.join("capture.sock"))
}

fn same_user(stream: &UnixStream) -> Result<()> {
    #[cfg(target_os = "linux")]
    {
        let mut cred: libc::ucred = unsafe { std::mem::zeroed() };
        let mut len = std::mem::size_of::<libc::ucred>() as libc::socklen_t;
        let rc = unsafe {
            libc::getsockopt(
                stream.as_raw_fd(),
                libc::SOL_SOCKET,
                libc::SO_PEERCRED,
                &mut cred as *mut _ as *mut _,
                &mut len,
            )
        };
        ensure!(
            rc == 0
                && len as usize == std::mem::size_of::<libc::ucred>()
                && cred.uid == unsafe { libc::geteuid() },
            "control peer is not this user"
        );
    }
    #[cfg(target_os = "macos")]
    {
        let mut uid = 0;
        let mut gid = 0;
        let rc = unsafe { libc::getpeereid(stream.as_raw_fd(), &mut uid, &mut gid) };
        ensure!(
            rc == 0 && uid == unsafe { libc::geteuid() },
            "control peer is not this user"
        );
    }
    Ok(())
}

pub struct Request {
    pub action: Option<(Action, String)>,
    pub reply: std::sync::mpsc::SyncSender<String>,
    pub deadline_ms: u64,
}

/// Same-host monotonic deadline, including time spent in the socket accept queue.
fn clock_ms() -> u64 {
    let mut time: libc::timespec = unsafe { std::mem::zeroed() };
    // CLOCK_MONOTONIC is available on both supported Unix targets.
    assert_eq!(
        unsafe { libc::clock_gettime(libc::CLOCK_MONOTONIC, &mut time) },
        0
    );
    time.tv_sec as u64 * 1000 + time.tv_nsec as u64 / 1_000_000
}

impl Request {
    pub fn expired(&self) -> bool {
        clock_ms() >= self.deadline_ms
    }
}

fn parse_request(line: &str) -> Option<(Option<(Action, String)>, u64)> {
    let parts: Vec<_> = line.split_whitespace().collect();
    if parts == ["state"] {
        return Some((None, clock_ms() + 3000));
    }
    if !(2..=3).contains(&parts.len()) || !valid_id(parts[1]) {
        return None;
    }
    let action = match parts[0] {
        "start" if parts.len() == 3 => Action::Start,
        "inspect" => Action::Inspect,
        "stop" => Action::Stop,
        "cancel" => Action::Cancel,
        _ => return None,
    };
    let deadline = if parts.len() == 3 {
        parts[2].parse().ok()?
    } else {
        clock_ms() + 3000
    };
    Some((
        Some((action, parts[1].into())),
        deadline.min(clock_ms() + 3000),
    ))
}

/// Separate from Linux's shortcut socket: no toggle, no unacknowledged mutation.
pub fn listen() -> Result<flume::Receiver<Request>> {
    let path = socket_path(true)?;
    listen_at(path)
}

fn listen_at(path: PathBuf) -> Result<flume::Receiver<Request>> {
    // Hold this advisory lock for the listener's whole lifetime. Without it, two launches
    // recovering the same stale socket can unlink each other's freshly bound listener.
    let owner_path = path.with_extension("lock");
    let owner = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW)
        .open(owner_path)?;
    ensure!(
        try_lock_owner(&owner)?,
        "control socket is already owned by another GUI"
    );
    if let Ok(meta) = std::fs::symlink_metadata(&path) {
        ensure!(
            meta.file_type().is_socket()
                && meta.uid() == unsafe { libc::geteuid() }
                && meta.mode() & 0o777 == 0o600,
            "unsafe existing control socket"
        );
        match connect_until(&path, Instant::now() + Duration::from_millis(250)) {
            Err(error) if error.kind() == std::io::ErrorKind::ConnectionRefused => {
                std::fs::remove_file(&path)?
            }
            _ => bail!("control socket is already in use: {}", path.display()),
        }
    }
    let listener = UnixListener::bind(&path)?;
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))?;
    listener.set_nonblocking(true)?;
    let (tx, rx) = flume::bounded(16);
    std::thread::Builder::new()
        .name("apparent-agent-control".into())
        .spawn(move || {
            let _owner = owner;
            while !tx.is_disconnected() {
                let (mut stream, _) = match listener.accept() {
                    Ok(accepted) => accepted,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(Duration::from_millis(20));
                        continue;
                    }
                    Err(_) => break,
                };
                if same_user(&stream).is_err() {
                    continue;
                }
                let _ = stream.set_read_timeout(Some(Duration::from_secs(3)));
                let _ = stream.set_write_timeout(Some(Duration::from_secs(3)));
                let mut line = String::new();
                let response = if BufReader::new(&stream)
                    .take(256)
                    .read_line(&mut line)
                    .is_ok()
                {
                    if let Some((action, deadline_ms)) = parse_request(line.trim()) {
                        let (reply, receive) = std::sync::mpsc::sync_channel(1);
                        if tx
                            .try_send(Request {
                                action,
                                reply,
                                deadline_ms,
                            })
                            .is_ok()
                        {
                            receive
                                .recv_timeout(Duration::from_millis(
                                    deadline_ms.saturating_sub(clock_ms()),
                                ))
                                .unwrap_or_else(|_| "{\"error\":\"app_unresponsive\"}".into())
                        } else {
                            "{\"error\":\"app_busy\"}".into()
                        }
                    } else {
                        "{\"error\":\"invalid_request\"}".to_owned()
                    }
                } else {
                    "{\"error\":\"invalid_request\"}".into()
                };
                let _ = writeln!(stream, "{response}");
            }
            // Only this listener can own the pathname until the lock is released.
            let _ = std::fs::remove_file(path);
        })?;
    Ok(rx)
}

fn valid_id(id: &str) -> bool {
    id.len() == 32 && id.bytes().all(|b| b.is_ascii_hexdigit())
}

/// Check GUI ownership without asking its UI to respond or connecting to its socket.
/// Missing/released locks mean no owner; unsafe paths and I/O errors fail closed.
pub fn running_owner() -> Result<bool> {
    match socket_path(false) {
        Ok(path) => running_owner_at(path),
        Err(error)
            if error
                .downcast_ref::<std::io::Error>()
                .is_some_and(|error| error.kind() == std::io::ErrorKind::NotFound) =>
        {
            Ok(false)
        }
        Err(error) => Err(error),
    }
}

fn running_owner_at(path: PathBuf) -> Result<bool> {
    let owner = match std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(path.with_extension("lock"))
    {
        Ok(owner) => owner,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(error.into()),
    };
    Ok(!try_lock_owner(&owner)?)
}

fn try_lock_owner(owner: &std::fs::File) -> Result<bool> {
    let meta = owner.metadata()?;
    ensure!(
        meta.is_file() && meta.uid() == unsafe { libc::geteuid() } && meta.mode() & 0o777 == 0o600,
        "unsafe control owner lock"
    );
    if unsafe { libc::flock(owner.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } == 0 {
        return Ok(true);
    }
    let error = std::io::Error::last_os_error();
    if error.kind() == std::io::ErrorKind::WouldBlock {
        Ok(false)
    } else {
        Err(error.into())
    }
}

pub fn command(action: Option<(Action, &str)>) -> Result<String> {
    command_for(action, Duration::from_secs(4))
}

fn deadline_error() -> std::io::Error {
    std::io::Error::new(
        std::io::ErrorKind::TimedOut,
        "GUI capture control deadline expired",
    )
}

fn remaining_until(deadline: Instant) -> std::io::Result<Duration> {
    let remaining = deadline.saturating_duration_since(Instant::now());
    if remaining.is_zero() {
        Err(deadline_error())
    } else {
        Ok(remaining)
    }
}

fn wait_ready(fd: libc::c_int, events: libc::c_short, deadline: Instant) -> std::io::Result<()> {
    loop {
        let remaining = remaining_until(deadline)?;
        let mut descriptor = libc::pollfd {
            fd,
            events,
            revents: 0,
        };
        let millis = remaining
            .as_millis()
            .saturating_add(1)
            .min(i32::MAX as u128) as i32;
        let result = unsafe { libc::poll(&mut descriptor, 1, millis) };
        if result > 0 {
            remaining_until(deadline)?;
            return Ok(());
        }
        if result < 0 && std::io::Error::last_os_error().kind() != std::io::ErrorKind::Interrupted {
            return Err(std::io::Error::last_os_error());
        }
    }
}

/// Nonblocking from socket creation onward. Linux reports a full Unix accept queue as
/// EAGAIN (not EINPROGRESS); retry with a fresh socket without leaving a worker behind.
fn connect_until(path: &std::path::Path, deadline: Instant) -> std::io::Result<UnixStream> {
    let bytes = path.as_os_str().as_bytes();
    let mut address: libc::sockaddr_un = unsafe { std::mem::zeroed() };
    if bytes.len() >= address.sun_path.len() || bytes.contains(&0) {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "invalid control socket path",
        ));
    }
    address.sun_family = libc::AF_UNIX as libc::sa_family_t;
    for (dest, source) in address.sun_path.iter_mut().zip(bytes) {
        *dest = *source as libc::c_char;
    }
    let length =
        (std::mem::offset_of!(libc::sockaddr_un, sun_path) + bytes.len() + 1) as libc::socklen_t;
    #[cfg(target_os = "macos")]
    {
        address.sun_len = length as u8;
    }
    loop {
        remaining_until(deadline)?;
        #[cfg(target_os = "linux")]
        let flags = libc::SOCK_STREAM | libc::SOCK_CLOEXEC;
        #[cfg(not(target_os = "linux"))]
        let flags = libc::SOCK_STREAM;
        let fd = unsafe { libc::socket(libc::AF_UNIX, flags, 0) };
        if fd < 0 {
            return Err(std::io::Error::last_os_error());
        }
        // Own the descriptor immediately, including every error path below.
        let stream = unsafe { UnixStream::from_raw_fd(fd) };
        #[cfg(target_os = "macos")]
        {
            if unsafe { libc::fcntl(fd, libc::F_SETFD, libc::FD_CLOEXEC) } < 0 {
                return Err(std::io::Error::last_os_error());
            }
            let enabled: libc::c_int = 1;
            if unsafe {
                libc::setsockopt(
                    fd,
                    libc::SOL_SOCKET,
                    libc::SO_NOSIGPIPE,
                    (&enabled as *const libc::c_int).cast(),
                    std::mem::size_of_val(&enabled) as libc::socklen_t,
                )
            } < 0
            {
                return Err(std::io::Error::last_os_error());
            }
        }
        stream.set_nonblocking(true)?;
        if unsafe { libc::connect(fd, (&address as *const libc::sockaddr_un).cast(), length) } == 0
        {
            return Ok(stream);
        }
        let error = std::io::Error::last_os_error();
        if error.raw_os_error() == Some(libc::EINPROGRESS) {
            wait_ready(fd, libc::POLLOUT, deadline)?;
            if let Some(error) = stream.take_error()? {
                return Err(error);
            }
            return Ok(stream);
        }
        if !matches!(
            error.kind(),
            std::io::ErrorKind::WouldBlock | std::io::ErrorKind::Interrupted
        ) {
            return Err(error);
        }
        drop(stream);
        std::thread::sleep(Duration::from_millis(2).min(remaining_until(deadline)?));
    }
}

/// One absolute deadline covers all partial reads/writes, not one timeout per byte.
struct DeadlineStream {
    stream: UnixStream,
    deadline: Instant,
}

impl Read for DeadlineStream {
    fn read(&mut self, bytes: &mut [u8]) -> std::io::Result<usize> {
        loop {
            wait_ready(self.stream.as_raw_fd(), libc::POLLIN, self.deadline)?;
            match self.stream.read(bytes) {
                Err(error)
                    if matches!(
                        error.kind(),
                        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::Interrupted
                    ) => {}
                result => return result,
            }
        }
    }
}

impl Write for DeadlineStream {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        loop {
            wait_ready(self.stream.as_raw_fd(), libc::POLLOUT, self.deadline)?;
            match self.stream.write(bytes) {
                Err(error)
                    if matches!(
                        error.kind(),
                        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::Interrupted
                    ) => {}
                result => return result,
            }
        }
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

fn command_for(action: Option<(Action, &str)>, budget: Duration) -> Result<String> {
    if let Some((_, id)) = action {
        ensure!(valid_id(id), "capture ID must be 32 hex characters");
    }
    let timeout = budget
        .min(Duration::from_secs(4))
        .max(Duration::from_millis(1));
    let deadline_ms = clock_ms() + timeout.as_millis() as u64;
    let path = socket_path(false)?;
    command_at(action, timeout, deadline_ms, &path)
}

fn command_at(
    action: Option<(Action, &str)>,
    timeout: Duration,
    deadline_ms: u64,
    path: &std::path::Path,
) -> Result<String> {
    let deadline = Instant::now()
        + timeout.min(Duration::from_millis(
            deadline_ms.saturating_sub(clock_ms()),
        ));
    let meta = std::fs::symlink_metadata(&path).context("no running GUI control socket")?;
    ensure!(
        meta.file_type().is_socket()
            && meta.uid() == unsafe { libc::geteuid() }
            && meta.mode() & 0o777 == 0o600,
        "unsafe control socket"
    );
    let stream = connect_until(path, deadline).context("GUI capture control unavailable")?;
    same_user(&stream)?;
    let mut stream = DeadlineStream { stream, deadline };
    let request = match action {
        None => "state".to_owned(),
        Some((action, id)) => format!(
            "{} {id} {deadline_ms}",
            match action {
                Action::Start => "start",
                Action::Inspect => "inspect",
                Action::Stop => "stop",
                Action::Cancel => "cancel",
            }
        ),
    };
    writeln!(stream, "{request}")?;
    let mut response = String::new();
    BufReader::new(stream).take(4096).read_line(&mut response)?;
    ensure!(
        !response.is_empty(),
        "GUI capture control closed without a reply"
    );
    Ok(response.trim().to_owned())
}

/// One mutation, then read-only polling by the original ID. Never infer ownership
/// from global state and never resend Stop as a toggle after a timeout.
pub fn execute(action: Option<(Action, &str)>, wait: bool, timeout: Duration) -> serde_json::Value {
    execute_with(action, wait, timeout, command_for)
}

fn execute_with(
    action: Option<(Action, &str)>,
    wait: bool,
    timeout: Duration,
    mut send: impl FnMut(Option<(Action, &str)>, Duration) -> Result<String>,
) -> serde_json::Value {
    let deadline = Instant::now() + timeout;
    let id = action.map(|(_, id)| id);
    let mut next = action;
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return serde_json::json!({"capture_id": id, "error": "timeout", "message": "Inspect the same ID; an admitted capture is not cancelled on timeout."});
        }
        let response = send(next, remaining)
            .and_then(|text| Ok(serde_json::from_str::<serde_json::Value>(&text)?));
        if Instant::now() >= deadline
            || response.as_ref().err().is_some_and(|error| {
                error
                    .downcast_ref::<std::io::Error>()
                    .is_some_and(|error| error.kind() == std::io::ErrorKind::TimedOut)
            })
        {
            return serde_json::json!({"capture_id": id, "error": "timeout", "message": "Inspect the same ID; an admitted capture is not cancelled on timeout."});
        }
        let mut value = match response {
            Ok(value) => value,
            Err(error) => {
                return serde_json::json!({"capture_id": id, "error": "control_unavailable", "message": format!("{error:#}"), "recovery": "Inspect the same ID before retrying; admission may have succeeded."});
            }
        };
        if !value.is_object() {
            return serde_json::json!({"capture_id": id, "error": "invalid_response"});
        }
        if value["error"].is_string() {
            // Listener/transport errors may not yet have reached the GUI thread.
            value["capture_id"] = serde_json::json!(id);
            return value;
        }
        if let Some((action, id)) = action {
            // A response for a different resource is never a successful receipt.
            let status = value["status"].as_str();
            if value["capture_id"].as_str() != Some(id)
                || !matches!(
                    status,
                    Some(
                        "starting"
                            | "recording"
                            | "processing"
                            | "saved"
                            | "cancelled"
                            | "failed"
                            | "rejected"
                            | "unknown"
                    )
                )
                || (status == Some("saved")
                    && !value["bundle_path"].as_str().is_some_and(|p| !p.is_empty()))
            {
                return serde_json::json!({"capture_id": id, "error": "invalid_response"});
            }
            if !wait
                || matches!(
                    value["outcome"].as_str(),
                    Some("wrong_capture" | "not_ready")
                )
            {
                return value;
            }
            if (action == Action::Start && status == Some("recording"))
                || (action == Action::Stop
                    && status == Some("saved")
                    && value["bundle_path"].is_string())
            {
                return value;
            }
            if matches!(
                status,
                Some("cancelled" | "failed" | "rejected" | "unknown" | "saved")
            ) {
                value["error"] = serde_json::json!(match status {
                    Some("cancelled") => "cancelled",
                    Some("unknown") => "unknown_capture",
                    _ => "ended_before_ready",
                });
                return value;
            }
            next = Some((Action::Inspect, id));
        } else {
            return value;
        }
        std::thread::sleep(
            Duration::from_millis(50).min(deadline.saturating_duration_since(Instant::now())),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn transport_fixture() -> (PathBuf, UnixListener) {
        // Short enough for sun_path, private and unrelated to the live GUI socket.
        let dir = std::env::temp_dir().join(format!("ac-{}", new_id().unwrap()));
        std::fs::create_dir(&dir).unwrap();
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700)).unwrap();
        let path = dir.join("s");
        let listener = UnixListener::bind(&path).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
        (path, listener)
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn transport_full_backlog_obeys_absolute_deadline() {
        let (path, listener) = transport_fixture();
        assert_eq!(unsafe { libc::listen(listener.as_raw_fd(), 1) }, 0);
        let queued = [
            UnixStream::connect(&path).unwrap(),
            UnixStream::connect(&path).unwrap(),
        ];
        // Bound even the buggy test: unblock its blocking connect only after the assertion's
        // budget has been exceeded. No timed-out worker is abandoned.
        let server = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(450));
            drop(queued);
            drop(listener);
        });
        let started = Instant::now();
        let result = command_at(None, Duration::from_millis(80), clock_ms() + 80, &path);
        let elapsed = started.elapsed();
        server.join().unwrap();
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
        assert!(result.is_err());
        assert!(
            elapsed < Duration::from_millis(300),
            "connect exceeded budget: {elapsed:?}"
        );
    }

    #[test]
    fn transport_trickled_reply_obeys_absolute_deadline() {
        let (path, listener) = transport_fixture();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = String::new();
            BufReader::new(&stream).read_line(&mut request).unwrap();
            for byte in b"{\"state\":\"idle\"}\n" {
                if stream.write_all(&[*byte]).is_err() {
                    break;
                }
                std::thread::sleep(Duration::from_millis(30));
            }
        });
        let started = Instant::now();
        let result = command_at(None, Duration::from_millis(80), clock_ms() + 80, &path);
        let elapsed = started.elapsed();
        server.join().unwrap();
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
        assert!(
            result.is_err(),
            "trickle must not restart the timeout: {result:?}"
        );
        assert!(
            elapsed < Duration::from_millis(300),
            "read exceeded budget: {elapsed:?}"
        );
    }

    #[test]
    fn transport_normal_reply_preserves_request_and_peer_checks() {
        let (path, listener) = transport_fixture();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(1)))
                .unwrap();
            let mut request = String::new();
            BufReader::new(&stream).read_line(&mut request).unwrap();
            assert_eq!(request, "state\n");
            stream
                .write_all(b"{\"state\":{\"phase\":\"idle\"}}\n")
                .unwrap();
        });
        let response = command_at(None, Duration::from_secs(1), clock_ms() + 1000, &path);
        server.join().unwrap();
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
        assert_eq!(response.unwrap(), "{\"state\":{\"phase\":\"idle\"}}");
    }

    #[test]
    fn transport_stalled_write_obeys_absolute_deadline() {
        let (stream, _peer) = UnixStream::pair().unwrap();
        stream.set_nonblocking(true).unwrap();
        let started = Instant::now();
        let mut stream = DeadlineStream {
            stream,
            deadline: started + Duration::from_millis(80),
        };
        // More than the socket send queue; peer deliberately never drains it.
        let result = stream.write_all(&vec![0; 4 * 1024 * 1024]);
        assert_eq!(result.unwrap_err().kind(), std::io::ErrorKind::TimedOut);
        assert!(started.elapsed() < Duration::from_millis(300));
    }

    #[test]
    fn owned_admission_is_once_only_and_rejections_cannot_start_later() {
        let mut registry = Registry::default();
        let mut starts = 0;
        for (id, occupied, expired) in [
            ("a", false, false),
            ("b", true, false),
            ("late", false, true),
            ("a", false, false),
            ("b", false, false),
            ("late", false, false),
        ] {
            starts += usize::from(registry.admit(id, occupied, expired));
        }
        assert_eq!(starts, 1);
        assert_eq!(registry.inspect("a")["status"], "starting");
        assert_eq!(registry.inspect("b")["error"], "occupied");
        assert_eq!(registry.inspect("late")["error"], "admission_expired");
    }

    #[test]
    fn older_saved_result_survives_new_capture_and_stop_retry_does_not_stop_it() {
        let mut registry = Registry::default();
        registry.begin("old");
        registry.finish("old", Ok(std::path::Path::new("/captures/exact.apparent")));
        registry.begin("new");
        let state = State {
            phase: Phase::Recording,
            capture_id: Some("new".into()),
        };
        assert_eq!(
            registry.decide(&state, Action::Stop, "old"),
            Outcome::AlreadyEnded
        );
        assert_eq!(
            registry.inspect("old")["bundle_path"],
            "/captures/exact.apparent"
        );
        assert_eq!(
            registry.decide(&state, Action::Stop, "other"),
            Outcome::WrongCapture
        );
        assert_eq!(
            registry.decide(&state, Action::Stop, "new"),
            Outcome::Stopping
        );
        registry.set("new", "processing", None, None);
        assert_eq!(
            registry.decide(&state, Action::Stop, "new"),
            Outcome::AlreadyEnded
        );
    }

    #[test]
    fn finalization_error_or_cancel_never_publishes_a_saved_path() {
        let mut registry = Registry::default();
        registry.begin("failure");
        registry.finish("failure", Err("disk full".into()));
        let failure = registry.inspect("failure");
        assert_eq!(failure["status"], "failed");
        assert_eq!(failure["error"], "finalization_failed");
        assert_eq!(failure["message"], "disk full");
        assert!(failure["bundle_path"].is_null());
        registry.set("cancel", "cancelled", None, None);
        assert!(registry.inspect("cancel")["bundle_path"].is_null());
        assert_eq!(registry.inspect("unknown")["error"], "unknown_capture");
    }

    #[test]
    fn stop_wait_sends_one_stop_then_inspects_only_that_id_until_saved() {
        let mut calls = vec![];
        let replies = [
            serde_json::json!({"capture_id":"owned", "status":"processing", "outcome":"stopping"}),
            serde_json::json!({"capture_id":"owned", "status":"processing"}),
            serde_json::json!({"capture_id":"owned", "status":"saved", "bundle_path":"/captures/exact.apparent"}),
        ];
        let value = execute_with(
            Some((Action::Stop, "owned")),
            true,
            Duration::from_secs(1),
            |action, _| {
                calls.push(action.map(|(a, id)| (a, id.to_owned())));
                Ok(replies[calls.len() - 1].to_string())
            },
        );
        assert_eq!(value["bundle_path"], "/captures/exact.apparent");
        assert_eq!(
            calls,
            vec![
                Some((Action::Stop, "owned".into())),
                Some((Action::Inspect, "owned".into())),
                Some((Action::Inspect, "owned".into()))
            ]
        );
    }

    #[test]
    fn start_wait_requires_real_readiness_receipt_for_the_owned_id() {
        let mut calls = 0;
        let value = execute_with(
            Some((Action::Start, "owned")),
            true,
            Duration::from_secs(1),
            |action, _| {
                calls += 1;
                assert_eq!(
                    action.unwrap().0,
                    if calls == 1 {
                        Action::Start
                    } else {
                        Action::Inspect
                    }
                );
                Ok(serde_json::json!({"capture_id":"owned", "status":if calls == 1 {"starting"} else {"recording"}}).to_string())
            },
        );
        assert_eq!(value["status"], "recording");
        assert_eq!(calls, 2);
    }

    #[test]
    fn wait_returns_failures_and_rejects_unknown_or_incomplete_receipts() {
        for (reply, expected) in [
            (
                serde_json::json!({"capture_id":"owned", "status":"failed", "error":"start_failed"}),
                "start_failed",
            ),
            (
                serde_json::json!({"capture_id":"owned", "status":"failed", "error":"finalization_failed"}),
                "finalization_failed",
            ),
            (
                serde_json::json!({"capture_id":"owned", "status":"cancelled"}),
                "cancelled",
            ),
            (
                serde_json::json!({"capture_id":"owned", "status":"unknown", "outcome":"already_ended"}),
                "unknown_capture",
            ),
            (
                serde_json::json!({"capture_id":"foreign", "status":"saved", "bundle_path":"/foreign"}),
                "invalid_response",
            ),
            (serde_json::json!({}), "invalid_response"),
            (
                serde_json::json!({"capture_id":"owned", "status":"saved"}),
                "invalid_response",
            ),
        ] {
            let value = execute_with(
                Some((Action::Stop, "owned")),
                true,
                Duration::from_millis(10),
                |_, _| Ok(reply.to_string()),
            );
            assert_eq!(value["error"], expected, "{reply}");
        }
    }

    #[test]
    fn wait_timeout_preserves_owned_id_and_retry_reads_terminal_result() {
        let mut stops = 0;
        let value = execute_with(
            Some((Action::Stop, "owned")),
            true,
            Duration::from_millis(5),
            |action, _| {
                stops += usize::from(action.unwrap().0 == Action::Stop);
                Ok(serde_json::json!({"capture_id":"owned", "status":"processing", "outcome":"stopping"}).to_string())
            },
        );
        assert_eq!(value["error"], "timeout");
        assert_eq!(value["capture_id"], "owned");
        assert_eq!(stops, 1);
        let saved = execute_with(
            Some((Action::Stop, "owned")),
            true,
            Duration::from_secs(1),
            |_, _| {
                Ok(serde_json::json!({"capture_id":"owned", "status":"saved", "outcome":"already_ended", "bundle_path":"/exact"}).to_string())
            },
        );
        assert_eq!(saved["bundle_path"], "/exact");
        assert!(saved["error"].is_null());
    }

    #[test]
    fn expired_wire_start_keeps_its_deadline_and_never_admits() {
        let id = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        let (action, deadline_ms) = parse_request(&format!("start {id} 0")).unwrap();
        let (reply, _) = std::sync::mpsc::sync_channel(1);
        let request = Request {
            action,
            reply,
            deadline_ms,
        };
        assert!(request.expired());
        let mut registry = Registry::default();
        assert!(!registry.admit(id, false, request.expired()));
        assert!(!registry.admit(id, false, false));
        for invalid in [
            format!("start {id}"),
            format!("start {id} bad"),
            format!("stop {id} 0 extra"),
            "start bad 1".into(),
        ] {
            assert!(parse_request(&invalid).is_none());
        }
    }

    #[test]
    fn late_reply_cannot_turn_an_expired_wait_into_success() {
        let value = execute_with(
            Some((Action::Start, "owned")),
            true,
            Duration::from_millis(1),
            |_, _| {
                std::thread::sleep(Duration::from_millis(5));
                Ok(serde_json::json!({"capture_id":"owned", "status":"recording"}).to_string())
            },
        );
        assert_eq!(value["error"], "timeout");
        assert_eq!(value["capture_id"], "owned");
    }

    #[test]
    fn running_owner_does_not_require_an_answering_ui() {
        #[cfg(target_os = "macos")]
        let parent = PathBuf::from("/tmp");
        #[cfg(not(target_os = "macos"))]
        let parent = std::env::temp_dir();
        let dir = parent.join(format!("apparent-owner-{}", new_id().unwrap()));
        std::fs::create_dir(&dir).unwrap();
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700)).unwrap();
        let path = dir.join("capture.sock");
        let lock = path.with_extension("lock");
        assert!(!running_owner_at(path.clone()).unwrap());
        assert!(!lock.exists(), "a query must not create an owner lock");

        let stale = UnixListener::bind(&path).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
        drop(stale);
        let owner = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .mode(0o600)
            .open(&lock)
            .unwrap();
        assert_eq!(unsafe { libc::flock(owner.as_raw_fd(), libc::LOCK_EX) }, 0);
        assert!(
            running_owner_at(path.clone()).unwrap(),
            "a held owner lock must prevent another GUI even when connect is refused"
        );
        std::fs::remove_file(&path).unwrap();
        assert!(running_owner_at(path.clone()).unwrap());
        let listener = UnixListener::bind(&path).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
        listener.set_nonblocking(true).unwrap();
        assert!(running_owner_at(path.clone()).unwrap());
        assert_eq!(
            listener.accept().unwrap_err().kind(),
            std::io::ErrorKind::WouldBlock,
            "an owner query must not connect, regardless of the listener backlog"
        );
        drop(listener);
        let inode = std::fs::symlink_metadata(&path).unwrap().ino();
        drop(owner);
        assert!(!running_owner_at(path.clone()).unwrap());
        assert_eq!(std::fs::symlink_metadata(&path).unwrap().ino(), inode);
        std::fs::remove_file(path).unwrap();
        std::fs::remove_file(lock).unwrap();
        std::fs::remove_dir(dir).unwrap();
    }

    #[test]
    fn running_owner_rejects_unsafe_locks_without_changing_them() {
        #[cfg(target_os = "macos")]
        let parent = PathBuf::from("/tmp");
        #[cfg(not(target_os = "macos"))]
        let parent = std::env::temp_dir();
        let dir = parent.join(format!("apparent-owner-{}", new_id().unwrap()));
        std::fs::create_dir(&dir).unwrap();
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700)).unwrap();
        let path = dir.join("capture.sock");
        let lock = path.with_extension("lock");

        std::fs::write(&lock, b"do not change").unwrap();
        for mode in [0o644, 0o000] {
            std::fs::set_permissions(&lock, std::fs::Permissions::from_mode(mode)).unwrap();
            assert!(running_owner_at(path.clone()).is_err());
            assert_eq!(
                std::fs::symlink_metadata(&lock).unwrap().mode() & 0o777,
                mode
            );
        }
        std::fs::set_permissions(&lock, std::fs::Permissions::from_mode(0o600)).unwrap();
        assert_eq!(std::fs::read(&lock).unwrap(), b"do not change");
        let target = dir.join("target");
        std::fs::rename(&lock, &target).unwrap();
        std::os::unix::fs::symlink(&target, &lock).unwrap();
        assert!(running_owner_at(path.clone()).is_err());
        assert!(
            std::fs::symlink_metadata(&lock)
                .unwrap()
                .file_type()
                .is_symlink()
        );
        std::fs::remove_file(&lock).unwrap();
        std::fs::create_dir(&lock).unwrap();
        assert!(running_owner_at(path).is_err());
        std::fs::remove_dir(lock).unwrap();
        std::fs::remove_file(target).unwrap();
        std::fs::remove_dir(dir).unwrap();
    }

    #[test]
    fn competing_launches_cannot_remove_the_winning_control_socket() {
        // Reuse the short private fixture suffix, including with CI's HOME-rooted TMPDIR.
        // Do not relocate the fixture or change the product's control socket path.
        let (path, stale) = transport_fixture();
        let dir = path.parent().unwrap().to_path_buf();
        drop(stale);

        // A launcher holding the lock may be between its stale-socket check and bind.
        // Another launcher must not unlink the socket even though connect is refused.
        let owner = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .mode(0o600)
            .open(path.with_extension("lock"))
            .unwrap();
        assert_eq!(unsafe { libc::flock(owner.as_raw_fd(), libc::LOCK_EX) }, 0);
        let inode = std::fs::symlink_metadata(&path).unwrap().ino();
        assert!(listen_at(path.clone()).is_err());
        assert_eq!(std::fs::symlink_metadata(&path).unwrap().ino(), inode);
        drop(owner);

        let barrier = std::sync::Arc::new(std::sync::Barrier::new(3));
        let contenders: Vec<_> = (0..2)
            .map(|_| {
                let path = path.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    listen_at(path)
                })
            })
            .collect();
        barrier.wait();
        let mut results: Vec<_> = contenders
            .into_iter()
            .map(|thread| thread.join().unwrap())
            .collect();
        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        let receiver = results
            .remove(results.iter().position(Result::is_ok).unwrap())
            .unwrap();
        let mut stream = UnixStream::connect(&path).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        writeln!(stream, "state").unwrap();
        receiver
            .recv_timeout(Duration::from_secs(2))
            .unwrap()
            .reply
            .send("{\"state\":\"reachable\"}".into())
            .unwrap();
        let mut response = String::new();
        BufReader::new(stream).read_line(&mut response).unwrap();
        assert!(response.contains("reachable"));
        drop(receiver);
        for _ in 0..50 {
            if !path.exists() {
                break;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        assert!(!path.exists());
        std::fs::remove_file(path.with_extension("lock")).unwrap();
        std::fs::remove_dir(dir).unwrap();
    }

    #[test]
    fn only_the_matching_capture_can_be_stopped_or_cancelled() {
        for phase in [Phase::Starting, Phase::Recording] {
            let state = State {
                phase: phase.clone(),
                capture_id: Some("capture-a".into()),
            };
            assert_eq!(
                decide(&state, Action::Cancel, "capture-b"),
                Outcome::WrongCapture
            );
            assert_eq!(
                decide(&state, Action::Stop, "capture-b"),
                Outcome::WrongCapture
            );
            assert_eq!(
                decide(&state, Action::Cancel, "capture-a"),
                Outcome::Cancelled
            );
            assert_eq!(
                decide(&state, Action::Stop, "capture-a"),
                if phase == Phase::Recording {
                    Outcome::Stopping
                } else {
                    Outcome::NotReady
                }
            );
        }
        for phase in [
            Phase::Idle,
            Phase::Selecting,
            Phase::Processing,
            Phase::Completed,
        ] {
            let state = State {
                phase,
                capture_id: None,
            };
            assert_eq!(
                decide(&state, Action::Stop, "capture-a"),
                Outcome::AlreadyEnded
            );
            assert_eq!(
                decide(&state, Action::Cancel, "capture-a"),
                Outcome::AlreadyEnded
            );
        }
    }

    #[test]
    fn ids_are_opaque_fresh_and_command_ids_are_strict() {
        let first = new_id().unwrap();
        let second = new_id().unwrap();
        assert!(valid_id(&first));
        assert!(valid_id(&second));
        assert_ne!(first, second);
        for invalid in [
            "",
            "capture-a",
            "0\nstop 00000000000000000000000000000000",
            "g0000000000000000000000000000000",
        ] {
            assert!(!valid_id(invalid));
            assert!(command(Some((Action::Cancel, invalid))).is_err());
        }
    }

    #[test]
    fn response_phase_and_outcome_are_machine_readable() {
        let response = serde_json::json!({
            "state": State { phase: Phase::Starting, capture_id: Some("id".into()) },
            "outcome": Outcome::NotReady,
        });
        assert_eq!(response["state"]["phase"], "starting");
        assert_eq!(response["outcome"], "not_ready");
    }
}
