impl Session {
    pub fn note_badge_anchor(&self) -> Option<[f64; 4]> {
        if !self.healthy() || !self.ready() { return None; }
        {
            let (revision, rect, _) = (*self.frame.lock().ok()?)?;
            (revision == self.view.revision).then_some(rect)
        }
    }
    pub(crate) fn recording_pill_timing(&self, generation: u64) -> Option<(Instant, Instant)> {
        if self.generation != generation || self.view.phase != "recording" || !self.healthy() || !self.ready() {
            return None;
        }
        let (revision, _, reported) = (*self.frame.lock().ok()?)?;
        if revision != self.view.revision {
            return None;
        }
        let observation = self.observation.lock().ok()?;
        let (capture, flushed) = observation.first_recording_flush.as_ref()?;
        (*capture == Self::capture_key(generation)).then_some((*flushed, reported))
    }
}

fn observe_flushed_state(observation: &Mutex<Observation>, message: &serde_json::Value) {
    if message.get("type").and_then(|v| v.as_str()) == Some("state")
        && let (Some(phase), Some(revision)) = (
            message.pointer("/view/phase").and_then(|v| v.as_str()),
            message.pointer("/view/revision").and_then(|v| v.as_u64()),
        )
    {
        let mut observation = observation.lock().unwrap();
        if phase == "recording"
            && let Some(capture) = message.get("capture").and_then(serde_json::Value::as_str)
            && !observation.first_recording_flush.as_ref().is_some_and(|(key, _)| key == capture)
        {
            observation.first_recording_flush = Some((capture.to_owned(), Instant::now()));
        }
        observation.wrote_state(phase, revision);
    }
}

fn geometry_receipt(value: &serde_json::Value, frame: &serde_json::Value) -> Option<(u64, [f64; 4], Instant)> {
    let revision = value.get("revision")?.as_u64()?;
    let rect = serde_json::from_value::<[f64; 4]>(frame.clone()).ok()?;
    (rect.iter().all(|value| value.is_finite()) && rect[2] > 0.0 && rect[3] > 0.0)
        .then(|| (revision, rect, Instant::now()))
}
