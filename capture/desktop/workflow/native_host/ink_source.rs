//! Native Shift source controller. Binding/observation alone never opens input.
//! No renderer points or inferred Board geometry enter this source. The existing
//! input owner must supply the real donor callbacks; this is not a new recorder.
use super::ink::{InkBatch, InkSourceBuffer, InkSourceState, NativeSeal};
use crate::capture::desktop::ui::whiteboard::observations::{PaperObserver, PaperTap};
use crate::capture::engine::runtime::{
    NativeInkObservation, NativeInkObserver, SharedCaptureTelemetry,
};
use serde_json::{Value, json};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
mod paper;

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
    Prepared,
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
    paper: paper::History,
}
struct Observer {
    state: Arc<Mutex<State>>,
    surface: Value,
    probe: Probe,
    output: Output,
    invalid: Arc<AtomicBool>,
}
impl NativeInkObserver for Observer {
    fn observe(&self, observation: NativeInkObservation) {
        // A native probe must not hold the shared state mutex against Board's
        // GUI callback. Both sources retain one original event ordering.
        let source_matches = (self.probe)().as_ref() == Ok(&self.output);
        let mut s = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if s.phase != Phase::Active {
            return;
        }
        if !source_matches || self.invalid.load(Ordering::Acquire) {
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
                if s.gesture.is_some() || s.paper.gesture_active() {
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
            if let Err(error) = retain_gesture(s, surface, &gesture, observed_at_ns, 2) {
                s.gesture = Some(gesture);
                return Err(error);
            }
        }
        NativeInkObservation::ClockUnavailable | NativeInkObservation::CapacityExceeded => {
            return Err("native-input-unavailable");
        }
    }
    Ok(())
}

fn retain_gesture(
    s: &mut State,
    surface: &Value,
    gesture: &Gesture,
    accepted_at: u64,
    minimum: usize,
) -> Result<String, &'static str> {
    if gesture.points.len() < minimum
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
        let points: Vec<_> = points
            .iter()
            .map(|p| json!({"timeNs":p.time.to_string(),"x":p.position[0],"y":p.position[1]}))
            .collect();
        groups.push(vec![
            json!({"kind":"points","gestureId":gesture_id,"points":points}),
        ]);
    }
    groups.push(vec![
        json!({"kind":"commit","gestureId":gesture_id,"acceptedAtNs":accepted_at.to_string()}),
    ]);
    if s.buffer.retain_group(&groups).is_err() {
        return Err("retention-bound");
    }
    s.gestures += 1;
    s.points += gesture.points.len();
    s.revision = s.revision.checked_add(1).ok_or("revision-bound")?;
    Ok(gesture_id)
}

