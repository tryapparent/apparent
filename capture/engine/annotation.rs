//! Source evidence and composition policy. Native adapters own measurement; Engine owns replay.
//! No timestamp, OS name, window visibility or pixel colour can manufacture this evidence.
use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Deserializer, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FrameEvidence {
    pub version: u32,
    /// Opaque identity of one authorized source lifetime, not an app/window name.
    pub source_lifetime: String,
    pub source_generation: u64,
    pub sample_id: String,
    /// Acquisition on the bundle clock, never a subsequent polling/presentation time.
    pub captured_at_ms: u64,
    pub ordinary_ink: OrdinaryInk,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "camelCase", deny_unknown_fields)]
pub enum OrdinaryInk {
    Clean,
    /// Complete measured ordinary-ink layer snapshot. Unlisted strokes are absent.
    /// A represented prefix/fade must be preserved, not topped up without a clean underlay.
    Represented { strokes: Vec<RepresentedStroke> },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RepresentedStroke {
    /// Stable index in this capture's stroke log (also preserved by crop_view).
    pub stroke: usize,
    pub through_ms: u64,
    pub opacity: f32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Composition {
    Replay,
    PreserveSource,
    /// Compatibility replay, NOT a clean-source or exactly-once claim.
    Unknown,
}

impl FrameEvidence {
    pub fn valid_for(&self, log: &[crate::shared::model::Stroke]) -> bool {
        self.valid() && match &self.ordinary_ink {
            OrdinaryInk::Clean => true,
            OrdinaryInk::Represented { strokes } => strokes.iter().all(|represented| {
                log.get(represented.stroke).is_some_and(|stroke| !stroke.laser && stroke.pin.is_none()
                    && stroke.t0 <= represented.through_ms && represented.through_ms <= stroke.t1)
            }),
        }
    }

    pub fn valid(&self) -> bool {
        self.version == 1
            && !self.source_lifetime.trim().is_empty()
            && !self.sample_id.trim().is_empty()
            && self.source_generation > 0
            && match &self.ordinary_ink {
                OrdinaryInk::Clean => true,
                OrdinaryInk::Represented { strokes } => {
                    let mut seen = BTreeSet::new();
                    strokes.iter().all(|s| {
                        seen.insert(s.stroke)
                            && s.through_ms <= self.captured_at_ms
                            && s.opacity.is_finite()
                            && s.opacity > 0.0
                            && s.opacity <= 1.0
                    })
                }
            }
    }
}

pub fn composition(evidence: Option<&FrameEvidence>, stroke: usize) -> Composition {
    match evidence.filter(|e| e.valid()).map(|e| &e.ordinary_ink) {
        None => Composition::Unknown,
        Some(OrdinaryInk::Represented { strokes }) if strokes.iter().any(|s| s.stroke == stroke) => {
            Composition::PreserveSource
        }
        Some(_) => Composition::Replay,
    }
}

/// Exact media time. Never round a decoder timestamp to establish sample identity.
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MediaTime {
    pub value: u64,
    pub timescale: u32,
}

impl MediaTime {
    pub fn valid(self) -> bool {
        self.timescale > 0 && self.timescale <= i32::MAX as u32 && self.value <= i64::MAX as u64
    }

    pub fn cmp_exact(self, other: Self) -> std::cmp::Ordering {
        (self.value as u128 * other.timescale as u128)
            .cmp(&(other.value as u128 * self.timescale as u128))
    }

    #[cfg(test)]
    pub fn milliseconds(self) -> f64 {
        self.value as f64 * 1000.0 / self.timescale as f64
    }
}

impl PartialEq for MediaTime {
    fn eq(&self, other: &Self) -> bool {
        self.valid() && other.valid() && self.cmp_exact(*other).is_eq()
    }
}

/// Zero-based video-track ordinal plus original, unclipped sample PTS.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VideoSample {
    pub video_track: u32,
    pub pts: MediaTime,
}

impl VideoSample {
    #[cfg(test)]
    pub fn at_ms(ms: u64) -> Self {
        Self {
            video_track: 0,
            pts: MediaTime { value: ms, timescale: 1000 },
        }
    }
}

/// Association made by the encoder with a particular sample's actual presentation interval.
/// These are media-clock times, not bundle times. A gap remains unknown, never forward-filled.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VideoSampleEvidence {
    pub sample: VideoSample,
    pub end: MediaTime,
    pub frame: FrameEvidence,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnnotationEvidence {
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub keyframes: BTreeMap<usize, FrameEvidence>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub video: Vec<VideoSampleEvidence>,
}

impl AnnotationEvidence {
    pub fn is_empty(&self) -> bool {
        self.keyframes.is_empty() && self.video.is_empty()
    }

