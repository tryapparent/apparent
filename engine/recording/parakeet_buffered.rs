use super::pause_transcribe::Pause;
use anyhow::{Context, Result, anyhow, ensure};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, AtomicUsize, Ordering},
    mpsc,
};
use std::thread::JoinHandle;
use std::time::Duration;
use transcribe_cpp::{
    CancelToken, Model, ParakeetBufferedStreamOptions, RunOptions, StreamExtension, StreamOptions,
    TimestampKind,
};

use crate::capture::engine::runtime::audio::persistence::Samples;
use crate::shared::model::{TranscriptData, TranscriptSegment, WordTiming};

const PAUSE_START_SAMPLES: usize = 384_000;
const START_SAMPLES: usize = 640_000;
const MAX_STOP_BACKLOG_SAMPLES: usize = 48_000;
const PREVIEW_MIN_SAMPLES: usize = 3 * START_SAMPLES;

pub struct Buffered {
    stop: Arc<AtomicBool>,
    cancel: CancelToken,
    fed_samples: Arc<AtomicUsize>,
    preview: mpsc::Sender<mpsc::Sender<TranscriptData>>,
    tail: Option<mpsc::Sender<(Vec<u8>, usize)>>,
    worker: Option<JoinHandle<Result<TranscriptData>>>,
}

impl Buffered {
    pub fn start(samples: Arc<Mutex<Samples>>) -> Result<Self> {
        let stop = Arc::new(AtomicBool::new(false));
        let worker_stop = Arc::clone(&stop);
        let cancel = CancelToken::new();
        let worker_cancel = cancel.clone();
        let (tail, receive) = mpsc::channel();
        let (preview, preview_receive) = mpsc::channel();
        let fed_samples = Arc::new(AtomicUsize::new(0));
        let worker_fed = Arc::clone(&fed_samples);
        let worker = std::thread::Builder::new()
            .name("apparent-buffered-parakeet".into())
            .spawn(move || run(samples, &worker_stop, &worker_cancel, &worker_fed, receive, preview_receive))?;
        Ok(Self {
            stop,
            cancel,
            fed_samples,
            preview,
            tail: Some(tail),
            worker: Some(worker),
        })
    }

    fn request_preview(&self, sample_count: usize) -> Option<mpsc::Receiver<TranscriptData>> {
        let fed = self.fed_samples.load(Ordering::Acquire);
        if sample_count < PREVIEW_MIN_SAMPLES
            || sample_count.saturating_sub(fed) > MAX_STOP_BACKLOG_SAMPLES
        {
            return None;
        }
        let (send, receive) = mpsc::channel();
        self.preview.send(send).ok()?;
        Some(receive)
    }

    pub fn finish(mut self, wav: &[u8], sample_count: usize) -> Result<TranscriptData> {
        let tail = self.tail.take().context("Stream already finalized")?;
        let fed = self.fed_samples.load(Ordering::Acquire);
        let use_batch = sample_count >= START_SAMPLES
            && sample_count.saturating_sub(fed) > MAX_STOP_BACKLOG_SAMPLES;
        if use_batch {
            self.cancel.cancel();
            drop(tail);
        } else {
            let _ = tail.send((wav.to_vec(), sample_count));
        }
        self.stop.store(true, Ordering::Release);
        let worker = self.worker.take().context("Stream worker missing")?;
        worker.thread().unpark();
        let result = worker.join().map_err(|_| anyhow!("Stream worker stopped"))?;
        ensure!(!use_batch, "Buffered speech fell behind; using batch after Stop");
        result
    }
}

impl Drop for Buffered {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        self.tail.take();
        self.cancel.cancel();
        if let Some(worker) = &self.worker {
            worker.thread().unpark();
        }
    }
}

