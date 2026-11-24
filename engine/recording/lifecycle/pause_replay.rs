use super::{Arc, Duration, Mutex, Pause, Result, Samples, anyhow, audio};

pub fn simulate(wav: &[u8], speed: f64) -> Result<Pause> {
    let samples = audio::decode_wav_16k(wav)?;
    let buffer = Arc::new(Mutex::new(Samples::default()));
    let pause = Pause::start(Arc::clone(&buffer))?;
    let started = std::time::Instant::now();
    for (i, chunk) in samples.chunks(160).enumerate() {
        buffer
            .lock()
            .map_err(|_| anyhow!("Microphone buffer poisoned"))?
            .extend_from_slice(chunk);
        let due = Duration::from_secs_f64((i + 1) as f64 * 0.01 / speed.max(0.01));
        if let Some(wait) = due.checked_sub(started.elapsed()) {
            std::thread::sleep(wait);
        }
    }
    buffer
        .lock()
        .map_err(|_| anyhow!("Microphone buffer poisoned"))?
        .clear();
    Ok(pause)
}