    /// Reject the complete ambiguous timeline rather than selecting one overlapping receipt.
    pub fn valid_video(&self) -> bool {
        self.video.iter().all(|s| {
            s.sample.pts.valid() && s.end.valid()
                && s.sample.pts.cmp_exact(s.end).is_lt() && s.frame.valid()
        }) && self.video.windows(2).all(|p| {
            p[0].sample.video_track == p[1].sample.video_track
                && !p[0].end.cmp_exact(p[1].sample.pts).is_gt()
        })
    }

    pub fn at_video_pts(&self, sample: VideoSample) -> Option<&FrameEvidence> {
        if !self.valid_video() {
            return None;
        }
        // Seek/preroll can clip PTS inside a frame. Require an exact recorded boundary.
        self.video.iter().find(|s| s.sample == sample).map(|s| &s.frame)
    }

    pub fn preserved_samples(&self, stroke: usize, log: &[crate::shared::model::Stroke]) -> Vec<VideoSample> {
        if !self.valid_video() {
            return Vec::new();
        }
        self.video.iter().filter(|s| {
            s.frame.valid_for(log) && composition(Some(&s.frame), stroke) == Composition::PreserveSource
        }).map(|s| s.sample).collect()
    }
}

/// Invalid/unsupported provenance is unknown. It must not make legacy media unreadable.
pub fn deserialize_evidence<'de, D: Deserializer<'de>>(d: D) -> Result<AnnotationEvidence, D::Error> {
    let value = serde_json::Value::deserialize(d)?;
    Ok(serde_json::from_value(value).unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;

    pub fn represented() -> FrameEvidence {
        FrameEvidence {
            version: 1,
            source_lifetime: "fixture-source".into(),
            source_generation: 1,
            sample_id: "fixture-sample".into(),
            captured_at_ms: 500,
            ordinary_ink: OrdinaryInk::Represented { strokes: vec![RepresentedStroke {
                stroke: 0, through_ms: 400, opacity: 0.3,
            }] },
        }
    }

    #[test]
    fn unknown_invalid_and_independent_generations_do_not_invent_cleanliness() {
        assert_eq!(composition(None, 0), Composition::Unknown);
        let mut first = represented();
        assert_eq!(composition(Some(&first), 0), Composition::PreserveSource);
        assert_eq!(composition(Some(&first), 1), Composition::Replay);
        let mut second = first.clone();
        second.source_lifetime = "another-source".into();
        second.source_generation = 7;
        second.ordinary_ink = OrdinaryInk::Clean;
        assert_eq!(composition(Some(&second), 0), Composition::Replay);
        assert_eq!(composition(Some(&first), 0), Composition::PreserveSource);
        first.version = 99;
        assert_eq!(composition(Some(&first), 0), Composition::Unknown);
        first.version = 1;
        if let OrdinaryInk::Represented { strokes } = &mut first.ordinary_ink {
            strokes[0].opacity = f32::NAN;
        }
        assert_eq!(composition(Some(&first), 0), Composition::Unknown);
    }

    #[test]
    fn media_intervals_are_explicit_and_ambiguous_records_are_unknown() {
        let mut evidence = AnnotationEvidence { video: vec![VideoSampleEvidence {
            sample: VideoSample::at_ms(100), end: VideoSample::at_ms(200).pts, frame: represented(),
        }], ..Default::default() };
        assert!(evidence.at_video_pts(VideoSample::at_ms(99)).is_none());
        assert!(evidence.at_video_pts(VideoSample::at_ms(100)).is_some());
        assert!(evidence.at_video_pts(VideoSample::at_ms(150)).is_none(), "a clipped seek PTS is not sample identity");
        assert!(evidence.at_video_pts(VideoSample::at_ms(200)).is_none());
        evidence.video.push(evidence.video[0].clone());
        assert!(evidence.at_video_pts(VideoSample::at_ms(150)).is_none());
        assert!(evidence.preserved_samples(0, &[]).is_empty());
    }

    #[test]
    fn cached_pixels_keep_their_receipt_through_candidates_crop_and_prepared_artifacts() {
        use crate::capture::engine::{bundle::bundle_processing::prepare_visuals, render};
        use crate::shared::model::{Keyframe, KeyframeReason, RgbaFrame, Stroke, TargetInfo};
        let target: TargetInfo = serde_json::from_value(serde_json::json!({
            "mode":"display","displayId":1,
            "frame":{"x":0,"y":0,"width":640,"height":400,"scale":1}
        })).unwrap();
        let stroke = Stroke {
            t0: 100, t1: 700, fw: 640, fh: 400, on: None, pin: None, laser: false,
            pts: (0..31).flat_map(|i| [3000 + i * 100, 5000 + i * 20, i * 20]).collect(),
        };
        let key = Keyframe {
            index: 1, t: 1000, reason: KeyframeReason::Mark, file: "frames/frame-01.png".into(),
            event: String::new(), said: None, mark_id: None, cursor: None,
        };
        let mut whiteboard = RgbaFrame::new(1000, 640, 400, vec![255; 640 * 400 * 4]);
        // Unrelated same-colour content is not a removable annotation layer.
        for y in 300..340 {
            for x in 80..160 {
                let at = (y * 640 + x) * 4;
                whiteboard.rgba[at..at + 4].copy_from_slice(&[255, 59, 48, 255]);
            }
        }
        let settings = crate::capture::engine::autocrop::autocrop::Settings::default();
        for (captured, through, opacity) in [(200, 200, 1.0), (800, 700, 1.0), (1000, 700, 0.3)] {
            let mut pixels = whiteboard.clone();
            let mut source_key = key.clone();
            source_key.t = through;
            render::annotate_keyframe_marks_in_place(&mut pixels, &source_key, &[stroke.clone()], &[], &[]);
            for (pixel, base) in pixels.rgba.iter_mut().zip(&whiteboard.rgba) {
                *pixel = (*base as f32 + (*pixel as f32 - *base as f32) * opacity) as u8;
            }
            assert!(pixels.rgba != whiteboard.rgba, "fixture must contain real source ink");
            let mut receipt = represented();
            receipt.captured_at_ms = captured;
            receipt.ordinary_ink = OrdinaryInk::Represented { strokes: vec![RepresentedStroke {
                stroke: 0, through_ms: through, opacity,
            }] };
            pixels.source_evidence = Some(receipt.clone());
            // A cached acquisition is polled again long after the partial stroke.
            pixels.t_ms = 1000;
            let mut buffer = crate::capture::engine::runtime::CandidateBuffer::new(1024 * 1024);
            buffer.push(pixels.clone(), true);
            let cached = buffer.into_frames().pop().unwrap();
            assert_eq!(cached.source_evidence.as_ref(), Some(&receipt));
            assert_eq!(cached.source_evidence.as_ref().unwrap().captured_at_ms, captured);
            for crop in [None, Some(&settings)] {
                let actual = prepare_visuals(
                    vec![(key.clone(), cached.clone())], None, crop, &target, 1100,
                    &[stroke.clone()], &[], &[], &Default::default(),
                ).unwrap();
                let mut expected_full = pixels.clone();
                expected_full.t_ms = key.t;
                let mut expected = if let Some(info) = &actual.autocrop {
                    let c = &info.crops[0];
                    crate::capture::engine::autocrop::autocrop::crop_frame(&expected_full, [
                        (c.x / 640.0) as f32, (c.y / 400.0) as f32,
                        ((c.x + c.width) / 640.0) as f32, ((c.y + c.height) / 400.0) as f32,
                    ])
                } else { expected_full.clone() };
                let sheet = render::render_contact_sheet_for_duration(1100, &[(key.clone(), expected.clone())]);
                assert!(actual.contact_sheet_png == render::encode_png(&sheet).unwrap(), "sheet at {captured}");
                render::stamp_keyframe_badge_in_place(&mut expected, &key);
                assert!(actual.frame_pngs[0].1 == render::encode_png(&expected).unwrap(), "saved keyframe at {captured}");
                if crop.is_some() {
                    assert!(actual.autocrop.is_some(), "exercise a real crop, not a full-frame fallback");
                    let full_sheet = render::render_contact_sheet_for_duration(1100, &[(key.clone(), expected_full.clone())]);
                    assert!(actual.full_sheet_png.as_ref().unwrap() == &render::encode_png(&full_sheet).unwrap());
                    render::stamp_keyframe_badge_in_place(&mut expected_full, &key);
                    assert!(actual.full_frame_pngs[0].1 == render::encode_png(&expected_full).unwrap());
                }
                assert_eq!(actual.source_evidence.get(&1), Some(&receipt));
            }
            let cropped = crate::capture::engine::autocrop::autocrop::crop_frame(&cached, [0.25, 0.25, 0.75, 0.75]);
            assert_eq!(cropped.source_evidence, Some(receipt));
        }
        let mut mixed = vec![stroke.clone(), stroke.clone(), stroke.clone()];
        mixed[1].pin = Some(1);
        mixed[1].pts = vec![1000, 1000, 0];
        mixed[2].laser = true;
        mixed[2].t0 = 900;
        mixed[2].t1 = 1000;
        mixed[2].pts = vec![8000, 1000, 0, 9000, 2000, 100];
        let events = vec![crate::shared::model::InteractionEvent::Click {
            t: 1000, x: 0.5, y: 0.2, button: None, label: None, role: None,
        }];
        let mut base = whiteboard.clone();
        let mut receipt = represented();
        receipt.captured_at_ms = 200;
        receipt.ordinary_ink = OrdinaryInk::Represented { strokes: vec![RepresentedStroke {
            stroke: 0, through_ms: 200, opacity: 1.0,
        }] };
        base.source_evidence = Some(receipt.clone());
        let mut actual = base.clone();
        render::annotate_keyframe_marks_in_place(&mut actual, &key, &mixed, &[], &events);
        mixed[0].pts.clear();
        let mut expected = base.clone();
        expected.source_evidence = None;
        render::annotate_keyframe_marks_in_place(&mut expected, &key, &mixed, &[], &events);
        assert!(actual.rgba == expected.rgba, "ordinary preservation must not suppress pin, laser or click");
        assert!(actual.rgba != base.rgba, "independent overlays must really be rendered");
        // A structurally valid receipt referencing a different layer is unknown as a whole.
        if let OrdinaryInk::Represented { strokes } = &mut receipt.ordinary_ink {
            strokes.push(RepresentedStroke { stroke: 1, through_ms: 200, opacity: 1.0 });
        }
        mixed[0] = stroke.clone();
        assert!(!receipt.valid_for(&mixed));
        base.source_evidence = Some(receipt);
        render::annotate_keyframe_marks_in_place(&mut base, &key, &mixed, &[], &events);
        assert!(base.rgba != actual.rgba, "invalid provenance must keep unknown legacy replay");
        // A separate lifetime/generation at the same poll time must not reuse the old layer state.
        let mut clean = represented();
        clean.source_lifetime = "independent".into();
        clean.source_generation = 2;
        clean.ordinary_ink = OrdinaryInk::Clean;
        whiteboard.source_evidence = Some(clean);
        let original = whiteboard.rgba.clone();
        render::annotate_keyframe_marks_in_place(&mut whiteboard, &key, &[stroke], &[], &[]);
        assert!(whiteboard.rgba != original);
    }
}
