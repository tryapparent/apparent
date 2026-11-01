//! Optional, manually configured Linux playback experiment. No volume snapshots.
//! Only a short, self-expiring DSP lease changes; audio clients expire it even
//! if this process/helper dies. A Guard means queued, not effective.
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::OnceLock;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Sender};

static WORKER: OnceLock<Option<Sender<Request>>> = OnceLock::new();
static NEXT_ID: AtomicU64 = AtomicU64::new(1);

enum Request {
    Warm,
    Start(u64, u8),
    Stop(u64),
}

pub fn helper_path() -> Option<PathBuf> {
    dirs::home_dir().map(|home| home.join(".local/lib/apparent/apparent-playback-helper"))
}

/// An asynchronous lease. Drop requests restoration; it never waits for audio.
/// Some means the request was queued, not that a server accepted the change.
pub struct Guard {
    id: u64,
    sender: Sender<Request>,
}

fn enabled_level() -> Option<u8> {
    let config = crate::shared::handoff::load_config_from(&crate::shared::handoff::default_config_path());
    (config.lower_playback == Some(true) && crate::shared::handoff::experiment("linux-playback-ducking"))
        .then(|| config.recording_volume())
}

fn sender() -> Option<&'static Sender<Request>> {
    WORKER
        .get_or_init(|| {
            let (sender, receiver) = mpsc::channel();
            std::thread::Builder::new()
                .name("playback-control".into())
                .spawn(move || worker(receiver))
                .map(|_| sender)
                .map_err(|error| log(format!("Starting playback worker: {error}")))
                .ok()
        })
        .as_ref()
}

fn log(message: String) {
    crate::capture::apparent_log(message);
}

/// Prepare the optional helper off the UI thread, only with both gates enabled.
pub fn warm_up() {
    if enabled_level().is_some()
        && let Some(sender) = sender()
    {
        let _ = sender.send(Request::Warm);
    }
}

impl Guard {
    pub fn start() -> Option<Self> {
        let level = enabled_level()?;
        if level == 100 {
            return None;
        }
        let sender = sender()?.clone();
        let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
        sender.send(Request::Start(id, level)).ok()?;
        Some(Self { id, sender })
    }
}

impl Drop for Guard {
    fn drop(&mut self) {
        let _ = self.sender.send(Request::Stop(self.id));
    }
}

fn launch(level: u8) -> std::io::Result<Child> {
    let path = helper_path().ok_or_else(|| std::io::Error::other("home directory unavailable"))?;
    Command::new(path)
        .args(["--serve", &level.to_string()])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .spawn()
}

fn worker(receiver: mpsc::Receiver<Request>) {
    let mut active: Option<(u64, Child)> = None;
    for request in receiver {
        match request {
            Request::Warm => {
                if let Some(path) = helper_path() {
                    match Command::new(path).arg("--init").stdout(Stdio::null()).status() {
                        Ok(status) if status.success() => {},
                        result => log(format!("Optional playback setup unavailable: {result:?}")),
                    }
                }
            }
            Request::Start(id, level) => {
                if active.is_some() {
                    log("Playback experiment supports one capture at a time".into());
                    continue;
                }
                match launch(level) {
                    Ok(child) => active = Some((id, child)),
                    Err(error) => log(format!("Optional playback helper unavailable: {error}")),
                }
            }
            Request::Stop(id) => {
                if active.as_ref().is_some_and(|(owner, _)| *owner == id) {
                    let (_, mut child) = active.take().unwrap();
                    finish(&mut child);
                }
            }
        }
    }
    if let Some((_, mut child)) = active { finish(&mut child); }
}

fn finish(child: &mut Child) {
    child.stdin.take();
    for _ in 0..10 {
        match child.try_wait() {
            Ok(Some(_)) => return,
            Err(error) => { log(format!("Checking playback helper: {error}")); break; },
            Ok(None) => std::thread::sleep(std::time::Duration::from_millis(20)),
        }
    }
    // A stopped helper cannot renew: the audio clients independently expire it.
    let _ = child.kill();
    let _ = child.wait();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drop_only_queues_its_own_stop() {
        let (sender, receiver) = mpsc::channel();
        let guard = Guard { id: 42, sender };
        drop(guard);
        assert!(matches!(receiver.try_recv(), Ok(Request::Stop(42))));
    }
}
