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
