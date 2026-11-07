//! Observations at the existing native paper callbacks, never reconstructed from
//! Board arrays or supplied by a renderer. Installing an observer is privileged;
//! it does not open a window, admit input, or establish Engine registration.
use std::sync::{Arc, Mutex};

#[derive(Clone, Debug, PartialEq)]
pub(in crate::capture::desktop) struct PaperWindow {
    /// Actual X11/XWayland ID associated by the existing native adapter at open.
    /// GPUI's internal entity/window ID is not an operating-system window ID.
    pub handle: u64,
    /// Fresh native owner nonce for this opened window; logical Board survives it.
    pub incarnation: String,
    /// Actual scale1 native client viewport excluding the 64-point toolbar.
    pub content_rectangle: [f64; 4],
}
#[derive(Clone, Debug, PartialEq)]
pub(in crate::capture::desktop) enum PaperAction {
    Surface,
    Begin([f32; 2]),
    Point([f32; 2]),
    Commit,
    Undo { active: bool },
    Clear { active: bool },
    Closed,
}
#[derive(Clone, Debug, PartialEq)]
pub(in crate::capture::desktop) enum PaperObservation {
    Observed {
        window: PaperWindow,
        at_ns: u64,
        action: PaperAction,
    },
    Unavailable,
}
/// Callbacks must only retain bounded original observations, with no blocking
/// native probes, network, Engine RPC or application policy on the GUI thread.
pub(in crate::capture::desktop) trait PaperObserver:
    Send + Sync
{
    fn observe(&self, observation: PaperObservation);
}
#[derive(Clone, Default)]
pub(in crate::capture::desktop) struct PaperTap {
    observer: Arc<Mutex<Option<Arc<dyn PaperObserver>>>>,
}
impl PaperTap {
    pub fn install(&self, observer: Arc<dyn PaperObserver>) -> bool {
        let Ok(mut slot) = self.observer.lock() else {
            return false;
        };
        if slot.is_some() {
            return false;
        }
        *slot = Some(observer);
        true
    }
    pub fn remove(&self, observer: &Arc<dyn PaperObserver>) -> bool {
        let Ok(mut slot) = self.observer.lock() else {
            return false;
        };
        if !slot
            .as_ref()
            .is_some_and(|current| Arc::ptr_eq(current, observer))
        {
            return false;
        }
        *slot = None;
        true
    }
    pub fn active(&self) -> bool {
        self.observer.lock().map_or(true, |slot| slot.is_some())
    }
    pub fn emit(&self, window: Option<PaperWindow>, at_ns: Option<u64>, action: PaperAction) {
        // This gate stays held through the bounded callback. Removal therefore
        // positively drains actual in-flight callbacks, not merely a flag.
        let Ok(slot) = self.observer.lock() else {
            return;
        };
        let Some(observer) = slot.as_ref() else {
            return;
        };
        let value = match (window, at_ns) {
            (Some(window), Some(at_ns))
                if window.handle > 0
                    && !window.incarnation.is_empty()
                    && window.incarnation.len() <= 128
                    && !window.incarnation.chars().any(char::is_control)
                    && window.content_rectangle.iter().all(|n| n.is_finite())
                    && window.content_rectangle[2] > 0.
                    && window.content_rectangle[3] > 0.
                    && match &action {
                        PaperAction::Begin(p) | PaperAction::Point(p) => {
                            p.iter().all(|n| n.is_finite())
                        }
                        _ => true,
                    } =>
            {
                PaperObservation::Observed {
                    window,
                    at_ns,
                    action,
                }
            }
            _ => PaperObservation::Unavailable,
        };
        observer.observe(value);
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;
    struct Observer(Mutex<Vec<PaperObservation>>);
    impl PaperObserver for Observer {
        fn observe(&self, o: PaperObservation) {
            self.0.lock().unwrap().push(o);
        }
    }
    #[test]
    fn callback_tap_preserves_native_paper_coordinates_and_original_close_tuple() {
        let observer = Arc::new(Observer(Mutex::new(Vec::new())));
        let port: Arc<dyn PaperObserver> = observer.clone();
        let mut tap = PaperTap::default();
        let window = PaperWindow {
            handle: 17,
            incarnation: "original-native-window".into(),
            content_rectangle: [200., 164., 720., 476.],
        };
        tap.emit(
            Some(window.clone()),
            Some(1),
            PaperAction::Begin([3.25, 4.5]),
        );
        assert!(observer.0.lock().unwrap().is_empty());
        assert!(tap.install(port.clone()));
        assert!(!tap.install(port.clone()));
        tap.emit(
            Some(window.clone()),
            Some(2),
            PaperAction::Begin([3.25, 4.5]),
        );
        tap.emit(Some(window.clone()), Some(3), PaperAction::Closed);
        assert_eq!(
            *observer.0.lock().unwrap(),
            vec![
                PaperObservation::Observed {
                    window: window.clone(),
                    at_ns: 2,
                    action: PaperAction::Begin([3.25, 4.5])
                },
                PaperObservation::Observed {
                    window,
                    at_ns: 3,
                    action: PaperAction::Closed
                }
            ]
        );
        let foreign: Arc<dyn PaperObserver> = Arc::new(Observer(Mutex::new(Vec::new())));
        assert!(!tap.remove(&foreign));
        assert!(tap.remove(&port));
    }
    #[test]
    fn absent_native_geometry_or_clock_is_unavailable_not_accepted_empty() {
        let observer = Arc::new(Observer(Mutex::new(Vec::new())));
        let mut tap = PaperTap::default();
        tap.install(observer.clone());
        tap.emit(None, Some(1), PaperAction::Commit);
        tap.emit(None, None, PaperAction::Closed);
        tap.emit(
            Some(PaperWindow {
                handle: 0,
                incarnation: "native".into(),
                content_rectangle: [0., 64., 720., 476.],
            }),
            Some(2),
            PaperAction::Surface,
        );
        tap.emit(
            Some(PaperWindow {
                handle: 17,
                incarnation: "native".into(),
                content_rectangle: [0., 64., 720., 476.],
            }),
            Some(2),
            PaperAction::Point([f32::NAN, 20.]),
        );
        assert_eq!(
            *observer.0.lock().unwrap(),
            vec![
                PaperObservation::Unavailable,
                PaperObservation::Unavailable,
                PaperObservation::Unavailable,
                PaperObservation::Unavailable
            ]
        );
    }
}
