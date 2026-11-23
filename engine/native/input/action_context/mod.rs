use std::collections::HashMap;
use std::sync::PoisonError;
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

use super::{SharedCaptureTelemetry, platform};
#[cfg(target_os = "linux")]
use crate::capture::engine::accessibility::ax::window;
use crate::shared::model::{
    ActionContext, ActionKind, ActionWindow, InteractionEvent, SCALE, Stroke, TargetFrame,
};
use crate::shared::windows::RawWindow;

const FRESH: Duration = Duration::from_millis(50);
const QUEUE: usize = 8;
const MAX_CONTEXTS: usize = 1024;
const ADMISSION: [bool; 8] = include!(concat!(env!("OUT_DIR"), "/record-action-context.json"));

type Key = (ActionKind, u64);
type Rect = [f64; 4];

enum Probe {
    Point(f64, f64),
    Focus,
    StrokeEnd(Rect),
}

struct Request {
    key: Key,
    at: Instant,
    probe: Probe,
    frame: TargetFrame,
    passthrough: Vec<u32>,
    dock: Option<Rect>,
}

pub(in crate::capture) struct Collector {
    jobs: flume::Sender<Request>,
    context: flume::Receiver<ActionContext>,
    last_scroll: Option<u64>,
}

impl Collector {
    fn start() -> Option<Self> {
        let (jobs, pending) = flume::bounded::<Request>(QUEUE);
        let (publish, context) = flume::bounded(MAX_CONTEXTS);
        std::thread::Builder::new()
            .name("apparent-action-context".into())
            .spawn(move || {
                let mut provider = Provider::open();
                let mut stroke_start = None;
                for request in pending {
                    let (kind, t) = request.key;
                    let start = (kind == ActionKind::Stroke)
                        .then(|| stroke_start.take())
                        .flatten();
                    if request.at.elapsed() > FRESH {
                        continue;
                    }
                    let window = provider.observe(&request);
                    let consistent = match request.probe {
                        Probe::StrokeEnd(_) => {
                            start.as_ref().is_some_and(|(time, prior, frame)| {
                                *time == t
                                    && super::same_target_frame(*frame, request.frame)
                                    && window.as_ref() == Some(prior)
                            })
                        }
                        _ => true,
                    };
                    let fresh = request.at.elapsed() <= FRESH;
                    let admission = usize::from(fresh)
                        | (usize::from(window.is_some()) << 1)
                        | (usize::from(consistent) << 2);
                    if ADMISSION[admission]
                        && let Some(window) = window
                    {
                        if kind == ActionKind::Stroke && matches!(request.probe, Probe::Point(..)) {
                            stroke_start = Some((t, window, request.frame));
                        } else {
                            let _ = publish.try_send(ActionContext { kind, t, window });
                        }
                    }
                }
            })
            .ok()?;
        Some(Self {
            jobs,
            context,
            last_scroll: None,
        })
    }

    pub(in crate::capture) fn finish(
        self,
        events: &[InteractionEvent],
        strokes: &[Stroke],
    ) -> Vec<ActionContext> {
        drop(self.jobs);
        let mut keys = HashMap::new();
        for (kind, t) in events.iter().filter_map(event_key).chain(
            strokes
                .iter()
                .filter(|s| !s.laser && s.pin.is_none())
                .map(|s| (ActionKind::Stroke, s.t0)),
        ) {
            keys.entry((kind, t))
                .and_modify(|unique| *unique = false)
                .or_insert(true);
        }
        let deadline = Instant::now() + FRESH;
        let mut rows: Vec<_> = std::iter::from_fn(|| self.context.recv_deadline(deadline).ok())
            .filter(|row| keys.get(&(row.kind, row.t)) == Some(&true))
            .collect();
        rows.sort_by_key(|row| (row.t, row.kind));
        rows
    }
}

fn event_key(event: &InteractionEvent) -> Option<Key> {
    let kind = match event {
        InteractionEvent::Click { .. } | InteractionEvent::Drag { .. } => ActionKind::Pointer,
        InteractionEvent::Scroll { .. } => ActionKind::Scroll,
        InteractionEvent::Key { .. } => ActionKind::Key,
        _ => return None,
    };
    Some((kind, event.timestamp_ms()))
}

impl SharedCaptureTelemetry {
    pub(super) fn reset_action_context(&self) {
        let enabled = self.probing() && self.capture_mode.load(Ordering::Acquire) <= 1;
        *self
            .action_context
            .lock()
            .unwrap_or_else(PoisonError::into_inner) = enabled.then(Collector::start).flatten();
    }

