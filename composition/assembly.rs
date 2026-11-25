use anyhow::{Context, Result, ensure};
use serde::Deserialize;
use std::{process::Command, time::Duration};
use crate::capture::engine::{keyframes::SelectionLimits, render::MAX_SHEET_TILES};

#[path = "../engine/recognition/worker.rs"]
mod circle;
pub(crate) use circle::circle_label;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Plan {
    version: u32,
    maximum_frames: usize,
    ordinary_frames: usize,
}

#[derive(Clone, Copy)]
pub(crate) struct AssemblyPlan {
    duration_ms: u64,
    limits: SelectionLimits,
}

impl AssemblyPlan {
    pub(crate) fn limits(self, duration_ms: u64) -> Result<SelectionLimits> {
        ensure!(duration_ms == self.duration_ms, "Record assembly duration changed");
        Ok(self.limits)
    }
}

fn decode(bytes: &[u8]) -> Result<SelectionLimits> {
    let plan: Plan = serde_json::from_slice(bytes).context("Invalid Record assembly plan")?;
    ensure!(plan.version == 1 && (1..MAX_SHEET_TILES).contains(&plan.maximum_frames)
        && (1..=plan.maximum_frames).contains(&plan.ordinary_frames), "Invalid Record assembly plan");
    Ok(SelectionLimits {maximum:plan.maximum_frames, ordinary:plan.ordinary_frames})
}

