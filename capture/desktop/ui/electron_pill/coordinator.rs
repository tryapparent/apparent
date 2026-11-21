use super::{Session, View};
use crate::capture::desktop::{ApparentCoordinator, HudPillWindow, IslandPhase, apparent_log};
use crate::capture::desktop::{ActiveRecording, CompletedAudioIssue, InputWarning, PillEvent, motion, reveal_clock_ms};
use std::time::{Duration, Instant};
use super as pill_state;
use gpui::Context;

impl ApparentCoordinator {

    pub(in crate::capture::desktop) fn observe_pill_event(&mut self, event: PillEvent) -> Option<(IslandPhase, bool)> {
        let completed = match &event {
            PillEvent::CaptureSaved { frame_count, duration_ms, .. } => Some((*frame_count, *duration_ms)),
            _ => None,
        };
        let now = Instant::now();
        let animation_ms = reveal_clock_ms();
        let elapsed = now.saturating_duration_since(self.reveal.epoch).as_millis() as u64;
        let snapshot = (|| {
            if self.reveal.policy.is_none() {
                self.reveal.policy = Some(pill_state::PolicySession::open()?);
            }
            self.reveal.policy.as_ref().unwrap().dispatch(event, elapsed, animation_ms)
        })();
        let snapshot = match snapshot {
            Ok(snapshot) => snapshot,
            Err(error) => {
                self.reveal.wake = None;
                self.reveal.motion_wake = None;
                apparent_log(format!("Record pill observation failed: {error:#}"));
                return None;
            }
        };
        if snapshot.phase == pill_state::Phase::Recording {
            self.reveal.wake = None;
            self.reveal.motion_wake = snapshot.wake_in_ms.map(|ms| (animation_ms + ms) as f64 / 1000.0);
        } else {
            self.reveal.wake = snapshot.wake_in_ms.map(|ms| now + Duration::from_millis(ms));
            self.reveal.motion_wake = None;
        }
        let phase = match snapshot.phase {
            pill_state::Phase::Hidden => IslandPhase::Hidden,
            pill_state::Phase::Selecting => {
                let Some(mode) = snapshot.mode else { return None };
                IslandPhase::Selecting { mode: mode.into() }
            }
            pill_state::Phase::Recording => IslandPhase::Recording,
            pill_state::Phase::Processing => IslandPhase::Processing,
            pill_state::Phase::Completed => match completed {
                Some((frame_count, duration_ms)) if !matches!(self.island_phase, IslandPhase::Completed { .. }) => {
                    IslandPhase::Completed { finished_at: now, frame_count, duration_ms, inbox_count: 0 }
                }
                _ => self.island_phase,
            },
            pill_state::Phase::Dismissing => IslandPhase::Dismissing,
        };
        Some((phase, snapshot.reveal))
    }

    pub(in crate::capture::desktop) fn completed_audio_issue(&self) -> Option<CompletedAudioIssue> {
        match (&self.completed_dir, &self.review_bundle) {
            (Some(dir), Some((review_dir, _))) if dir == review_dir => self.review_audio_issue,
            _ => None,
        }
    }

    pub(in crate::capture::desktop) fn refresh_pill_presentation(&mut self) {
        let microphone = self.active_recording.as_ref().and_then(ActiveRecording::mic_warning);
        let audio = self.completed_audio_issue();
        let facts = pill_state::Facts {
            phone: self.iphone.is_some(),
            no_words: self.recording_has_no_words(),
            note_count: self.note_ui.as_ref().map_or(0, |notes| notes.saved_count()),
            movable: crate::shared::handoff::experiment("movableRecordingControls"),
            paste: self.completed_dir.is_some(),
            inspect: self.review_bundle.is_some(),
            sharing_enabled: crate::shared::handoff::experiment(crate::connect::hosted::HOSTED_SHARING),
            sharing_online: self.share_online,
            mic_warning: microphone.map(InputWarning::announcement),
            audio_issue: audio.map(CompletedAudioIssue::label),
            microphone_problem: microphone.is_some(),
            audio_problem: audio.is_some(),
        };
        if self.reveal.facts.as_ref() == Some(&facts) {
            return;
        }
        let Some(session) = &self.reveal.policy else { return };
        match session.present(&facts) {
            Ok(presentation) => {
                self.reveal.facts = Some(facts);
                if matches!(self.island_phase, IslandPhase::Completed { .. }) {
                    self.completed_note = Some(presentation.label.clone());
                    self.reveal.completed_presentation = presentation.clone();
                }
                self.reveal.presentation = presentation;
            }
            Err(error) => apparent_log(format!("Record pill presentation failed: {error:#}")),
        }
    }