    pub(super) fn observe_pointer_context(&self, kind: ActionKind, t: u64, x: f64, y: f64) {
        #[cfg(target_os = "linux")]
        if !self.action_pointer_known.load(Ordering::Relaxed) {
            return;
        }
        self.request_context((kind, t), Probe::Point(x, y));
    }

    #[cfg(target_os = "macos")]
    pub(super) fn record_scroll(&self, t: u64, x: f64, y: f64, dx: f32, dy: f32) {
        if self.agent_context.load(Ordering::Relaxed) && self.contains_screen_point(x, y) {
            self.observe_pointer_context(ActionKind::Scroll, t, x, y);
        }
        let (x, y, _, _) = self.normalize_point(x, y);
        self.events
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push(InteractionEvent::Scroll {
                t,
                x,
                y,
                dx,
                dy,
                label: None,
            });
    }

    pub(super) fn observe_key_context(&self, t: u64) {
        self.request_context((ActionKind::Key, t), Probe::Focus);
    }

    pub(super) fn observe_stroke_end_context(&self, stroke: &Stroke) {
        if !self.agent_context.load(Ordering::Acquire) {
            return;
        }
        let frame = *self
            .target_frame
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        let mut bounds = [
            f64::INFINITY,
            f64::INFINITY,
            f64::NEG_INFINITY,
            f64::NEG_INFINITY,
        ];
        for point in stroke.pts.chunks_exact(3) {
            let x = frame.x + f64::from(point[0]) / f64::from(SCALE) * frame.width;
            let y = frame.y + f64::from(point[1]) / f64::from(SCALE) * frame.height;
            bounds = [
                bounds[0].min(x),
                bounds[1].min(y),
                bounds[2].max(x),
                bounds[3].max(y),
            ];
        }
        let [x, y, right, bottom] = bounds;
        self.request_context(
            (ActionKind::Stroke, stroke.t0),
            Probe::StrokeEnd([x, y, (right - x).max(1.0), (bottom - y).max(1.0)]),
        );
    }

    fn request_context(&self, key: Key, probe: Probe) {
        if !self.agent_context.load(Ordering::Acquire) {
            return;
        }
        let at = Instant::now();
        let Ok(mut session) = self.action_context.try_lock() else {
            return;
        };
        let Some(session) = session.as_mut() else {
            return;
        };
        if !platform::accessibility_granted() {
            return;
        }
        if key.0 == ActionKind::Scroll {
            if session
                .last_scroll
                .is_some_and(|prior| key.1.saturating_sub(prior) < 250)
            {
                return;
            }
            session.last_scroll = Some(key.1);
        }
        let frame = *self
            .target_frame
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        let passthrough = self
            .passthrough_window_ids
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone();
        #[cfg(target_os = "macos")]
        let dock = *self
            .dock_bounds
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        #[cfg(target_os = "linux")]
        let dock = None;
        let _ = session.jobs.try_send(Request {
            key,
            at,
            probe,
            frame,
            passthrough,
            dock,
        });
    }
}

enum Provider {
    Desktop,
    #[cfg(target_os = "linux")]
    Hyprland(Hyprland),
    #[cfg(target_os = "linux")]
    Unavailable,
}

impl Provider {
    fn open() -> Self {
        #[cfg(target_os = "linux")]
        if crate::capture::desktop::linux::wayland_session() {
            return window::Events::open().map_or(Self::Unavailable, |events| {
                Self::Hyprland(Hyprland {
                    events,
                    stroke: None,
                })
            });
        }
        Self::Desktop
    }

    fn observe(&mut self, request: &Request) -> Option<ActionWindow> {
        match self {
            Self::Desktop => desktop_window(request),
            #[cfg(target_os = "linux")]
            Self::Hyprland(provider) => provider.observe(request),
            #[cfg(target_os = "linux")]
            Self::Unavailable => None,
        }
    }
}

fn desktop_window(request: &Request) -> Option<ActionWindow> {
    let mut windows = platform::raw_windows_now();
    crate::shared::windows::constrain_dock(&mut windows, request.dock);
    let selected = match request.probe {
        Probe::Focus => focused_window(&windows)?,
        Probe::Point(x, y) => window_at(&windows, [x, y, 1.0, 1.0], &request.passthrough)?,
        Probe::StrokeEnd(rect) => window_at(&windows, rect, &request.passthrough)?,
    };
    let frame = request.frame;
    if selected.pid <= 0
        || selected.id == 0
        || selected.layer != 0
        || !overlaps(
            selected.bounds,
            [frame.x, frame.y, frame.width, frame.height],
        )
    {
        return None;
    }
    let provider = if cfg!(target_os = "macos") {
        "macos"
    } else {
        "x11"
    };
    evidence(
        format!("{provider}:{}:{}", selected.pid, selected.id),
        &selected.owner,
        &selected.title,
    )
}

