use super::pause_transcribe::Pause;
use anyhow::{Context, Result, anyhow, ensure};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
    mpsc,
};
use std::thread::JoinHandle;
use std::time::Duration;
use transcribe_cpp::{
    CancelToken, Model, ParakeetStreamOptions, RunOptions, StreamExtension, StreamOptions,
    TimestampKind,
};

use super::speech::parakeet::saved_audio_tail;
use crate::capture::engine::runtime::audio::persistence::Samples;
use crate::shared::model::{TranscriptData, TranscriptSegment, WordTiming};

const START_SAMPLES: usize = 320_000;

pub(crate) fn start_background(
    samples: &Arc<Mutex<Samples>>,
    trial: bool,
    word_probe: bool,
) -> (Option<Pause>, Option<Buffered>) {
    super::warm_recognizer::clear_if_disabled();
    let local = !trial && super::pause_transcribe::wanted();
    let buffered = if local
        && !word_probe
        && super::speech::resident_final::selected_for_capture().is_some()
    {
        Buffered::start(Arc::clone(samples)).ok()
    } else {
        None
    };
    if trial || buffered.is_some() {
        super::warm_recognizer::clear();
    }
    let pause = if super::speech::resident_final::allows_capture_pause(local, word_probe) {
        Pause::start(Arc::clone(samples))
            .inspect_err(|error| crate::capture::engine::runtime::apparent_log(format!("Pause transcription: {error:#}")))
            .ok()
    } else {
        None
    };
    (pause, buffered)
}

pub struct Buffered {
    stop: Arc<AtomicBool>,
    cancel: CancelToken,
    tail: Option<mpsc::Sender<Vec<u8>>>,
    worker: Option<JoinHandle<Result<TranscriptData>>>,
}

impl Buffered {
    fn start(samples: Arc<Mutex<Samples>>) -> Result<Self> {
        let stop = Arc::new(AtomicBool::new(false));
        let worker_stop = Arc::clone(&stop);
        let cancel = CancelToken::new();
        let worker_cancel = cancel.clone();
        let (tail, receive) = mpsc::channel();
        let worker = std::thread::Builder::new()
            .name("apparent-buffered-parakeet".into())
            .spawn(move || run(samples, &worker_stop, &worker_cancel, receive))?;
        Ok(Self {
            stop,
            cancel,
            tail: Some(tail),
            worker: Some(worker),
        })
    }

    pub fn finish(mut self, wav: &[u8]) -> Result<TranscriptData> {
        let _ = self
            .tail
            .take()
            .context("Stream already finalized")?
            .send(wav.to_vec());
        self.stop.store(true, Ordering::Release);
        let worker = self.worker.take().context("Stream worker missing")?;
        worker.thread().unpark();
        worker
            .join()
            .map_err(|_| anyhow!("Stream worker stopped"))?
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
    tail: mpsc::Receiver<Vec<u8>>,
) -> Result<TranscriptData> {
    while !stop.load(Ordering::Acquire) {
        let captured = samples
            .lock()
            .map_err(|_| anyhow!("Audio history unavailable"))?
            .len();
        if captured >= START_SAMPLES {
            break;
        }
        std::thread::park_timeout(Duration::from_millis(80));
    }
    ensure!(
        !stop.load(Ordering::Acquire) && !cancel.is_cancelled(),
        "Capture ended before buffered speech started"
    );
    let path = super::speech::resident_final::selected_for_capture()
        .context("No ready resident speech model")?;
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
            family: Some(StreamExtension::ParakeetStream(ParakeetStreamOptions {
                att_context_right: Some(13),
            })),
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
        } else {
            std::thread::park_timeout(Duration::from_millis(80));
        }
    }
    let wav = tail
        .recv()
        .context("Stream cancelled before finalization")?;
    let finish_started = std::time::Instant::now();
    let (sample_count, audio) = saved_audio_tail(&wav, consumed)?;
    for chunk in audio.chunks(16_000) {
        stream.feed(chunk)?;
    }
    stream.finalize()?;
    ensure!(!stream.was_aborted(), "Stream cancelled");
    let mut result = stream.snapshot();
    clamp_trailing_punctuation(&mut result.tokens, i64::try_from(sample_count / 16)?);
    drop(stream);
    ensure!(!session.was_truncated(), "Incomplete stream");
    let transcript = materialize(result, name, sample_count)?;
    crate::capture::desktop::start_metric("local_cache_aware_finish_ms", finish_started);
    Ok(transcript)
}

fn clamp_trailing_punctuation(tokens: &mut [transcribe_cpp::Token], end: i64) {
    if let Some(token) = tokens.last_mut() {
        let text = token.text.trim();
        if token.t0_ms > end
            && token.t0_ms <= end + super::speech::resident_final::EOF_PUNCTUATION_START_ALLOWANCE_MS
            && token.t1_ms >= token.t0_ms
            && token.t1_ms <= end + 1000
            && !text.is_empty()
            && text.bytes().all(|byte| matches!(byte, b'.' | b',' | b'!' | b'?' | b';' | b':'))
        {
            token.t0_ms = end;
            token.t1_ms = end;
        }
    }
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
}

pub enum Pending {
    Pause(Pause),
    Buffered(Buffered),
}

impl Pending {
    pub fn finish(self, wav: &[u8]) -> Result<TranscriptData> {
        match self {
            Self::Pause(pause) => pause.finish(wav),
            Self::Buffered(buffered) => buffered.finish(wav),
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
    fn short_capture_uses_its_saved_audio_fallback() {
        let buffered = Buffered::start(Arc::new(Mutex::new(Samples::default()))).unwrap();
        let error = buffered.finish(&[]).unwrap_err();
        assert!(error.to_string().contains("Capture ended"));
    }

    #[test]
    fn only_bounds_trailing_punctuation_within_one_frame() {
        let last = |text: &str, t0_ms, t1_ms| transcribe_cpp::Token {
            text: text.into(),
            t0_ms,
            t1_ms,
            ..Default::default()
        };
        let mut tokens = [last("then", 800, 960), last(".", 1030, 1110)];
        clamp_trailing_punctuation(&mut tokens, 1000);
        let words = timed_words("then.", &tokens, 1000).unwrap();
        assert_eq!((words[0].t0, words[0].t1), (800, 1000));

        for mut tokens in [
            [last("then", 800, 960), last("later", 1030, 1110)],
            [last("then", 800, 960), last(".", 1081, 1110)],
            [last(".", 1030, 1110), last("then", 800, 960)],
        ] {
            clamp_trailing_punctuation(&mut tokens, 1000);
            assert!(timed_words("then.", &tokens, 1000).is_err());
        }
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