fn run(
    samples: Arc<Mutex<Samples>>,
    stop: &AtomicBool,
    cancel: &CancelToken,
    fed_samples: &AtomicUsize,
    tail: mpsc::Receiver<(Vec<u8>, usize)>,
    preview: mpsc::Receiver<mpsc::Sender<TranscriptData>>,
) -> Result<TranscriptData> {
    ensure!(
        wait_for_samples(&samples, stop, PAUSE_START_SAMPLES)? && !cancel.is_cancelled(),
        "Capture ended before buffered speech started"
    );
    let pause = Pause::start_capture_owned(Arc::clone(&samples))?;
    if !wait_for_samples(&samples, stop, START_SAMPLES)? {
        if let Ok((wav, sample_count)) = tail.recv() {
            return checked_pause_result(pause.finish(&wav)?, sample_count);
        }
        pause.discard()?;
        return Err(anyhow!("Stream cancelled before finalization"));
    }
    pause.discard()?;
    ensure!(
        !stop.load(Ordering::Acquire) && !cancel.is_cancelled(),
        "Capture ended before buffered speech started"
    );
    let path = super::speech::installed_models()
        .into_iter()
        .next()
        .filter(|path| {
            path.file_name().is_some_and(|name| {
                name == super::speech::preferred_parakeet().filename
                    || name == super::speech::PARAKEET.filename
            })
        })
        .context("No ready buffered Parakeet model");
    let path = path?;
    super::speech::init_backends()?;
    let name = path
        .file_stem()
        .context("Model name unavailable")?
        .to_string_lossy()
        .into_owned();
    let model = Model::load(&path)?;
    let n_threads = i32::from(
        model
            .device()
            .is_ok_and(|device| device.device_type == transcribe_cpp::DeviceType::Cpu),
    );
    let mut session = model.session_with(&transcribe_cpp::SessionOptions {
        n_threads,
        ..Default::default()
    })?;
    session.set_cancel_token(cancel);
    let mut stream = session.stream(
        &RunOptions {
            timestamps: TimestampKind::Word,
            language: Some("en".into()),
            ..Default::default()
        },
        &StreamOptions {
            family: Some(StreamExtension::ParakeetBuffered(
                ParakeetBufferedStreamOptions {
                    left_ms: Some(5600),
                    chunk_ms: Some(1040),
                    right_ms: Some(1040),
                },
            )),
            ..Default::default()
        },
    )?;
    let mut consumed = 0;
    let mut chunk = Vec::with_capacity(3200);
    while !stop.load(Ordering::Acquire) {
        chunk.clear();
        {
            let history = samples
                .lock()
                .map_err(|_| anyhow!("Audio history unavailable"))?;
            if history.len() > consumed {
                chunk.extend_from_slice(
                    history
                        .get(consumed..history.len().min(consumed + 3200))
                        .context("Streaming fell behind capture")?,
                );
            }
        }
        if !chunk.is_empty() {
            for sample in &mut chunk {
                *sample = pcm16(*sample);
            }
            stream.feed(&chunk)?;
            consumed += chunk.len();
            fed_samples.store(consumed, Ordering::Release);
        } else {
            std::thread::park_timeout(Duration::from_millis(80));
        }
    }
    let (wav, _) = tail
        .recv()
        .context("Stream cancelled before finalization")?;
    let finish_started = std::time::Instant::now();
    if let Ok(send) = preview.try_recv()
        && let Ok(snapshot) = materialize(stream.snapshot(), name.clone(), consumed)
    {
        let _ = send.send(snapshot);
    }
    let audio = crate::capture::engine::runtime::audio::audio::decode_wav_16k(&wav)?;
    ensure!(consumed <= audio.len(), "Stream exceeds saved audio");
    for chunk in audio[consumed..].chunks(16_000) {
        stream.feed(chunk)?;
    }
    stream.finalize()?;
    ensure!(!stream.was_aborted(), "Stream cancelled");
    let result = stream.snapshot();
    drop(stream);
    ensure!(!session.was_truncated(), "Incomplete stream");
    let transcript = materialize(result, name, audio.len())?;
    crate::capture::desktop::start_metric("local_stream_finish_success_ms", finish_started);
    Ok(transcript)
}

fn checked_pause_result(transcript: TranscriptData, sample_count: usize) -> Result<TranscriptData> {
    if let [.., previous, last] = transcript.words.as_slice() {
        let recorded_ms = sample_count as u64 / 16;
        ensure!(
            last.t0 != previous.t0 || last.t1 != previous.t1 || last.t1 <= recorded_ms,
            "Native pause transcription shares a final clock beyond the saved audio"
        );
    }
    Ok(transcript)
}

fn wait_for_samples(samples: &Mutex<Samples>, stop: &AtomicBool, minimum: usize) -> Result<bool> {
    while !stop.load(Ordering::Acquire) {
        let captured = samples.lock().map_err(|_| anyhow!("Audio history unavailable"))?.len();
        if captured >= minimum {
            return Ok(!stop.load(Ordering::Acquire));
        }
        std::thread::park_timeout(Duration::from_millis(80));
    }
    Ok(false)
}

fn pcm16(sample: f32) -> f32 {
    crate::capture::engine::runtime::audio::audio::pcm16(sample) as f32 / 32768.0
}

