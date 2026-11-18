//! Read-only Record allocation; native code validates its rendering resource envelope.
use anyhow::{Context, Result, ensure};
use serde::Deserialize;
use std::{process::Command, time::Duration};
use crate::capture::engine::{keyframes::SelectionLimits, render::MAX_SHEET_TILES};

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
    let (node, worker) = super::worker::policy_assets("Record assembly", "record-media", "assembly-worker.js")?;
    let bytes = super::worker::run(Command::new(node).env("ELECTRON_RUN_AS_NODE", "1")
        .arg(worker).arg(duration_ms.to_string()), Duration::from_secs(5), 1024)?;
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
    use crate::shared::model::RgbaFrame;
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
    struct Times<'a>(&'a [&'a RgbaFrame]);
    impl Serialize for Times<'_> {
        fn serialize<S: serde::Serializer>(
            &self,
            serializer: S,
        ) -> std::result::Result<S::Ok, S::Error> {
            let mut sequence = serializer.serialize_seq(Some(self.0.len()))?;
            for frame in self.0 {
                sequence.serialize_element(&frame.t_ms.to_string())?;
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
    fn decode(bytes: &[u8], frames: &[&RgbaFrame]) -> Result<Vec<Transition>> {
        let reply: Reply = serde_json::from_slice(bytes).context("Invalid Record scene plan")?;
        ensure!(
            reply.version == 1
                && reply.frame_count == frames.len()
                && reply.first_time == frames.first().map_or(0, |f| f.t_ms).to_string()
                && reply.last_time == frames.last().map_or(0, |f| f.t_ms).to_string(),
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
                    span: (frames[value.start_frame].t_ms, frames[value.frame].t_ms),
                    score: value.score,
                    ordinary: value.ordinary,
                    event: value.event,
                })
            })
            .collect()
    }
    pub(crate) fn plan(
        frames: &[&RgbaFrame],
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
        let input = super::super::worker::private_json(&Request {
            version: 1,
            times: Times(frames),
            deltas,
            drawing: Drawing(drawing),
        })?;
        let (node, worker) = super::super::worker::policy_assets(
            "Record scene selection",
            "record-media",
            "selection/scene-worker.js",
        )?;
        let bytes = super::super::worker::run_with_input(
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
            let a = RgbaFrame::new(1, 1, 1, vec![0, 0, 0, 255]);
            let b = RgbaFrame::new(u64::MAX, 1, 1, vec![255; 4]);
            let frames = vec![&a, &b];
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
