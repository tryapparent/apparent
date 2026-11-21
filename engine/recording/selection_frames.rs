use super::{FrameRef, InteractionEvent, Mark, RgbaFrame, SelectedFrames, SelectionLimits, SpeechInput, StoredFrame, Stroke, THUMB_PIXELS, VideoInk, select_with_analysis};

#[derive(Default)]
pub(super) struct SceneAnalysis {
    pub(super) thumbnails: Option<Vec<[f32; THUMB_PIXELS]>>,
    pub(super) transitions: Option<SceneTransitions>,
}

pub(super) struct SceneTransitions {
    pub(super) drawing: Vec<(u64, u64)>,
    pub(super) transitions: Vec<crate::composition::assembly::scene::Transition>,
}

pub(crate) struct SelectionFrames {
    frames: Vec<StoredFrame>,
    analysis: SceneAnalysis,
}

impl From<Vec<RgbaFrame>> for SelectionFrames {
    fn from(frames: Vec<RgbaFrame>) -> Self {
        Self::from(frames.into_iter().map(StoredFrame::from).collect::<Vec<_>>())
    }
}

impl From<Vec<StoredFrame>> for SelectionFrames {
    fn from(frames: Vec<StoredFrame>) -> Self {
        Self { frames, analysis: SceneAnalysis::default() }
    }
}

impl SelectionFrames {
    pub(crate) fn first(&self) -> Option<RgbaFrame> {
        self.frames.first().map(StoredFrame::to_rgba)
    }

    pub(crate) fn into_first(self) -> Option<RgbaFrame> {
        self.frames.into_iter().next().map(StoredFrame::into_rgba)
    }

    pub(crate) fn select(
        &mut self,
        strokes: &[Stroke],
        marks: &mut [Mark],
        events: &[InteractionEvent],
        speech: &SpeechInput<'_>,
        limits: SelectionLimits,
        video_ink: Option<VideoInk>,
    ) -> anyhow::Result<SelectedFrames> {
        select_with_analysis(
            self.frames.iter().map(FrameRef::Stored).collect(),
            strokes,
            marks,
            events,
            speech,
            limits,
            video_ink,
            &mut self.analysis,
        )
    }
}