pub(crate) fn plan(duration_ms: u64) -> Result<AssemblyPlan> {
    let duration = duration_ms.to_string();
    if let Some(limits) = super::record_policy::evaluate("nativeAssembly", duration.as_bytes(), 1024)
        .and_then(|result| decode(result.as_bytes()).ok())
    {
        return Ok(AssemblyPlan {duration_ms, limits});
    }
    let (node, worker) = super::worker::policy_assets("Record assembly", "record-media", "assembly-worker.js")?;
    let bytes = super::worker::run(Command::new(node).env("ELECTRON_RUN_AS_NODE", "1")
        .arg(worker).arg(duration), Duration::from_secs(5), 1024)?;
    Ok(AssemblyPlan {duration_ms, limits:decode(&bytes)?})
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accepts_record_allocations_within_the_native_envelope_without_reimplementing_defaults() {
        let limits=decode(br#"{"version":1,"maximumFrames":9,"ordinaryFrames":3}"#).unwrap();
        assert_eq!((limits.maximum,limits.ordinary),(9,3));
        for bytes in [br#"{"version":2,"maximumFrames":9,"ordinaryFrames":3}"#.as_slice(),
            br#"{"version":1,"maximumFrames":13,"ordinaryFrames":3}"#,
            br#"{"version":1,"maximumFrames":9,"ordinaryFrames":10}"#,
            br#"{"version":1,"maximumFrames":9,"ordinaryFrames":0}"#,
            br#"{"version":1,"maximumFrames":0,"ordinaryFrames":0}"#,
            br#"{"version":1,"maximumFrames":9,"ordinaryFrames":3,"extra":true}"#] {
            assert!(decode(bytes).is_err());
        }
    }
}

pub(crate) mod scene {
    use crate::composition::{record_policy, worker};
    use anyhow::{Context, Result, ensure};
    use serde::{Deserialize, Serialize, ser::SerializeSeq};
    use std::{process::Command, time::Duration};

    pub(crate) struct Transition {
        pub frame: usize,
        pub span: (u64, u64),
        pub score: f32,
        pub ordinary: bool,
        pub event: String,
    }
    struct Times<'a>(&'a [u64]);
    impl Serialize for Times<'_> {
        fn serialize<S: serde::Serializer>(
            &self,
            serializer: S,
        ) -> std::result::Result<S::Ok, S::Error> {
            let mut sequence = serializer.serialize_seq(Some(self.0.len()))?;
            for frame in self.0 {
                sequence.serialize_element(&frame.to_string())?;
            }
            sequence.end()
        }
    }
    struct Drawing<'a>(&'a [(u64, u64)]);
    impl Serialize for Drawing<'_> {
        fn serialize<S: serde::Serializer>(
            &self,
            serializer: S,
        ) -> std::result::Result<S::Ok, S::Error> {
            let mut sequence = serializer.serialize_seq(Some(self.0.len()))?;
            for &(a, b) in self.0 {
                sequence.serialize_element(&[a.to_string(), b.to_string()])?;
            }
            sequence.end()
        }
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct RawTransition {
        start_frame: usize,
        frame: usize,
        diff: f32,
        score: f32,
        ordinary: bool,
        event: String,
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct Reply {
        version: u8,
        frame_count: usize,
        first_time: String,
        last_time: String,
        transitions: Vec<RawTransition>,
    }
    fn decode(bytes: &[u8], frames: &[u64]) -> Result<Vec<Transition>> {
        let reply: Reply = serde_json::from_slice(bytes).context("Invalid scene plan")?;
        ensure!(
            reply.version == 1
                && reply.frame_count == frames.len()
                && reply.first_time == frames.first().unwrap_or(&0).to_string()
                && reply.last_time == frames.last().unwrap_or(&0).to_string(),
            "Record scene snapshot changed"
        );
        ensure!(
            reply.transitions.len() < frames.len().max(1),
            "Record scene plan exceeds native measurements"
        );
        let mut previous = 0;
        reply
            .transitions
            .into_iter()
            .map(|value| {
                ensure!(
                    value.start_frame >= previous
                        && value.start_frame < value.frame
                        && value.frame < frames.len()
                        && value.diff.is_finite()
                        && (0.0..=1.0).contains(&value.diff)
                        && value.score.is_finite()
                        && value.score >= 0.0
                        && value.event.len() <= 512,
                    "Invalid Record scene candidate"
                );
                previous = value.frame;
                Ok(Transition {
                    frame: value.frame,
                    span: (frames[value.start_frame], frames[value.frame]),
                    score: value.score,
                    ordinary: value.ordinary,
                    event: value.event,
                })
            })
            .collect()
    }
    pub(crate) fn plan(
        frames: &[u64],
        deltas: &[f32],
        drawing: &[(u64, u64)],
    ) -> Result<Vec<Transition>> {
        ensure!(
            deltas.len() == frames.len().saturating_sub(1),
            "Invalid native scene measurements"
        );
        if frames.len() < 2 {
            return Ok(Vec::new());
        }
        #[derive(Serialize)]
        struct Request<'a> {
            version: u8,
            times: Times<'a>,
            deltas: &'a [f32],
            drawing: Drawing<'a>,
        }
        let mut input = worker::private_json(&Request {
            version: 1,
            times: Times(frames),
            deltas,
            drawing: Drawing(drawing),
        })?;
        if let Some(Ok(transitions)) = record_policy::evaluate_file(
            "nativeScenes", &mut input, 16 * 1024 * 1024,
        )?.map(|bytes| decode(bytes.as_bytes(), frames)) {
            return Ok(transitions);
        }
        let (node, worker) = worker::policy_assets(
            "Record scene selection",
            "record-media",
            "selection/scene-worker.js",
        )?;
        let bytes = worker::run_with_input(
            Command::new(node)
                .env("ELECTRON_RUN_AS_NODE", "1")
                .arg(worker),
            input,
            Duration::from_secs(10),
            16 * 1024 * 1024,
        )?;
        decode(&bytes, frames)
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        #[test]
        fn scene_reply_is_bound_to_native_indices_clocks_and_finite_measurements() {
            let frames = [1, u64::MAX];
            let value = serde_json::json!({"version":1,"frameCount":2,"firstTime":"1","lastTime":u64::MAX.to_string(),"transitions":[{"startFrame":0,"frame":1,"diff":0.5,"score":60,"ordinary":true,"event":"scene changed"}]});
            let good = serde_json::to_vec(&value).unwrap();
            assert_eq!(decode(&good, &frames).unwrap()[0].span, (1, u64::MAX));
            for (field, bad) in [
                ("frameCount", serde_json::json!(3)),
                ("version", serde_json::json!(2)),
                ("firstTime", serde_json::json!("01")),
            ] {
                let mut changed = value.clone();
                changed[field] = bad;
                assert!(decode(&serde_json::to_vec(&changed).unwrap(), &frames).is_err());
            }
            for (field, bad) in [
                ("frame", serde_json::json!(2)),
                ("startFrame", serde_json::json!(1)),
                ("diff", serde_json::json!(-0.5)),
                ("score", serde_json::json!(-1)),
                ("event", serde_json::json!("x".repeat(513))),
            ] {
                let mut changed = value.clone();
                changed["transitions"][0][field] = bad;
                assert!(decode(&serde_json::to_vec(&changed).unwrap(), &frames).is_err());
            }
        }
    }
}

