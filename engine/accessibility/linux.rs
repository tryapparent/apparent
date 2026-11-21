use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use crate::capture::desktop::linux::hyprland;
use crate::shared::model::{InteractionEvent, Stroke, TargetFrame};

#[cfg(test)]
pub(crate) use super::ax_other::percent_decode;

#[path = "atspi.rs"]
mod atspi;
#[path = "window.rs"]
mod window;

const QUEUE: usize = 8;
const FRESHNESS: Duration = Duration::from_millis(150);
const DRAIN: Duration = Duration::from_millis(250);
const ADMISSION: [bool; 16] = include!("../../record/media/src/assembly/focused-mark.json");

pub enum Target {
    Pointer(u64),
}

enum Request {
    Start(u64, Instant),
    Resolve(Mark, Instant),
}

struct Mark {
    time: u64,
    bounds: [i32; 4],
}

impl Mark {
    fn from_stroke(stroke: &Stroke, frame: TargetFrame) -> Option<Self> {
        let points = stroke.normalized_points();
        if stroke.laser || stroke.pin.is_some() || points.is_empty() {
            return None;
        }
        let [x0, y0, x1, y1] = crate::capture::engine::sketch::bounds(&points);
        let left = (frame.x + f64::from(x0) * frame.width).floor();
        let top = (frame.y + f64::from(y0) * frame.height).floor();
        let width = ((frame.x + f64::from(x1) * frame.width).ceil() - left).max(1.0);
        let height = ((frame.y + f64::from(y1) * frame.height).ceil() - top).max(1.0);
        Some(Self {
            time: stroke.t0,
            bounds: [left as i32, top as i32, width as i32, height as i32],
        })
    }
}

struct Session {
    requests: flume::Sender<Request>,
    results: flume::Receiver<(u64, String)>,
}

pub struct Prober(Mutex<Option<Session>>);

impl Prober {
    pub fn shared() -> &'static Self {
        static PROBER: Prober = Prober(Mutex::new(None));
        &PROBER
    }

    pub fn begin(&self) {
        let mut session = self
            .0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        *session = None;
        if !hyprland::running() {
            return;
        }
        let (requests, pending) = flume::bounded(QUEUE);
        let (labels, results) = flume::bounded(128);
        if std::thread::Builder::new()
            .name("apparent-atspi-marks".into())
            .spawn(move || Work::run(pending, labels))
            .is_ok()
        {
            *session = Some(Session { requests, results });
        }
    }

    fn send(&self, request: Request) {
        if let Some(session) = self
            .0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .as_ref()
        {
            let _ = session.requests.try_send(request);
        }
    }

    pub fn mark_started(&self, time: u64) {
        self.send(Request::Start(time, Instant::now()));
    }

    pub fn stroke(&self, stroke: &Stroke, frame: TargetFrame) {
        if let Some(mark) = Mark::from_stroke(stroke, frame) {
            self.send(Request::Resolve(mark, Instant::now()));
        }
    }

    pub fn probe(&self, Target::Pointer(time): Target, _x: f64, _y: f64) {
        let _ = time;
    }

    pub fn finish(&self) -> HashMap<u64, String> {
        let session = self
            .0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .take();
        let Some(Session { requests, results }) = session else {
            return HashMap::new();
        };
        drop(requests);
        let deadline = Instant::now() + DRAIN;
        std::iter::from_fn(|| results.recv_deadline(deadline).ok()).collect()
    }
}

struct Witness {
    time: u64,
    window: window::Window,
    tree: atspi::Object,
}

struct Work {
    events: window::Events,
    accessibility: atspi::Bus,
    witness: Option<Witness>,
}

impl Work {
    fn run(pending: flume::Receiver<Request>, labels: flume::Sender<(u64, String)>) {
        let Some(events) = window::Events::open() else {
            return;
        };
        let Some(accessibility) = atspi::Bus::open() else {
            return;
        };
        let mut worker = Self {
            events,
            accessibility,
            witness: None,
        };
        while let Ok(request) = pending.recv() {
            match request {
                Request::Start(time, at) => worker.witness = worker.begin_mark(time, at),
                Request::Resolve(mark, at) => {
                    if let Some(label) = worker.resolve(&mark, at) {
                        let _ = labels.try_send((mark.time, label));
                    }
                }
            }
        }
    }

    fn begin_mark(&mut self, time: u64, at: Instant) -> Option<Witness> {
        if at.elapsed() > FRESHNESS {
            return None;
        }
        self.events.drain(None)?;
        let window = window::focused()?;
        let tree = self.accessibility.active_tree(window.pid)?;
        if self.events.drain(Some(&window))? || window::focused().as_ref() != Some(&window) {
            return None;
        }
        Some(Witness { time, window, tree })
    }

    fn resolve(&mut self, mark: &Mark, at: Instant) -> Option<String> {
        let witness = self
            .witness
            .take()
            .filter(|witness| witness.time == mark.time)?;
        if at.elapsed() > FRESHNESS || self.events.drain(Some(&witness.window))? {
            return None;
        }
        let window = window::focused()?;
        let rect = window::layout_rect(mark.bounds)?;
        let tree = self.accessibility.active_tree(window.pid)?;
        let inside = window.contains(rect);
        let clear = window.is_uncovered(rect)?;
        let same_window = witness.window == window;
        let same_tree = witness.tree == tree;
        if !admit(inside, clear, same_window, same_tree) {
            return None;
        }
        let label = self
            .accessibility
            .label_at(&tree, window.mark_point(rect)?)?;
        let still_focused = window::focused().as_ref() == Some(&window);
        let still_active = self.accessibility.is_active(&tree);
        let still_clear = window.is_uncovered(rect)?;
        if self.events.drain(Some(&window))?
            || !admit(inside, still_clear, still_focused, still_active)
        {
            return None;
        }
        Some(label)
    }
}

fn admit(inside: bool, clear: bool, same_window: bool, same_tree: bool) -> bool {
    let bits = usize::from(inside)
        | usize::from(clear) << 1
        | usize::from(same_window) << 2
        | usize::from(same_tree) << 3;
    ADMISSION[bits]
}

pub fn apply(
    hits: &HashMap<u64, String>,
    _events: &mut [InteractionEvent],
    strokes: &mut [Stroke],
) {
    for stroke in strokes
        .iter_mut()
        .filter(|stroke| stroke.on.is_none() && !stroke.laser && stroke.pin.is_none())
    {
        stroke.on = hits.get(&stroke.t0).cloned();
    }
}
