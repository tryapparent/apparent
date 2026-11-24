use std::time::Instant;
use crate::recording_trace::{self as trace, Operation};

use super::{ScreenCaptureSession, ScreenRecording};
use crate::capture::engine::runtime::audio::audio::{AudioRecorder, RecordedAudio, stop_optional};
use crate::capture::engine::runtime::recording::diagnostics::sampling::Sampling;
use crate::shared::windows::{ActivityLog, WindowLogger};

pub(crate) struct StoppedScreen {
    pub(crate) recording: ScreenRecording,
    pub(crate) sampling: Option<Sampling>,
    pub(crate) audio: anyhow::Result<Option<RecordedAudio>>,
    pub(crate) activity: ActivityLog,
    #[cfg(target_os = "linux")]
    pub(crate) storage_dir: Option<std::fs::File>,
}

impl ScreenCaptureSession {
    pub(crate) fn stop_tracks(
        self,
        audio: Option<AudioRecorder>,
        windows: Option<WindowLogger>,
    ) -> StoppedScreen {
        #[cfg(target_os = "linux")]
        let (screen, storage_dir) = {
            let mut screen = self;
            let storage_dir = screen.storage_dir.take();
            (screen, storage_dir)
        };
        #[cfg(not(target_os = "linux"))]
        let screen = self;
        let stop_started = Instant::now();
        let ((recording, sampling), audio, mut activity) = std::thread::scope(|scope| {
            let screen = scope.spawn(trace::propagate(|| {
                let _span = trace::span(Operation::StopScreen);
                screen.stop_with_sampling()
            }));
            let windows = scope.spawn(trace::propagate(|| {
                let _span = trace::span(Operation::StopWindows);
                windows.map(WindowLogger::stop).unwrap_or_default()
            }));
            let audio = {
                let _span = trace::span(Operation::StopAudio);
                stop_optional(audio)
            };
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
            #[cfg(target_os = "linux")]
            storage_dir,
        }
    }
}

impl Drop for ScreenCaptureSession {
    fn drop(&mut self) {
        self.stopping.store(true, std::sync::atomic::Ordering::Release);
        if let Some(handle) = self.sampler_thread.take() {
            handle.thread().unpark();
            let _ = handle.join();
        }
    }
}
