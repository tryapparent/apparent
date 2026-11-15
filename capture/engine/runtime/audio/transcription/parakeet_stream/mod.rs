//! Native streaming execution. PCM capture/durability never waits for inference.
//! Each handle owns its preview, cancellation, stream and finalization receipt.
use std::{path::PathBuf, sync::{Arc, Mutex, OnceLock, atomic::{AtomicBool, Ordering}, mpsc}, thread::JoinHandle, time::Duration};
use anyhow::{Result, Context, ensure, anyhow};
use serde::Serialize;
use transcribe_cpp::{Model, RunOptions, StreamOptions, TimestampKind, CancelToken, StreamExtension, ParakeetBufferedStreamOptions};
use crate::{capture::engine::runtime::audio::persistence::Samples, shared::model::{TranscriptData, TranscriptSegment, WordTiming}};

type Admission = Box<dyn FnOnce() -> Result<bool> + Send>;
static MODEL: OnceLock<Mutex<Option<(PathBuf, Model)>>> = OnceLock::new();
static PREPARING: AtomicBool = AtomicBool::new(false);
fn installed() -> Option<PathBuf> {
    super::speech::installed_models().into_iter().find(|path| path.file_name().is_some_and(|name|
        name.to_string_lossy().starts_with("parakeet-unified-en-0.6b")))
}
// Preparation is independent of capture/finalization: a download must never
// extend stop-to-handoff latency. The current recording can use its saved WAV.
pub(crate) fn prepare() {
    if MODEL.get().and_then(|cache| cache.try_lock().ok().map(|model| model.is_some())).unwrap_or(false) { return; }
    if PREPARING.swap(true, Ordering::AcqRel) { return; }
    if std::thread::Builder::new().name("apparent-stream-model".into()).spawn(|| {
        let ready = installed().map(Ok).unwrap_or_else(|| super::speech::download(
            &super::speech::PARAKEET, &super::speech::own_models_dir(), &mut |_| {}));
        if ready.is_ok() { let _ = model(); }
        PREPARING.store(false, Ordering::Release);
    }).is_err() { PREPARING.store(false, Ordering::Release); }
}
pub(crate) fn release_cache() {
    if let Some(cache) = MODEL.get() && let Ok(mut loaded) = cache.try_lock() { *loaded = None; }
}
fn model() -> Result<(Model, String)> {
    super::speech::init_backends()?;
    let mut loaded = MODEL.get_or_init(|| Mutex::new(None)).try_lock().map_err(|_| anyhow!("Model preparing"))?;
    let path = installed().context("Model preparing; saved audio will be transcribed")?;
    if loaded.as_ref().is_none_or(|(old, _)| *old != path) { *loaded = Some((path.clone(), Model::load(&path)?)); }
    let name = path.file_stem().context("Model name unavailable")?.to_string_lossy().into_owned();
    Ok((loaded.as_ref().unwrap().1.clone(), name))
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Preview { pub state: &'static str, pub text: String }
impl Default for Preview { fn default() -> Self { Self {state: "starting", text: String::new()} } }

pub struct Live {
    stop: Arc<AtomicBool>,
    cancel: CancelToken,
    tail: Option<mpsc::Sender<Vec<u8>>>,
    worker: Option<JoinHandle<Result<TranscriptData>>>,
    preview: Arc<Mutex<Preview>>,
}
impl Live {
    pub fn start(samples: Arc<Mutex<Samples>>, admit: Admission) -> Result<Self> {
        let stop = Arc::new(AtomicBool::new(false));
        let worker_stop = stop.clone();
        let cancel = CancelToken::new();
        let worker_cancel = cancel.clone();
        let preview = Arc::new(Mutex::new(Preview::default()));
        let view = preview.clone();
        let (tail, receive) = mpsc::channel();
        let worker = std::thread::Builder::new().name("apparent-local-stream".into()).spawn(move || {
            let result = run(samples, &worker_stop, &worker_cancel, receive, &view, admit);
            if result.is_err() && let Ok(mut state) = view.lock() { state.state = "failed"; }
            result
        })?;
        Ok(Self {stop, cancel, tail: Some(tail), worker: Some(worker), preview})
    }
    pub fn preview(&self) -> Preview {
        self.preview.try_lock().map(|state| state.clone()).unwrap_or_default()
    }
    pub fn finish(mut self, wav: &[u8]) -> Result<TranscriptData> {
        // A failed worker may have already closed its input. Join it anyway so
        // finalization preserves the actual inference failure for recovery.
        let _ = self.tail.take().context("Stream already finalized")?.send(wav.to_vec());
        self.stop.store(true, Ordering::Release);
        let worker = self.worker.take().context("Stream worker missing")?;
        worker.thread().unpark();
        worker.join().map_err(|_| anyhow!("Stream worker stopped"))?
    }
}
impl Drop for Live {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release); self.tail.take();
        self.cancel.cancel();
        if let Some(worker) = &self.worker {worker.thread().unpark();}
        // Never wait for model loading/inference on capture teardown.
    }
}

