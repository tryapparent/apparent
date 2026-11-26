use crate::capture::engine::runtime::recording::recorder::{StartError, start::ScreenTracks};
#[cfg(target_os = "linux")]
use crate::capture::engine::runtime::recording::recorder::start::{PendingStartCancellation, StartPreparation};

struct DesktopScreenStart {
    target: TargetInfo,
    bundle_dir: PathBuf,
    overlay: Option<LaserOverlay>,
    microphone: bool,
    user_started: bool,
    allow_notes: bool,
    started: Instant,
    performance: Option<workflow::performance::RecordingPerformance>,
    startup: Option<workflow::performance::Startup>,
}

#[cfg(target_os = "linux")]
enum PendingScreenTracks {
    Cancelled,
    ProtectionFailed(anyhow::Error),
    Started(Result<ScreenTracks, StartError>),
}


enum SourceTransition {
    Idle,
    #[cfg(target_os = "linux")]
    Starting(Arc<PendingStartCancellation>),
    Releasing(u64),
}

impl ApparentCoordinator {
    fn source_is_stopping(&self) -> bool {
        !matches!(self.stopping_source, SourceTransition::Idle) || (self.lab && self.is_processing())
    }

    fn screen_start_is_pending(&self) -> bool {
        #[cfg(target_os = "linux")]
        if let SourceTransition::Starting(cancellation) = &self.stopping_source {
            return !cancellation.requested();
        }
        false
    }

    #[cfg(target_os = "linux")]
    fn cancel_pending_screen_start(&self) -> anyhow::Result<()> {
        if let SourceTransition::Starting(cancellation) = &self.stopping_source {
            cancellation.request()?;
        }
        Ok(())
    }

