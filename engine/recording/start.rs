use anyhow::Context;
use std::path::Path;
use std::sync::Arc;
use std::time::Instant;

#[cfg(any(target_os = "macos", target_os = "linux"))]
use super::PreparedSource;
use super::ScreenCaptureSession;
use crate::capture::desktop::start_metric;
use crate::capture::engine::bundle::recover;
use crate::capture::engine::runtime::{
    SharedCaptureTelemetry, apparent_log, audio::audio::AudioRecorder,
};
use crate::shared::model::{CaptureMode, TargetInfo};
use crate::shared::windows::WindowLogger;

#[cfg(target_os = "linux")]
use super::ChooserStorage;
#[cfg(target_os = "linux")]
use super::chooser_storage::Promotion;
#[cfg(target_os = "linux")]
use crate::capture::engine::runtime::audio::audio::PreparedAudio;

#[cfg(target_os = "linux")]
#[path = "lifecycle/pending/cancellation.rs"]
mod pending_start_cancellation;
#[cfg(target_os = "linux")]
pub(crate) use pending_start_cancellation::PendingStartCancellation;

pub(crate) enum StartError {
    #[cfg(target_os = "linux")]
    Cancelled,
    MicrophoneIntent(std::io::Error),
    Audio(anyhow::Error),
    Screen(anyhow::Error),
}

#[cfg(target_os = "linux")]
pub(crate) enum AudioPreparation {
    Worker(std::thread::JoinHandle<anyhow::Result<PreparedAudio>>),
    Ready(PreparedAudio),
}

#[cfg(target_os = "linux")]
impl AudioPreparation {
    fn wait(self) -> anyhow::Result<PreparedAudio> {
        match self {
            Self::Worker(worker) => worker.join()
                .map_err(|_| anyhow::anyhow!("Audio preparation worker panicked"))?,
            Self::Ready(audio) => Ok(audio),
        }
    }
}

pub(crate) type LocalStreamAdmission = Box<dyn FnOnce() -> anyhow::Result<bool> + Send>;
pub(crate) type ScreenTracks = (
    ScreenCaptureSession,
    Option<AudioRecorder>,
    Option<WindowLogger>,
);

pub(crate) struct StartPreparation {
    protection: Option<std::thread::JoinHandle<anyhow::Result<()>>>,
    started: Instant,
    #[cfg(target_os = "linux")]
    audio: Option<AudioPreparation>,
    #[cfg(target_os = "linux")]
    storage: Option<ChooserStorage>,
    #[cfg(target_os = "linux")]
    promotion: Option<std::thread::JoinHandle<anyhow::Result<Promotion>>>,
    #[cfg(target_os = "linux")]
    pub(crate) pending_cancellation: Option<Arc<PendingStartCancellation>>,
}

impl StartPreparation {
    pub(crate) fn protect(mut self, bundle_dir: &Path) -> anyhow::Result<Self> {
        #[cfg(target_os = "linux")]
        if let Some(promotion) = self.promotion.take() {
            let waiting = Instant::now();
            let promoted = promotion.join()
                .map_err(|_| anyhow::anyhow!("Provisional screen storage worker panicked"))?;
            start_metric("raw_protection_critical_ms", waiting);
            start_metric("raw_protection_overlapped_ms", self.started);
            let promoted = match promoted? {
                ready @ Promotion::Ready(_, _) => ready,
                Promotion::Fallback { microphone } => {
                    ChooserStorage::reserve_final(bundle_dir, microphone)?
                }
            };
            if let Promotion::Ready(storage, audio) = promoted {
                self.storage = Some(storage);
                self.audio = audio.map(AudioPreparation::Ready);
            }
        }
        if let Some(protection) = self.protection.take() {
            let waiting = Instant::now();
            let result = protection.join()
                .map_err(|_| anyhow::anyhow!("Raw-video protection worker panicked"))
                .and_then(|result| result);
            start_metric("raw_protection_critical_ms", waiting);
            start_metric("raw_protection_overlapped_ms", self.started);
            if let Err(error) = result {
                let stop = || {
                    #[cfg(target_os = "linux")]
                    if let Some(worker) = self.audio.take() {
                        let _ = worker.wait();
                    }
                };
                #[cfg(target_os = "linux")]
                let cleanup = match self.pending_cancellation.as_ref() {
                    Some(pending) => pending.abandon(bundle_dir, stop),
                    None => recover::abandon_start(bundle_dir, stop),
                };
                #[cfg(not(target_os = "linux"))]
                let cleanup = recover::abandon_start(bundle_dir, stop);
                if let Err(cleanup) = cleanup {
                    apparent_log(format!("Failed protection cleanup: {cleanup:#}"));
                }
                return Err(error);
            }
        }
        Ok(self)
    }

