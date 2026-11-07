//! Native Shift source controller. Binding/observation alone never opens input.
//! No renderer points or inferred Board geometry enter this source. The existing
//! input owner must supply the real donor callbacks; this is not a new recorder.
use super::ink::{InkBatch, InkSourceBuffer, InkSourceState, NativeSeal};
use crate::capture::engine::runtime::{
    NativeInkObservation, NativeInkObserver, SharedCaptureTelemetry,
};
use serde_json::{Value, json};
use std::sync::{Arc, Mutex};

#[derive(Clone, Debug, PartialEq)]
struct Output {
    name: String,
    rect: [f64; 4],
    monitor: isize,
}
type Clock = Arc<dyn Fn() -> Result<u64, &'static str> + Send + Sync>;
type Probe = Arc<dyn Fn() -> Result<Output, &'static str> + Send + Sync>;
fn output() -> Result<Output, &'static str> {
    let monitors = crate::capture::desktop::linux::monitors();
    if monitors.len() != 1 {
        return Err("unsupported-output");
    }
    let m = &monitors[0];
    if m.name.is_empty()
        || m.scale != 1.0
        || !m.rect.iter().all(|x| x.is_finite())
        || m.rect[2] <= 0.0
        || m.rect[3] <= 0.0
    {
        return Err("unsupported-output");
    }
    let compositor = crate::capture::desktop::linux::hyprland::ink_output_rect(&m.name)
        .ok_or("unsupported-compositor")?;
    if compositor != m.rect {
        return Err("output-mismatch");
    }
    Ok(Output {
        name: m.name.clone(),
        rect: m.rect,
        monitor: m.handle,
    })
}
fn now() -> Result<u64, &'static str> {
    let mut t = libc::timespec {
        tv_sec: 0,
        tv_nsec: 0,
    };
    if unsafe { libc::clock_gettime(libc::CLOCK_MONOTONIC, &mut t) } != 0
        || t.tv_sec < 0
        || !(0..1_000_000_000).contains(&t.tv_nsec)
    {
        return Err("clock-unavailable");
    }
    (t.tv_sec as u64)
        .checked_mul(1_000_000_000)
        .and_then(|v| v.checked_add(t.tv_nsec as u64))
        .ok_or("clock-unavailable")
}
fn id() -> Result<String, &'static str> {
    crate::capture::desktop::workflow::agent_capture::new_id().map_err(|_| "nonce-unavailable")
}
fn valid_id(s: &str) -> bool {
    s.len() == 32
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn rectangle(r: [f64; 4]) -> Value {
    json!({"x":r[0],"y":r[1],"width":r[2],"height":r[3]})
}
#[derive(Clone)]
struct Point {
    position: [f64; 2],
    time: u64,
}
struct Gesture {
    points: Vec<Point>,
    rgb: Option<[u8; 3]>,
}
#[derive(Clone, Copy, Debug, PartialEq)]
enum Phase {
    Observed,
    Active,
    Sealed,
    Unavailable,
}
struct State {
    phase: Phase,
    buffer: InkSourceBuffer,
    gesture: Option<Gesture>,
    admission: u64,
    last_time: u64,
    revision: u64,
    gestures: usize,
    points: usize,
}
struct Observer {
    state: Arc<Mutex<State>>,
    surface: Value,
    probe: Probe,
    output: Output,
}
impl NativeInkObserver for Observer {
    fn observe(&self, observation: NativeInkObservation) {
        let mut s = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if s.phase != Phase::Active {
            return;
        }
        if (self.probe)().as_ref() != Ok(&self.output) {
            s.phase = Phase::Unavailable;
            return;
        }
        let result = accept(&mut s, &self.surface, observation);
        if result.is_err() {
            s.phase = Phase::Unavailable;
        }
    }
}
fn stamp(s: &mut State, time: u64) -> Result<(), &'static str> {
    if time < s.admission || time < s.last_time {
        return Err("clock-mismatch");
    }
    s.last_time = time;
    Ok(())
}
fn accept(
    s: &mut State,
    surface: &Value,
    observation: NativeInkObservation,
) -> Result<(), &'static str> {
    match observation {
        NativeInkObservation::Point {
            first,
            position,
            observed_at_ns,
            rgb,
        } => {
            stamp(s, observed_at_ns)?;
            if !position.iter().all(|x| x.is_finite()) {
                return Err("invalid-point");
            }
            if first {
                if s.gesture.is_some() {
                    return Err("gesture-overlap");
                }
                s.gesture = Some(Gesture {
                    points: Vec::new(),
                    rgb,
                });
            }
            let gesture = s.gesture.as_mut().ok_or("missing-gesture")?;
            if gesture.points.len() >= 2400 || gesture.rgb != rgb {
                return Err("gesture-bound");
            }
            gesture.points.push(Point {
                position,
                time: observed_at_ns,
            });
        }
        NativeInkObservation::End {
            accepted,
            observed_at_ns,
        } => {
            stamp(s, observed_at_ns)?;
            let gesture = s.gesture.take().ok_or("missing-gesture")?;
            // Do not publish provisional points as accepted input. A stationary
            // Shift tap and an unfinished gesture produce no accepted history.
            if !accepted {
                return Ok(());
            }
            if gesture.points.len() < 2
                || s.gestures >= 4096
                || s.points.saturating_add(gesture.points.len()) > 65_536
            {
                return Err("history-bound");
            }
            let gesture_id = id()?;
            let first = &gesture.points[0];
            let mut begin = json!({"kind":"begin","gestureId":gesture_id,
                "surfaceId":surface["surfaceId"],"transformId":surface["transformId"],
                "nativeIncarnation":surface["nativeIncarnation"],"timeNs":first.time.to_string(),
                "x":first.position[0],"y":first.position[1]});
            if let Some(rgb) = gesture.rgb {
                begin["rgb"] = json!(rgb);
            }
            let mut groups = vec![vec![begin]];
            for points in gesture.points[1..].chunks(64) {
                let points: Vec<_> = points.iter().map(|p| json!({"timeNs":p.time.to_string(),"x":p.position[0],"y":p.position[1]})).collect();
                groups.push(vec![
                    json!({"kind":"points","gestureId":gesture_id,"points":points}),
                ]);
            }
            groups.push(vec![json!({"kind":"commit","gestureId":gesture_id,"acceptedAtNs":observed_at_ns.to_string()})]);
            if s.buffer.retain_group(&groups).is_err() {
                s.gesture = Some(gesture);
                return Err("retention-bound");
            }
            s.gestures += 1;
            s.points += gesture.points.len();
            s.revision = s.revision.checked_add(1).ok_or("revision-bound")?;
        }
        NativeInkObservation::ClockUnavailable | NativeInkObservation::CapacityExceeded => {
            return Err("native-input-unavailable");
        }
    }
    Ok(())
}