    pub(in crate::capture::desktop) fn fallback_share(&self) -> Option<bool> {
        self.reveal.completed_presentation.actions.iter().find(|action| action.id == "copy-link")
            .map(|action| action.enabled && self.reveal.completed_presentation.share_indicator != pill_state::ShareIndicator::Uploading)
    }

    pub(in crate::capture::desktop) fn show_completion_text(&mut self, copy: pill_state::CompletionCopy, text: impl Into<String>) {
        self.apply_pill_event(PillEvent::CompletionText { copy, text: Some(text.into()) });
        self.refresh_pill_presentation();
    }

    pub(in crate::capture::desktop) fn advance_pill_deadlines(&mut self) {
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        {
            let open = self.electron_pill.as_ref().is_some_and(|session| session.confirming_public_share());
            if self.reveal.consent_open != open {
                self.reveal.consent_open = open;
                self.apply_pill_event(PillEvent::ConsentChanged { open });
            }
        }
        if self.reveal.wake.is_some_and(|when| when <= Instant::now())
            || self.reveal.motion_wake.is_some_and(|when| when <= motion::now()) {
            self.apply_pill_event(PillEvent::Deadline);
        }

    }

    pub(in crate::capture::desktop) fn select_pill_mode(&mut self, mode: super::SelectionMode) {
        self.apply_pill_event(PillEvent::ModeSelected { mode: mode.into() });
    }

    pub(in crate::capture::desktop) fn reveal_pill_controls(&mut self) {
        let activity = self.telemetry.reveal_activity();
        self.reveal.activity_count = activity;
        self.reveal.pointer_inside = false;
        self.apply_pill_event(PillEvent::RevealOpened { activity: activity as u32 });
    }

    pub(crate) fn begin_system_display_picker(&self) -> Option<crate::capture::engine::runtime::recording::recorder::selection::DisplaySelection> {
        use crate::capture::engine::runtime::recording::recorder::selection::DisplaySelection;
        #[cfg(target_os = "macos")]
        let excluded = {
            let mut ids = self.electron_pill_exclusions.clone();
            super::restore_capture_exclusion(
                &mut ids,
                self.electron_pill.as_ref().and_then(Session::window_number),
                !crate::shared::handoff::experiment("movableRecordingControls"),
            );
            ids
        };
        DisplaySelection::begin(
            #[cfg(target_os = "macos")]
            &excluded,
        )
    }

    fn electron_pill_view(&self, revision: u64) -> View {
        let snapshot = self.pill_snapshot();
        let mut view = View {
            presentation: self.reveal.presentation.clone(),
            revision,
            clock: snapshot.clock,
            reduced_motion: snapshot.reduced_motion,
            input_waveform: snapshot.input_waveform,
            transcript: None,
            notice: None,
            note_tip: None,
        };
        if view.phase == "recording" {
            if let Some(crate::capture::desktop::CaptureSource::Screen {audio: Some(audio), ..}) = self.active_recording.as_ref().map(|recording| &recording.source) {
                view.transcript = audio.streaming_preview();
            }
            view.note_tip = self.recording_note_tip();
        }
        view
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
        self.refresh_pill_presentation();
        self.observe_note_tip();
        let view = self.electron_pill_view(0);
        let selection = self.electron_pill_selection();
        let completion = self.electron_pill.as_ref()
            .filter(|session| !session.has_completion(self.capture_generation))
            .and_then(|_| self.completed_handoff_bundle())
            .map(|(dir, bundle)| crate::shared::handoff::clipboard_summary(bundle, dir));
        if let Some(session) = &mut self.electron_pill {
            session.set_t3_eligible(!self.capture_local_practice && !self.report_capture);
            if let Some(text) = completion {
                session.complete(self.capture_generation, Some(text));
            }
            session.update(view, self.capture_generation, selection);
        }
    }

