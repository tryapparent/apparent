//! Default-off X11 GtkPlug label lookup. No desktop-wide accessibility search.
use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use crate::model::{InteractionEvent, Stroke, TargetFrame};
#[path = "ax_other.rs"]
#[allow(dead_code)]
mod fallback;
pub use fallback::Target;
pub(crate) use fallback::percent_decode;
#[path = "ax_linux_native.rs"]
mod native;
// Let capture's owner-boundary regressions exercise the real transport without
// changing DISPLAY, starting X, or replacing the production snapshot provider.
#[cfg(test)]
pub(crate) use native::x11::DeadlineStream;

pub const LINUX_NEARBY_TEXT: &str = "linuxNearbyText";
#[derive(Clone, Debug)]
pub struct Hit(pub String);

#[derive(Default)]
struct Results {
    generation: u64,
    accepting: bool,
    hits: HashMap<Target, Hit>,
}
impl Results {
    fn store(&mut self, generation: u64, target: Target, hit: Hit) {
        if self.accepting && self.generation == generation {
            self.hits.insert(target, hit);
        }
    }
}
struct Job {
    generation: u64,
    target: Target,
    snapshot: native::Snapshot,
}
pub struct Prober {
    jobs: flume::Sender<Job>,
    results: Arc<Mutex<Results>>,
    pending: Arc<AtomicUsize>,
}
fn decline(reason: &str) {
    // Fixed reason codes only: no names, bus references, window IDs or private content.
    eprintln!("Linux nearby text: {reason}");
}
/// The same publication boundary is exercised by delayed-session tests without X or D-Bus.
fn publish_lookup(
    results: &Mutex<Results>,
    generation: u64,
    target: Target,
    lookup: impl FnOnce(&dyn Fn() -> bool) -> Result<String, &'static str>,
    validate: impl FnOnce() -> Result<(), &'static str>,
) {
    let current = || {
        let state = results
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        state.accepting && state.generation == generation
    };
    if !current() {
        return;
    }
    match lookup(&current) {
        Ok(text) if current() => {
            if let Err(reason) = validate() {
                decline(reason);
                return;
            }
            // begin/finish and the final generation test share one lock, closing the store race.
            results
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .store(generation, target, Hit(text));
        }
        Ok(_) => {}
        Err(reason) => decline(reason),
    }
}
impl Prober {
    pub fn shared() -> &'static Self {
        static PROBER: OnceLock<Prober> = OnceLock::new();
        PROBER.get_or_init(|| {
            let (jobs, queue) = flume::bounded::<Job>(2);
            let results = Arc::new(Mutex::new(Results::default()));
            let worker = Arc::clone(&results);
            let pending = Arc::new(AtomicUsize::new(0));
            let worker_pending = Arc::clone(&pending);
            std::thread::Builder::new()
                .name("apparent-labels".into())
                .spawn(move || {
                    // Auth-file discovery stays off the input path. Until ready,
                    // event-time acquisition declines without waiting for setup.
                    native::x11::prepare();
                    for job in queue {
                        publish_lookup(
                            &worker,
                            job.generation,
                            job.target,
                            |current| job.snapshot.lookup(current),
                            || job.snapshot.unchanged(),
                        );
                        worker_pending.fetch_sub(1, Ordering::AcqRel);
                    }
                })
                .expect("label worker");
            Self {
                jobs,
                results,
                pending,
            }
        })
    }
    pub fn begin(&self) {
        let mut state = self
            .results
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        state.generation = state.generation.wrapping_add(1);
        state.accepting = true;
        state.hits.clear();
    }
    /// Pointer attribution is intentionally not part of this experiment.
    pub fn probe(&self, _target: Target, _x: f64, _y: f64) {}
    pub fn probe_stroke(
        &self,
        target: Target,
        x: f64,
        y: f64,
        frame: TargetFrame,
        excluded: &[u32],
        passthrough: &[u32],
    ) {
        let generation = {
            let state = self
                .results
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            if !state.accepting {
                return;
            }
            state.generation
        };
        if self.jobs.is_full() {
            decline("queue-full");
            return;
        }
        // Snapshot *now*, never a queued fresh query that could name a replacement plug.
        match native::Snapshot::take(x, y, frame, excluded, passthrough) {
            Ok(snapshot) => {
                self.pending.fetch_add(1, Ordering::AcqRel);
                if self
                    .jobs
                    .try_send(Job {
                        generation,
                        target,
                        snapshot,
                    })
                    .is_err()
                {
                    self.pending.fetch_sub(1, Ordering::AcqRel);
                    decline("queue-full");
                }
            }
            Err(reason) => decline(reason),
        }
    }
    pub fn finish(&self) -> HashMap<Target, Hit> {
        // Keep capture teardown bounded. Results arriving later are never published.
        let deadline = Instant::now() + Duration::from_millis(400);
        while self.pending.load(Ordering::Acquire) != 0 && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(5));
        }
        let mut state = self
            .results
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        state.accepting = false;
        std::mem::take(&mut state.hits)
    }
}
pub fn apply(
    hits: &HashMap<Target, Hit>,
    _events: &mut [InteractionEvent],
    strokes: &mut [Stroke],
) {
    for stroke in strokes.iter_mut().filter(|s| !s.laser && s.on.is_none()) {
        if let Some(hit) = hits.get(&Target::Stroke(stroke.t0)) {
            stroke.on = Some(hit.0.clone());
        }
    }
}
pub fn stroke_probe_point(stroke: &Stroke, frame: TargetFrame) -> Option<(f64, f64)> {
    let points = stroke.normalized_points();
    if points.is_empty() {
        return None;
    }
    let [x0, y0, x1, y1] = crate::sketch::bounds(&points);
    let w = f64::from(x1 - x0) * frame.width;
    let h = f64::from(y1 - y0) * frame.height;
    let cx = frame.x + f64::from(x0 + x1) / 2.0 * frame.width;
    let top = frame.y + f64::from(y0) * frame.height;
    Some((
        cx,
        if h < 24.0 && w > 3.0 * h {
            top - 8.0
        } else {
            top + h / 2.0
        },
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn actual_socket_stall_cannot_publish_into_replacement_session() {
        use std::io::Read;
        use std::os::unix::net::UnixStream;
        let state = Arc::new(Mutex::new(Results {
            generation: 1,
            accepting: true,
            ..Default::default()
        }));
        let (jobs, _queue) = flume::bounded(2);
        let prober = Prober {
            jobs,
            results: Arc::clone(&state),
            pending: Arc::new(AtomicUsize::new(0)),
        };
        let (client, mut peer) = UnixStream::pair().unwrap();
        peer.set_read_timeout(Some(Duration::from_secs(1))).unwrap();
        let (resume, resume_rx) = flume::bounded(1);
        let worker = Arc::clone(&state);
        let handle = std::thread::spawn(move || {
            publish_lookup(
                &worker,
                1,
                Target::Stroke(1),
                |_| {
                    let at = Instant::now();
                    let stream =
                        DeadlineStream::from_socket(client, at + Duration::from_millis(75))
                            .unwrap();
                    assert!(
                        x11rb::rust_connection::RustConnection::connect_to_stream(stream, 0)
                            .is_err()
                    );
                    assert!(at.elapsed() < Duration::from_millis(300));
                    resume_rx.recv_timeout(Duration::from_secs(2)).unwrap();
                    // Even a lookup that erroneously returns a value after the stall
                    // cannot cross the real generation/publication boundary.
                    Ok("old".into())
                },
                || panic!("stale work must not reach validation"),
            );
        });
        let mut byte = [0];
        assert_eq!(peer.read(&mut byte).unwrap(), 1, "actual setup began");
        assert!(prober.finish().is_empty());
        prober.begin();
        resume.send(()).unwrap();
        handle.join().unwrap();
        assert!(state.lock().unwrap().hits.is_empty());
    }
    #[test]
    fn actual_publication_drops_lookup_that_finishes_after_session_replacement() {
        let state = Arc::new(Mutex::new(Results {
            generation: 1,
            accepting: true,
            ..Default::default()
        }));
        let (jobs, _queue) = flume::bounded(2);
        let prober = Prober {
            jobs,
            results: Arc::clone(&state),
            pending: Arc::new(AtomicUsize::new(0)),
        };
        let (started, started_rx) = flume::bounded(1);
        let (resume, resume_rx) = flume::bounded(1);
        let worker = Arc::clone(&state);
        let handle = std::thread::spawn(move || {
            publish_lookup(
                &worker,
                1,
                Target::Stroke(1),
                |_| {
                    started.send(()).unwrap();
                    resume_rx.recv_timeout(Duration::from_secs(2)).unwrap();
                    Ok("old".into())
                },
                || Ok(()),
            );
        });
        started_rx.recv_timeout(Duration::from_secs(2)).unwrap();
        prober.begin();
        resume.send(()).unwrap();
        handle.join().unwrap();
        assert!(state.lock().unwrap().hits.is_empty());
        publish_lookup(
            &state,
            2,
            Target::Stroke(1),
            |_| Ok("new".into()),
            || Err("native-changed"),
        );
        assert!(state.lock().unwrap().hits.is_empty());
        publish_lookup(
            &state,
            2,
            Target::Stroke(1),
            |_| Ok("new".into()),
            || Ok(()),
        );
        let completed = prober.finish();
        assert_eq!(completed[&Target::Stroke(1)].0, "new");
        publish_lookup(
            &state,
            2,
            Target::Stroke(1),
            |_| Ok("late".into()),
            || Ok(()),
        );
        assert!(state.lock().unwrap().hits.is_empty());
    }
    #[test]
    fn label_reaches_serialized_mark_without_changing_geometry() {
        let mut strokes = vec![Stroke {
            t0: 1,
            t1: 20,
            fw: 1000,
            fh: 1000,
            pts: vec![1000, 5000, 0, 3000, 5050, 19],
            on: None,
            pin: None,
            laser: false,
        }];
        let before = crate::sketch::marks_of(&strokes);
        let frame = TargetFrame {
            x: 100.,
            y: 50.,
            width: 1000.,
            height: 1000.,
            scale: 1.,
        };
        let point = stroke_probe_point(&strokes[0], frame).unwrap();
        assert!((point.0 - 300.).abs() < 0.5 && (point.1 - 542.).abs() < 0.5);
        let points = strokes[0].pts.clone();
        apply(
            &HashMap::from([(Target::Stroke(1), Hit("label “Friday”".into()))]),
            &mut [],
            &mut strokes,
        );
        let after = crate::sketch::marks_of(&strokes);
        assert_eq!(strokes[0].pts, points);
        assert_eq!(before[0].box_norm, after[0].box_norm);
        assert_eq!(before[0].shape, after[0].shape);
        assert_eq!(
            serde_json::to_value(&after[0]).unwrap()["on"],
            "label “Friday”"
        );
        strokes[0].on = Some("page supplied".into());
        apply(
            &HashMap::from([(Target::Stroke(1), Hit("replace".into()))]),
            &mut [],
            &mut strokes,
        );
        assert_eq!(strokes[0].on.as_deref(), Some("page supplied"));
    }
}