    #[cfg(target_os = "linux")]
    pub(crate) fn abandon(self, bundle_dir: &Path) -> anyhow::Result<()> {
        if let Some(storage) = self.storage {
            let result = storage.cancel();
            drop(self.audio);
            return result;
        }
        let stop = || {
            if let Some(worker) = self.audio {
                let _ = worker.wait();
            }
        };
        match self.pending_cancellation.as_ref() {
            Some(pending) => pending.abandon(bundle_dir, stop),
            None => recover::abandon_start(bundle_dir, stop),
        }
    }
}

impl ScreenCaptureSession {
    pub fn start(
        target: TargetInfo,
        video_output_path: Option<std::path::PathBuf>,
        excluded_window_ids: Arc<std::sync::Mutex<Vec<u32>>>,
    ) -> anyhow::Result<Self> {
        Self::start_with_exclusion_receipt(target, video_output_path, excluded_window_ids,
            #[cfg(any(target_os = "macos", target_os = "linux"))]
            None,
            #[cfg(target_os = "macos")]
            Arc::new(std::sync::Mutex::new(Vec::new())),
            #[cfg(any(target_os = "macos", target_os = "linux"))]
            None,
            #[cfg(target_os = "linux")]
            None,
            #[cfg(target_os = "linux")]
            None,
        )
    }

    #[cfg(target_os = "linux")]
    pub(crate) fn prepare_picker_start(
        storage: Option<ChooserStorage>,
        bundle_dir: &Path,
        microphone: bool,
        pending: bool,
    ) -> anyhow::Result<StartPreparation> {
        let Some(storage) = storage.filter(|stage| stage.matches(bundle_dir, microphone)) else {
            return Self::prepare_start(bundle_dir, microphone, pending);
        };
        let started = Instant::now();
        let bundle_dir = bundle_dir.to_owned();
        let promotion = std::thread::Builder::new()
            .name("apparent-promote-screen-storage".into())
            .spawn(move || storage.promote(&bundle_dir))?;
        Ok(StartPreparation {
            protection: None,
            started,
            audio: None,
            storage: None,
            promotion: Some(promotion),
            pending_cancellation: None,
        })
    }

    pub(crate) fn prepare_start(
        bundle_dir: &Path,
        _microphone: bool,
        #[cfg(target_os = "linux")] pending: bool,
    ) -> anyhow::Result<StartPreparation> {
        let started = Instant::now();
        let protection = prepare_screen_capture(bundle_dir)?;
        #[cfg(target_os = "linux")]
        let pending_cancellation = if pending {
            Some(Arc::new(PendingStartCancellation::new(protection.directory.try_clone()?)))
        } else {
            None
        };
        let protection = if cfg!(target_os = "linux") {
            Some(std::thread::Builder::new()
                .name("apparent-raw-protection".into())
                .spawn(move || protection.commit())?)
        } else {
            protection.commit()?;
            start_metric("raw_protection_critical_ms", started);
            None
        };
        Ok(StartPreparation {
            protection,
            started,
            #[cfg(target_os = "linux")]
            audio: Self::prepare_audio(bundle_dir, _microphone),
            #[cfg(target_os = "linux")]
            storage: None,
            #[cfg(target_os = "linux")]
            promotion: None,
            #[cfg(target_os = "linux")]
            pending_cancellation,
        })
    }

