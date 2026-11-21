use std::time::Instant;

use super::{ScreenCaptureSession, ScreenRecording};
use crate::capture::engine::runtime::audio::audio::{AudioRecorder, RecordedAudio, stop_optional};
use crate::capture::engine::runtime::recording::diagnostics::sampling::Sampling;
use crate::shared::windows::{ActivityLog, WindowLogger};

pub(crate) struct StoppedScreen {
    pub(crate) recording: ScreenRecording,
    pub(crate) sampling: Option<Sampling>,
    pub(crate) audio: anyhow::Result<Option<RecordedAudio>>,
    pub(crate) activity: ActivityLog,
}

impl ScreenCaptureSession {
    pub(crate) fn stop_tracks(
        self,
        audio: Option<AudioRecorder>,
        windows: Option<WindowLogger>,
    ) -> StoppedScreen {
        let stop_started = Instant::now();
        let ((recording, sampling), audio, mut activity) = std::thread::scope(|scope| {
            let screen = scope.spawn(|| self.stop_with_sampling());
            let windows = scope.spawn(|| windows.map(WindowLogger::stop).unwrap_or_default());
            let audio = stop_optional(audio);
            (
                screen.join().unwrap(),
                audio,
                windows.join().unwrap_or_default(),
            )
        });
        activity.stop_started = Some(stop_started);
        activity.stop_ms = Some(stop_started.elapsed().as_millis() as u64);
        StoppedScreen {
            recording,
            sampling,
            audio,
            activity,
        }
    }
}
