use super::{FinishPhase, Record};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub(super) enum Stage {
    #[default]
    Starting,
    Idle,
    Recording,
    Shortcut,
    Finishing,
    Saved,
    Cancelled,
    UnexpectedReturn,
}

pub(super) fn stage(line: &[u8]) -> Option<Stage> {
    let line = std::str::from_utf8(line).ok()?;
    let (stamp, message) = line.strip_prefix('[')?.split_once("] ")?;
    if !stamp.bytes().all(|c| c.is_ascii_digit()) {
        return None;
    }
    if message.starts_with("run_app started pid=") {
        Some(Stage::Idle)
    } else if message.starts_with("Recording ") {
        Some(Stage::Recording)
    } else if message == "emit_capture_shortcut" {
        Some(Stage::Shortcut)
    } else if message == "finish_recording invoked" {
        Some(Stage::Finishing)
    } else if message.starts_with("finish timings: ") {
        Some(Stage::Saved)
    } else if message == "cancel_recording invoked" {
        Some(Stage::Cancelled)
    } else if message == "native_event_loop_ended_during_capture" {
        Some(Stage::UnexpectedReturn)
    } else {
        None
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum Observation {
    Stage(Stage),
    FinishPhase(FinishPhase),
}

impl Observation {
    pub(super) fn read(line: &[u8]) -> Option<Self> {
        if line.starts_with(b"apparent-native-finish: ") {
            FinishPhase::from_marker(line).map(Self::FinishPhase)
        } else {
            stage(line).map(Self::Stage)
        }
    }

    pub(super) fn apply(self, record: &mut Record, elapsed_ms: u64) -> bool {
        let changed = match self {
            Self::Stage(next) => {
                let changed = record.stage != next;
                record.stage = next;
                let reset_finish = matches!(
                    next,
                    Stage::Idle | Stage::Recording | Stage::Finishing | Stage::Cancelled
                ) && record.finish_phase.take().is_some();
                changed || reset_finish
            }
            Self::FinishPhase(next) => {
                if record.consent.is_none() || record.finish_phase == Some(next) {
                    return false;
                }
                record.finish_phase = Some(next);
                true
            }
        };
        if changed && record.consent.is_some() {
            record.trace.push(self, elapsed_ms);
        }
        changed
    }
}

const MAX_STEPS: usize = 8;

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(transparent)]
pub(super) struct Trace(VecDeque<Step>);

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Step {
    elapsed_ms: u64,
    checkpoint: Observation,
}

impl Trace {
    pub(super) fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    pub(super) fn is_bounded(&self) -> bool {
        self.0.len() <= MAX_STEPS
    }

    fn push(&mut self, checkpoint: Observation, elapsed_ms: u64) {
        if self.0.len() == MAX_STEPS {
            self.0.pop_front();
        }
        self.0.push_back(Step {
            elapsed_ms,
            checkpoint,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trace_retains_only_the_most_recent_eight_transitions() {
        let mut trace = Trace::default();
        for elapsed_ms in 0..20 {
            trace.push(Observation::Stage(Stage::Shortcut), elapsed_ms);
        }
        let steps = serde_json::to_value(&trace).unwrap();
        assert_eq!(steps.as_array().unwrap().len(), 8);
        assert_eq!(steps[0]["elapsed_ms"], 12);
        assert_eq!(steps[7]["elapsed_ms"], 19);
    }
}
