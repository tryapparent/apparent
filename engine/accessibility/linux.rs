use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use crate::capture::desktop::linux::hyprland;
use crate::shared::model::{ActionContext, ActionKind, ActionWindow, InteractionEvent, PinWindow, Stroke, TargetFrame};

#[cfg(test)]
pub(crate) use super::ax_other::percent_decode;

#[path = "atspi.rs"]
mod atspi;
#[path = "window.rs"]
pub(crate) mod window;

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

struct PinRequest {
    pin: u32,
    t: u64,
    release: u64,
    note_pid: u32,
    x: f64,
    y: f64,
    at: Instant,
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

struct Pins {
    requests: flume::Sender<PinRequest>,
    results: flume::Receiver<ActionContext>,
}

struct Session {
    requests: flume::Sender<Request>,
    pins: Option<Pins>,
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
            let (requests_for_pins, pending) = flume::bounded(2);
            let (observations, pin_results) = flume::bounded(12);
            let pins = std::thread::Builder::new()
                .name("apparent-atspi-pins".into())
                .spawn(move || Work::run_pins(pending, observations))
                .ok()
                .map(|_| Pins { requests: requests_for_pins, results: pin_results });
            *session = Some(Session { requests, pins, results });
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

    pub fn pin(&self, pin: u32, t: u64, release: u64, x: f64, y: f64, note_pid: u32) {
        if let Some(queue) = self.0.try_lock().ok()
            .and_then(|session| Some(session.as_ref()?.pins.as_ref()?.requests.clone()))
        {
            let _ = queue.try_send(PinRequest { pin, t, release, note_pid, x, y, at: Instant::now() });
        }
    }

    pub fn finish(&self) -> (Vec<Result>, Vec<ActionContext>) {
        let session = self
            .0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .take();
        let Some(Session { requests, pins, results }) = session else {
            return (Vec::new(), Vec::new());
        };
        drop(requests);
        let pin_results = pins.map(|Pins { requests, results }| {
            drop(requests);
            results
        });
        let deadline = Instant::now() + DRAIN;
        let marks = std::iter::from_fn(|| results.recv_deadline(deadline).ok()).collect();
        let pins = pin_results.map_or_else(Vec::new, |results| {
            std::iter::from_fn(|| results.recv_deadline(deadline).ok()).collect()
        });
        (marks, pins)
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
    fn open(accessibility: atspi::Bus) -> Option<Self> {
        Some(Self { events: window::Events::open()?, accessibility, witness: None })
    }

    fn run_pins(pending: flume::Receiver<PinRequest>, results: flume::Sender<ActionContext>) {
        let Some(mut worker) = atspi::Bus::connect().and_then(Self::open) else { return; };
        let mut remaining = 12;
        while remaining > 0 {
            let Ok(pin) = pending.recv() else { return; };
            if let Some(snapshot) = worker.pin_window(pin)
                && results.try_send(snapshot).is_ok()
            {
                remaining -= 1;
            }
        }
    }

    fn run(pending: flume::Receiver<Request>, labels: flume::Sender<Result>) {
        let Some(mut worker) = atspi::Bus::open().and_then(Self::open) else { return; };
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

    fn pin_window(&mut self, pin: PinRequest) -> Option<ActionContext> {
        let deadline = pin.at + FRESHNESS;
        if Instant::now() > deadline {
            return None;
        }
        self.events.drain(None)?;
        let point = [pin.x.floor() as i32, pin.y.floor() as i32, 1, 1];
        let focus = window::pin_focus(point, pin.note_pid, deadline)?;
        let window = focus.window;
        let tree = self.accessibility.window_tree(window.pid, Some(&window.title))
            .or_else(|| {
                focus.editor.is_none().then(|| self.accessibility.active_tree(window.pid)).flatten()
            })?;
        let sampled_after_ms = pin.release.saturating_sub(pin.t)
            .saturating_add(pin.at.elapsed().as_millis() as u64);
        let browser_point = window.browser_attribute().and_then(|_| window.mark_point(focus.rect));
        let (elements, truncated) = self.accessibility.pin_tree(
            &tree, &window.title, window.size(), focus.unique_client, browser_point,
        )?;
        let finish = deadline + DRAIN;
        let after = window::pin_focus(point, pin.note_pid, finish)?;
        let editor = after.editor.as_ref().or(focus.editor.as_ref());
        if after.window != window
            || after.rect != focus.rect
            || !self.accessibility.is_showing(&tree)
            || self.events.drain_pin(&window, editor)?
            || Instant::now() > finish
        {
            return None;
        }
        Some(ActionContext {
            kind: ActionKind::Stroke,
            t: pin.t,
            window: ActionWindow {
                id: window.action_id(),
                app: window.class,
                title: (!window.title.is_empty()).then_some(window.title),
            },
            pin_window: Some(PinWindow { pin: pin.pin, sampled_after_ms, truncated, elements }),
        })
    }

    fn page(&self, window: &window::Window, point: (i32, i32)) -> Option<String> {
        let attribute = window.browser_attribute()?;
        let (size, title) = window.unique_mapped_client()?;
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
        let url = crate::shared::routing::browser_site_url(raw)?;
        Some(InteractionEvent::AppEvent { t: *time, label: format!("{}{url}", crate::shared::routing::BROWSER_PAGE_EVENT_PREFIX) })
    }).collect();
    events.extend(pages);
}
