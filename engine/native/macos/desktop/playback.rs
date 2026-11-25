use std::io::Write;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use crate::shared::handoff::{default_config_path, load_config_from};

pub struct Guard;

static HELPER: Mutex<Option<Child>> = Mutex::new(None);

fn command(line: Option<&str>) -> anyhow::Result<()> {
    let mut helper = HELPER.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(child) = helper.as_mut()
        && child.try_wait()?.is_some()
    {
        helper.take();
    }
    if helper.is_none() {
        *helper = Some(
            Command::new(crate::capture::desktop::helper::path()?)
                .args(["playback-volume", "--server"])
                .stdin(Stdio::piped())
                .stdout(Stdio::null())
                .spawn()?,
        );
    }
    if let Some(line) = line {
        let stdin = helper
            .as_mut()
            .and_then(|child| child.stdin.as_mut())
            .ok_or_else(|| anyhow::anyhow!("Playback helper stdin missing"))?;
        writeln!(stdin, "{line}")?;
        stdin.flush()?;
    }
    Ok(())
}

pub fn warm_up() {
    if load_config_from(&default_config_path()).lower_playback == Some(true)
        && let Err(error) = command(None)
    {
        crate::capture::engine::runtime::apparent_log(format!("Playback helper: {error:#}"));
    }
}

impl Guard {
    pub fn start() -> Option<Self> {
        let config = load_config_from(&default_config_path());
        if config.lower_playback != Some(true) {
            return None;
        }
        match command(Some(&format!("start {}", config.recording_volume()))) {
            Ok(()) => Some(Self),
            Err(error) => {
                crate::capture::engine::runtime::apparent_log(format!("Playback volume: {error:#}"));
                None
            }
        }
    }
}

impl Drop for Guard {
    fn drop(&mut self) {
        if let Err(error) = command(Some("stop")) {
            crate::capture::engine::runtime::apparent_log(format!("Restoring playback volume: {error:#}"));
        }
    }
}
