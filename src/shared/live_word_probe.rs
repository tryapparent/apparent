//! A best-effort live recognizer over bounded, completed chunks of the captured audio.
//! It never supplies the final transcript and cannot delay Stop or discard audio.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::shared::live_word_warning::{LiveWordWarning, State};

const RATE: usize = 16_000;
const CHUNK: usize = 6 * RATE;

pub struct Probe {
    state: Arc<Mutex<LiveWordWarning>>,
    stop: Arc<AtomicBool>,
}

impl Probe {
    pub fn start(samples: Arc<Mutex<Vec<f32>>>) -> Self {
        let state = Arc::new(Mutex::new(LiveWordWarning::new()));
        let stop = Arc::new(AtomicBool::new(false));
        let worker_state = Arc::clone(&state);
        let worker_stop = Arc::clone(&stop);
        if let Err(error) = std::thread::Builder::new()
            .name("apparent-live-words".into())
            .spawn(move || run(samples, worker_state, worker_stop))
        {
            crate::capture::apparent_log(format!("Live word check could not start: {error}"));
            if let Ok(mut state) = state.lock() { state.unavailable(); }
        }
        Self { state, stop }
    }

    pub fn state(&self) -> State {
        self.state.lock().map(|state| state.state()).unwrap_or(State::Unavailable)
    }
}

impl Drop for Probe {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
    }
}

fn run(samples: Arc<Mutex<Vec<f32>>>, state: Arc<Mutex<LiveWordWarning>>, stop: Arc<AtomicBool>) {
    #[cfg(not(target_os = "macos"))]
    let mut recognizer: Option<crate::shared::speech::Incremental> = None;
    let mut processed = 0;
    while !stop.load(Ordering::Acquire) {
        let chunk = {
            let Ok(samples) = samples.lock() else { return };
            if samples.len().saturating_sub(processed) > 3 * CHUNK {
                // A slow recognizer cannot make a timely claim about the current recording.
                if let Ok(mut state) = state.lock() { state.unavailable(); }
                return;
            }
            samples.get(processed..processed + CHUNK).map(|slice| slice.to_vec())
        };
        let Some(chunk) = chunk else {
            std::thread::sleep(Duration::from_millis(160));
            continue;
        };
        processed += CHUNK;
        // Energy only qualifies a span for attempting recognition. It is not a speech detector.
        let active = chunk.iter().any(|sample| sample.is_finite() && sample.abs() >= 0.01);
        if !active { continue; }
        #[cfg(target_os = "macos")]
        let result = mac_words(&chunk);
        #[cfg(not(target_os = "macos"))]
        let result = (|| -> anyhow::Result<bool> {
            if recognizer.is_none() {
                recognizer = Some(crate::shared::speech::Incremental::new()?);
            }
            let offset_ms = ((processed - CHUNK) / (RATE / 1_000)) as u64;
            Ok(!recognizer.as_mut().unwrap().transcribe(&chunk, offset_ms)?.text.trim().is_empty())
        })();
        if stop.load(Ordering::Acquire) { break; }
        if let Ok(mut state) = state.lock() {
            match result {
                Ok(words) => state.completed(6_000, active, words),
                Err(error) => {
                    crate::capture::apparent_log(format!("Live word check unavailable: {error:#}"));
                    state.unavailable();
                    return;
                }
            }
        }
    }
}

#[cfg(target_os = "macos")]
fn mac_words(chunk: &[f32]) -> anyhow::Result<bool> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let path = std::env::temp_dir().join(format!(
        "apparent-live-words-{}-{}.wav",
        std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    let mut file = std::fs::OpenOptions::new().write(true).create_new(true).mode(0o600).open(&path)?;
    struct Remove(std::path::PathBuf);
    impl Drop for Remove {
        fn drop(&mut self) { let _ = std::fs::remove_file(&self.0); }
    }
    let _remove = Remove(path.clone());
    file.write_all(&crate::capture::audio::encode_wav_16k(chunk)?)?;
    drop(file);
    let transcript = crate::desktop::helper::transcribe_with_timeout(&path, Duration::from_secs(15))?;
    if transcript.missing.is_some() { anyhow::bail!("Speech model unavailable"); }
    Ok(!transcript.text.trim().is_empty())
}
