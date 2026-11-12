//! Presentation routing and recovery; capture policy stays with the coordinator.
use super::{Session, View};
use crate::capture::desktop::{ApparentCoordinator, HudPillWindow, IslandPhase, apparent_log};
use gpui::Context;

impl ApparentCoordinator {
    fn electron_pill_view(&self, revision: u64) -> View {
        View::new(
            &self.pill_snapshot(),
            revision,
            crate::shared::handoff::experiment("movableRecordingControls"),
        )
        .with_handoff(self.completed_dir.is_some(), self.review_bundle.is_some())
        .with_notes(self.note_ui.as_ref().map_or(0, |notes| notes.saved_count()))
        .with_foreground_upload(
            self.share_pending.is_some() && crate::connect::hosted::foreground_progress().is_some(),
            self.completed_note.as_deref().is_some_and(|note| note.starts_with("Upload failed") || note.starts_with("Upload cancelled")),
        )
    }
    fn electron_pill_selection(&self) -> super::session::Selection {
        (
            self.completed_dir.clone(),
            self.review_bundle.as_ref().map(|(path, _)| path.clone()),
        )
    }
    pub(crate) fn reconcile_electron_pill(&mut self) {
        #[cfg(target_os = "macos")]
        if !self.is_recording() && !self.is_processing() && !Self::electron_pill_compatible() {
            if let Some(session) = self.electron_pill.take() {
                if let Some(id) = session.window_number() {
                    self.electron_pill_exclusions.push(id);
                }
                // Closing is asynchronous. Preserve this exact window's exclusion in
                // the next stream's initial filter, before it can supply any frame.
                drop(session);
                self.electron_pill_failed = true;
            }
            self.electron_pill_routed = false;
        }
    }
    fn electron_pill_compatible() -> bool {
        #[cfg(target_os = "macos")]
        return crate::capture::desktop::native::pill::PillStyle::current()
            != crate::capture::desktop::native::pill::PillStyle::Glass;
        #[cfg(target_os = "linux")]
        true
    }
    pub(crate) fn ensure_electron_pill(&mut self) {
        self.reconcile_electron_pill();
        if self.electron_pill.is_some()
            || self.electron_pill_failed
            || !Self::electron_pill_compatible()
        {
            return;
        }
        let view = self.electron_pill_view(1);
        match Session::open(
            view,
            self.capture_generation,
            self.electron_pill_selection(),
        ) {
            Ok(session) => self.electron_pill = Some(session),
            Err(error) => {
                apparent_log(format!(
                    "Recording controls retain native presentation: {error:#}"
                ));
                self.electron_pill_failed = true;
            }
        }
    }
    pub(crate) fn sync_electron_pill(&mut self) {
        if self.electron_pill.is_none() {
            return;
        }
        let view = self.electron_pill_view(0);
        let selection = self.electron_pill_selection();
        if let Some(session) = &mut self.electron_pill {
            session.update(view, self.capture_generation, selection);
        }
    }
    pub(crate) fn tick_electron_pill(&mut self, cx: &mut Context<Self>) {
        self.sync_electron_pill();
        if self
            .electron_pill
            .as_ref()
            .is_some_and(|session| !session.healthy())
        {
            self.electron_pill.take();
            self.electron_pill_failed = true;
            self.electron_pill_routed = false;
            apparent_log("Electron recording controls exited; restoring native controls");
            let coordinator = cx.entity().clone();
            if !matches!(self.island_phase, IslandPhase::Hidden | IslandPhase::Dismissing) {
                cx.defer(move |cx| super::super::super::ensure_hud_pill_open(&coordinator, cx));
            }
            return;
        }
        if !self.electron_pill.as_ref().is_some_and(Session::ready) {
            return;
        }
        if !self.electron_pill_routed {
            {
                let mut excluded = self
                    .telemetry
                    .excluded_window_ids
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner);
                super::restore_capture_exclusion(&mut excluded,
                    self.electron_pill.as_ref().and_then(Session::window_number),
                    cfg!(target_os = "linux") || !crate::shared::handoff::experiment("movableRecordingControls"));
            }
            #[cfg(target_os = "macos")]
            if (self.is_recording() || self.is_processing())
                && !crate::shared::handoff::experiment("movableRecordingControls")
                && !super::capture_exclusion_ready(
                    self.electron_pill.as_ref().and_then(Session::window_number),
                    &self.telemetry.applied_excluded_window_ids.lock()
                        .unwrap_or_else(std::sync::PoisonError::into_inner),
                    !self.lab && self.telemetry.capture_mode.load(std::sync::atomic::Ordering::Acquire) != 3)
            {
                // Keep the already excluded native surface until SCK confirms
                // this child's ID is in the actual filter, not merely requested.
                return;
            }
            self.electron_pill_routed = true;
            self.island_await_frame = false;
            self.native_pill.take();
            // Only the previous pill closes; picker/ink and recordings retain their owner.
            let coordinator = cx.entity().clone();
            cx.defer(move |cx| {
                for handle in cx.windows() {
                    if handle.downcast::<HudPillWindow>().is_some() {
                        let _ = handle.update(cx, |_, window, _| window.remove_window());
                    }
                }
                coordinator.update(cx, |coord, _| {
                    if let Some(session) = &mut coord.electron_pill {
                        session.activate();
                    }
                });
            });
        }
        let actions = self
            .electron_pill
            .as_mut()
            .map(Session::actions)
            .unwrap_or_default();
        for action in actions {
            // Each action was admitted against the freshly projected state, never renderer policy.
            self.apply_pill_action(action, cx);
            self.sync_electron_pill();
        }
        if matches!(self.island_phase, IslandPhase::Hidden) {
            self.sync_electron_pill();
        }
    }
}
