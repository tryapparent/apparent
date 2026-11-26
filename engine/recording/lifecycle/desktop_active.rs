mod frog_wardrobe {
    include!("../../native/desktop/frog_wardrobe.rs");
}

struct ActiveRecording {
    user_started: bool,
    performance: Option<workflow::performance::RecordingPerformance>,
    started: Instant,
    target: TargetInfo,
    bundle_dir: PathBuf,
    source: CaptureSource,
    _metal_overlay: Option<LaserOverlay>,
    microphone_enabled: bool,
}

impl ActiveRecording {
    fn mic_warning(&self) -> Option<InputWarning> {
        if !self.microphone_enabled {
            return None;
        }
        match &self.source {
            CaptureSource::Screen {
                audio: Some(audio), ..
            } => audio.warning(),
            CaptureSource::Screen { audio: None, .. } => Some(InputWarning::Unavailable),
            CaptureSource::Phone(_) | CaptureSource::Lab => None,
        }
    }

    fn elapsed_ms(&self) -> u64 {
        match &self.source {
            CaptureSource::Screen { session, .. } => session.elapsed_ms(),
            CaptureSource::Phone(session) => session.elapsed_ms(),
            CaptureSource::Lab => self.started.elapsed().as_millis() as u64,
        }
    }
}