fn run(samples: Arc<Mutex<Samples>>, stop: &AtomicBool, cancel: &CancelToken,
    tail: mpsc::Receiver<Vec<u8>>, preview: &Mutex<Preview>, admit: Admission) -> Result<TranscriptData> {
    ensure!(admit()?, "Streaming not admitted");
    ensure!(!cancel.is_cancelled(), "Stream cancelled");
    let (model, name) = match model() {
        Ok(ready) => ready,
        Err(error) => { prepare(); return Err(error); }
    };
    let n_threads = std::env::var("T3_BUILD_JOBS").ok().and_then(|value| value.parse::<i32>().ok())
        .filter(|value| *value > 0).unwrap_or(0);
    let mut session = model.session_with(&transcribe_cpp::SessionOptions {n_threads, ..Default::default()})?;
    session.set_cancel_token(cancel);
    let mut stream = session.stream(&RunOptions {timestamps: TimestampKind::Word, language: Some("en".into()), ..Default::default()},
        &StreamOptions {family: Some(StreamExtension::ParakeetBuffered(ParakeetBufferedStreamOptions {
            // Pinned Unified EN model's trained menu: L=70, C=7, R=4
            // encoder frames at 80ms. Unsupported context is rejected natively.
            left_ms: Some(5600), chunk_ms: Some(560), right_ms: Some(320),
        })), ..Default::default()})?;
    let mut consumed = 0;
    let mut chunk = Vec::with_capacity(3200);
    while !stop.load(Ordering::Acquire) {
        chunk.clear();
        {
            let history = samples.lock().map_err(|_| anyhow!("Audio history unavailable"))?;
            if history.len() > consumed {
                // Copy at most 200ms into preallocated storage; conversion and
                // inference never own the audio callback's history mutex.
                chunk.extend_from_slice(history.get(consumed..history.len().min(consumed + 3200))
                    .context("Streaming fell behind capture")?);
            }
        }
        if !chunk.is_empty() {
            for sample in &mut chunk { *sample = pcm16(*sample); }
            let update = stream.feed(&chunk)?; consumed += chunk.len();
            if update.result_changed {
                let text = stream.text().display();
                let mut state = preview.lock().map_err(|_| anyhow!("Preview unavailable"))?;
                state.state = "streaming"; state.text = tail_text(&text, 8192);
            }
        } else {std::thread::park_timeout(Duration::from_millis(80));}
    }
    let wav = tail.recv().context("Stream cancelled before finalization")?;
    let audio = crate::capture::engine::runtime::audio::audio::decode_wav_16k(&wav)?;
    ensure!(consumed <= audio.len(), "Stream exceeds saved audio");
    for chunk in audio[consumed..].chunks(16_000) {stream.feed(chunk)?;}
    stream.finalize()?;
    ensure!(!stream.was_aborted(), "Stream cancelled");
    let result = stream.snapshot();
    drop(stream);
    ensure!(!session.was_truncated(), "Incomplete stream");
    materialize(result, name, audio.len())
}
fn pcm16(sample: f32) -> f32 {crate::capture::engine::runtime::audio::audio::pcm16(sample) as f32 / 32768.0}
fn tail_text(text: &str, limit: usize) -> String {text.chars().rev().take(limit).collect::<String>().chars().rev().collect()}
fn materialize(result: transcribe_cpp::Transcript, name: String, count: usize) -> Result<TranscriptData> {
    let duration = count as u64 / 16;
    let text = result.text.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut value = TranscriptData {source: format!("parakeet:{name}"), model: Some(name), text: text.clone(), ..Default::default()};
    for word in result.words.iter().filter(|word| !word.text.trim().is_empty()) {
        ensure!(word.t0_ms >= 0 && word.t0_ms as u64 <= duration && word.t1_ms >= word.t0_ms && word.t1_ms as u64 <= duration + 1000, "Invalid stream word timing");
        value.words.push(WordTiming {t0: word.t0_ms as u64, t1: (word.t1_ms as u64).min(duration), text: word.text.trim().into()});
    }
    if !text.is_empty() && value.words.is_empty() {
        // transcribe.cpp's buffered stream exposes measured token times, but
        // does not build its word table. Align exact decoded characters to the
        // final word boundaries; never invent word times or silently accept a
        // prefix if token decoding and the complete text disagree.
        value.words = timed_words(&text, &result.tokens, duration)?;
    }
    if !text.is_empty() {
        ensure!(!value.words.is_empty(), "Stream has no measured word times");
        value.segments.push(TranscriptSegment {t0: value.words[0].t0, t1: value.words.last().unwrap().t1, text});
    }
    Ok(value)
}
fn timed_words(text: &str, tokens: &[transcribe_cpp::Token], duration: u64) -> Result<Vec<WordTiming>> {
    for token in tokens {
        ensure!(token.t0_ms >= 0 && token.t0_ms as u64 <= duration && token.t1_ms >= token.t0_ms && token.t1_ms as u64 <= duration + 1000, "Invalid stream token timing");
    }
    let mut characters = tokens.iter().flat_map(|token| token.text.chars()
        .filter(|character| !character.is_whitespace()).map(move |character| (character, token)));
    let mut words = Vec::new();
    for word in text.split_whitespace() {
        let mut start = None; let mut end = 0;
        for character in word.chars() {
            let (decoded, token) = characters.next().context("Incomplete stream tokens")?;
            ensure!(decoded == character, "Stream text and tokens disagree");
            start.get_or_insert(token.t0_ms as u64); end = (token.t1_ms as u64).min(duration);
        }
        if let Some(t0) = start { words.push(WordTiming {t0, t1: end.max(t0), text: word.into()}); }
    }
    ensure!(characters.next().is_none(), "Unconsumed stream tokens");
    Ok(words)
}