pub(crate) mod frame_labels {
    use crate::shared::model::{Keyframe, format_clock};
    use anyhow::{Context, Result};

    const PRECISION: [u8; 4] = include!("../record/media/src/assembly/frame-label.json");

    pub(crate) fn prefix(frame: &Keyframe) -> String {
        frame.display_time.clone().unwrap_or_else(|| format!("- #{} ({})", frame.index, format_clock(frame.t)))
    }

    pub(crate) fn resolve(frames: &[Keyframe], reference: Option<&str>) -> Result<Option<usize>> {
        reference.map(|value| {
            value.parse::<usize>().ok().or_else(|| {
                frames.iter().find(|key| key.display_time.as_deref() == Some(value)).map(|key| key.index)
            }).with_context(|| format!("No keyframe matches {value}"))
        }).transpose()
    }

    fn label(time: u64, earlier_equal: usize, same_second: bool, same_time: bool) -> String {
        let clock = format_clock(time);
        match PRECISION[usize::from(same_second) | (usize::from(same_time) << 1)] {
            0 => clock,
            1 => format!("{clock}.{:03}", time % 1_000),
            _ => format!("{clock}.{:03}/{}", time % 1_000, earlier_equal + 1),
        }
    }

    pub(crate) fn stamp<T>(frames: &mut [(Keyframe, T)]) {
        let times: Vec<_> = frames.iter().map(|(frame, _)| frame.t).collect();
        for (i, (frame, _)) in frames.iter_mut().enumerate() {
            let others = times.iter().enumerate().filter(|(j, _)| *j != i);
            frame.display_time = Some(label(
                frame.t,
                times[..i].iter().filter(|&&t| t == frame.t).count(),
                others.clone().any(|(_, &t)| t / 1_000 == frame.t / 1_000),
                others.into_iter().any(|(_, &t)| t == frame.t),
            ));
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use crate::shared::model::KeyframeReason;

        #[test]
        fn compact_frame_times_disambiguate_and_keep_published_labels_when_appending() {
            let mut frames: Vec<_> = [1200, 1530, 1530, 4000].into_iter().enumerate().map(|(i, t)| {
                (Keyframe {
                    index: i + 1, t, display_time: None, reason: KeyframeReason::Initial,
                    file: format!("frames/frame-{:02}.png", i + 1), event: String::new(),
                    said: None, mark_id: None, cursor: None,
                }, ())
            }).collect();
            stamp(&mut frames);
            let labels: Vec<_> = frames.iter().map(|(key, _)| key.display_time.as_deref().unwrap()).collect();
            assert_eq!(labels, ["0:01.200", "0:01.530/1", "0:01.530/2", "0:04"]);
            let keys: Vec<_> = frames.into_iter().map(|(key, _)| key).collect();
            assert_eq!(appended(&keys, 4_001).as_deref(), Some("0:04.001"));
            assert_eq!(appended(&keys, 1_530).as_deref(), Some("0:01.530/3"));
        assert_eq!(resolve(&keys, Some("0:01.530/2")).unwrap(), Some(3));
        assert_eq!(resolve(&keys, Some("3")).unwrap(), Some(3));
        assert!(resolve(&keys, Some("0:03")).is_err());
    }

    #[test]
    fn compact_handoff_puts_words_before_access_and_retains_fallbacks() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::Builder::new().permissions(std::fs::Permissions::from_mode(0o700)).tempdir().unwrap();
        let (_, bundle, _) = crate::capture::desktop::demo::generate_demo_bundle(
            Some(dir.path().join("sample.apparent")),
        ).unwrap();
        let path = dir.path().join("sample.apparent");
        assert!(!bundle.keyframes.is_empty());
        assert!(bundle.keyframes.iter().all(|frame| frame.display_time.is_some()));
        let pointer = "apparent inspect 0123456789abcdef0123456789abcdef\n";
        for hosted in [Some(pointer), None] {
            let prompt = crate::shared::handoff::clipboard_summary_with_access(&bundle, &path, hosted);
            assert!(prompt.find("When I click").unwrap() < prompt.find("apparent inspect").unwrap());
            assert!(prompt.contains("Inspect relevant frames before edits.\n"));
            assert!(prompt.contains("Install if missing: https://github.com/tryapparent/apparent\n"));
            assert_eq!(prompt.contains("apparent connect alternatives"), hosted.is_none());
            assert!(prompt.ends_with("For complex visible changes, use make-it-apparent. Share verified video or explain the blocker.\n"));
            assert!(!prompt.contains("#agents") && !prompt.contains("\n\n") && !prompt.contains("[apparent "));
        }
        }
    }

