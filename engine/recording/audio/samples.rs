pub struct Samples {
    data: Vec<f32>,
    total: usize,
    #[cfg(target_os = "linux")]
    clock: Option<Instant>,
    #[cfg(target_os = "linux")]
    initial_silence: usize,
}
impl Default for Samples {
    fn default() -> Self {
        Self {
            data: vec![0.0; 2 * HISTORY],
            total: 0,
            #[cfg(target_os = "linux")]
            clock: None,
            #[cfg(target_os = "linux")]
            initial_silence: 0,
        }
    }
}
impl Samples {
    #[cfg(target_os = "linux")]
    pub(super) fn use_clock(&mut self, clock: Instant) {
        self.clock = Some(clock);
    }

    #[cfg(target_os = "linux")]
    pub(super) fn align_first_input(&mut self, first_sample: impl FnOnce() -> Instant) {
        if let Some(clock) = self.clock.take() {
            let offset = first_sample().saturating_duration_since(clock);
            self.initial_silence = (offset.as_nanos() * RATE as u128 / 1_000_000_000)
                .try_into()
                .unwrap_or(usize::MAX / 2);
            self.total = self.initial_silence;
        }
    }

    pub fn len(&self) -> usize {
        self.total
    }
    pub fn is_empty(&self) -> bool {
        self.total == 0
    }
    pub fn clear(&mut self) {
        self.total = 0;
    }
    pub fn push(&mut self, value: f32) {
        let at = self.total % HISTORY;
        self.data[at] = value;
        self.data[at + HISTORY] = value;
        self.total += 1;
    }
    pub fn extend(&mut self, values: impl IntoIterator<Item = f32>) {
        for value in values {
            self.push(value);
        }
    }
    pub fn extend_from_slice(&mut self, values: &[f32]) {
        self.extend(values.iter().copied());
    }
    pub fn get(&self, range: impl RangeBounds<usize>) -> Option<&[f32]> {
        let start = match range.start_bound() {
            Bound::Included(&v) => v,
            Bound::Excluded(&v) => v.checked_add(1)?,
            Bound::Unbounded => 0,
        };
        let end = match range.end_bound() {
            Bound::Included(&v) => v.checked_add(1)?,
            Bound::Excluded(&v) => v,
            Bound::Unbounded => self.total,
        };
        if start < self.total.saturating_sub(HISTORY) || end > self.total || end < start {
            return None;
        }
        let at = start % HISTORY;
        Some(&self.data[at..at + end - start])
    }
    pub fn recent(&self) -> &[f32] {
        self.get(self.total.saturating_sub(HISTORY)..).unwrap()
    }
}
impl From<Vec<f32>> for Samples {
    fn from(values: Vec<f32>) -> Self {
        let mut s = Self::default();
        s.extend(values);
        s
    }
}
impl std::ops::Deref for Samples {
    type Target = [f32];
    fn deref(&self) -> &[f32] {
        self.recent()
    }
}

fn write_stream(
    file: &mut File,
    samples: &Mutex<Samples>,
    receiver: std::sync::mpsc::Receiver<()>,
) -> Result<()> {
    let mut written: usize = 0;
    let mut synced = Instant::now();
    let mut catching_up = false;
    loop {
        let stopping = matches!(
            receiver.recv_timeout(if catching_up { Duration::ZERO } else { POLL }),
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected)
        );
        let bytes: Vec<u8> = {
            let buffer = samples
                .lock()
                .map_err(|_| anyhow!("Narration buffer poisoned"))
                .stage(Stage::AudioSampleState)?;
            #[cfg(target_os = "linux")]
            let end = if written < buffer.initial_silence {
                buffer.initial_silence
            } else {
                buffer.len()
            };
            #[cfg(not(target_os = "linux"))]
            let end = buffer.len();
            let end = end.min(written.saturating_add(WRITE_BATCH));
            catching_up = end < buffer.len();
            #[cfg(target_os = "linux")]
            if written < buffer.initial_silence {
                vec![0; 2 * (end - written)]
            } else {
                pcm_batch(&buffer, written, end)?
            }
            #[cfg(not(target_os = "linux"))]
            pcm_batch(&buffer, written, end)?
        };
        let data_len = written
            .checked_mul(2)
            .and_then(|n| n.checked_add(bytes.len()))
            .context("Narration length overflow")
            .stage(Stage::AudioWriterLength)?;
        if data_len > u32::MAX as usize - 36 {
            return Err(anyhow!("Narration exceeds WAV size limit"))
                .stage(Stage::AudioWriterLength);
        }
        file.write_all(&bytes)
            .map_err(anyhow::Error::from)
            .stage(Stage::AudioWriterWrite)?;
        written += bytes.len() / 2;
        if (stopping && !catching_up) || synced.elapsed() >= SYNC {
            checkpoint(file, (written * 2) as u32).stage(Stage::AudioWriterCheckpoint)?;
            synced = Instant::now();
        }
        if stopping && !catching_up {
            return Ok(());
        }
    }
}

fn pcm_batch(buffer: &Samples, start: usize, end: usize) -> Result<Vec<u8>> {
    Ok(buffer
        .get(start..end)
        .context("Narration history expired")
        .stage(Stage::AudioWriterHistory)?
        .iter()
        .flat_map(|&s| super::audio::pcm16(s).to_le_bytes())
        .collect())
}
