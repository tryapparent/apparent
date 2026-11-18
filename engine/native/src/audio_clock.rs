#[cfg(test)]
use std::io::Write;

#[derive(Clone, Copy)]
pub(crate) struct Packet {
    pub(crate) movie_start: i64,
    pub(crate) movie_duration: u64,
    pub(crate) decoded_frames: usize,
    pub(crate) leading_trim: usize,
}

#[derive(Debug, PartialEq)]
pub(crate) enum ClockError {
    InvalidTiming,
    #[cfg(test)]
    InvalidDecodedAudio,
    ResourceLimit,
    #[cfg(test)]
    Write,
}

#[derive(Debug)]
pub(crate) struct Span {
    pub(crate) start: u64,
    pub(crate) first: usize,
    pub(crate) count: usize,
}

impl Packet {
    pub(crate) fn span(self, sample_limit: u64) -> Result<Option<Span>, ClockError> {
        if !(1..=65_536).contains(&self.decoded_frames) || self.leading_trim > self.decoded_frames {
            return Err(ClockError::InvalidTiming);
        }
        let available = (self.decoded_frames - self.leading_trim) as u64;
        let visible = available.min(self.movie_duration);
        let before_zero = if self.movie_start < 0 {
            self.movie_start.unsigned_abs().min(visible)
        } else {
            0
        };
        let count = visible - before_zero;
        if count == 0 {
            return Ok(None);
        }
        let start = self.movie_start.max(0) as u64;
        let end = start.checked_add(count).ok_or(ClockError::ResourceLimit)?;
        if end > sample_limit {
            return Err(ClockError::ResourceLimit);
        }
        Ok(Some(Span {
            start,
            first: self.leading_trim + before_zero as usize,
            count: count as usize,
        }))
    }
}

#[cfg(test)]
fn map_packets(packets: &[Packet], sample_limit: u64) -> Result<Vec<Option<Span>>, ClockError> {
    let mut previous_end = 0;
    let mut spans = Vec::with_capacity(packets.len());
    for packet in packets {
        let span = packet.span(sample_limit)?;
        if let Some(span) = &span {
            if span.start < previous_end {
                return Err(ClockError::InvalidTiming);
            }
            previous_end = span.start + span.count as u64;
        }
        spans.push(span);
    }
    Ok(spans)
}

#[cfg(test)]
fn write_track(
    decoded: &[f32],
    packets: &[Packet],
    sample_limit: u64,
    mut output: impl Write,
) -> Result<u64, ClockError> {
    let expected = packets.iter().try_fold(0_usize, |sum, packet| {
        sum.checked_add(packet.decoded_frames)
            .ok_or(ClockError::ResourceLimit)
    })?;
    if decoded.len() != expected || decoded.iter().any(|sample| !sample.is_finite()) {
        return Err(ClockError::InvalidDecodedAudio);
    }
    let spans = map_packets(packets, sample_limit)?;
    let mut cursor = 0_u64;
    let mut packet_offset = 0;
    let zero_frames = [0_u8; 4096];
    let mut bytes = Vec::new();
    for (packet, span) in packets.iter().zip(spans) {
        if let Some(span) = span {
            while cursor < span.start {
                let gap = (span.start - cursor).min((zero_frames.len() / 2) as u64);
                output
                    .write_all(&zero_frames[..gap as usize * 2])
                    .map_err(|_| ClockError::Write)?;
                cursor += gap;
            }
            let first = packet_offset + span.first;
            bytes.clear();
            for &sample in &decoded[first..first + span.count] {
                let pcm = (f64::from(sample) * 32768.0)
                    .round()
                    .clamp(-32768.0, 32767.0) as i16;
                bytes.extend_from_slice(&pcm.to_le_bytes());
            }
            output.write_all(&bytes).map_err(|_| ClockError::Write)?;
            cursor += span.count as u64;
        }
        packet_offset += packet.decoded_frames;
    }
    output.flush().map_err(|_| ClockError::Write)?;
    Ok(cursor)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_trimmed_edges_and_fills_only_witnessed_internal_gaps() {
        let packets = [
            Packet {
                movie_start: 0,
                movie_duration: 0,
                decoded_frames: 4,
                leading_trim: 4,
            },
            Packet {
                movie_start: 0,
                movie_duration: 5,
                decoded_frames: 4,
                leading_trim: 1,
            },
            Packet {
                movie_start: 5,
                movie_duration: 2,
                decoded_frames: 4,
                leading_trim: 0,
            },
        ];
        let decoded: Vec<f32> = (1..=12).map(|sample| sample as f32 / 32768.0).collect();
        let mut pcm = Vec::new();
        assert_eq!(write_track(&decoded, &packets, 7, &mut pcm), Ok(7));
        let samples: Vec<_> = pcm
            .chunks_exact(2)
            .map(|sample| i16::from_le_bytes(sample.try_into().unwrap()))
            .collect();
        assert_eq!(samples, [6, 7, 8, 0, 0, 9, 10]);
    }

    #[test]
    fn rejects_early_converter_eof_excess_pcm_and_a_tiny_budget() {
        let packets = [Packet {
            movie_start: 1,
            movie_duration: 2,
            decoded_frames: 4,
            leading_trim: 0,
        }];
        let mut pcm = Vec::new();
        for decoded in [&[0.5; 3][..], &[0.5; 5][..]] {
            assert_eq!(
                write_track(decoded, &packets, 3, &mut pcm),
                Err(ClockError::InvalidDecodedAudio)
            );
        }
        assert_eq!(
            write_track(&[0.5; 4], &packets, 2, &mut pcm),
            Err(ClockError::ResourceLimit)
        );
        assert!(pcm.is_empty());
    }
}