    pub fn cancel_recording(&mut self, cx: &mut Context<Self>) {
        #[cfg(target_os = "linux")]
        if let Err(error) = self.cancel_pending_screen_start() {
            apparent_log(format!("Could not persist cancellation; startup is still active: {error:#}"));
            if let Ok(mut status) = CAPTURE_STATUS.lock() {
                *status = Some("Could not cancel the recording. Try again.".into());
            }
            return;
        }
        self.cancel_capture_attempt();
        self.present_capture_cancellation(cx);
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    fn agent_capture_control_response(
        &self,
        id: &str,
        outcome: workflow::agent_capture::Outcome,
    ) -> serde_json::Value {
        use workflow::agent_capture::Outcome;
        let outcome = if outcome == Outcome::Cancelled && self.screen_start_is_pending() {
            Outcome::NotReady
        } else {
            outcome
        };
        let mut response = self.agent_captures.inspect(id);
        response["outcome"] = serde_json::json!(outcome);
        response["state"] = serde_json::json!(self.agent_state());
        if outcome == Outcome::AlreadyEnded && response["status"] == "unknown" {
            response["error"] = serde_json::Value::Null;
        }
        response
    }

    pub(crate) fn capture_busy(&self) -> bool {
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        if self.agent_capture_id.is_some() || display_selection::pending() { return true; }
        !matches!(self.stopping_source, SourceTransition::Idle) || self.pending_finalizers > 0 || self.lab || self.active_recording.is_some()
            || self.is_selecting() || self.is_processing() || self.iphone_preview.is_some()
            || self.recording_shortcut_key
    }

    fn present_recording_island(&mut self, cx: &mut Context<Self>) {
        self.confirm_recording_started();
        self.show_recording_island(cx);
    }

    fn confirm_recording_started(&mut self) {
        if !self.lab {
            crate::capture::desktop::settings::onboarding::Progress::recording_started();
            if self.onboarding.as_ref().is_some_and(|session| {
                session.mode() == crate::capture::desktop::settings::onboarding::Mode::Tour
                    && !session.local_practice()
            }) {
                self.cancel_onboarding_editor();
                self.onboarding = None;
            }
        }
    }

    fn show_recording_island(&mut self, cx: &mut Context<Self>) {
        self.apply_pill_event(PillEvent::CaptureStarted);
        let entity = cx.entity().clone();
        cx.defer(move |cx| {
            close_review_window(cx);
            close_picker_window(cx);
            entity.update(cx, |coord, _| coord.ensure_electron_pill());
        });
        cx.notify();
    }

    #[cfg(target_os = "linux")]
    fn start_screen_in_background(
        &mut self,
        draft: DesktopScreenStart,
        preparation: StartPreparation,
        cancellation: Arc<PendingStartCancellation>,
        cx: &mut Context<Self>,
    ) {
        let target = draft.target.clone();
        let bundle_dir = draft.bundle_dir.clone();
        let orphaned_bundle_dir = draft.bundle_dir.clone();
        let telemetry = self.telemetry.clone();
        let startup = draft.startup.clone();
        let microphone = draft.microphone;
        let worker_cancellation = cancellation.clone();
        cx.spawn(async move |entity, cx| {
            let tracks = cx.background_executor().spawn(async move {
                let source = crate::capture::engine::runtime::recording::recorder::PreparedSource::prepare_direct(
                    &target, startup.clone(),
                );
                let preparation = match preparation.protect(&bundle_dir) {
                    Ok(preparation) => preparation,
                    Err(error) => return PendingScreenTracks::ProtectionFailed(error),
                };
                if worker_cancellation.requested() {
                    if let Err(error) = preparation.abandon(&bundle_dir) {
                        apparent_log(format!("Failed cancelled startup cleanup: {error:#}"));
                    }
                    return PendingScreenTracks::Cancelled;
                }
                let stream_admission = crate::shared::handoff::experiment_preference("labs.localStreamingTranscription")
                    .then(workflow::local_transcription::admission);
                workflow::performance::StartupPoint::TracksEnter.record_in(startup.as_ref());
                PendingScreenTracks::Started(ScreenCaptureSession::start_tracks(
                    &target, &bundle_dir, &telemetry, microphone, stream_admission,
                    preparation, source.map(|source| source.admit()), startup.as_ref(),
                ))
            }).await;
            let mut tracks = Some(tracks);
            let _ = entity.update(cx, |coord, cx| {
                let result = tracks.take().expect("one pending screen start");
                let cancelled = cancellation.requested();
                coord.stopping_source = SourceTransition::Idle;
                if !cancelled
                    && matches!(result, PendingScreenTracks::Started(Err(_)) | PendingScreenTracks::ProtectionFailed(_))
                    && let Some(id) = coord.agent_capture_id.take()
                {
                    coord.agent_captures.set(&id, "failed", None, Some("start_failed"));
                }
                match result {
                    PendingScreenTracks::Started(tracks) if !cancelled => {
                        coord.complete_screen_start(draft, tracks, true, cx);
                    }
                    PendingScreenTracks::ProtectionFailed(error) if !cancelled => {
                        coord.refuse_raw_protection(&error, cx);
                    }
                    other => {
                        abandon_pending_screen(&cancellation, &draft.bundle_dir, other);
                        coord.cancel_recording(cx);
                    }
                }
                coord.publish_capture_busy();
            });
            if let Some(tracks) = tracks {
                abandon_pending_screen(&cancellation, &orphaned_bundle_dir, tracks);
            }
        }).detach();
    }

}

#[cfg(target_os = "linux")]
fn abandon_pending_screen(cancellation: &PendingStartCancellation, bundle_dir: &std::path::Path, result: PendingScreenTracks) {
    if let PendingScreenTracks::Started(Ok((screen, audio, windows))) = result {
        let cleanup = cancellation.abandon(bundle_dir, || {
            let _ = screen.stop();
            if let Some(audio) = audio { let _ = audio.stop(); }
            drop(windows);
        });
        if let Err(error) = cleanup { apparent_log(format!("Failed cancelled startup cleanup: {error:#}")); }
    }
}
