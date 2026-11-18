use std::io::Write;

pub(crate) struct Samples {
    pub(crate) start: u64,
    pub(crate) values: Vec<f32>,
}

pub(crate) trait Track {
    fn next(&mut self) -> Result<Option<Samples>, &'static str>;
}

struct Cursor {
    source: Box<dyn Track>,
    block: Option<Samples>,
    previous_end: u64,
    ended: bool,
}

impl Cursor {
    fn next_sample(&mut self, position: u64, limit: u64) -> Result<Option<f32>, &'static str> {
        if self.ended {
            return Ok(None);
        }
        if self.block.is_none() || position >= self.previous_end {
            let Some(block) = self.source.next()? else {
                self.ended = true;
                self.block = None;
                return Ok(None);
            };
            let end = block
                .start
                .checked_add(block.values.len() as u64)
                .ok_or("resource_limit")?;
            if end > limit {
                return Err("resource_limit");
            }
            if block.values.is_empty() || block.start < self.previous_end || end <= position {
                return Err("decode_failed");
            }
            self.previous_end = end;
            self.block = Some(block);
        }
        let block = self.block.as_ref().ok_or("decode_failed")?;
        if position < block.start {
            return Ok(Some(0.0));
        }
        let value = block.values[(position - block.start) as usize];
        if !value.is_finite() {
            return Err("decode_failed");
        }
        Ok(Some(value))
    }
}

pub(crate) fn mix(
    tracks: Vec<Box<dyn Track>>,
    limit: u64,
    mut output: impl Write,
) -> Result<u64, &'static str> {
    let mut tracks: Vec<_> = tracks
        .into_iter()
        .map(|source| Cursor {
            source,
            block: None,
            previous_end: 0,
            ended: false,
        })
        .collect();
    let mut position = 0;
    let mut bytes = Vec::with_capacity(16_384);
    loop {
        let mut sum = 0.0_f64;
        let mut active = false;
        for track in &mut tracks {
            if let Some(sample) = track.next_sample(position, limit)? {
                active = true;
                sum += f64::from(sample);
            }
        }
        if !active {
            break;
        }
        let sample = (sum * 32768.0).round().clamp(-32768.0, 32767.0) as i16;
        bytes.extend_from_slice(&sample.to_le_bytes());
        position += 1;
        if bytes.len() == 16_384 {
            output.write_all(&bytes).map_err(|_| "decode_failed")?;
            bytes.clear();
        }
    }
    output.write_all(&bytes).map_err(|_| "decode_failed")?;
    output.flush().map_err(|_| "decode_failed")?;
    Ok(position)
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture(std::vec::IntoIter<Samples>);

    impl Track for Fixture {
        fn next(&mut self) -> Result<Option<Samples>, &'static str> {
            Ok(self.0.next())
        }
    }

    fn track(blocks: Vec<Samples>) -> Box<dyn Track> {
        Box::new(Fixture(blocks.into_iter()))
    }

    #[test]
    fn mixes_unclamped_floats_across_distinct_movie_gaps() {
        let tracks = vec![
            track(vec![
                Samples {
                    start: 1,
                    values: vec![1.5, 0.25],
                },
                Samples {
                    start: 5,
                    values: vec![0.25],
                },
            ]),
            track(vec![Samples {
                start: 0,
                values: vec![0.5, -1.25, 0.125, 0.5],
            }]),
        ];
        let mut out = Vec::new();
        assert_eq!(mix(tracks, 6, &mut out), Ok(6));
        let values: Vec<_> = out
            .chunks_exact(2)
            .map(|sample| i16::from_le_bytes(sample.try_into().unwrap()))
            .collect();
        assert_eq!(values, [16384, 8192, 12288, 16384, 0, 8192]);
    }

    #[test]
    fn refuses_overlapping_samples_and_output_over_budget() {
        let mut out = Vec::new();
        let over = track(vec![Samples {
            start: 2,
            values: vec![0.5],
        }]);
        assert_eq!(mix(vec![over], 2, &mut out), Err("resource_limit"));
        let overlapping = track(vec![
            Samples {
                start: 0,
                values: vec![0.25, 0.5],
            },
            Samples {
                start: 1,
                values: vec![0.5, 0.5],
            },
        ]);
        assert_eq!(mix(vec![overlapping], 3, &mut out), Err("decode_failed"));
        assert!(out.is_empty());
    }
}