    #[cfg(target_os = "linux")]
    pub(crate) fn prepare_audio(bundle_dir: &Path, microphone: bool) -> Option<AudioPreparation> {
        if !microphone {
            return None;
        }
        let bundle_dir = bundle_dir.to_owned();
        std::thread::Builder::new()
            .name("apparent-audio-prepare".into())
            .spawn(move || PreparedAudio::new(&bundle_dir))
            .inspect_err(|error| apparent_log(format!("Could not schedule audio preparation: {error}")))
            .ok()
            .map(AudioPreparation::Worker)
    }

    pub(crate) fn start_tracks(
        target: &TargetInfo,
        bundle_dir: &Path,
        telemetry: &SharedCaptureTelemetry,
        microphone: bool,
        stream_admission: Option<LocalStreamAdmission>,
        #[cfg(target_os = "linux")] preparation: StartPreparation,
        #[cfg(any(target_os = "macos", target_os = "linux"))] prepared_source: Option<
            PreparedSource,
        >,
        startup: Option<&crate::capture::desktop::workflow::performance::Startup>,
    ) -> Result<ScreenTracks, StartError> {
        #[cfg(target_os = "linux")]
        let StartPreparation { storage, audio: prepared_audio, pending_cancellation, .. } = preparation;
        #[cfg(target_os = "linux")]
        let pinned = storage.as_ref().map(|storage| {
            storage.verify_bundle(bundle_dir)?;
            Ok(storage.directory()?)
        }).transpose().map_err(StartError::Screen)?;
        let stage = Instant::now();
        let audio = if microphone {
            #[cfg(target_os = "linux")]
            let recorder = match prepared_audio {
                Some(prepared) => {
                    let prepared = prepared.wait().map_err(StartError::Audio)?;
                    AudioRecorder::start_prepared(prepared, stream_admission, stage)
                }
                None => AudioRecorder::start_with_local_stream(bundle_dir, stream_admission),
            };
            #[cfg(not(target_os = "linux"))]
            let recorder = AudioRecorder::start_with_local_stream(bundle_dir, stream_admission);
            Some(recorder.map_err(StartError::Audio)?)
        } else {
            #[cfg(target_os = "linux")]
            let pinned_path = storage.as_ref().map(ChooserStorage::pinned_path);
            #[cfg(target_os = "linux")]
            if let Some(path) = pinned_path {
                recover::record_microphone_off(&path, target).map_err(StartError::Screen)?;
            } else {
                std::fs::write(bundle_dir.join("microphone-off"), b"")
                    .map_err(StartError::MicrophoneIntent)?;
            }
            #[cfg(not(target_os = "linux"))]
            std::fs::write(bundle_dir.join("microphone-off"), b"")
                .map_err(StartError::MicrophoneIntent)?;
            None
        };
        start_metric("audio_start_ms", stage);
        if let Some(trace) = startup {
            trace.record(crate::capture::desktop::workflow::performance::StartupPoint::AudioReady);
        }
        #[cfg(target_os = "linux")]
        if let Some(pending) = &pending_cancellation && pending.requested() {
            if let Err(error) = pending.abandon(bundle_dir, || drop(audio)) {
                apparent_log(format!("Failed cancelled startup cleanup: {error:#}"));
            }
            return Err(StartError::Cancelled);
        }
        let stage = Instant::now();
        let screen = Self::start_with_exclusion_receipt(
            target.clone(),
            Some(bundle_dir.join("recording.mp4")),
            Arc::clone(&telemetry.excluded_window_ids),
            #[cfg(any(target_os = "linux", target_os = "macos"))]
            telemetry.circle_session.lock().unwrap_or_else(std::sync::PoisonError::into_inner).clone(),
            #[cfg(target_os = "macos")]
            Arc::clone(&telemetry.applied_excluded_window_ids),
            #[cfg(any(target_os = "macos", target_os = "linux"))]
            prepared_source,
            #[cfg(target_os = "linux")]
            pinned,
            #[cfg(target_os = "linux")]
            startup.cloned(),
        );
        let screen = match screen {
            Ok(screen) => screen,
            Err(error) => {
                #[cfg(target_os = "linux")]
                if let Some(storage) = storage {
                    if let Err(cleanup) = storage.cancel() {
                        apparent_log(format!("Failed capture startup cleanup: {cleanup:#}"));
                    }
                    drop(audio);
                    return Err(StartError::Screen(error));
                }
                let stop = || drop(audio);
                #[cfg(target_os = "linux")]
                let cleanup = match pending_cancellation {
                    Some(pending) => pending.abandon(bundle_dir, stop),
                    None => recover::abandon_start(bundle_dir, stop),
                };
                #[cfg(not(target_os = "linux"))]
                let cleanup = recover::abandon_start(bundle_dir, stop);
                if let Err(cleanup) = cleanup {
                    apparent_log(format!(
                        "Failed capture startup cleanup at {}: {cleanup:#}",
                        bundle_dir.display()
                    ));
                }
                return Err(StartError::Screen(error));
            }
        };
        start_metric("sck_start_ms", stage);
        let windows = (target.mode == CaptureMode::Display).then(|| {
            WindowLogger::start(
                target.frame,
                *telemetry
                    .started_at
                    .lock()
                    .unwrap_or_else(|error| error.into_inner()),
                Arc::clone(&telemetry.window_log_request),
            )
        });
        #[cfg(target_os = "linux")]
        if let Some(storage) = storage {
            storage.release();
        }
        Ok((screen, audio, windows))
    }
}

