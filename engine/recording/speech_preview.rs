use std::{
    path::PathBuf,
    sync::{
        Arc, Mutex, OnceLock,
        atomic::{AtomicBool, Ordering},
    },
    thread::{self, JoinHandle},
    time::Duration,
};

use anyhow::{Context, Result, anyhow, ensure};
use serde::Serialize;
use transcribe_cpp::{
    CancelToken, Model, ParakeetStreamOptions, RunOptions, SessionOptions, StreamExtension,
    StreamOptions,
};

use crate::capture::engine::runtime::audio::persistence::Samples;

use super::speech;

type Admission = Box<dyn FnOnce() -> Result<bool> + Send>;

const NEMOTRON: speech::Artifact = speech::Artifact {
    filename: "nemotron-speech-streaming-en-0.6b-Q8_0.gguf",
    url: "https://huggingface.co/handy-computer/nemotron-speech-streaming-en-0.6b-gguf/resolve/7d9b719206789e4068d87c6398262ab4dfd4e45d/nemotron-speech-streaming-en-0.6b-Q8_0.gguf",
    bytes: 729_650_176,
    sha256: "90d8c89714cd31efc88be62a40c6b2bea57e0cc2063af1ffe2c28f1a228ca110",
};

static MODEL: OnceLock<Mutex<Option<(PathBuf, Model)>>> = OnceLock::new();
static PREPARING: AtomicBool = AtomicBool::new(false);

fn preview_dir() -> PathBuf {
    speech::own_models_dir().join("preview")
}

fn installed() -> Option<PathBuf> {
    speech::verified_in(&preview_dir())
        .into_iter()
        .find(|path| path.file_name().is_some_and(|name| name == NEMOTRON.filename))
}

pub(crate) fn prepare() {
    if MODEL.get().and_then(|cache| cache.try_lock().ok()).is_some_and(|entry| entry.is_some())
        && speech::installed_parakeet().is_some()
    {
        return;
    }
    if PREPARING.swap(true, Ordering::AcqRel) {
        return;
    }
    if thread::Builder::new()
        .name("apparent-stream-model".into())
        .spawn(|| {
            if let Err(error) = prepare_models() {
                crate::capture::engine::runtime::apparent_log(format!("Live speech models unavailable: {error:#}"));
            }
            PREPARING.store(false, Ordering::Release);
        })
        .is_err()
    {
        PREPARING.store(false, Ordering::Release);
    }
}

fn prepare_models() -> Result<()> {
    if speech::installed_parakeet().is_none() {
        speech::download(speech::preferred_parakeet(), &speech::own_models_dir(), &mut |_| {})?;
    }
    if installed().is_none() {
        speech::download(&NEMOTRON, &preview_dir(), &mut |_| {})?;
    }
    model()?;
    Ok(())
}

pub(crate) fn release_cache() {
    if let Some(cache) = MODEL.get() && let Ok(mut loaded) = cache.try_lock() {
        *loaded = None;
    }
}

