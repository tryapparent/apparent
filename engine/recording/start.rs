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

pub(crate) enum StartError {
    MicrophoneIntent(std::io::Error),
    Audio(anyhow::Error),
    Screen(anyhow::Error),
}

#[cfg(target_os = "linux")]
type AudioPreparation = std::thread::JoinHandle<anyhow::Result<
    crate::capture::engine::runtime::audio::audio::PreparedAudio,
>>;
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
    pub(crate) audio: Option<AudioPreparation>,
}

impl StartPreparation {
    pub(crate) fn protect(mut self, bundle_dir: &Path) -> anyhow::Result<Self> {
        if let Some(protection) = self.protection.take() {
            let waiting = Instant::now();
            let result = protection.join()
                .map_err(|_| anyhow::anyhow!("Raw-video protection worker panicked"))
                .and_then(|result| result);
            start_metric("raw_protection_critical_ms", waiting);
            start_metric("raw_protection_overlapped_ms", self.started);
            if let Err(error) = result {
                if let Err(cleanup) = recover::abandon_start(bundle_dir, || {
                    #[cfg(target_os = "linux")]
                    if let Some(worker) = self.audio.take() {
                        let _ = worker.join();
                    }
                }) {
                    apparent_log(format!("Failed protection cleanup: {cleanup:#}"));
                }
                return Err(error);
            }
        }
        Ok(self)
    }
}

impl ScreenCaptureSession {
    pub(crate) fn prepare_start(
        bundle_dir: &Path,
        _microphone: bool,
    ) -> anyhow::Result<StartPreparation> {
        let started = Instant::now();
        let protection = prepare_screen_capture(bundle_dir)?;
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
            .spawn(move || crate::capture::engine::runtime::audio::audio::PreparedAudio::new(&bundle_dir))
            .inspect_err(|error| apparent_log(format!("Could not schedule audio preparation: {error}")))
            .ok()
    }

    pub(crate) fn start_tracks(
        target: &TargetInfo,
        bundle_dir: &Path,
        telemetry: &SharedCaptureTelemetry,
        microphone: bool,
        stream_admission: Option<LocalStreamAdmission>,
        #[cfg(target_os = "linux")] prepared_audio: Option<AudioPreparation>,
        #[cfg(any(target_os = "macos", target_os = "linux"))] prepared_source: Option<
            PreparedSource,
        >,
    ) -> Result<ScreenTracks, StartError> {
        let stage = Instant::now();
        let audio = if microphone {
            #[cfg(target_os = "linux")]
            let recorder = match prepared_audio {
                Some(prepared) => {
                    let prepared = prepared.join()
                        .map_err(|_| StartError::Audio(anyhow::anyhow!("Audio preparation worker panicked")))?
                        .map_err(StartError::Audio)?;
                    AudioRecorder::start_prepared(prepared, stream_admission, stage)
                }
                None => AudioRecorder::start_with_local_stream(bundle_dir, stream_admission),
            };
            #[cfg(not(target_os = "linux"))]
            let recorder = AudioRecorder::start_with_local_stream(bundle_dir, stream_admission);
            Some(recorder.map_err(StartError::Audio)?)
        } else {
            std::fs::write(bundle_dir.join("microphone-off"), b"")
                .map_err(StartError::MicrophoneIntent)?;
            None
        };
        start_metric("audio_start_ms", stage);
        let stage = Instant::now();
        let screen = Self::start_with_exclusion_receipt(
            target.clone(),
            Some(bundle_dir.join("recording.mp4")),
            Arc::clone(&telemetry.excluded_window_ids),
            #[cfg(target_os = "macos")]
            Arc::clone(&telemetry.applied_excluded_window_ids),
            #[cfg(any(target_os = "macos", target_os = "linux"))]
            prepared_source,
        );
        let screen = match screen {
            Ok(screen) => screen,
            Err(error) => {
                if let Err(cleanup) = recover::abandon_start(bundle_dir, || drop(audio)) {
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
    marker.write_all(b"No safe screenshots; do not recover movie frames\n")?;
    Ok(ScreenProtection { marker, directory: root.0 })
}