fn materialize(
    result: transcribe_cpp::Transcript,
    name: String,
    count: usize,
) -> Result<TranscriptData> {
    let duration = count as u64 / 16;
    let text = result.text.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut value = TranscriptData {
        source: format!("parakeet:{name}"),
        model: Some(name),
        text: text.clone(),
        ..Default::default()
    };
    for word in result
        .words
        .iter()
        .filter(|word| !word.text.trim().is_empty())
    {
        ensure!(
            word.t0_ms >= 0
                && word.t0_ms as u64 <= duration
                && word.t1_ms >= word.t0_ms
                && word.t1_ms as u64 <= duration + 1000,
            "Invalid stream word timing"
        );
        value.words.push(WordTiming {
            t0: word.t0_ms as u64,
            t1: (word.t1_ms as u64).min(duration),
            text: word.text.trim().into(),
        });
    }
    if !text.is_empty() && value.words.is_empty() {
        value.words = timed_words(&text, &result.tokens, duration)?;
    }
    if !text.is_empty() {
        ensure!(!value.words.is_empty(), "Stream has no measured word times");
        value.segments.push(TranscriptSegment {
            t0: value.words[0].t0,
            t1: value.words.last().unwrap().t1,
            text,
        });
    }
    Ok(value)
}
fn timed_words(
    text: &str,
    tokens: &[transcribe_cpp::Token],
    duration: u64,
) -> Result<Vec<WordTiming>> {
    for token in tokens {
        ensure!(
            token.t0_ms >= 0
                && token.t0_ms as u64 <= duration
                && token.t1_ms >= token.t0_ms
                && token.t1_ms as u64 <= duration + 1000,
            "Invalid stream token timing"
        );
    }
    let mut characters = tokens.iter().flat_map(|token| {
        token
            .text
            .chars()
            .filter(|character| !character.is_whitespace())
            .map(move |character| (character, token))
    });
    let mut words = Vec::new();
    for word in text.split_whitespace() {
        let mut start = None;
        let mut end = 0;
        for character in word.chars() {
            let (decoded, token) = characters.next().context("Incomplete stream tokens")?;
            ensure!(decoded == character, "Stream text and tokens disagree");
            start.get_or_insert(token.t0_ms as u64);
            end = (token.t1_ms as u64).min(duration);
        }
        if let Some(t0) = start {
            words.push(WordTiming {
                t0,
                t1: end.max(t0),
                text: word.into(),
            });
        }
    }
    ensure!(characters.next().is_none(), "Unconsumed stream tokens");
    Ok(words)
}

#[derive(Clone, Default)]
pub struct Slot(Arc<Mutex<Option<Pending>>>);

impl Slot {
    pub fn new(pause: Option<Pause>) -> Self {
        Self(Arc::new(Mutex::new(pause.map(Pending::Pause))))
    }
    pub fn for_recording(pause: Option<Pause>, buffered: Option<Buffered>) -> Self {
        if let Some(buffered) = buffered {
            return Self(Arc::new(Mutex::new(Some(Pending::Buffered(buffered)))));
        }
        Self::new(pause)
    }
    pub fn take(&self) -> Option<Pending> {
        self.0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .take()
    }

    pub(crate) fn request_preview(&self, sample_count: usize) -> Option<mpsc::Receiver<TranscriptData>> {
        let slot = self.0.lock().ok()?;
        let Pending::Buffered(buffered) = slot.as_ref()? else { return None };
        buffered.request_preview(sample_count)
    }
}

pub enum Pending {
    Pause(Pause),
    Buffered(Buffered),
}

impl Pending {
    pub fn finish(self, wav: &[u8], sample_count: usize) -> Result<TranscriptData> {
        match self {
            Self::Pause(pause) => pause.finish(wav),
            Self::Buffered(buffered) => buffered.finish(wav, sample_count),
        }
    }
}

impl std::fmt::Debug for Slot {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_tuple("Slot")
            .field(&self.0.lock().map(|v| v.is_some()).unwrap_or(false))
            .finish()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pause_tail_with_a_shared_out_of_bounds_clock_uses_batch() {
        let terminal = TranscriptData {
            words: vec![
                WordTiming { t0: 160, t1: 240, text: "one".into() },
                WordTiming { t0: 160, t1: 240, text: "more".into() },
            ],
            ..Default::default()
        };
        assert!(checked_pause_result(terminal.clone(), 200 * 16).is_err());
        assert!(checked_pause_result(terminal, 240 * 16).is_ok());
    }

    #[test]
    fn short_capture_uses_its_saved_audio_fallback() {
        let buffered = Buffered::start(Arc::new(Mutex::new(Samples::default()))).unwrap();
        let error = buffered.finish(&[], 0).unwrap_err();
        assert!(error.to_string().contains("Capture ended"));
    }

    #[test]
    fn buffered_word_clocks_reject_unmatched_or_out_of_range_text() {
        let tokens = [("ple", 80, 80), ("ase", 160, 160), (" move", 240, 320)].map(
            |(text, t0_ms, t1_ms)| transcribe_cpp::Token {
                text: text.into(),
                t0_ms,
                t1_ms,
                ..Default::default()
            },
        );
        let words = timed_words("please move", &tokens, 1000).unwrap();
        assert_eq!(
            (words[0].t0, words[0].t1, words[1].t0, words[1].t1),
            (80, 160, 240, 320)
        );
        assert!(timed_words("please stay", &tokens, 1000).is_err());
        assert!(timed_words("please move", &tokens, 100).is_err());
    }
}