fn window_at<'a>(
    windows: &'a [RawWindow],
    rect: Rect,
    passthrough: &[u32],
) -> Option<&'a RawWindow> {
    let selected = windows
        .iter()
        .find(|w| w.alpha > 0.01 && !passthrough.contains(&w.id) && overlaps(w.bounds, rect))?;
    contains(selected.bounds, rect).then_some(selected)
}

fn overlaps([x, y, w, h]: Rect, [rx, ry, rw, rh]: Rect) -> bool {
    w > 0.0 && h > 0.0 && x < rx + rw && rx < x + w && y < ry + rh && ry < y + h
}

fn contains([x, y, w, h]: Rect, [rx, ry, rw, rh]: Rect) -> bool {
    x <= rx && y <= ry && rx + rw <= x + w && ry + rh <= y + h
}

fn evidence(id: String, app: &str, title: &str) -> Option<ActionWindow> {
    let text = |value: &str| {
        let value = value.trim();
        (!value.is_empty() && value.len() <= 512 && !value.chars().any(char::is_control))
            .then(|| value.to_owned())
    };
    Some(ActionWindow {
        id,
        app: text(app)?,
        title: text(title),
    })
}

#[cfg(target_os = "macos")]
fn focused_window(windows: &[RawWindow]) -> Option<&RawWindow> {
    objc2::rc::autoreleasepool(|_| {
        let pid = objc2_app_kit::NSWorkspace::sharedWorkspace()
            .frontmostApplication()?
            .processIdentifier();
        let mut candidates = windows
            .iter()
            .filter(|w| w.pid == pid && w.layer == 0 && w.alpha > 0.01);
        let first = candidates.next()?;
        candidates.next().is_none().then_some(first)
    })
}

#[cfg(target_os = "linux")]
fn focused_window(windows: &[RawWindow]) -> Option<&RawWindow> {
    let focused = crate::capture::desktop::linux::x11::active_window()?;
    windows.iter().find(|w| {
        w.id == focused.hwnd as u32 && w.pid as u32 == focused.pid && w.title == focused.title
    })
}

#[cfg(target_os = "linux")]
struct Hyprland {
    events: window::Events,
    stroke: Option<window::Window>,
}

#[cfg(target_os = "linux")]
impl Hyprland {
    fn observe(&mut self, request: &Request) -> Option<ActionWindow> {
        if let Some(start) = &self.stroke {
            if self.events.drain_action(start) != Some(false) {
                self.stroke = None;
            }
        } else {
            self.events.drain(None)?;
        }
        let window = window::action_focused()?;
        if matches!(request.probe, Probe::StrokeEnd(_))
            && self.stroke.take().as_ref() != Some(&window)
        {
            return None;
        }
        let rect = match request.probe {
            Probe::Focus => {
                let TargetFrame {
                    x,
                    y,
                    width,
                    height,
                    ..
                } = request.frame;
                let rect = window::layout_rect([x as i32, y as i32, width as i32, height as i32])?;
                if !window.overlaps(rect) {
                    return None;
                }
                None
            }
            Probe::Point(x, y) => Some(window::layout_rect([
                x.floor() as i32,
                y.floor() as i32,
                1,
                1,
            ])?),
            Probe::StrokeEnd([x, y, w, h]) => Some(window::layout_rect([
                x.floor() as i32,
                y.floor() as i32,
                ((x + w).ceil() - x.floor()) as i32,
                ((y + h).ceil() - y.floor()) as i32,
            ])?),
        };
        if let Some(rect) = rect
            && (!window.contains(rect) || !window.action_uncovered(rect)?)
        {
            return None;
        }
        let confirmed = window::action_focused();
        if self
            .events
            .drain_action(self.stroke.as_ref().unwrap_or(&window))?
        {
            self.stroke = None;
            return None;
        }
        if confirmed.as_ref() != Some(&window) {
            return None;
        }
        let context = evidence(window.action_id(), &window.class, &window.title)?;
        if request.key.0 == ActionKind::Stroke && matches!(request.probe, Probe::Point(..)) {
            self.stroke = Some(window);
        }
        Some(context)
    }
}

#[cfg(test)]
mod tests;