#[derive(Clone, Default)] pub struct Slot(Arc<Mutex<Option<Live>>>);
impl Slot {
    pub fn new(value: Option<Live>) -> Self {Self(Arc::new(Mutex::new(value)))}
    pub fn take(&self) -> Option<Live> {self.0.lock().unwrap_or_else(std::sync::PoisonError::into_inner).take()}
}
impl std::fmt::Debug for Slot {fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {f.debug_struct("LocalStreamingSlot").finish_non_exhaustive()}}

#[cfg(test)] mod tests {
    use super::*;
    #[test] fn preview_tail_preserves_unicode() {assert_eq!(tail_text("one 😀two", 4), "😀two");}
    #[test] fn measured_tokens_align_across_decoded_word_boundaries_and_reject_mismatch() {
        let tokens = [("ple",80,80),("ase",160,160),(" move",240,320)].map(|(text,t0_ms,t1_ms)|
            transcribe_cpp::Token {text:text.into(),t0_ms,t1_ms,..Default::default()});
        let words = timed_words("please move", &tokens, 1000).unwrap();
        assert_eq!((words[0].t0,words[0].t1,words[1].t0,words[1].t1),(80,160,240,320));
        assert!(timed_words("please stay", &tokens, 1000).is_err());
        assert!(timed_words("please", &tokens, 1000).is_err());
        assert!(timed_words("please move", &tokens, 100).is_err());
    }
    #[test] fn cancelled_admission_never_loads_a_model_or_reuses_preview() {
        let (send, receive) = mpsc::channel();
        let live = Live::start(Arc::new(Mutex::new(Samples::default())), Box::new(move || {
            receive.recv()?; Ok(true)
        })).unwrap();
        let preview = live.preview.clone();
        drop(live); send.send(()).unwrap();
        let deadline = std::time::Instant::now() + Duration::from_secs(2);
        while preview.lock().unwrap().state != "failed" && std::time::Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(preview.lock().unwrap().state, "failed");
        assert!(preview.lock().unwrap().text.is_empty());
        assert_eq!(Preview::default().state, "starting");
    }
    #[test]
    #[ignore = "Requires an installed verified Parakeet model and synthetic APPARENT_STREAM_WAV fixture"]
    fn real_stream_publishes_before_stop_and_flushes_saved_tail() -> Result<()> {
        let expected = std::env::var("APPARENT_STREAM_EXPECT_DEVICE").ok();
        stream_fixture(expected.as_deref())
    }
    #[cfg(target_os = "macos")]
    #[test]
    #[ignore = "Requires a Metal device with Apple7 support and the staged speech fixture"]
    fn real_metal_stream_publishes_before_stop_and_flushes_saved_tail() -> Result<()> {
        // CPU fallback can prove streaming, but must never count as Metal proof.
        stream_fixture(Some("metal"))
    }
    fn stream_fixture(expected_device: Option<&str>) -> Result<()> {
        static FIXTURE: Mutex<()> = Mutex::new(());
        let _fixture = FIXTURE.lock().unwrap();
        let directory = PathBuf::from(std::env::var("APPARENT_MODELS_DIR")?);
        ensure!(directory.join(super::super::speech::PARAKEET.filename).is_file(), "Stage a private model copy first");
        super::super::speech::download(&super::super::speech::PARAKEET, &directory, &mut |_| {})?;
        let wav = std::fs::read(std::env::var("APPARENT_STREAM_WAV")?)?;
        let audio = crate::capture::engine::runtime::audio::audio::decode_wav_16k(&wav)?;
        let (loaded, _) = model()?;
        let device = loaded.device()?;
        eprintln!("stream backend: {}, device: {} ({})", loaded.backend(), device.kind, device.name);
        if let Some(expected) = expected_device {
            ensure!(device.kind == expected, "Required {expected} execution was not admitted (selected {})", device.kind);
        }
        let samples = Arc::new(Mutex::new(Samples::default()));
        let live = Live::start(samples.clone(), Box::new(|| Ok(true)))?;
        let started = std::time::Instant::now();
        let mut first = None;
        // Deliberately retain the final quarter only in the durable WAV. Finish
        // must flush that unobserved tail rather than return the live prefix.
        for chunk in audio[..audio.len()*3/4].chunks(3200) {
            samples.lock().unwrap().extend_from_slice(chunk);
            std::thread::sleep(Duration::from_millis(200));
            let preview = live.preview();
            if preview.state == "failed" {
                return live.finish(&wav).context("Live inference failed before Stop").map(|_| ());
            }
            if !preview.text.is_empty() && first.is_none() { first = Some(started.elapsed()); }
        }
        ensure!(first.is_some(), "No text before Stop");
        let stopped = std::time::Instant::now();
        let transcript = live.finish(&wav)?;
        ensure!(transcript.text.to_lowercase().contains("purple"), "Missing early speech");
        ensure!(transcript.text.to_lowercase().contains("cursor"), "Missing saved tail");
        ensure!(!transcript.words.is_empty() && !transcript.estimated, "Missing real word times");
        ensure!(transcript.words.iter().all(|word| word.t0 <= word.t1 && word.t1 <= audio.len() as u64 / 16), "Invalid word times");
        eprintln!("stream evidence: first text {:?}, finish {:?}, audio {}ms, words {}", first.unwrap(), stopped.elapsed(), audio.len()/16, transcript.words.len());
        Ok(())
    }
}