    pub(crate) fn appended(frames: &[Keyframe], time: u64) -> Option<String> {
        frames.iter().any(|frame| frame.display_time.is_some()).then(|| {
            let equal = frames.iter().filter(|frame| frame.t == time).count();
            label(time, equal, frames.iter().any(|frame| frame.t / 1_000 == time / 1_000), equal > 0)
        })
    }
}

pub(crate) mod transcript_handoff {
    use crate::shared::model::{ApparentBundle, KeyframeReason};

    const ADMIT: [bool; 4] = include!("../handoff/pure/transcript/transcript-only.json");

    pub(crate) fn words(bundle: &ApparentBundle) -> Option<&str> {
        let text = bundle.transcript.text.trim();
        let needs_visuals = bundle.interaction_telemetry.is_some()
            || bundle.image_quality_warning.is_some()
            || bundle.note.as_ref().is_some_and(|note| !note.trim().is_empty())
            || !bundle.events.is_empty()
            || !bundle.marks.is_empty()
            || !bundle.strokes.is_empty()
            || !bundle.context_changes.is_empty()
            || bundle.screens.len() > 1
            || bundle.windows.len() > 1
            || bundle.cursor.len() > 1
            || bundle.keyframes.iter().any(|key| {
                !matches!(key.reason, KeyframeReason::Initial | KeyframeReason::Speech)
            });
        let index = usize::from(!text.is_empty()) | (usize::from(needs_visuals) << 1);
        ADMIT[index].then_some(text)
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use std::os::unix::fs::PermissionsExt;

        #[test]
        fn voice_only_requires_words_and_no_visual_evidence() {
            let dir = tempfile::Builder::new().permissions(std::fs::Permissions::from_mode(0o700)).tempdir().unwrap();
            let (_, mut bundle, _) = crate::capture::desktop::demo::generate_demo_bundle(
                Some(dir.path().join("speech.apparent")),
            ).unwrap();
            assert_eq!(words(&bundle), None);
            bundle.note = None;
            bundle.events.clear();
            bundle.strokes.clear();
            bundle.marks.clear();
            bundle.keyframes.truncate(1);
            bundle.keyframes[0].reason = KeyframeReason::Speech;
            assert_eq!(
                crate::shared::handoff::clipboard_payload(&bundle, &dir.path().join("speech.apparent")),
                (bundle.transcript.text.trim().into(), false),
            );
            bundle.interaction_telemetry = Some(crate::shared::model::InteractionTelemetry::VideoOnly);
            assert_eq!(words(&bundle), None);
            bundle.interaction_telemetry = None;
            bundle.transcript.text.clear();
            assert_eq!(words(&bundle), None);
        }
    }
}