fn model() -> Result<Model> {
    speech::init_backends()?;
    let path = installed().context("Preview speech model preparing")?;
    let mut loaded = MODEL
        .get_or_init(|| Mutex::new(None))
        .try_lock()
        .map_err(|_| anyhow!("Preview speech model preparing"))?;
    if loaded.as_ref().is_none_or(|(old, _)| *old != path) {
        let model = Model::load(&path)?;
        *loaded = Some((path, model));
    }
    Ok(loaded.as_ref().unwrap().1.clone())
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Preview {
    pub state: &'static str,
    pub text: String,
}

impl Default for Preview {
    fn default() -> Self {
        Self { state: "starting", text: String::new() }
    }
}

pub struct Live {
    cancel: CancelToken,
    worker: JoinHandle<()>,
    preview: Arc<Mutex<Preview>>,
}

impl Live {
    pub fn start(samples: Arc<Mutex<Samples>>, admit: Admission) -> Result<Self> {
        let cancel = CancelToken::new();
        let worker_cancel = cancel.clone();
        let preview = Arc::new(Mutex::new(Preview::default()));
        let view = Arc::clone(&preview);
        let worker = thread::Builder::new()
            .name("apparent-local-stream".into())
            .spawn(move || {
                let result = run(samples, &worker_cancel, &view, admit);
                if result.is_err() && let Ok(mut state) = view.lock() {
                    state.state = "failed";
                    state.text.clear();
                }
            })?;
        Ok(Self { cancel, worker, preview })
    }

    pub fn preview(&self) -> Preview {
        self.preview.try_lock().map(|state| state.clone()).unwrap_or_default()
    }
}

impl Drop for Live {
    fn drop(&mut self) {
        self.cancel.cancel();
        self.worker.thread().unpark();
    }
}

fn run(
    samples: Arc<Mutex<Samples>>,
    cancel: &CancelToken,
    preview: &Mutex<Preview>,
    admit: Admission,
) -> Result<()> {
    ensure!(admit()?, "Streaming not admitted");
    ensure!(!cancel.is_cancelled(), "Stream cancelled");
    let model = match model() {
        Ok(ready) if speech::installed_parakeet().is_some() => ready,
        _ => {
            prepare();
            return Err(anyhow!("Local speech models preparing"));
        }
    };

    let mut session = model.session_with(&SessionOptions {
        n_threads: 1,
        ..Default::default()
    })?;
    session.set_cancel_token(cancel);
    let mut stream = session.stream(
        &RunOptions { language: Some("en".into()), ..Default::default() },
        &StreamOptions {
            family: Some(StreamExtension::ParakeetStream(ParakeetStreamOptions {
                att_context_right: Some(13),
            })),
            ..Default::default()
        },
    )?;
    let mut consumed = 0;
    let mut chunk = Vec::with_capacity(3200);
    while !cancel.is_cancelled() {
        chunk.clear();
        {
            let history = samples.lock().map_err(|_| anyhow!("Audio history unavailable"))?;
            if history.len() > consumed {
                chunk.extend_from_slice(
                    history.get(consumed..history.len().min(consumed + 3200))
                        .context("Streaming fell behind capture")?,
                );
            }
        }
        if chunk.is_empty() {
            thread::park_timeout(Duration::from_millis(80));
            continue;
        }
        for sample in &mut chunk {
            *sample = pcm16(*sample);
        }
        let update = stream.feed(&chunk)?;
        consumed += chunk.len();
        if update.result_changed {
            let text = stream.text().display();
            let mut state = preview.lock().map_err(|_| anyhow!("Preview unavailable"))?;
            state.state = "streaming";
            state.text = tail_text(&text, 8192);
        }
    }
    Ok(())
}

fn pcm16(sample: f32) -> f32 {
    crate::capture::engine::runtime::audio::audio::pcm16(sample) as f32 / 32768.0
}

fn tail_text(text: &str, limit: usize) -> String {
    text.chars().rev().take(limit).collect::<String>().chars().rev().collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{sync::mpsc, time::Instant};
    use crate::capture::engine::{bundle::bundle_processing, runtime::{ScreenRecording, audio::audio}};
    use crate::shared::model::{ApparentBundle, RgbaFrame, TargetInfo};

    #[test]
    fn preview_tail_preserves_unicode() {
        assert_eq!(tail_text("one 😀two", 4), "😀two");
    }

    #[test]
    fn cancelled_admission_cannot_publish_preview() {
        let (send, receive) = mpsc::channel();
        let live = Live::start(Arc::new(Mutex::new(Samples::default())), Box::new(move || {
            receive.recv()?;
            Ok(true)
        })).unwrap();
        let preview = Arc::clone(&live.preview);
        drop(live);
        send.send(()).unwrap();
        let deadline = Instant::now() + Duration::from_secs(2);
        while preview.lock().unwrap().state != "failed" && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(preview.lock().unwrap().state, "failed");
        assert!(preview.lock().unwrap().text.is_empty());
    }

    #[test]
    #[ignore = "Requires staged verified Nemotron and Parakeet models and a synthetic APPARENT_STREAM_WAV"]
    fn real_nemotron_preview_and_parakeet_saved_transcript() -> Result<()> {
        let expected = std::env::var("APPARENT_STREAM_EXPECT_DEVICE").ok();
        stream_fixture(expected.as_deref())
    }

    #[cfg(target_os = "macos")]
    #[test]
    #[ignore = "Requires Metal and staged verified Nemotron and Parakeet models and a synthetic APPARENT_STREAM_WAV"]
    fn real_metal_nemotron_preview_and_parakeet_saved_transcript() -> Result<()> {
        stream_fixture(Some("metal"))
    }

    fn stream_fixture(expected_device: Option<&str>) -> Result<()> {
        let directory = PathBuf::from(std::env::var("APPARENT_MODELS_DIR")?);
        ensure!(directory.join(speech::PARAKEET.filename).is_file(), "Stage a private Parakeet model first");
        let preview_directory = directory.join("preview");
        ensure!(preview_directory.join(NEMOTRON.filename).is_file(), "Stage a private Nemotron model first");
        speech::download(&speech::PARAKEET, &directory, &mut |_| {})?;
        speech::download(&NEMOTRON, &preview_directory, &mut |_| {})?;
        ensure!(speech::installed_parakeet().is_some(), "Parakeet model unavailable");
        ensure!(!speech::installed_models().iter().any(|path| path.starts_with(&preview_directory)),
            "The final recognition model selector saw the preview model");

        let wav = std::fs::read(std::env::var("APPARENT_STREAM_WAV")?)?;
        let pcm = audio::decode_wav_16k(&wav)?;
        let loaded = model()?;
        let device = loaded.device()?;
        eprintln!("stream backend: {}, device: {} ({})", loaded.backend(), device.kind, device.name);
        if let Some(expected) = expected_device {
            ensure!(device.kind == expected, "Required {expected} execution was not admitted (selected {})", device.kind);
        }
        let samples = Arc::new(Mutex::new(Samples::default()));
        let live = Live::start(Arc::clone(&samples), Box::new(|| Ok(true)))?;
        let started = Instant::now();
        let mut first = None;
        for chunk in pcm[..pcm.len()/2].chunks(3200) {
            samples.lock().unwrap().extend_from_slice(chunk);
            thread::sleep(Duration::from_millis(200));
            let preview = live.preview();
            ensure!(preview.state != "failed", "Live inference failed before Stop");
            if !preview.text.is_empty() && first.is_none() {
                first = Some(started.elapsed());
            }
        }
        let first = first.context("No text before Stop")?;
        ensure!(!live.preview().text.to_lowercase().contains("cursor"), "Preview unexpectedly contains the saved tail");
        drop(live);

        let directory = tempfile::Builder::new().suffix(".apparent").tempdir()?;
        let target: TargetInfo = serde_json::from_value(serde_json::json!({
            "mode":"device","displayId":0,"frame":{"x":0.0,"y":0.0,"width":32.0,"height":32.0,"scale":1.0}
        }))?;
        let mut audio = audio::recorded_audio_from_wav(wav.clone())?;
        audio.streaming = true;
        let duration_ms = audio.duration_ms;
        let recording = ScreenRecording {
            frames: (0..duration_ms).step_by(500)
                .map(|t| RgbaFrame::new(t, 32, 32, vec![128; 32 * 32 * 4]).into())
                .collect(),
            duration_ms,
            video: None,
            video_offset_ms: 0,
            video_ink: None,
        };
        let stopped = Instant::now();
        let (saved, _, summary) = bundle_processing::finalize_capture_bundle(
            directory.path(), target, recording, vec![], vec![], Some(audio), None, Default::default(), None,
        )?;
        let bundle: ApparentBundle = serde_json::from_slice(&std::fs::read(saved.join("apparent.json"))?)?;
        ensure!(std::fs::read(saved.join("audio.wav"))? == wav, "Saved audio differs from the full fixture");
        ensure!(!summary.is_empty() && !bundle.keyframes.is_empty(), "Missing bundle presentation");
        let transcript = bundle.transcript;
        let model_path = speech::installed_parakeet().context("Final model unavailable")?;
        let model = model_path.file_stem().and_then(|name| name.to_str()).context("Final model name unavailable")?;
        ensure!(transcript.source == format!("parakeet:{model}"), "Wrong final provider");
        ensure!(transcript.text.to_lowercase().contains("microphone"), "Missing early speech");
        ensure!(transcript.text.to_lowercase().contains("cursor"), "Missing saved tail");
        ensure!(!transcript.words.is_empty() && !transcript.estimated, "Missing real word times");
        ensure!(transcript.words.iter().all(|word| word.t0 <= word.t1 && word.t1 <= duration_ms),
            "Invalid word times");
        eprintln!("stream evidence: first text {first:?}, finish {:?}, audio {}ms, words {}", stopped.elapsed(), duration_ms, transcript.words.len());
        if std::env::var_os("APPARENT_STREAM_KEEP_BUNDLE").is_some() {
            eprintln!("saved recording fixture: {}", directory.keep().display());
        }
        Ok(())
    }
}