/// Owns one capture-scoped real donor observer. There is deliberately no Drop
/// release: unresolved admission must remain owned until explicit seal/drain.
pub(crate) struct NativeInkSource {
    telemetry: Arc<SharedCaptureTelemetry>,
    state: Arc<Mutex<State>>,
    observer: Arc<dyn NativeInkObserver>,
    installed: Mutex<bool>,
    capture_id: String,
    producer_id: String,
    boot: String,
    observed_output: Output,
    probe: Probe,
    clock: Clock,
    observation: Value,
}
impl NativeInkSource {
    /// `capture/source` are privileged original Engine references, not native
    /// observations. The owning host must authenticate that reference separately.
    pub(crate) fn observe(
        telemetry: Arc<SharedCaptureTelemetry>,
        process_epoch: &str,
        revision: u64,
        capture: &str,
        source_id: &str,
        source_generation: &str,
    ) -> Result<Self, &'static str> {
        if !valid_id(process_epoch)
            || !valid_id(capture)
            || source_id.is_empty()
            || source_generation.is_empty()
        {
            return Err("invalid-binding");
        }
        let boot = std::fs::read_to_string("/proc/sys/kernel/random/boot_id")
            .map_err(|_| "identity-unavailable")?
            .trim()
            .to_owned();
        if boot.len() != 36 || !boot.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-') {
            return Err("identity-unavailable");
        }
        let stat =
            std::fs::read_to_string("/proc/self/stat").map_err(|_| "identity-unavailable")?;
        let ticks = stat
            .rsplit_once(')')
            .and_then(|(_, tail)| tail.split_whitespace().nth(19))
            .ok_or("identity-unavailable")?;
        ticks.parse::<u64>().map_err(|_| "identity-unavailable")?;
        let host = json!({"processEpoch":process_epoch,"revision":revision,"pid":std::process::id(),"startTicks":ticks});
        Self::new(
            telemetry,
            capture,
            source_id,
            source_generation,
            boot,
            host,
            Arc::new(output),
        )
    }
    fn new(
        telemetry: Arc<SharedCaptureTelemetry>,
        capture: &str,
        source_id: &str,
        source_generation: &str,
        boot: String,
        host: Value,
        probe: Probe,
    ) -> Result<Self, &'static str> {
        let observed_output = probe()?;
        let producer_id = id()?;
        let surface = json!({"surfaceId":id()?,"transformId":id()?,
            "nativeIncarnation":format!("xrandr-monitor:{}:{}:{}",boot,observed_output.monitor,producer_id),
            "target":"capture-rectangle","pointSpace":"desktop-physical",
            "contentRectangle":rectangle(observed_output.rect),
            "plane":{"width":observed_output.rect[2],"height":observed_output.rect[3]}});
        let mut compositor = rectangle(observed_output.rect);
        compositor["scale"] = json!(1);
        let observation = json!({"captureId":capture,"source":{"id":source_id,"generation":source_generation},"observation":{
            "host":host,"producerId":producer_id,"generation":1,"bootId":boot,"clock":"linux-clock-monotonic-observation",
            "output":{"name":observed_output.name,"physical":rectangle(observed_output.rect),"compositor":compositor},"surfaces":[surface]}});
        let state = Arc::new(Mutex::new(State {
            phase: Phase::Observed,
            buffer: InkSourceBuffer::new(),
            gesture: None,
            admission: 0,
            last_time: 0,
            revision: 0,
            gestures: 0,
            points: 0,
        }));
        let observer = Arc::new(Observer {
            state: state.clone(),
            surface: observation["observation"]["surfaces"][0].clone(),
            probe: probe.clone(),
            output: observed_output.clone(),
        });
        Ok(Self {
            telemetry,
            state,
            observer,
            installed: Mutex::new(false),
            capture_id: capture.into(),
            producer_id,
            boot,
            observed_output,
            probe,
            clock: Arc::new(now),
            observation,
        })
    }
    pub(crate) fn observation(&self) -> &Value {
        &self.observation
    }
    pub(crate) fn activate(
        &self,
        capture: &str,
        producer: &str,
        generation: u64,
        boot: &str,
        admission_ns: &str,
    ) -> Result<(), &'static str> {
        let mut installed = self
            .installed
            .lock()
            .map_err(|_| "input-ownership-unresolved")?;
        let mut s = self.state.lock().map_err(|_| "source-unavailable")?;
        if s.phase != Phase::Observed {
            return Err("source-unavailable");
        }
        let activation = (|| {
            if capture != self.capture_id
                || producer != self.producer_id
                || generation != 1
                || boot != self.boot
                || admission_ns.is_empty()
                || !admission_ns.bytes().all(|b| b.is_ascii_digit())
                || (admission_ns.len() > 1 && admission_ns.starts_with('0'))
            {
                return Err("binding-mismatch");
            }
            let admission = admission_ns.parse::<u64>().map_err(|_| "clock-mismatch")?;
            if admission > (self.clock)()? || (self.probe)()? != self.observed_output {
                return Err("source-changed");
            }
            // The donor's acceptance frame must be the real joined source, not
            // the coordinator's startup placeholder or another legacy capture.
            let f = self
                .telemetry
                .target_frame
                .lock()
                .map_err(|_| "source-unavailable")?;
            if [f.x, f.y, f.width, f.height] != self.observed_output.rect {
                return Err("target-mismatch");
            }
            drop(f);
            s.admission = admission;
            s.last_time = admission;
            if !self
                .telemetry
                .install_native_ink_observer(self.observer.clone())
            {
                return Err("input-already-owned");
            }
            *installed = true;
            s.phase = Phase::Active;
            Ok(())
        })();
        if activation.is_err() {
            s.phase = Phase::Unavailable;
        }
        activation
    }
    pub(crate) fn read_batch(&self) -> Result<Option<InkBatch>, &'static str> {
        let s = self.state.lock().map_err(|_| "source-unavailable")?;
        if s.phase == Phase::Unavailable {
            return Err("source-unavailable");
        }
        Ok(s.buffer.read_pending().cloned())
    }
    pub(crate) fn acknowledge(&self, sequence: u32, digest: &str) -> Result<(), &'static str> {
        let mut s = self.state.lock().map_err(|_| "source-unavailable")?;
        if s.phase == Phase::Unavailable {
            return Err("source-unavailable");
        }
        s.buffer
            .acknowledge(sequence, digest)
            .map_err(|_| "ack-mismatch")
    }
    pub(crate) fn seal_and_drain(&self) -> Result<(Option<u32>, NativeSeal), &'static str> {
        // Serialize activation/seal without blocking callbacks on this mutex.
        let mut installed = self
            .installed
            .lock()
            .map_err(|_| "input-ownership-unresolved")?;
        if !*installed {
            self.state.lock().map_err(|_| "source-unavailable")?.phase = Phase::Unavailable;
            return Err("input-ownership-unresolved");
        }
        // NEVER hold the state mutex while acquiring the donor callback gate:
        // an in-flight callback holds the gate and needs the state mutex.
        if !self.telemetry.remove_native_ink_observer(&self.observer) {
            self.state.lock().map_err(|_| "source-unavailable")?.phase = Phase::Unavailable;
            return Err("input-ownership-unresolved");
        }
        *installed = false;
        let mut s = self.state.lock().map_err(|_| "source-unavailable")?;
        if s.phase != Phase::Active {
            return Err("source-unavailable");
        }
        let result = (|| {
            if (self.probe)()? != self.observed_output {
                return Err("source-changed");
            }
            let revision = s.revision.checked_add(1).ok_or("revision-bound")?;
            let time = (self.clock)()?;
            if time < s.last_time {
                return Err("clock-mismatch");
            }
            s.buffer
                .seal_after_native_drain(time.to_string(), revision)
                .map_err(|_| "source-unavailable")?;
            s.gesture = None; // Discard provisional data only after positive drain seal.
            s.revision = revision;
            s.phase = Phase::Sealed;
            let InkSourceState::SealedAndDrained(seal) = s.buffer.state() else {
                return Err("source-unavailable");
            };
            Ok((s.buffer.final_sequence(), seal.clone()))
        })();
        if result.is_err() {
            s.phase = Phase::Unavailable;
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::capture::engine::runtime::track_shift_ink_observed;
    use crate::shared::model::TargetFrame;
    use std::sync::atomic::{AtomicBool, Ordering};
    fn fixture() -> (NativeInkSource, Arc<AtomicBool>) {
        let (tx, _) = flume::unbounded();
        let telemetry = SharedCaptureTelemetry::new(tx);
        telemetry.reset_for_session(TargetFrame {
            x: 0.0,
            y: 0.0,
            width: 100.0,
            height: 100.0,
            scale: 1.0,
        });
        let changed = Arc::new(AtomicBool::new(false));
        let change = changed.clone();
        let probe: Probe = Arc::new(move || {
            Ok(Output {
                name: "fixture".into(),
                rect: if change.load(Ordering::Acquire) {
                    [0., 0., 101., 100.]
                } else {
                    [0., 0., 100., 100.]
                },
                monitor: 17,
            })
        });
        let source = NativeInkSource::new(
            telemetry,
            &"a".repeat(32),
            "original-reference",
            "original-generation",
            "11111111-1111-4111-8111-111111111111".into(),
            json!({"processEpoch":"b".repeat(32),"revision":0,"pid":42,"startTicks":"123"}),
            probe,
        )
        .unwrap();
        (source, changed)
    }
    fn activate(s: &NativeInkSource) {
        s.activate(&s.capture_id, &s.producer_id, 1, &s.boot, "0")
            .unwrap();
    }
    fn gesture(s: &NativeInkSource) {
        track_shift_ink_observed(&s.telemetry, (10.25, 20.5), true, false, Some(100));
        track_shift_ink_observed(&s.telemetry, (15.75, 25.5), true, true, Some(200));
        track_shift_ink_observed(&s.telemetry, (15.75, 25.5), false, true, Some(300));
    }
    #[test]
    fn actual_donor_is_closed_before_ack_and_retains_original_accepted_bytes() {
        let (s, _) = fixture();
        gesture(&s);
        assert!(s.read_batch().unwrap().is_none());
        activate(&s);
        gesture(&s);
        let first = s.read_batch().unwrap().unwrap();
        let begin: Value = serde_json::from_str(&first.events_json).unwrap();
        assert_eq!(begin[0]["kind"], "begin");
        assert_eq!(begin[0]["x"], 10.25);
        assert_eq!(begin[0]["timeNs"], "100");
        assert!(s.acknowledge(first.sequence, "wrong").is_err());
        assert_eq!(s.read_batch().unwrap(), Some(first.clone()));
        s.acknowledge(first.sequence, &first.batch_sha256).unwrap();
        let points = s.read_batch().unwrap().unwrap();
        let v: Value = serde_json::from_str(&points.events_json).unwrap();
        assert_eq!(v[0]["points"][0]["timeNs"], "200");
        s.acknowledge(points.sequence, &points.batch_sha256)
            .unwrap();
        let commit = s.read_batch().unwrap().unwrap();
        let v: Value = serde_json::from_str(&commit.events_json).unwrap();
        assert_eq!(v[0]["acceptedAtNs"], "300");
        let (last, seal) = s.seal_and_drain().unwrap();
        assert_eq!(last, Some(2));
        assert_eq!(seal.native_revision, 2);
        assert_eq!(s.read_batch().unwrap(), Some(commit.clone()));
        s.acknowledge(commit.sequence, &commit.batch_sha256)
            .unwrap();
        gesture(&s);
        assert!(s.read_batch().unwrap().is_none());
    }
    #[test]
    fn wrong_ack_binding_never_installs_observer_or_admits_events() {
        for wrong in ["capture", "producer", "generation", "boot", "future"] {
            let (s, _) = fixture();
            let result = s.activate(
                if wrong == "capture" {
                    "foreign"
                } else {
                    &s.capture_id
                },
                if wrong == "producer" {
                    "foreign"
                } else {
                    &s.producer_id
                },
                if wrong == "generation" { 2 } else { 1 },
                if wrong == "boot" { "foreign" } else { &s.boot },
                if wrong == "future" {
                    "18446744073709551615"
                } else {
                    "0"
                },
            );
            assert!(result.is_err());
            gesture(&s);
            assert!(s.read_batch().is_err());
            assert!(s.telemetry.install_native_ink_observer(s.observer.clone()));
            assert!(s.telemetry.remove_native_ink_observer(&s.observer));
        }
    }
    #[test]
    fn changed_geometry_refuses_activation_and_seal_not_fake_clearance() {
        let (s, changed) = fixture();
        changed.store(true, Ordering::Release);
        assert!(
            s.activate(&s.capture_id, &s.producer_id, 1, &s.boot, "0")
                .is_err()
        );
        let (s, changed) = fixture();
        activate(&s);
        gesture(&s);
        changed.store(true, Ordering::Release);
        assert!(s.seal_and_drain().is_err());
        assert!(s.read_batch().is_err());
    }
    #[test]
    fn zero_accepted_and_unfinished_are_genuine_zero_not_fabricated_gestures() {
        let (s, _) = fixture();
        activate(&s);
        track_shift_ink_observed(&s.telemetry, (10., 20.), true, false, Some(100));
        track_shift_ink_observed(&s.telemetry, (10., 20.), false, true, Some(200));
        assert!(s.read_batch().unwrap().is_none());
        track_shift_ink_observed(&s.telemetry, (30., 40.), true, false, Some(300));
        assert_eq!(s.seal_and_drain().unwrap().0, None);
    }
    #[test]
    fn clock_failure_latches_unknown_and_preserves_already_retained_history() {
        let (s, _) = fixture();
        activate(&s);
        gesture(&s);
        let retained = s
            .state
            .lock()
            .unwrap()
            .buffer
            .read_pending()
            .unwrap()
            .clone();
        track_shift_ink_observed(&s.telemetry, (30., 40.), true, false, None);
        assert!(s.read_batch().is_err());
        assert!(s.seal_and_drain().is_err());
        assert_eq!(
            s.state.lock().unwrap().buffer.read_pending(),
            Some(&retained)
        );
    }
    #[test]
    fn late_or_overlapping_native_observation_is_not_accepted() {
        let (s, _) = fixture();
        activate(&s);
        s.observer.observe(NativeInkObservation::Point {
            first: true,
            position: [1., 2.],
            observed_at_ns: 100,
            rgb: None,
        });
        s.observer.observe(NativeInkObservation::Point {
            first: false,
            position: [3., 4.],
            observed_at_ns: 99,
            rgb: None,
        });
        assert!(s.read_batch().is_err());
        assert!(s.seal_and_drain().is_err());
    }
    #[test]
    fn public_factory_refuses_weak_host_identity_before_any_os_observation() {
        let (tx, _) = flume::unbounded();
        let t = SharedCaptureTelemetry::new(tx);
        assert!(
            NativeInkSource::observe(t, "process-123", 0, &"a".repeat(32), "source", "gen")
                .is_err()
        );
    }
    #[test]
    fn seal_before_activation_cannot_later_install_input() {
        let (s, _) = fixture();
        assert!(s.seal_and_drain().is_err());
        assert!(
            s.activate(&s.capture_id, &s.producer_id, 1, &s.boot, "0")
                .is_err()
        );
    }
    #[test]
    fn exports_actual_controller_wire_for_offline_sdk_validation() {
        let (s, _) = fixture();
        activate(&s);
        gesture(&s);
        let mut batches = Vec::new();
        while let Some(b) = s.read_batch().unwrap() {
            batches.push(json!({"sequence":b.sequence,"eventsJson":b.events_json,"batchSha256":b.batch_sha256}));
            s.acknowledge(b.sequence, &b.batch_sha256).unwrap();
        }
        let (final_sequence, seal) = s.seal_and_drain().unwrap();
        let fixture = json!({"scope":"synthetic native donor/controller unit fixture, NOT OS evidence","observed":s.observation(),"batches":batches,
            "seal":{"finalSequence":final_sequence,"seal":{"state":"sealed-and-drained","observedAtNs":seal.observed_at_ns,"nativeRevision":seal.native_revision}}});
        if let Ok(path) = std::env::var("APPARENT_INK_CONTROLLER_FIXTURE") {
            use std::io::Write;
            use std::os::unix::fs::OpenOptionsExt;
            let mut f = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .open(path)
                .unwrap();
            f.write_all(serde_json::to_string(&fixture).unwrap().as_bytes())
                .unwrap();
            f.sync_all().unwrap();
        }
    }
    #[test]
    fn first_seal_probe_or_clock_failure_latches_unavailable_and_preserves_batches() {
        for failed_clock in [false, true] {
            let (mut s, _) = fixture();
            activate(&s);
            gesture(&s);
            let before = s.read_batch().unwrap().unwrap();
            if failed_clock {
                s.clock = Arc::new(|| Err("fixture-clock-failure"));
            } else {
                s.probe = Arc::new(|| Err("fixture-output-failure"));
            }
            assert!(s.seal_and_drain().is_err());
            assert_eq!(s.state.lock().unwrap().phase, Phase::Unavailable);
            assert!(s.read_batch().is_err());
            assert!(
                s.acknowledge(before.sequence, &before.batch_sha256)
                    .is_err()
            );
            assert_eq!(s.state.lock().unwrap().buffer.read_pending(), Some(&before));
            assert!(!*s.installed.lock().unwrap());
        }
    }
    #[test]
    fn retention_failure_never_publishes_a_prefix_of_the_new_accepted_gesture() {
        let (s, _) = fixture();
        activate(&s);
        gesture(&s);
        let first = s.read_batch().unwrap().unwrap();
        {
            let mut state = s.state.lock().unwrap();
            for _ in 3..4095 {
                state
                    .buffer
                    .retain(&[json!({"fixture":"earlier retained bytes"})])
                    .unwrap();
            }
            assert_eq!(state.buffer.final_sequence(), Some(4094));
        }
        track_shift_ink_observed(&s.telemetry, (10.25, 20.5), true, false, Some(400));
        track_shift_ink_observed(&s.telemetry, (15.75, 25.5), true, true, Some(500));
        track_shift_ink_observed(&s.telemetry, (15.75, 25.5), false, true, Some(600));
        assert!(s.read_batch().is_err());
        let state = s.state.lock().unwrap();
        assert_eq!(state.phase, Phase::Unavailable);
        assert_eq!(state.buffer.final_sequence(), Some(4094));
        assert_eq!(state.buffer.read_pending(), Some(&first));
        assert_eq!(state.gesture.as_ref().unwrap().points.len(), 2);
    }
    #[test]
    fn foreign_observer_is_not_removed_and_ownership_failure_is_immediately_unknown() {
        let (s, _) = fixture();
        activate(&s);
        gesture(&s);
        assert!(s.telemetry.remove_native_ink_observer(&s.observer));
        let (foreign, _) = fixture();
        assert!(
            s.telemetry
                .install_native_ink_observer(foreign.observer.clone())
        );
        assert!(s.seal_and_drain().is_err());
        assert!(s.read_batch().is_err());
        assert!(s.telemetry.remove_native_ink_observer(&foreign.observer));
        assert!(
            *s.installed.lock().unwrap(),
            "uncertain ownership is retained, not cleared"
        );
    }
}