/// Owns one capture-scoped real donor observer. There is deliberately no Drop
/// release: unresolved admission must remain owned until explicit seal/drain.
pub(crate) struct NativeInkSource {
    telemetry: Arc<SharedCaptureTelemetry>,
    state: Arc<Mutex<State>>,
    observer: Arc<dyn NativeInkObserver>,
    installed: Mutex<bool>,
    invalid: Arc<AtomicBool>,
    paper_tap: PaperTap,
    paper_observer: Arc<dyn PaperObserver>,
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
            paper: paper::History::new()?,
        }));
        let invalid = Arc::new(AtomicBool::new(false));
        let paper_observer = Arc::new(paper::Observer {
            state: state.clone(),
            invalid: invalid.clone(),
        });
        let observer = Arc::new(Observer {
            state: state.clone(),
            surface: observation["observation"]["surfaces"][0].clone(),
            probe: probe.clone(),
            output: observed_output.clone(),
            invalid: invalid.clone(),
        });
        Ok(Self {
            telemetry,
            state,
            observer,
            installed: Mutex::new(false),
            invalid,
            paper_tap: PaperTap::default(),
            paper_observer,
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
    fn attach_paper(mut self, tap: PaperTap) -> Self {
        self.paper_tap = tap;
        self
    }
    #[cfg(test)]
    fn activate(
        &self,
        capture: &str,
        producer: &str,
        generation: u64,
        boot: &str,
        admission_ns: &str,
    ) -> Result<(), &'static str> {
        self.activate_before(
            capture,
            producer,
            generation,
            boot,
            admission_ns,
            Instant::now() + Duration::from_secs(2),
        )
    }
    fn activate_before(
        &self,
        capture: &str,
        producer: &str,
        generation: u64,
        boot: &str,
        admission_ns: &str,
        deadline: Instant,
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
            if Instant::now() >= deadline {
                return Err("activation-deadline");
            }
            s.admission = admission;
            s.last_time = admission;
            if !self.paper_tap.install(self.paper_observer.clone()) {
                return Err("paper-input-owned");
            }
            if !self
                .telemetry
                .install_native_ink_observer(self.observer.clone())
            {
                self.paper_tap.remove(&self.paper_observer);
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
        if s.phase == Phase::Unavailable || self.invalid.load(Ordering::Acquire) {
            return Err("source-unavailable");
        }
        Ok(s.buffer.read_pending().cloned())
    }
    pub(crate) fn acknowledge(&self, sequence: u32, digest: &str) -> Result<(), &'static str> {
        let mut s = self.state.lock().map_err(|_| "source-unavailable")?;
        if s.phase == Phase::Unavailable || self.invalid.load(Ordering::Acquire) {
            return Err("source-unavailable");
        }
        s.buffer
            .acknowledge(sequence, digest)
            .map_err(|_| "ack-mismatch")
    }
    #[cfg(test)]
    fn seal_and_drain(&self) -> Result<(Option<u32>, NativeSeal), &'static str> {
        self.seal_before(Instant::now() + Duration::from_secs(2))
    }
    fn seal_before(&self, deadline: Instant) -> Result<(Option<u32>, NativeSeal), &'static str> {
        // Serialize activation/seal without blocking callbacks on this mutex.
        let mut installed = self
            .installed
            .lock()
            .map_err(|_| "input-ownership-unresolved")?;
        if !*installed {
            self.state.lock().map_err(|_| "source-unavailable")?.phase = Phase::Unavailable;
            return Err("input-ownership-unresolved");
        }
        if !self.state.lock().is_ok_and(|s| s.paper.closed()) {
            if let Ok(mut s) = self.state.lock() {
                s.phase = Phase::Unavailable;
            }
            return Err("paper-window-not-drained");
        }
        // NEVER hold the state mutex while acquiring the donor callback gate:
        // an in-flight callback holds the gate and needs the state mutex.
        if !self.paper_tap.remove(&self.paper_observer)
            || !self.telemetry.remove_native_ink_observer(&self.observer)
        {
            self.state.lock().map_err(|_| "source-unavailable")?.phase = Phase::Unavailable;
            return Err("input-ownership-unresolved");
        }
        *installed = false;
        let mut s = self.state.lock().map_err(|_| "source-unavailable")?;
        if s.phase != Phase::Active || self.invalid.load(Ordering::Acquire) {
            s.phase = Phase::Unavailable;
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
            if Instant::now() >= deadline {
                return Err("seal-deadline");
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
        use crate::capture::desktop::ui::whiteboard::observations::{PaperAction, PaperWindow};
        let window = PaperWindow {
            handle: 42,
            incarnation: "synthetic-native-paper".into(),
            content_rectangle: [10., 10., 40., 40.],
        };
        for (time, action) in [
            (400, PaperAction::Surface),
            (410, PaperAction::Begin([1.25, 2.5])),
            (420, PaperAction::Point([3.5, 4.75])),
            (430, PaperAction::Commit),
            (440, PaperAction::Undo { active: false }),
            (450, PaperAction::Closed),
        ] {
            s.paper_tap.emit(Some(window.clone()), Some(time), action);
        }
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
    fn native_session_commands_preserve_original_batches_until_exact_ack_and_positive_drain() {
        use super::super::ink_wire::{Binding, Command};
        use std::time::{Duration, Instant};
        let (source, _) = fixture();
        activate(&source);
        gesture(&source);
        let telemetry = source.telemetry.clone();
        let binding = Binding {
            capture_id: source.capture_id.clone(),
            producer_id: source.producer_id.clone(),
            generation: 1,
        };
        // Synthetic sample owner only: production sampling/evdev/Hyprland are NOT invoked.
        let collector = super::super::ink_collector::NativeInkCollector::spawn(
            || Ok(([false; 4], [0., 0.], 1)),
            |_, _, _, _| {},
            || panic!("fixture sampler failed"),
            false,
        )
        .unwrap();
        collector
            .wait_ready(Instant::now() + Duration::from_secs(1))
            .unwrap();
        let mut session = Some(InkSessionState {
            source,
            collector: Some(collector),
            prepared: None,
        });
        let command = |session: &mut Option<InkSessionState>, c: Command| {
            execute_source_command(
                session,
                telemetry.clone(),
                &"b".repeat(32),
                0,
                &c,
                Instant::now() + Duration::from_secs(2),
            )
        };
        let first = command(
            &mut session,
            Command::ReadBatch {
                binding: binding.clone(),
                sequence: 0,
            },
        );
        assert_eq!(first["status"], "batch");
        assert_eq!(
            command(
                &mut session,
                Command::AcknowledgeBatch {
                    binding: binding.clone(),
                    sequence: 0,
                    batch_sha256: "0".repeat(64)
                }
            )["status"],
            "refused"
        );
        assert_eq!(
            command(
                &mut session,
                Command::ReadBatch {
                    binding: binding.clone(),
                    sequence: 0
                }
            ),
            first
        );
        assert!(
            !session.as_ref().unwrap().input_clear(),
            "active source is a native termination borrower"
        );
        let seal = command(
            &mut session,
            Command::SealInputAndDrain {
                binding: binding.clone(),
            },
        );
        assert!(
            !session.as_ref().unwrap().input_clear(),
            "positive local drain cannot erase unacknowledged original history"
        );
        assert_eq!(seal["finalSequence"], 2);
        assert_eq!(seal["seal"]["state"], "sealed-and-drained");
        for sequence in 0..3 {
            let batch = command(
                &mut session,
                Command::ReadBatch {
                    binding: binding.clone(),
                    sequence,
                },
            );
            assert_eq!(batch["status"], "batch");
            assert_eq!(
                command(
                    &mut session,
                    Command::AcknowledgeBatch {
                        binding: binding.clone(),
                        sequence,
                        batch_sha256: batch["batch"]["batchSha256"].as_str().unwrap().into()
                    }
                )["status"],
                "acknowledged"
            );
        }
        assert_eq!(
            command(
                &mut session,
                Command::ReadBatch {
                    binding,
                    sequence: 3
                }
            )["status"],
            "pending"
        );
        assert!(session.as_ref().unwrap().replaceable());
        assert!(session.as_ref().unwrap().input_clear());
    }
    #[test]
    fn session_without_started_input_never_claims_successful_empty_drain() {
        let (source, _) = fixture();
        let mut session = InkSessionState {
            source,
            collector: None,
            prepared: None,
        };
        assert!(
            session
                .seal(std::time::Instant::now() + std::time::Duration::from_secs(1))
                .is_err()
        );
        assert!(!session.replaceable());
        assert_eq!(
            session.source.state.lock().unwrap().phase,
            Phase::Unavailable
        );
    }
    fn synthetic_collector(fail: bool) -> super::super::ink_collector::NativeInkCollector {
        super::super::ink_collector::NativeInkCollector::spawn_with_admission(
            move || {
                if fail {
                    Err("fixture-input-refused")
                } else {
                    Ok(([false; 4], [1., 2.], 1))
                }
            },
            |_, _, _, _| panic!("input must stay closed before successful activation"),
            || {},
            false,
            false,
        )
        .unwrap()
    }
    #[test]
    fn input_stays_prepared_until_presentation_and_original_binding_are_acknowledged() {
        use super::super::ink_wire::{Binding, Clock};
        let (source, _) = fixture();
        let _prior = prior_donor(&source);
        let b = Binding {
            capture_id: source.capture_id.clone(),
            producer_id: source.producer_id.clone(),
            generation: 1,
        };
        let c = Clock {
            boot_id: source.boot.clone(),
            admission_monotonic_ns: "0".into(),
        };
        let collector = super::super::ink_collector::NativeInkCollector::spawn_with_admission(
            || Ok(([false; 4], [1., 2.], 1)),
            |_, _, _, _| {},
            || {},
            false,
            false,
        )
        .unwrap();
        let mut s = InkSessionState {
            source,
            collector: None,
            prepared: None,
        };
        s.activate_ready(&b, &c, Instant::now() + Duration::from_secs(1), collector)
            .unwrap();
        assert_eq!(s.source.state.lock().unwrap().phase, Phase::Prepared);
        let mut foreign = b.clone();
        foreign.producer_id = "f".repeat(32);
        assert!(
            s.arm_presentation(&foreign, Instant::now() + Duration::from_secs(1))
                .is_err()
        );
        assert_eq!(s.source.state.lock().unwrap().phase, Phase::Prepared);
        s.arm_presentation(&b, Instant::now() + Duration::from_secs(1))
            .unwrap();
        assert_eq!(s.source.state.lock().unwrap().phase, Phase::Active);
        assert!(!s.source.telemetry.active.load(Ordering::Acquire));
        s.seal(Instant::now() + Duration::from_secs(1)).unwrap();
        assert!(s.input_clear());
    }
    fn prior_donor(
        source: &NativeInkSource,
    ) -> (
        crate::shared::model::TargetFrame,
        Option<crate::shared::model::Stroke>,
    ) {
        // fixture() also supports the legacy donor tests via reset_for_session;
        // this case represents the exclusive native-only role, with no legacy
        // recorder active. Keep the production ownership refusal unchanged.
        source.telemetry.active.store(false, Ordering::Release);
        let frame = crate::shared::model::TargetFrame {
            x: 700.,
            y: 800.,
            width: 900.,
            height: 600.,
            scale: 1.,
        };
        *source.telemetry.target_frame.lock().unwrap() = frame;
        let stroke = crate::shared::model::Stroke {
            t0: 17,
            t1: 18,
            fw: 900,
            fh: 600,
            on: None,
            pin: None,
            laser: false,
            rgb: Some([1, 2, 3]),
            pts: vec![1, 2, 0, 3, 4, 1],
        };
        *source.telemetry.live_ink.lock().unwrap() = Some(stroke.clone());
        (frame, Some(stroke))
    }
    #[test]
    fn failed_readiness_or_post_preparation_refusal_preserves_exact_previous_donor() {
        use super::super::ink_wire::{Binding, Clock};
        for readiness_failure in [true, false] {
            let (source, _) = fixture();
            let old = prior_donor(&source);
            let b = Binding {
                capture_id: source.capture_id.clone(),
                producer_id: source.producer_id.clone(),
                generation: 1,
            };
            let c = Clock {
                boot_id: if readiness_failure {
                    source.boot.clone()
                } else {
                    "wrong-boot".into()
                },
                admission_monotonic_ns: "0".into(),
            };
            let mut state = InkSessionState {
                source,
                collector: None,
                prepared: None,
            };
            assert!(
                state
                    .activate_ready(
                        &b,
                        &c,
                        Instant::now() + Duration::from_secs(1),
                        synthetic_collector(readiness_failure)
                    )
                    .is_err()
            );
            assert_eq!(*state.source.telemetry.target_frame.lock().unwrap(), old.0);
            assert_eq!(*state.source.telemetry.live_ink.lock().unwrap(), old.1);
            assert!(!*state.source.installed.lock().unwrap());
            assert!(state.prepared.is_none());
            state
                .collector
                .as_mut()
                .unwrap()
                .stop_and_drain(Instant::now() + Duration::from_secs(1))
                .ok();
        }
    }
    #[test]
    fn controlled_slow_activation_probe_returns_at_deadline_and_cannot_later_install_input() {
        use super::super::ink_wire::{Binding, Clock, Command};
        use std::sync::mpsc;
        let (mut source, _) = fixture();
        let old = prior_donor(&source);
        let b = Binding {
            capture_id: source.capture_id.clone(),
            producer_id: source.producer_id.clone(),
            generation: 1,
        };
        let c = Clock {
            boot_id: source.boot.clone(),
            admission_monotonic_ns: "0".into(),
        };
        let command = Command::Activate {
            binding: b,
            clock: c,
        };
        let (entered_tx, entered_rx) = mpsc::sync_channel(1);
        let (release_tx, release_rx) = mpsc::sync_channel(1);
        let release = Mutex::new(release_rx);
        let observed = source.observed_output.clone();
        source.probe = Arc::new(move || {
            entered_tx.send(()).unwrap();
            release
                .lock()
                .unwrap()
                .recv_timeout(Duration::from_secs(1))
                .unwrap();
            Ok(observed.clone())
        });
        let state = Arc::new(Mutex::new(InkSessionState {
            source,
            collector: None,
            prepared: None,
        }));
        let run = state.clone();
        let abandoned = state.clone();
        let worker = NativeInkSession::spawn(
            move |command, deadline| {
                let Command::Activate { binding, clock } = command else {
                    panic!("wrong command")
                };
                let mut s = run.lock().unwrap();
                s.binding(binding).unwrap();
                match s.activate_ready(binding, clock, deadline, synthetic_collector(false)) {
                    Ok(()) => json!({"status":"active"}),
                    Err(_) => unknown_source(),
                }
            },
            move || {
                let s = abandoned.lock().unwrap();
                s.fail();
                if let Some(c) = s.collector.as_ref() {
                    c.request_stop();
                }
            },
            || false,
        )
        .unwrap();
        let start = Instant::now();
        let result = worker.request(command.clone(), start + Duration::from_millis(60));
        assert_eq!(result, unknown_source());
        assert!(
            worker.input_busy(),
            "timeout cannot clear native termination admission"
        );
        assert_eq!(
            result["status"], "outcome-unknown",
            "timeout is not positive refusal or absence"
        );
        assert!(
            start.elapsed() < Duration::from_millis(300),
            "coordinator waited for blocked native probe"
        );
        entered_rx.recv_timeout(Duration::from_secs(1)).unwrap();
        assert_eq!(
            worker.request(command, Instant::now() + Duration::from_secs(1)),
            unknown_source(),
            "late/busy source cannot be re-admitted"
        );
        release_tx.send(()).unwrap();
        drop(worker.sender);
        worker._worker.join().unwrap();
        let mut s = state.lock().unwrap();
        assert_eq!(s.source.state.lock().unwrap().phase, Phase::Unavailable);
        assert!(!*s.source.installed.lock().unwrap());
        assert_eq!(*s.source.telemetry.target_frame.lock().unwrap(), old.0);
        assert_eq!(*s.source.telemetry.live_ink.lock().unwrap(), old.1);
        s.collector
            .as_mut()
            .unwrap()
            .stop_and_drain(Instant::now() + Duration::from_secs(1))
            .unwrap();
    }
    #[test]
    fn controlled_slow_seal_probe_cannot_block_coordinator_or_publish_late_drain() {
        use super::super::ink_wire::{Binding, Command};
        use std::sync::mpsc;
        let (mut source, _) = fixture();
        activate(&source);
        gesture(&source);
        let b = Binding {
            capture_id: source.capture_id.clone(),
            producer_id: source.producer_id.clone(),
            generation: 1,
        };
        let before = source.read_batch().unwrap().unwrap();
        let telemetry = source.telemetry.clone();
        let (entered_tx, entered_rx) = mpsc::sync_channel(1);
        let (release_tx, release_rx) = mpsc::sync_channel(1);
        let release = Mutex::new(release_rx);
        let observed = source.observed_output.clone();
        source.probe = Arc::new(move || {
            entered_tx.send(()).unwrap();
            release
                .lock()
                .unwrap()
                .recv_timeout(Duration::from_secs(1))
                .unwrap();
            Ok(observed.clone())
        });
        let state = Arc::new(Mutex::new(Some(InkSessionState {
            source,
            collector: Some(synthetic_collector(false)),
            prepared: None,
        })));
        let run = state.clone();
        let abandoned = state.clone();
        let worker = NativeInkSession::spawn(
            move |command, deadline| {
                execute_source_command(
                    &mut run.lock().unwrap(),
                    telemetry.clone(),
                    &"b".repeat(32),
                    0,
                    command,
                    deadline,
                )
            },
            move || {
                abandoned.lock().unwrap().as_ref().unwrap().fail();
            },
            || false,
        )
        .unwrap();
        let start = Instant::now();
        assert_eq!(
            worker.request(
                Command::SealInputAndDrain { binding: b },
                start + Duration::from_millis(60)
            ),
            unknown_source()
        );
        assert!(
            start.elapsed() < Duration::from_millis(300),
            "coordinator waited for slow seal probe"
        );
        entered_rx.recv_timeout(Duration::from_secs(1)).unwrap();
        release_tx.send(()).unwrap();
        drop(worker.sender);
        worker._worker.join().unwrap();
        let s = state.lock().unwrap();
        let s = s.as_ref().unwrap();
        let original = s.source.state.lock().unwrap();
        assert_eq!(original.phase, Phase::Unavailable);
        assert_eq!(original.buffer.read_pending(), Some(&before));
        assert!(!matches!(
            original.buffer.state(),
            InkSourceState::SealedAndDrained(_)
        ));
        assert!(s.collector.is_none());
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

/// One source-local input scope, owned by the existing NativeHost coordinator.
/// Positive replacement here says nothing about Engine owning-close clearance.
struct InkSessionState {
    source: NativeInkSource,
    collector: Option<super::ink_collector::NativeInkCollector>,
    prepared: Option<crate::capture::engine::runtime::NativeInkTargetSnapshot>,
}
impl InkSessionState {
    fn input_clear(&self) -> bool {
        self.collector.is_none()
            && self.prepared.is_none()
            && !self.source.invalid.load(Ordering::Acquire)
            && !self.source.paper_tap.active()
            && self.source.installed.lock().is_ok_and(|i| !*i)
            && self.source.state.lock().is_ok_and(|state| {
                matches!(state.phase, Phase::Observed | Phase::Sealed)
                    && state.buffer.read_pending().is_none()
            })
    }
    fn binding(&self, b: &super::ink_wire::Binding) -> Result<(), &'static str> {
        if b.capture_id != self.source.capture_id
            || b.producer_id != self.source.producer_id
            || b.generation != 1
        {
            return Err("binding-mismatch");
        }
        Ok(())
    }
    fn replaceable(&self) -> bool {
        self.input_clear()
            && self.source.state.lock().is_ok_and(|s| {
                matches!(s.phase, Phase::Observed | Phase::Sealed)
                    && s.buffer.read_pending().is_none()
            })
    }
    fn fail(&self) {
        if let Ok(mut s) = self.source.state.lock() {
            s.phase = Phase::Unavailable;
        }
    }
    fn activate(
        &mut self,
        b: &super::ink_wire::Binding,
        c: &super::ink_wire::Clock,
        deadline: std::time::Instant,
    ) -> Result<(), &'static str> {
        self.binding(b)?;
        if self.collector.is_some() {
            return Err("input-already-owned");
        }
        let r = self.source.observed_output.rect;
        // Start/readiness are still outside native input admission. No donor
        // target or provisional data is touched if evdev/compositor fails.
        let collector = super::ink_collector::NativeInkCollector::start(
            self.source.telemetry.clone(),
            self.source.observer.clone(),
            self.source.observed_output.name.clone(),
            r,
        )?;
        self.activate_ready(b, c, deadline, collector)
    }
    fn restore_target(&mut self) -> Result<(), &'static str> {
        if let Some(snapshot) = self.prepared.as_mut() {
            self.source.telemetry.restore_native_ink_target(snapshot)?;
            self.prepared = None;
        }
        Ok(())
    }
    fn activate_ready(
        &mut self,
        b: &super::ink_wire::Binding,
        c: &super::ink_wire::Clock,
        deadline: Instant,
        collector: super::ink_collector::NativeInkCollector,
    ) -> Result<(), &'static str> {
        // Retain the lifetime BEFORE any readiness wait or unknown response.
        self.collector = Some(collector);
        let result = (|| {
            self.collector.as_ref().unwrap().wait_ready(deadline)?;
            let r = self.source.observed_output.rect;
            self.prepared = Some(self.source.telemetry.prepare_native_ink_target(
                crate::shared::model::TargetFrame {
                    x: r[0],
                    y: r[1],
                    width: r[2],
                    height: r[3],
                    scale: 1.0,
                },
            )?);
            self.source.activate_before(
                &b.capture_id,
                &b.producer_id,
                b.generation,
                &c.boot_id,
                &c.admission_monotonic_ns,
                deadline,
            )?;
            self.source
                .state
                .lock()
                .map_err(|_| "source-unavailable")?
                .phase = Phase::Prepared;
            Ok(())
        })();
        if result.is_err() {
            self.collector.as_ref().unwrap().request_stop();
            self.fail();
            // The collector has not been armed on failure. Remove only our
            // observer before restoring the exact prior donor snapshot.
            let mut installed = self
                .source
                .installed
                .lock()
                .map_err(|_| "input-ownership-unresolved")?;
            if *installed {
                if !self.source.paper_tap.remove(&self.source.paper_observer)
                    || !self
                        .source
                        .telemetry
                        .remove_native_ink_observer(&self.source.observer)
                {
                    return Err("input-ownership-unresolved");
                }
                *installed = false;
            }
            drop(installed);
            self.restore_target()?;
        }
        result
    }
    fn arm_presentation(
        &mut self,
        b: &super::ink_wire::Binding,
        deadline: Instant,
    ) -> Result<(), &'static str> {
        self.binding(b)?;
        let mut state = self.source.state.lock().map_err(|_| "source-unavailable")?;
        if state.phase != Phase::Prepared || self.source.invalid.load(Ordering::Acquire) {
            return Err("presentation-not-prepared");
        }
        self.collector
            .as_ref()
            .ok_or("collector-unavailable")?
            .arm(deadline)?;
        state.phase = Phase::Active;
        Ok(())
    }
    fn seal(&mut self, deadline: std::time::Instant) -> Result<Value, &'static str> {
        let Some(collector) = self.collector.as_mut() else {
            self.fail();
            return Err("input-not-ready");
        };
        if let Err(e) = collector.stop_and_drain(deadline) {
            self.fail();
            return Err(e);
        }
        self.collector = None;
        let result = self.source.seal_before(deadline);
        if !self.source.installed.lock().is_ok_and(|i| !*i) {
            self.fail();
            return Err("input-ownership-unresolved");
        }
        self.restore_target()?;
        let (final_sequence, seal) = result?;
        if std::time::Instant::now() >= deadline {
            self.fail();
            return Err("source-drain-unknown");
        }
        Ok(
            json!({"finalSequence":final_sequence,"seal":{"state":"sealed-and-drained","observedAtNs":seal.observed_at_ns,"nativeRevision":seal.native_revision}}),
        )
    }
}
#[cfg(test)]
fn execute_source_command(
    session: &mut Option<InkSessionState>,
    telemetry: Arc<SharedCaptureTelemetry>,
    epoch: &str,
    revision: u64,
    command: &super::ink_wire::Command,
    deadline: Instant,
) -> Value {
    execute_source_command_with_paper(
        session,
        telemetry,
        PaperTap::default(),
        epoch,
        revision,
        command,
        deadline,
    )
}
fn execute_source_command_with_paper(
    session: &mut Option<InkSessionState>,
    telemetry: Arc<SharedCaptureTelemetry>,
    paper: PaperTap,
    epoch: &str,
    revision: u64,
    command: &super::ink_wire::Command,
    deadline: Instant,
) -> Value {
    use super::ink_wire::Command;
    let result = (|| -> Result<Value, &'static str> {
        if Instant::now() >= deadline {
            return Err("deadline-expired");
        }
        if let Command::Observe { capture_id, source } = command {
            if session.as_ref().is_some_and(|s| !s.replaceable()) {
                return Err("source-already-owned");
            }
            let observed = NativeInkSource::observe(
                telemetry,
                epoch,
                revision,
                capture_id,
                &source.id,
                &source.generation,
            )?
            .attach_paper(paper);
            let value = observed.observation().clone();
            *session = Some(InkSessionState {
                source: observed,
                collector: None,
                prepared: None,
            });
            if std::time::Instant::now() >= deadline {
                return Err("source-observation-unknown");
            }
            return Ok(json!({"status":"observed","value":value}));
        }
        let s = session.as_mut().ok_or("source-unavailable")?;
        match command {
            Command::Activate { binding, clock } => {
                s.activate(binding, clock, deadline)?;
                Ok(json!({"status":"input-prepared"}))
            }
            Command::ArmInput { binding } => {
                s.arm_presentation(binding, deadline)?;
                Ok(json!({"status":"active"}))
            }
            Command::ReadBatch { binding, sequence } => {
                s.binding(binding)?;
                match s.source.read_batch()? {
                    Some(b) if b.sequence == *sequence => Ok(
                        json!({"status":"batch","batch":{"sequence":b.sequence,"eventsJson":b.events_json,"batchSha256":b.batch_sha256}}),
                    ),
                    Some(_) => Err("sequence-mismatch"),
                    None => Ok(json!({"status":"pending"})),
                }
            }
            Command::AcknowledgeBatch {
                binding,
                sequence,
                batch_sha256,
            } => {
                s.binding(binding)?;
                s.source.acknowledge(*sequence, batch_sha256)?;
                Ok(json!({"status":"acknowledged","sequence":sequence,"batchSha256":batch_sha256}))
            }
            Command::SealInputAndDrain { binding } => {
                s.binding(binding)?;
                s.seal(deadline)
            }
            Command::ReadBoard { binding } => {
                s.binding(binding)?;
                let state = s.source.state.lock().map_err(|_| "paper-unavailable")?;
                if state.phase != Phase::Active || s.source.invalid.load(Ordering::Acquire) {
                    return Err("paper-unavailable");
                }
                Ok(json!({"status":"board","value":state.paper.view(state.revision)}))
            }
            Command::BoardControl {
                binding,
                intent,
                expected_native_revision,
            } => {
                s.binding(binding)?;
                let state = s.source.state.lock().map_err(|_| "paper-unavailable")?;
                if state.phase != Phase::Active
                    || s.source.invalid.load(Ordering::Acquire)
                    || state.paper.revision() != *expected_native_revision
                {
                    return Err("paper-control-stale");
                }
                if !matches!(
                    intent,
                    super::ink_wire::PaperIntent::Open | super::ink_wire::PaperIntent::Close
                ) && state.paper.closed()
                {
                    return Err("paper-not-open");
                }
                Ok(json!({"status":"board-admitted"}))
            }
            Command::Observe { .. } => unreachable!(),
        }
    })();
    match result {
        Ok(v) => v,
        Err(_) => json!({"status":"refused","reason":"unavailable"}),
    }
}

