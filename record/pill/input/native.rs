use crate::shared::model::{MissingTranscript, TranscriptData, TranscriptSegment};
use std::time::{Duration, Instant};

include!(concat!(env!("OUT_DIR"), "/lip-input.rs"));

pub(crate) fn microphone_enabled(lips: bool, microphone: bool) -> bool {
    USE_MICROPHONE[usize::from(lips) * 2 + usize::from(microphone)]
}

pub(crate) fn preserve(transcript: &TranscriptData) -> Option<TranscriptData> {
    (transcript.source == "lipflow").then(|| transcript.clone())
}

#[derive(serde::Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum Frame {
    Clip { start: u64, end: u64, text: String },
    Done,
    Failed,
    TimedOut,
}

pub(crate) type Receipt = flume::Receiver<Frame>;

pub(crate) enum Input {
    Pending(Receipt),
    Unavailable,
}

impl Input {
    pub(crate) fn transcript(self, duration_ms: u64) -> TranscriptData {
        let mut result = TranscriptData {
            source: "lipflow".into(),
            estimated: true,
            ..Default::default()
        };
        let timed_out = "Lipflow timed out before the transcript was ready.";
        let failed = "The lip-reading transcript could not be completed. Check camera access and model setup in Settings.";
        let problem = match self {
            Self::Unavailable => Some(failed),
            Self::Pending(receipt) => {
                let deadline = Instant::now() + Duration::from_secs(100);
                loop {
                    match receipt.recv_deadline(deadline) {
                        Ok(Frame::Clip { start, end, text }) => {
                            let end = end.min(duration_ms);
                            if start < end && !text.trim().is_empty() {
                                result.segments.push(TranscriptSegment { t0: start, t1: end, text });
                            }
                        }
                        Ok(Frame::Done) => break None,
                        Ok(Frame::TimedOut) | Err(flume::RecvTimeoutError::Timeout) => break Some(timed_out),
                        Ok(Frame::Failed) | Err(flume::RecvTimeoutError::Disconnected) => break Some(failed),
                    }
                }
            }
        };
        result.text = result.segments.iter().map(|segment| segment.text.as_str())
            .collect::<Vec<_>>().join(" ");
        result.missing = problem.or_else(|| result.text.is_empty().then_some("Lipflow did not recognize any words."))
            .map(|reason| MissingTranscript { reason: reason.into(), retry: false });
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timeout_reports_decoder_and_keeps_completed_segments() {
        let (sender, receipt) = flume::bounded(2);
        sender.send(Frame::Clip { start: 100, end: 300, text: "First words".into() }).unwrap();
        sender.send(serde_json::from_str(r#"{"kind":"timed_out"}"#).unwrap()).unwrap();
        let transcript = Input::Pending(receipt).transcript(1000);
        assert_eq!(transcript.text, "First words");
        assert_eq!(transcript.missing.unwrap().reason, "Lipflow timed out before the transcript was ready.");
    }

    #[test]
    fn regular_capture_keeps_lip_text_and_notes_with_no_wav() {
        use crate::capture::engine::{
            bundle::{bundle_processing::finalize_capture_bundle_with_transcript, recover},
            runtime::ScreenRecording,
        };
        use crate::shared::{model::{CaptureMode, RgbaFrame, TargetFrame, TargetInfo}, windows};
        let directory = tempfile::Builder::new()
            .permissions(std::os::unix::fs::PermissionsExt::from_mode(0o700))
            .tempdir()
            .unwrap();
        let bundle_dir = directory.path();
        let target = TargetInfo {
            mode: CaptureMode::Display,
            frame: TargetFrame { x: 0.0, y: 0.0, width: 32.0, height: 32.0, scale: 1.0 },
            app: None, bundle_id: None, window_title: None, window_id: None, display_id: 1,
        };
        recover::record_microphone_off(bundle_dir, &target).unwrap();
        let mut notes = crate::capture::engine::runtime::recording::notes::Store::new(bundle_dir);
        notes.open(1, 250, 0.3, 0.4).unwrap();
        notes.save(1, "Keep the typed note".into()).unwrap();

        let (sender, receipt) = flume::bounded(2);
        sender.send(Frame::Clip { start: 100, end: 1100, text: "Make this button bigger".into() }).unwrap();
        sender.send(Frame::Done).unwrap();
        let transcript = Input::Pending(receipt).transcript(1000);
        let (_, bundle, summary) = finalize_capture_bundle_with_transcript(
            bundle_dir, target,
            ScreenRecording {
                frames: vec![RgbaFrame::new(0, 32, 32, vec![128; 32 * 32 * 4]).into()],
                video: None, duration_ms: 1000, video_offset_ms: 0, video_ink: None,
            },
            vec![], vec![], None, None, windows::ActivityLog::default(), None,
            Some(transcript),
        ).unwrap();
        assert_eq!(bundle.transcript.source, "lipflow");
        assert_eq!(bundle.transcript.segments[0].t0, 100);
        assert_eq!(bundle.transcript.segments[0].t1, 1000);
        assert!(summary.contains("Make this button bigger"));
        assert!(summary.contains("Keep the typed note"));
        assert!(!bundle_dir.join("audio.wav").exists());
        assert!(!summary.contains("No microphone audio was saved"));
    }
}
