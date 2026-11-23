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
    Start(u64, f64, f64, Instant),
    Pointer(u64, f64, f64, Instant),
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
    results: flume::Receiver<Result>,
}

pub enum Result {
    Label(u64, String),
    Pointer(u64, String),
    Mark(u64, String),
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

    pub fn mark_started(&self, time: u64, x: f64, y: f64) {
        self.send(Request::Start(time, x, y, Instant::now()));
    }

    pub fn stroke(&self, stroke: &Stroke, frame: TargetFrame) {
        if let Some(mark) = Mark::from_stroke(stroke, frame) {
            self.send(Request::Resolve(mark, Instant::now()));
        }
    }

    pub fn probe(&self, Target::Pointer(time): Target, x: f64, y: f64) {
        self.send(Request::Pointer(time, x, y, Instant::now()));
    }

    pub fn finish(&self) -> Vec<Result> {
        let session = self
            .0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .take();
        let Some(Session { requests, results }) = session else {
            return Vec::new();
        };
        drop(requests);
        let deadline = Instant::now() + DRAIN;
        std::iter::from_fn(|| results.recv_deadline(deadline).ok()).collect()
    }
}

struct Witness {
    time: u64,
    window: window::Window,
    tree: Option<atspi::Object>,
    page: Option<String>,
}

struct Work {
    events: window::Events,
    accessibility: atspi::Bus,
    witness: Option<Witness>,
}

impl Work {
    fn run(pending: flume::Receiver<Request>, labels: flume::Sender<Result>) {
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
                Request::Start(time, x, y, at) => worker.witness = worker.begin_mark(time, x, y, at),
                Request::Pointer(time, x, y, at) => {
                    if let Some(page) = worker.pointer_page(x, y, at) {
                        let _ = labels.try_send(Result::Pointer(time, page));
                    }
                }
                Request::Resolve(mark, at) => {
                    if let Some((label, page)) = worker.resolve(&mark, at) {
                        if let Some(label) = label {
                            let _ = labels.try_send(Result::Label(mark.time, label));
                        }
                        if let Some(page) = page {
                            let _ = labels.try_send(Result::Mark(mark.time, page));
                        }
                    }
                }
            }
        }
    }

    fn begin_mark(&mut self, time: u64, x: f64, y: f64, at: Instant) -> Option<Witness> {
        if at.elapsed() > FRESHNESS {
            return None;
        }
        self.events.drain(None)?;
        let rect = window::layout_rect([x.floor() as i32, y.floor() as i32, 1, 1])?;
        let window = window::focused_for_mark(rect)?;
        let tree = self.accessibility.active_tree(window.pid);
        let page = window.mark_point(rect).and_then(|point| {
            (window.is_uncovered(rect)? && window::share_picker_clear(rect)?).then_some(())?;
            self.page(&window, point)
        });
        if self.events.drain(Some(&window))? || window::focused_for_mark(rect).as_ref() != Some(&window) {
            return None;
        }
        Some(Witness { time, window, tree, page })
    }

    fn page(&self, window: &window::Window, point: (i32, i32)) -> Option<String> {
        let attribute = window.browser_attribute()?;
        let (size, title) = window.unique_browser_client()?;
        self.accessibility.browser_page(window.pid, size, &title, point, attribute)
    }

    fn pointer_page(&mut self, x: f64, y: f64, at: Instant) -> Option<String> {
        if at.elapsed() > FRESHNESS {
            return None;
        }
        self.events.drain(None)?;
        let window = window::focused()?;
        window.browser_attribute()?;
        let (rect, point) = window.point(x, y)?;
        if !window.is_uncovered(rect)? || !window::share_picker_clear(rect)? {
            return None;
        }
        let page = self.page(&window, point)?;
        if self.events.drain(Some(&window))? || window::focused().as_ref() != Some(&window)
            || !window::share_picker_clear(rect)? {
            return None;
        }
        Some(page)
    }

    fn resolve(&mut self, mark: &Mark, at: Instant) -> Option<(Option<String>, Option<String>)> {
        let witness = self
            .witness
            .take()
            .filter(|witness| witness.time == mark.time)?;
        if at.elapsed() > FRESHNESS || self.events.drain(Some(&witness.window))? {
            return None;
        }
        let rect = window::layout_rect(mark.bounds)?;
        let window = window::focused_for_mark(rect)?;
        let tree = self.accessibility.active_tree(window.pid);
        let inside = window.contains(rect);
        let clear = window.is_uncovered(rect)?;
        let same_window = witness.window == window;
        if !admit(inside, clear, same_window, true) {
            return None;
        }
        let point = window.mark_point(rect)?;
        let label = tree.as_ref().filter(|tree| witness.tree.as_ref() == Some(*tree))
            .and_then(|tree| self.accessibility.label_at(tree, point))
            .filter(|_| tree.as_ref().is_some_and(|tree| self.accessibility.is_active(tree)));
        let page = witness.page.and_then(|start| {
            window::share_picker_clear(rect)?.then_some(())?;
            let end = self.page(&window, point);
            super::admit_browser_page(end.is_some(), true, end.as_ref() == Some(&start))
                .then_some(start)
        });
        let still_focused = window::focused_for_mark(rect).as_ref() == Some(&window);
        let still_clear = window.is_uncovered(rect)?;
        if self.events.drain(Some(&window))?
            || !admit(inside, still_clear, still_focused, true)
        {
            return None;
        }
        Some((label, page))
    }
}

fn admit(inside: bool, clear: bool, same_window: bool, same_tree: bool) -> bool {
    let bits = usize::from(inside)
        | usize::from(clear) << 1
        | usize::from(same_window) << 2
        | usize::from(same_tree) << 3;
    ADMISSION[bits]
}

pub fn apply(hits: &[Result], events: &mut Vec<InteractionEvent>, strokes: &mut [Stroke]) {
    let labels: HashMap<_, _> = hits.iter().filter_map(|hit| match hit {
        Result::Label(t, label) => Some((*t, label)),
        _ => None,
    }).collect();
    for stroke in strokes.iter_mut()
        .filter(|stroke| stroke.on.is_none() && !stroke.laser && stroke.pin.is_none())
    {
        stroke.on = labels.get(&stroke.t0).map(|label| (*label).clone());
    }

    let pages: Vec<_> = hits.iter().filter_map(|hit| {
        let (time, raw) = match hit {
            Result::Pointer(time, raw) if events.iter().any(|event| matches!(
                event, InteractionEvent::Click { t, .. } | InteractionEvent::Drag { t, .. } if t == time
            )) => (time, raw),
            Result::Mark(time, raw) if strokes.iter().any(|stroke| stroke.t0 == *time && !stroke.laser) => (time, raw),
            _ => return None,
        };
        let url = crate::shared::routing::browser_page_url(raw)?;
        Some(InteractionEvent::AppEvent { t: *time, label: format!("{}{url}", crate::shared::routing::BROWSER_PAGE_EVENT_PREFIX) })
    }).collect();
    events.extend(pages);
}
