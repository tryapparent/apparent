use super::{CandidateBuffer, RgbaFrame, TargetInfo, capture_size};

impl CandidateBuffer {
    pub(crate) fn sampling_edge(&mut self, target: &TargetInfo, video: bool) -> f64 {
        let edge = if video {
            super::CANDIDATE_EDGE
        } else {
            super::CANDIDATE_EDGE_NO_VIDEO
        };
        if self.circle.is_some() {
            self.candidate_size = Some(capture_size(target, edge));
            edge.max(1600.0)
        } else {
            edge
        }
    }

    pub(crate) fn sampling_size(&mut self, target: &TargetInfo, video: bool) -> (u32, u32) {
        capture_size(target, self.sampling_edge(target, video))
    }

    pub(super) fn sample_for_circle(&self, frame: RgbaFrame, real: bool) -> RgbaFrame {
        let Some((width, height)) = self.candidate_size else {
            return frame;
        };
        let mut candidate =
            crate::capture::engine::autocrop::autocrop_lab::resize(&frame, width, height);
        candidate.badge_bottom_left = frame.badge_bottom_left;
        if real && let Some(session) = self.circle.as_ref() {
            session.sample(frame);
        }
        candidate
    }
}

impl super::ScreenCaptureSession {
    pub(crate) fn circle_labels(
        &self,
    ) -> Option<std::sync::Arc<crate::circle_recognition::Session>> {
        self.frames
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .circle
            .clone()
    }
}