/// One retained executor per native-only coordinator, never one detached thread
/// per request. Blocking OS probes cannot hold the GUI/coordinator past the
/// request deadline. Timeout permanently closes further source admission;
/// the existing executor, state and native handles remain owned, not cleared.
pub(crate) struct NativeInkSession {
    sender: std::sync::mpsc::SyncSender<SourceWork>,
    failed: Arc<std::sync::atomic::AtomicBool>,
    busy: Arc<std::sync::atomic::AtomicBool>,
    _worker: std::thread::JoinHandle<()>,
}
struct SourceWork {
    command: super::ink_wire::Command,
    deadline: Instant,
    response: std::sync::mpsc::SyncSender<Value>,
}
impl NativeInkSession {
    fn spawn(
        mut operation: impl FnMut(&super::ink_wire::Command, Instant) -> Value + Send + 'static,
        mut abandoned: impl FnMut() + Send + 'static,
        mut input_clear: impl FnMut() -> bool + Send + 'static,
    ) -> Result<Self, &'static str> {
        use std::sync::atomic::{AtomicBool, Ordering};
        let (sender, receiver) = std::sync::mpsc::sync_channel::<SourceWork>(1);
        let failed = Arc::new(AtomicBool::new(false));
        let failure = failed.clone();
        let busy = Arc::new(AtomicBool::new(true));
        let activity = busy.clone();
        let worker = std::thread::Builder::new()
            .name("apparent-native-ink-source".into())
            .spawn(move || {
                while let Ok(work) = receiver.recv() {
                    if failure.load(Ordering::Acquire) || Instant::now() >= work.deadline {
                        failure.store(true, Ordering::Release);
                        abandoned();
                        let _ = work.response.send(unknown_source());
                        continue;
                    }
                    let result = operation(&work.command, work.deadline);
                    let clear = input_clear();
                    if failure.load(Ordering::Acquire) || Instant::now() >= work.deadline {
                        failure.store(true, Ordering::Release);
                        abandoned();
                        let _ = work.response.send(unknown_source());
                    } else if work.response.send(result).is_err() {
                        failure.store(true, Ordering::Release);
                        abandoned();
                    } else {
                        activity.store(!clear, Ordering::Release);
                    }
                }
            })
            .map_err(|_| "source-worker-unavailable")?;
        Ok(Self {
            sender,
            failed,
            busy,
            _worker: worker,
        })
    }
    pub(crate) fn input_busy(&self) -> bool {
        use std::sync::atomic::Ordering;
        self.failed.load(Ordering::Acquire) || self.busy.load(Ordering::Acquire)
    }
    fn request(&self, command: super::ink_wire::Command, deadline: Instant) -> Value {
        use std::sync::atomic::Ordering;
        if self.failed.load(Ordering::Acquire) || Instant::now() >= deadline {
            return unknown_source();
        }
        let (response, receiver) = std::sync::mpsc::sync_channel(1);
        self.busy.store(true, Ordering::Release);
        if self
            .sender
            .try_send(SourceWork {
                command,
                deadline,
                response,
            })
            .is_err()
        {
            self.failed.store(true, Ordering::Release);
            return unknown_source();
        }
        match receiver.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
            Ok(value) if Instant::now() < deadline => value,
            _ => {
                self.failed.store(true, Ordering::Release);
                unknown_source()
            }
        }
    }
}
fn unknown_source() -> Value {
    json!({"status":"outcome-unknown"})
}
pub(crate) fn native_source_command(
    session: &mut Option<NativeInkSession>,
    telemetry: Arc<SharedCaptureTelemetry>,
    paper: PaperTap,
    epoch: &str,
    revision: u64,
    command: &super::ink_wire::Command,
    request_deadline: u64,
) -> Value {
    let remaining = request_deadline
        .saturating_sub(crate::capture::desktop::workflow::agent_capture::storage_clock_ms())
        .min(2000);
    if remaining == 0 {
        return unknown_source();
    }
    let deadline = Instant::now() + Duration::from_millis(remaining);
    if session.is_none() {
        if !matches!(command, super::ink_wire::Command::Observe { .. }) {
            return unknown_source();
        }
        let state = Arc::new(Mutex::new(None::<InkSessionState>));
        let cleanup = state.clone();
        let clearance = state.clone();
        let epoch = epoch.to_owned();
        let created = NativeInkSession::spawn(
            move |command, deadline| {
                let Ok(mut s) = state.lock() else {
                    return unknown_source();
                };
                execute_source_command_with_paper(
                    &mut s,
                    telemetry.clone(),
                    paper.clone(),
                    &epoch,
                    revision,
                    command,
                    deadline,
                )
            },
            move || {
                if let Ok(mut s) = cleanup.lock() {
                    if let Some(s) = s.as_mut() {
                        if let Some(c) = s.collector.as_ref() {
                            c.request_stop();
                        }
                        s.fail();
                    }
                }
            },
            move || {
                clearance
                    .lock()
                    .is_ok_and(|s| s.as_ref().is_none_or(InkSessionState::input_clear))
            },
        );
        let Ok(created) = created else {
            return unknown_source();
        };
        *session = Some(created);
    }
    session.as_ref().unwrap().request(command.clone(), deadline)
}