impl SharedCaptureTelemetry {
    pub(crate) fn reveal_activity(&self) -> usize {
        use std::sync::PoisonError;
        self.events
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .len()
            + self
                .strokes
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .len()
            + usize::from(
                self.live_ink
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner)
                    .is_some(),
            )
    }
}

impl ScreenCaptureSession {
    pub(crate) fn placement(
        frame: crate::shared::model::TargetFrame,
    ) -> ([f64; 4], [f32; 4], [f64; 2]) {
        use crate::capture::engine::runtime::screens;
        let rect = [frame.x, frame.y, frame.width, frame.height];
        let centre = [frame.x + frame.width / 2.0, frame.y + frame.height / 2.0];
        let screens = screens::current();
        let display = screens::index_at(&screens, centre).map_or(rect, |i| screens[i].frame);
        (rect, display.map(|value| value as f32), centre)
    }
}
pub(crate) struct ScreenProtection {
    marker: std::fs::File,
    directory: std::fs::File,
}

pub(super) const SCREEN_PROTECTION_BYTES: &[u8] =
    b"No safe screenshots; do not recover movie frames\n";

impl ScreenProtection {
    pub(crate) fn commit(self) -> anyhow::Result<()> {
        self.marker.sync_all()?;
        self.directory.sync_all()?;
        Ok(())
    }
}

pub(crate) fn prepare_screen_capture(bundle_dir: &Path) -> anyhow::Result<ScreenProtection> {
    let root = crate::capture::engine::bundle::bundle_processing::publication::Directory::open(
        bundle_dir, true,
    )?;
    anyhow::ensure!(
        std::fs::read_dir(bundle_dir)?.next().is_none(),
        "{} is not empty; use a new output directory for a screen capture",
        bundle_dir.display()
    );
    use std::io::Write;
    let mut marker = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(bundle_dir.join(recover::UNSAFE_VIDEO))
        .with_context(|| format!("Could not protect raw video in {}", bundle_dir.display()))?;
    marker.write_all(SCREEN_PROTECTION_BYTES)?;
    Ok(ScreenProtection { marker, directory: root.0 })
}
