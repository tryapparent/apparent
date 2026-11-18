use std::path::Path;
use std::sync::Arc;
use std::time::Instant;

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

pub(crate) type LocalStreamAdmission = Box<dyn FnOnce() -> anyhow::Result<bool> + Send>;
pub(crate) type ScreenTracks = (
    ScreenCaptureSession,
    Option<AudioRecorder>,
    Option<WindowLogger>,
);

impl ScreenCaptureSession {
    pub(crate) fn start_tracks(
        target: &TargetInfo,
        bundle_dir: &Path,
        telemetry: &SharedCaptureTelemetry,
        microphone: bool,
        stream_admission: Option<LocalStreamAdmission>,
        #[cfg(target_os = "linux")] prepared_source: Option<
            crate::capture::desktop::linux::media::Source,
        >,
    ) -> Result<ScreenTracks, StartError> {
        let stage = Instant::now();
        let audio = if microphone {
            Some(
                AudioRecorder::start_with_local_stream(bundle_dir, stream_admission)
                    .map_err(StartError::Audio)?,
            )
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
            #[cfg(target_os = "linux")]
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
