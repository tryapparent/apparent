use super::{Session, View};
use crate::capture::desktop::{ApparentCoordinator, IslandPhase, apparent_log};
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
        use crate::shared::handoff::{default_config_path, experiment_enabled_in, experiment_overridden,
            experiment_preference_in, experiment_preference_overridden, load_config_from};
        let now = Instant::now();
        let (_, movable, sharing_enabled) = match self.reveal.preferences {
            Some(preferences) if now.duration_since(preferences.0) < Duration::from_millis(500) => preferences,
            _ => {
                let config = load_config_from(&default_config_path());
                let preferences = (
                    now,
                    experiment_overridden("movableRecordingControls")
                        || (!cfg!(test) && experiment_enabled_in(&config, "movableRecordingControls")),
                    experiment_preference_overridden(crate::connect::hosted::HOSTED_SHARING)
                        || (!cfg!(test) && experiment_preference_in(&config, crate::connect::hosted::HOSTED_SHARING)),
                );
                self.reveal.preferences = Some(preferences);
                preferences
            }
        };
        let microphone = self.active_recording.as_ref().and_then(ActiveRecording::mic_warning);
        let audio = self.completed_audio_issue();
        let facts = pill_state::Facts {
            phone: self.iphone.is_some(),
            no_words: self.recording_has_no_words(),
            note_count: self.note_ui.as_ref().map_or(0, |notes| notes.saved_count()),
            movable,
            paste: self.completed_dir.is_some(),
            inspect: self.review_bundle.is_some(),
            sharing_enabled,
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
        let mut view = View {
            presentation: self.reveal.presentation.clone(),
            revision,
            clock: crate::shared::model::format_clock(self.active_recording.as_ref().map(ActiveRecording::elapsed_ms).unwrap_or(self.last_elapsed_ms)),
            reduced_motion: self.reduced_motion,
            input_waveform: None,
            doodle_ink: None,
            soft_bloom: None,
            transcript: None,
            notice: None,
            note_tip: None,
        };
        if view.phase == "recording" {
            if let Some(crate::capture::desktop::CaptureSource::Screen {audio: Some(audio), ..}) = self.active_recording.as_ref().map(|recording| &recording.source) {
                view.transcript = audio.streaming_preview();
                view.input_waveform = Some(audio.input_waveform().unwrap_or([0.0; 24]));
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
    pub(crate) fn ensure_electron_pill(&mut self) {
        if self.electron_pill.is_some()
            || self.electron_pill_retry_at.is_some_and(|retry| Instant::now() < retry)
        {
            return;
        }
        let view = View { revision: 1, ..Default::default() };
        match Session::open(
            view,
            self.capture_generation,
            self.electron_pill_selection(),
        ) {
            Ok(session) => {
                self.electron_pill_retry_at = None;
                self.electron_pill = Some(session);
            }
            Err(error) => {
                apparent_log(format!(
                    "Could not start recording controls: {error:#}"
                ));
                self.electron_pill_retry_at = Some(Instant::now() + Duration::from_secs(5));
            }
        }
    }
    pub(crate) fn sync_electron_pill(&mut self) {
        if !self.electron_pill.as_ref().is_some_and(Session::ready) {
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
        let t3_eligible = !self.capture_local_practice && !self.current_capture_is_report();
        if let Some(session) = &mut self.electron_pill {
            session.set_t3_eligible(t3_eligible);
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
        if self.electron_pill.is_none() {
            self.ensure_electron_pill();
            if self.electron_pill.is_some() { self.place_capsule(); }
        }
        self.sync_electron_pill();
        let unhealthy = self.electron_pill.as_ref().is_some_and(|session| !session.healthy());
        #[cfg(target_os = "macos")]
        let unhealthy = unhealthy || self.electron_pill_exclusion_wait
            .is_some_and(|since| since.elapsed() >= Duration::from_secs(5));
        if unhealthy {
            // Preserve the real transport/readiness/process state before Drop
            // closes the pipe and starts owned-child cleanup.
            let failure = self.electron_pill.as_mut().map(Session::failure_context);
            apparent_log(format!("Electron recording controls unhealthy; scheduling restart: {}",
                serde_json::json!({"failure":failure})));
            let retired = self.electron_pill.take();
            #[cfg(target_os = "macos")]
            if let Some(id) = retired.as_ref().and_then(Session::window_number) {
                self.electron_pill_exclusions.push(id);
            }
            drop(retired);
            #[cfg(target_os = "macos")]
            { self.electron_pill_exclusion_wait = None; }
            self.electron_pill_retry_at = Some(Instant::now() + Duration::from_secs(5));
            self.electron_pill_routed = false;
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
                self.electron_pill_exclusion_wait.get_or_insert_with(Instant::now);
                return;
            }
            #[cfg(target_os = "macos")]
            { self.electron_pill_exclusion_wait = None; }
            self.electron_pill_routed = true;
            if let Some(session) = &mut self.electron_pill {
                session.activate();
            }
        }
        let actions = self
            .electron_pill
            .as_mut()
            .map(Session::actions)
            .unwrap_or_default();
        for action in actions {
            self.apply_pill_action(action, cx);
            self.sync_electron_pill();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::capture::desktop::{ApparentBundle, SharedCaptureTelemetry};
    use std::path::PathBuf;

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
