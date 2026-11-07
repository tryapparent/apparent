//! Native Board observations into the SAME ordered retained source. No renderer
//! points, source reconstruction, canonical mapping or blocking OS probes here.
use super::*;
use crate::capture::desktop::ui::whiteboard::observations::{
    PaperAction, PaperObservation, PaperObserver, PaperWindow,
};
use std::sync::atomic::{AtomicBool, Ordering};

pub(super) struct History {
    logical_id: String,
    window: Option<PaperWindow>,
    surface: Option<Value>,
    gesture: Option<Gesture>,
    current: Vec<String>,
    incarnations: usize,
    revision: u64,
}
impl History {
    pub(super) fn new() -> Result<Self, &'static str> {
        Ok(Self {
            logical_id: id()?,
            window: None,
            surface: None,
            gesture: None,
            current: Vec::new(),
            incarnations: 0,
            revision: 0,
        })
    }
    pub(super) fn closed(&self) -> bool {
        self.window.is_none() && self.gesture.is_none()
    }
    pub(super) fn gesture_active(&self) -> bool {
        self.gesture.is_some()
    }
    pub(super) fn revision(&self) -> u64 {
        self.revision
    }
    pub(super) fn view(&self, _revision: u64) -> Value {
        json!({"nativeRevision":self.revision,"open":self.window.is_some(),
            "strokeCount":self.current.len(),"activeGesture":self.gesture.is_some()})
    }
}
pub(super) struct Observer {
    pub state: Arc<Mutex<State>>,
    pub invalid: Arc<AtomicBool>,
}
impl PaperObserver for Observer {
    fn observe(&self, observation: PaperObservation) {
        // Never hold the GUI behind a collector/native probe. Contention means
        // unknown collection, not a dropped point or accepted empty history.
        let Ok(mut s) = self.state.try_lock() else {
            self.invalid.store(true, Ordering::Release);
            return;
        };
        if s.phase != Phase::Active {
            return;
        }
        if self.invalid.load(Ordering::Acquire) || accept(&mut s, observation).is_err() {
            s.phase = Phase::Unavailable;
            self.invalid.store(true, Ordering::Release);
        }
    }
}
fn retain(s: &mut State, events: &[Value]) -> Result<(), &'static str> {
    s.buffer
        .retain(events)
        .map_err(|_| "paper-retention-unavailable")?;
    s.revision = s.revision.checked_add(1).ok_or("revision-bound")?;
    Ok(())
}
fn surface(s: &mut State, window: &PaperWindow, time: u64) -> Result<(), &'static str> {
    if s.paper.window.as_ref() == Some(window) {
        return Ok(());
    }
    if s.paper.gesture.is_some() || s.gesture.is_some() {
        return Err("paper-source-changed");
    }
    if s.paper.incarnations >= 8 {
        return Err("paper-surface-bound");
    }
    let value = json!({"surfaceId":s.paper.logical_id,"transformId":id()?,
        "nativeIncarnation":format!("x11:{}:{}",window.handle,window.incarnation),
        "target":"whiteboard-canvas","pointSpace":"paper-logical",
        "contentRectangle":rectangle(window.content_rectangle),"plane":{"width":1600,"height":1100}});
    let event = json!({"kind":"surface-state","state":if s.paper.window.is_some(){"replaced"}else{"opened"},
        "surface":value,"observedAtNs":time.to_string(),"nativeRevision":s.revision+1});
    retain(s, &[event])?;
    s.paper.incarnations += 1;
    s.paper.window = Some(window.clone());
    s.paper.surface = Some(value);
    Ok(())
}
fn accept(s: &mut State, observation: PaperObservation) -> Result<(), &'static str> {
    let PaperObservation::Observed {
        window,
        at_ns,
        action,
    } = observation
    else {
        return Err("paper-unavailable");
    };
    // Repainting an unchanged surface is no new input/effect observation and
    // must not invalidate a Board CAS or advance the gesture observation clock.
    if matches!(action, PaperAction::Surface) && s.paper.window.as_ref() == Some(&window) {
        return Ok(());
    }
    stamp(s, at_ns)?;
    s.paper.revision = s
        .paper
        .revision
        .checked_add(1)
        .ok_or("paper-revision-bound")?;
    if matches!(action, PaperAction::Closed) {
        if s.paper.window.as_ref() != Some(&window) {
            return Err("paper-close-identity");
        }
        // Provisional native input is not accepted history. Closing discards it
        // but preserves every earlier committed gesture and the current stack.
        s.paper.gesture = None;
        let value = s.paper.surface.clone().ok_or("paper-not-open")?;
        retain(
            s,
            &[
                json!({"kind":"surface-state","state":"closed","surface":value,
            "observedAtNs":at_ns.to_string(),"nativeRevision":s.revision+1}),
            ],
        )?;
        s.paper.window = None;
        s.paper.surface = None;
        return Ok(());
    }
    surface(s, &window, at_ns)?;
    match action {
        PaperAction::Surface => {}
        PaperAction::Begin(p) => {
            if s.paper.gesture.is_some() || s.gesture.is_some() {
                return Err("gesture-overlap");
            }
            s.paper.gesture = Some(Gesture {
                points: vec![Point {
                    position: [p[0] as f64, p[1] as f64],
                    time: at_ns,
                }],
                rgb: None,
            });
        }
        PaperAction::Point(p) => {
            let g = s.paper.gesture.as_mut().ok_or("paper-missing-begin")?;
            if g.points.len() >= 2400 {
                return Err("paper-point-bound");
            }
            g.points.push(Point {
                position: [p[0] as f64, p[1] as f64],
                time: at_ns,
            });
        }
        PaperAction::Commit => {
            let g = s.paper.gesture.take().ok_or("paper-missing-begin")?;
            let surface = s.paper.surface.clone().ok_or("paper-not-open")?;
            let gesture_id = match retain_gesture(s, &surface, &g, at_ns, 1) {
                Ok(id) => id,
                Err(error) => {s.paper.gesture=Some(g);return Err(error);}
            };
            s.paper.current.push(gesture_id);
        }
        PaperAction::Undo { active } | PaperAction::Clear { active } => {
            if active != s.paper.gesture.is_some() || s.gesture.is_some() {
                return Err("paper-state-mismatch");
            }
            s.paper.gesture = None;
            let clear = matches!(action, PaperAction::Clear { .. });
            let value = s.paper.surface.as_ref().ok_or("paper-not-open")?;
            let event = json!({"kind":if clear{"clear"}else{"undo"},"surfaceId":value["surfaceId"],
                "transformId":value["transformId"],"nativeIncarnation":value["nativeIncarnation"],
                "observedAtNs":at_ns.to_string(),"nativeRevision":s.revision+1});
            retain(s, &[event])?;
            if clear {
                s.paper.current.clear();
            } else if !active {
                s.paper.current.pop();
            }
        }
        PaperAction::Closed => unreachable!(),
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::capture::desktop::ui::whiteboard::Board;
    fn setup() -> (NativeInkSource, Board, PaperWindow) {
        let (tx, _) = flume::unbounded();
        let telemetry = SharedCaptureTelemetry::new(tx);
        telemetry.reset_for_session(crate::shared::model::TargetFrame {
            x: 0.,
            y: 0.,
            width: 1280.,
            height: 800.,
            scale: 1.,
        });
        telemetry.active.store(false, Ordering::Release);
        let board = Board::default();
        let mut source = NativeInkSource::new(
            telemetry,
            &"a".repeat(32),
            "original",
            "generation",
            "boot".into(),
            json!({}),
            Arc::new(|| {
                Ok(Output {
                    name: "fixture".into(),
                    rect: [0., 0., 1280., 800.],
                    monitor: 1,
                })
            }),
        )
        .unwrap()
        .attach_paper(board.native_paper.clone());
        source.clock = Arc::new(|| Ok(1000));
        source
            .activate(
                &source.capture_id,
                &source.producer_id,
                1,
                &source.boot,
                "0",
            )
            .unwrap();
        (
            source,
            board,
            PaperWindow {
                handle: 42,
                incarnation: "first-native-open".into(),
                content_rectangle: [100., 164., 720., 476.],
            },
        )
    }
    fn emit(board: &Board, w: &PaperWindow, t: u64, a: PaperAction) {
        board.native_paper.emit(Some(w.clone()), Some(t), a);
    }
    fn collected(source: &NativeInkSource) -> Vec<Value> {
        let mut all = Vec::new();
        while let Some(batch) = source.read_batch().unwrap() {
            all.extend(serde_json::from_str::<Vec<Value>>(&batch.events_json).unwrap());
            source
                .acknowledge(batch.sequence, &batch.batch_sha256)
                .unwrap();
        }
        all
    }
    fn gesture(board: &mut Board, w: &PaperWindow, t: u64) {
        let p = [13.25, 15.5];
        assert!(board.start(p));
        emit(board, w, t, PaperAction::Begin(p));
        let accepted = board.extend([-20., 1200.]).unwrap();
        assert_eq!(accepted, [0., 1100.]);
        emit(board, w, t + 1, PaperAction::Point(accepted));
        assert!(board.finish());
        emit(board, w, t + 2, PaperAction::Commit);
    }
    #[test]
    fn real_board_acceptance_clipping_and_immutable_history_survive_undo_clear_and_reopen() {
        let (source, mut board, window) = setup();
        emit(&board, &window, 1, PaperAction::Surface);
        assert!(
            !source.telemetry.active.load(Ordering::Acquire),
            "painting must not admit the legacy recorder"
        );
        assert!(
            source
                .telemetry
                .native_ink_visible_scope
                .load(Ordering::Acquire)
        );
        gesture(&mut board, &window, 2);
        let history = collected(&source);
        let begin = history.iter().find(|e| e["kind"] == "begin").unwrap();
        assert_eq!(begin["x"], 13.25);
        assert_eq!(begin["y"], 15.5);
        assert!(begin.get("rgb").is_none());
        assert_eq!(
            history.iter().find(|e| e["kind"] == "points").unwrap()["points"][0]["y"],
            1100.
        );
        let old_surface = history[0]["surface"].clone();
        emit(&board, &window, 5, PaperAction::Closed);
        let mut reopened = window.clone();
        reopened.handle = 43;
        reopened.incarnation = "second-native-open".into();
        emit(&board, &reopened, 6, PaperAction::Surface);
        assert_eq!(board.strokes.len(), 1);
        let reopened_events = collected(&source);
        let new_surface = &reopened_events[1]["surface"];
        assert_eq!(old_surface["surfaceId"], new_surface["surfaceId"]);
        assert_ne!(old_surface["transformId"], new_surface["transformId"]);
        assert_ne!(
            old_surface["nativeIncarnation"],
            new_surface["nativeIncarnation"]
        );
        assert!(board.start([1., 2.]));
        emit(&board, &reopened, 7, PaperAction::Begin([1., 2.]));
        board.undo();
        emit(&board, &reopened, 8, PaperAction::Undo { active: true });
        assert_eq!(board.strokes.len(), 1);
        assert_eq!(source.state.lock().unwrap().paper.view(0)["strokeCount"], 1);
        board.undo();
        emit(&board, &reopened, 9, PaperAction::Undo { active: false });
        assert!(board.strokes.is_empty());
        gesture(&mut board, &reopened, 10);
        board.clear();
        emit(&board, &reopened, 13, PaperAction::Clear { active: false });
        let later = collected(&source);
        assert_eq!(later.iter().filter(|e| e["kind"] == "commit").count(), 1);
        assert_eq!(
            history.iter().filter(|e| e["kind"] == "commit").count(),
            1,
            "undo/clear never rewrites original accepted bytes"
        );
        assert_eq!(source.state.lock().unwrap().paper.view(0)["strokeCount"], 0);
        emit(&board, &reopened, 14, PaperAction::Closed);
        assert!(source.seal_and_drain().is_ok());
        assert!(!board.native_paper.active());
    }
    #[test]
    fn board_must_close_before_seal_and_geometry_clock_or_contention_never_claim_empty_success() {
        let (source, mut board, window) = setup();
        emit(&board, &window, 1, PaperAction::Surface);
        assert!(
            source.seal_and_drain().is_err(),
            "an open native window is not a positive closed/drained observation"
        );
        assert!(source.read_batch().is_err());
        let (source, mut board, window) = setup();
        emit(&board, &window, 1, PaperAction::Surface);
        assert!(board.start([1., 2.]));
        emit(&board, &window, 2, PaperAction::Begin([1., 2.]));
        let mut moved = window.clone();
        moved.content_rectangle[0] += 1.;
        emit(&board, &moved, 3, PaperAction::Surface);
        assert!(source.read_batch().is_err());
        assert!(source.seal_and_drain().is_err());
        let (source, board, window) = setup();
        let lock = source.state.lock().unwrap();
        emit(&board, &window, 1, PaperAction::Surface);
        drop(lock);
        assert!(source.invalid.load(Ordering::Acquire));
        assert!(source.read_batch().is_err());
        let (source, board, window) = setup();
        emit(&board, &window, 5, PaperAction::Surface);
        emit(&board, &window, 4, PaperAction::Closed);
        assert!(source.read_batch().is_err());
    }
}
