use std::sync::{PoisonError, atomic::Ordering};

use super::{ActionContextCollector, SharedCaptureTelemetry};
use crate::shared::model::{InteractionEvent, Stroke};

impl SharedCaptureTelemetry {
    pub fn finish_session(&self) -> (Vec<InteractionEvent>, Vec<Stroke>) {
        let (events, strokes, _) = self.finish_session_with_context();
        (events, strokes)
    }

    pub(in crate::capture) fn finish_session_with_context(
        &self,
    ) -> (
        Vec<InteractionEvent>,
        Vec<Stroke>,
        Option<ActionContextCollector>,
    ) {
        self.active.store(false, Ordering::Release);
        self.selecting.store(false, Ordering::Release);
        *self
            .drag_start
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = None;
        *self
            .shift_press
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = None;
        #[cfg(target_os = "linux")]
        self.set_native_note_window(None);
        self.finish_active_laser(None);
        if let Some(ink) = self
            .live_ink
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .take()
            && ink.pts.len() >= 3
        {
            self.observe_stroke_end_context(&ink);
            #[cfg(any(target_os = "linux", target_os = "macos"))]
            if let Some(session) = self
                .circle_session
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .as_ref()
            {
                session.end_mark(&ink);
            }
            self.strokes
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .push(ink);
        }
        let mut events = std::mem::take(
            &mut *self
                .events
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner),
        );
        let mut strokes = std::mem::take(
            &mut *self
                .strokes
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner),
        );
        let context = self
            .action_context
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .take();
        #[cfg(target_os = "linux")]
        let mut context = context;
        if self.agent_context.swap(false, Ordering::AcqRel) {
            #[cfg(target_os = "linux")]
            let (hits, pins) = crate::capture::engine::accessibility::ax::Prober::shared().finish();
            #[cfg(not(target_os = "linux"))]
            let hits = crate::capture::engine::accessibility::ax::Prober::shared().finish();
            crate::capture::engine::accessibility::ax::apply(&hits, &mut events, &mut strokes);
            #[cfg(target_os = "linux")]
            if let Some(context) = context.as_mut() {
                context.pin_windows = pins;
            }
            if self.capture_mode.load(Ordering::Acquire) != 3 {
                let end = crate::shared::clock::now_epoch_ms();
                let start = end.saturating_sub(self.elapsed_ms());
                let page = crate::capture::desktop::workflow::page::between(start, end);
                crate::capture::desktop::workflow::page::apply(
                    &page,
                    start,
                    &mut events,
                    &mut strokes,
                );
            }
        }
        #[cfg(any(target_os = "linux", target_os = "macos"))]
        self.circle_session
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .take();
        (events, strokes, context)
    }
}
