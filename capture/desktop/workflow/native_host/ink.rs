//! Bounded retention for native-created ink batches.
//!
//! This module is a private source buffer. It does not interpret events or
//! claim that a platform input/effect was observed. Its caller may seal only
//! after the native callback source has actually drained.

use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::VecDeque;

const MAX_BATCH_BYTES: usize = 16 * 1024;
const MAX_BATCHES: usize = 4096;
const MAX_RETAINED_BYTES: usize = 4 * 1024 * 1024;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct InkBatch {
    pub(crate) sequence: u32,
    /// Exact UTF-8 JSON bytes serialized once by this source buffer.
    pub(crate) events_json: String,
    /// Lowercase SHA-256 of `events_json.as_bytes()`.
    pub(crate) batch_sha256: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct NativeSeal {
    pub(crate) observed_at_ns: String,
    pub(crate) native_revision: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum InkSourceState {
    Accepting,
    SealedAndDrained(NativeSeal),
    Unavailable,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum InkBufferError {
    Unavailable,
    Sealed,
    Serialization,
    EmptyBatch,
    BatchTooLarge,
    BatchLimit,
    RetentionLimit,
    SequenceExhausted,
    NoPendingBatch,
    AckMismatch,
}

/// Owns exact source batches until an exact sequence/digest acknowledgment.
#[derive(Debug)]
pub(crate) struct InkSourceBuffer {
    state: InkSourceState,
    pending: VecDeque<InkBatch>,
    next_sequence: u32,
    total_batches: usize,
    retained_bytes: usize,
    last_sequence: Option<u32>,
}

impl Default for InkSourceBuffer {
    fn default() -> Self {
        Self::new()
    }
}

impl InkSourceBuffer {
    pub(crate) fn new() -> Self {
        Self {
            state: InkSourceState::Accepting,
            pending: VecDeque::new(),
            next_sequence: 0,
            total_batches: 0,
            retained_bytes: 0,
            last_sequence: None,
        }
    }

    pub(crate) fn state(&self) -> &InkSourceState {
        &self.state
    }

    /// Serializes one native-created JSON event array once and retains it
    /// unchanged. Any invalid input or capacity failure makes collection
    /// unavailable while preserving earlier unacknowledged source data.
    pub(crate) fn retain<T: Serialize>(&mut self, events: &[T]) -> Result<u32, InkBufferError> {
        match self.state {
            InkSourceState::Accepting => {}
            InkSourceState::SealedAndDrained(_) => return self.fail(InkBufferError::Sealed),
            InkSourceState::Unavailable => return Err(InkBufferError::Unavailable),
        }

        if events.is_empty() {
            return self.fail(InkBufferError::EmptyBatch);
        }
        let events_json = match serde_json::to_string(events) {
            Ok(json) => json,
            Err(_) => return self.fail(InkBufferError::Serialization),
        };
        let bytes = events_json.len();
        if bytes > MAX_BATCH_BYTES {
            return self.fail(InkBufferError::BatchTooLarge);
        }
        if self.total_batches >= MAX_BATCHES {
            return self.fail(InkBufferError::BatchLimit);
        }
        if self.retained_bytes.saturating_add(bytes) > MAX_RETAINED_BYTES {
            return self.fail(InkBufferError::RetentionLimit);
        }
        let sequence = self.next_sequence;
        let Some(next_sequence) = sequence.checked_add(1) else {
            return self.fail(InkBufferError::SequenceExhausted);
        };
        let digest = Sha256::digest(events_json.as_bytes());
        let batch_sha256 = digest.iter().map(|byte| format!("{byte:02x}")).collect();
        self.pending.push_back(InkBatch {
            sequence,
            events_json,
            batch_sha256,
        });
        self.next_sequence = next_sequence;
        self.last_sequence = Some(sequence);
        self.total_batches += 1;
        self.retained_bytes += bytes;
        Ok(sequence)
    }

    /// Returns the first unacknowledged batch. Repeated reads return identical
    /// bytes until that exact batch is acknowledged.
    pub(crate) fn read_pending(&self) -> Option<&InkBatch> {
        self.pending.front()
    }

    pub(crate) fn acknowledge(
        &mut self,
        sequence: u32,
        batch_sha256: &str,
    ) -> Result<(), InkBufferError> {
        if self.state == InkSourceState::Unavailable {
            return Err(InkBufferError::Unavailable);
        }
        let Some(batch) = self.pending.front() else {
            return Err(InkBufferError::NoPendingBatch);
        };
        if batch.sequence != sequence || batch.batch_sha256 != batch_sha256 {
            return Err(InkBufferError::AckMismatch);
        }
        let batch = self.pending.pop_front().expect("front checked above");
        self.retained_bytes -= batch.events_json.len();
        Ok(())
    }

    /// Call only after the native callback source has independently drained.
    pub(crate) fn seal_after_native_drain(
        &mut self,
        observed_at_ns: String,
        native_revision: u64,
    ) -> Result<(), InkBufferError> {
        match self.state {
            InkSourceState::Accepting => {
                if !is_canonical_u64(&observed_at_ns) {
                    return self.fail(InkBufferError::Serialization);
                }
                self.state = InkSourceState::SealedAndDrained(NativeSeal {
                    observed_at_ns,
                    native_revision,
                });
                Ok(())
            }
            InkSourceState::SealedAndDrained(_) => Err(InkBufferError::Sealed),
            InkSourceState::Unavailable => Err(InkBufferError::Unavailable),
        }
    }

    /// `None` means the native source genuinely produced no batches.
    pub(crate) fn final_sequence(&self) -> Option<u32> {
        self.last_sequence
    }

    pub(crate) fn retained_bytes(&self) -> usize {
        self.retained_bytes
    }

    fn fail<T>(&mut self, error: InkBufferError) -> Result<T, InkBufferError> {
        self.state = InkSourceState::Unavailable;
        // Preserve bounded original unacknowledged evidence after collection fails.
        Err(error)
    }
}

fn is_canonical_u64(value: &str) -> bool {
    !value.is_empty()
        && value.bytes().all(|byte| byte.is_ascii_digit())
        && (value == "0" || !value.starts_with('0'))
        && value.parse::<u64>().is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Serialize;

    #[derive(Serialize)]
    struct Event<'a> {
        text: &'a str,
    }

    #[test]
    fn retains_exact_serialization_and_requires_exact_ack() {
        let mut buffer = InkSourceBuffer::new();
        assert_eq!(buffer.retain(&[Event { text: "λ" }]), Ok(0));
        let first = buffer.read_pending().unwrap().clone();
        assert_eq!(buffer.read_pending(), Some(&first));
        assert_eq!(first.events_json, "[{\"text\":\"λ\"}]");
        assert_eq!(first.batch_sha256.len(), 64);
        assert!(
            first
                .batch_sha256
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        );
        assert_eq!(
            buffer.acknowledge(1, &first.batch_sha256),
            Err(InkBufferError::AckMismatch)
        );
        assert_eq!(
            buffer.acknowledge(0, "wrong"),
            Err(InkBufferError::AckMismatch)
        );
        assert_eq!(buffer.read_pending(), Some(&first));
        buffer.acknowledge(0, &first.batch_sha256).unwrap();
        assert!(buffer.read_pending().is_none());
    }

    #[test]
    fn sequences_batches_and_seals_with_original_native_stamp() {
        let mut buffer = InkSourceBuffer::new();
        assert_eq!(buffer.final_sequence(), None);
        assert_eq!(buffer.retain(&[Event { text: "a" }]), Ok(0));
        assert_eq!(buffer.retain(&[Event { text: "b" }]), Ok(1));
        assert_eq!(buffer.final_sequence(), Some(1));
        buffer.seal_after_native_drain("123".into(), 9).unwrap();
        assert_eq!(
            buffer.state(),
            &InkSourceState::SealedAndDrained(NativeSeal {
                observed_at_ns: "123".into(),
                native_revision: 9,
            })
        );
        assert_eq!(
            buffer.retain(&[Event { text: "c" }]),
            Err(InkBufferError::Sealed)
        );
        assert_eq!(buffer.state(), &InkSourceState::Unavailable);
    }

    #[test]
    fn zero_batch_seal_keeps_null_final_sequence() {
        let mut buffer = InkSourceBuffer::new();
        buffer.seal_after_native_drain("0".into(), 0).unwrap();
        assert_eq!(buffer.final_sequence(), None);
    }

    #[test]
    fn oversized_batch_fails_closed_without_truncation() {
        let mut buffer = InkSourceBuffer::new();
        let too_large = "x".repeat(MAX_BATCH_BYTES);
        assert_eq!(
            buffer.retain(&[Event { text: &too_large }]),
            Err(InkBufferError::BatchTooLarge)
        );
        assert_eq!(buffer.state(), &InkSourceState::Unavailable);
        assert!(buffer.read_pending().is_none());
        assert_eq!(
            buffer.retain(&[] as &[Event<'_>]),
            Err(InkBufferError::Unavailable)
        );
    }

    #[test]
    fn batch_count_and_aggregate_retention_are_bounded() {
        let mut count_limited = InkSourceBuffer::new();
        for expected in 0..MAX_BATCHES as u32 {
            assert_eq!(
                count_limited.retain(&[Event { text: "event" }]),
                Ok(expected)
            );
        }
        assert_eq!(
            count_limited.retain(&[Event { text: "event" }]),
            Err(InkBufferError::BatchLimit)
        );
        assert_eq!(count_limited.state(), &InkSourceState::Unavailable);

        let mut byte_limited = InkSourceBuffer::new();
        let text = "y".repeat(15_000);
        let batch_bytes = serde_json::to_string(&[Event { text: &text }])
            .unwrap()
            .len();
        for _ in 0..(MAX_RETAINED_BYTES / batch_bytes) {
            byte_limited.retain(&[Event { text: &text }]).unwrap();
        }
        assert!(byte_limited.retained_bytes() <= MAX_RETAINED_BYTES);
        assert_eq!(
            byte_limited.retain(&[Event { text: &text }]),
            Err(InkBufferError::RetentionLimit)
        );
        assert_eq!(byte_limited.state(), &InkSourceState::Unavailable);
        assert!(byte_limited.retained_bytes() > 0);
        assert!(byte_limited.retained_bytes() <= MAX_RETAINED_BYTES);
        assert!(byte_limited.read_pending().is_some());
    }

    #[test]
    fn invalid_batch_preserves_original_unacknowledged_bytes() {
        let mut buffer = InkSourceBuffer::new();
        buffer.retain(&[Event { text: "original" }]).unwrap();
        let original = buffer.read_pending().unwrap().clone();
        assert_eq!(
            buffer.retain(&[] as &[Event<'_>]),
            Err(InkBufferError::EmptyBatch)
        );
        assert_eq!(buffer.state(), &InkSourceState::Unavailable);
        assert_eq!(buffer.read_pending(), Some(&original));
        assert_eq!(
            buffer.acknowledge(original.sequence, &original.batch_sha256),
            Err(InkBufferError::Unavailable)
        );
        assert_eq!(buffer.final_sequence(), Some(0));
    }

    #[test]
    fn invalid_seal_and_ack_after_empty_are_rejected() {
        let mut buffer = InkSourceBuffer::new();
        assert_eq!(
            buffer.acknowledge(0, "0"),
            Err(InkBufferError::NoPendingBatch)
        );
        assert_eq!(
            buffer.seal_after_native_drain("01".into(), 3),
            Err(InkBufferError::Serialization)
        );
        assert_eq!(buffer.state(), &InkSourceState::Unavailable);
    }
}
