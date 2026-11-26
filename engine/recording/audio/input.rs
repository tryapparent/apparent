use super::Samples;
use super::{InputHealth, SAMPLE_RATE};
use anyhow::Result;
use cpal::traits::DeviceTrait;
use std::sync::{Arc, Mutex};
use std::time::Instant;
#[cfg(target_os = "linux")]
use {
    super::{AudioRecorder, InputStream, PreparedAudio},
    anyhow::anyhow,
    std::time::Duration,
};

#[cfg(target_os = "linux")]
impl AudioRecorder {
    pub(crate) fn start_on_clock(
        prepared: PreparedAudio,
        admit: Option<Box<dyn FnOnce() -> Result<bool> + Send>>,
        clock: Instant,
    ) -> Result<Self> {
        let started = Instant::now();
        prepared
            .samples
            .lock()
            .map_err(|_| anyhow!("Microphone buffer lock poisoned"))?
            .use_clock(clock);
        Self::start_prepared(prepared, admit, started)
    }

    pub(super) fn open_pulse(
        source: &str,
        samples: Arc<Mutex<Samples>>,
        health: Arc<Mutex<InputHealth>>,
    ) -> Result<InputStream> {
        let stream =
            crate::capture::desktop::linux::microphone::Stream::start(source, move |data| {
                if !data.is_empty()
                    && let Ok(mut output) = samples.lock()
                {
                    output.align_first_input(|| {
                        let now = Instant::now();
                        now.checked_sub(Duration::from_secs_f64(
                            data.len() as f64 / f64::from(SAMPLE_RATE),
                        ))
                        .unwrap_or(now)
                    });
                    output.extend_from_slice(data);
                    drop(output);
                    let peak = data.iter().map(|value| value.abs()).fold(0.0_f32, f32::max);
                    if let Ok(mut health) = health.lock() {
                        health.sample(Instant::now(), peak);
                    }
                }
            })?;
        Ok(InputStream::Pulse(stream))
    }
}

pub(super) fn input_stream<T>(
    device: &cpal::Device,
    config: cpal::StreamConfig,
    samples: Arc<Mutex<Samples>>,
    error: Arc<Mutex<Option<String>>>,
    health: Arc<Mutex<InputHealth>>,
) -> Result<cpal::Stream>
where
    T: cpal::SizedSample,
    f32: cpal::FromSample<T>,
{
    let channels = usize::from(config.channels);
    let rate = config.sample_rate;
    let mut phase = 0_u32;
    let mut sum = 0.0_f64;
    let callback_health = Arc::clone(&health);
    Ok(device.build_input_stream::<T, _, _>(
        config,
        move |data, _info| {
            let Ok(mut output) = samples.lock() else {
                return;
            };
            #[cfg(target_os = "linux")]
            if data.len() / channels * SAMPLE_RATE as usize + phase as usize >= rate as usize {
                output.align_first_input(|| {
                    let timestamp = _info.timestamp();
                    let now = Instant::now();
                    now.checked_sub(timestamp.callback.duration_since(timestamp.capture))
                        .unwrap_or(now)
                });
            }
            let before = output.len();
            let mut peak = 0.0_f32;
            for frame in data.chunks_exact(channels) {
                let mono = frame
                    .iter()
                    .map(|sample| sample.to_sample::<f32>() as f64)
                    .sum::<f64>()
                    / channels as f64;
                let mono = if mono.is_finite() { mono } else { 0.0 };
                let mut remaining = SAMPLE_RATE;
                while remaining > 0 {
                    let weight = remaining.min(rate - phase);
                    sum += mono * weight as f64;
                    phase += weight;
                    remaining -= weight;
                    if phase == rate {
                        let value = (sum / rate as f64) as f32;
                        peak = peak.max(value.abs());
                        output.push(value);
                        phase = 0;
                        sum = 0.0;
                    }
                }
            }
            if output.len() > before {
                if let Ok(mut health) = callback_health.lock() {
                    health.sample(Instant::now(), peak);
                }
            }
        },
        move |err| {
            if err.kind() == cpal::ErrorKind::Xrun {
                return;
            }
            if let Ok(mut error) = error.lock() {
                *error = Some(err.to_string());
            }
            if let Ok(mut health) = health.lock() {
                health.stream_failed();
            }
        },
        None,
    )?)
}