    pub(in crate::capture::desktop) fn completed_handoff_bundle(
        &self,
    ) -> Option<&(std::path::PathBuf, crate::capture::desktop::ApparentBundle)> {
        if self.capture_local_practice
            || self.completion_pending != Some(self.capture_generation)
            || !matches!(self.island_phase, IslandPhase::Completed { .. })
        {
            return None;
        }
        self.review_bundle.as_ref()
            .filter(|(dir, _)| self.completed_dir.as_ref() == Some(dir))
    }
    pub(crate) fn tick_electron_pill(&mut self, cx: &mut Context<Self>) {
        self.sync_electron_pill();
        if self
            .electron_pill
            .as_ref()
            .is_some_and(|session| !session.healthy())
        {
            // Preserve the real transport/readiness/process state before Drop
            // closes the pipe and starts owned-child cleanup.
            let failure = self.electron_pill.as_mut().map(Session::failure_context);
            apparent_log(format!("Electron recording controls unhealthy; restoring native controls: {}",
                serde_json::json!({"failure":failure})));
            self.electron_pill.take();
            self.electron_pill_failed = true;
            self.electron_pill_routed = false;
            let coordinator = cx.entity().clone();
            if !matches!(self.island_phase, IslandPhase::Hidden | IslandPhase::Dismissing) {
                cx.defer(move |cx| super::super::super::ensure_hud_pill_open(&coordinator, cx));
            }
            return;
        }
        if !self.electron_pill.as_ref().is_some_and(Session::ready) {
            return;
        }
        if self.electron_pill.as_ref().is_some_and(Session::take_window_changed) {
            // Picker/recording windows have different native keyboard roles on
            // Linux. Re-admit the replacement ID before activating its surface.
            self.electron_pill_routed = false;
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::capture::desktop::{ApparentBundle, SharedCaptureTelemetry};
    use std::{path::PathBuf, time::Instant};

    #[test]
    fn t3_recovery_requires_the_current_recordings_completed_bundle() {
        let (sender, _receiver) = flume::unbounded();
        let mut coordinator = ApparentCoordinator::new(SharedCaptureTelemetry::new(sender), None);
        let bundle = |id: &str| -> ApparentBundle {
            serde_json::from_value(serde_json::json!({
                "version": 1, "id": id, "createdAtMs": 0, "durationMs": 1000,
                "target": {"mode": "display", "displayId": 0,
                    "frame": {"x": 0.0, "y": 0.0, "width": 640.0, "height": 480.0, "scale": 1.0}},
                "transcript": {"source": "test", "text": id, "segments": []},
                "strokes": [], "marks": [], "events": [], "keyframes": [], "contactSheet": "c.png"
            })).unwrap()
        };
        coordinator.apply_pill_event(super::PillEvent::CaptureStarted);
        coordinator.apply_pill_event(super::PillEvent::CaptureSealed);
        let first = PathBuf::from("/synthetic/first.apparent");
        coordinator.completed_dir = Some(first.clone());
        coordinator.completion_pending = Some(coordinator.capture_generation);
        coordinator.review_bundle = Some((first, bundle("first")));
        coordinator.apply_pill_event(super::PillEvent::CaptureSaved { recovery: false, text: None, frame_count: 1, duration_ms: 1000 });
        assert_eq!(coordinator.completed_handoff_bundle().unwrap().1.id, "first");

        coordinator.apply_pill_event(super::PillEvent::CaptureStarted);
        assert!(coordinator.completed_handoff_bundle().is_none());
        coordinator.apply_pill_event(super::PillEvent::CaptureSealed);
        assert!(coordinator.completed_handoff_bundle().is_none());
        coordinator.completion_pending = Some(coordinator.capture_generation);
        assert!(coordinator.completed_handoff_bundle().is_none());

        let second = PathBuf::from("/synthetic/second.apparent");
        coordinator.completed_dir = Some(second.clone());
        coordinator.review_bundle = Some((second, bundle("second")));
        coordinator.apply_pill_event(super::PillEvent::CaptureSaved { recovery: false, text: None, frame_count: 1, duration_ms: 1000 });
        assert_eq!(coordinator.completed_handoff_bundle().unwrap().1.id, "second");
    }
}
