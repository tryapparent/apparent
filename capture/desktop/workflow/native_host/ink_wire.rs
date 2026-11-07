//! Fixed privileged source operations; never renderer points or geometry.
use serde::Deserialize;
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Binding {
    pub capture_id: String,
    pub producer_id: String,
    pub generation: u64,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Clock {
    pub boot_id: String,
    pub admission_monotonic_ns: String,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Source {
    pub id: String,
    pub generation: String,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum PaperIntent {
    Open,
    Undo,
    Clear,
    Close,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(
    tag = "action",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub(crate) enum Command {
    Observe {
        capture_id: String,
        source: Source,
    },
    Activate {
        binding: Binding,
        clock: Clock,
    },
    /// Coordinator-only continuation after opening the real donor overlay.
    ArmInput {
        binding: Binding,
    },
    ReadBatch {
        binding: Binding,
        sequence: u32,
    },
    AcknowledgeBatch {
        binding: Binding,
        sequence: u32,
        batch_sha256: String,
    },
    SealInputAndDrain {
        binding: Binding,
    },
    ReadBoard {
        binding: Binding,
    },
    BoardControl {
        binding: Binding,
        intent: PaperIntent,
        expected_native_revision: u64,
    },
}
fn hex(s: &str, n: usize) -> bool {
    s.len() == n
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
impl Command {
    pub(crate) fn valid(&self) -> bool {
        let binding = match self {
            Self::Observe { capture_id, source } => {
                return hex(capture_id, 32)
                    && [&source.id, &source.generation].iter().all(|s| {
                        !s.is_empty() && s.len() <= 1024 && !s.chars().any(char::is_control)
                    });
            }
            Self::Activate { binding, clock } => {
                if clock.boot_id.len() != 36
                    || clock.admission_monotonic_ns.is_empty()
                    || !clock
                        .admission_monotonic_ns
                        .bytes()
                        .all(|b| b.is_ascii_digit())
                    || (clock.admission_monotonic_ns.len() > 1
                        && clock.admission_monotonic_ns.starts_with('0'))
                    || clock.admission_monotonic_ns.parse::<u64>().is_err()
                {
                    return false;
                }
                binding
            }
            Self::ReadBatch { binding, sequence } => {
                if *sequence >= 4096 {
                    return false;
                }
                binding
            }
            Self::AcknowledgeBatch {
                binding,
                sequence,
                batch_sha256,
            } => {
                if *sequence >= 4096 || !hex(batch_sha256, 64) {
                    return false;
                }
                binding
            }
            Self::SealInputAndDrain { binding } => binding,
            Self::ReadBoard { binding } => binding,
            // Only the coordinator constructs this continuation after the real
            // presentation is prepared. It is never an admitted wire command.
            Self::ArmInput { .. } => return false,
            Self::BoardControl {
                binding,
                expected_native_revision,
                ..
            } => {
                if *expected_native_revision > 9_007_199_254_740_991 {
                    return false;
                }
                binding
            }
        };
        hex(&binding.capture_id, 32) && hex(&binding.producer_id, 32) && binding.generation == 1
    }
}
