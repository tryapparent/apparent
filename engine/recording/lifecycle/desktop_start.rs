impl ApparentCoordinator {
    pub fn start_recording_with_target(&mut self, target: impl FnOnce(bool) -> TargetInfo, cx: &mut Context<Self>) {
        self.start_recording_from(
            target,
            None,
            #[cfg(target_os = "linux")]
            None,
            cx,
        );
    }

    fn choose_system_display(&mut self, cx: &mut Context<Self>) -> bool {
        if self.lab || self.agent_capture_id.is_some()
            || !display_selection::requested()
        {
            return false;
        }
        if crate::capture::desktop::workflow::shutdown::requested()
            || self.is_recording() || self.source_is_stopping()
        {
            return true;
        }
        let Some(picker) = self.begin_system_display_picker() else { return true; };
        cx.spawn(async move |entity, cx| {
            let selected = picker.acquire(|| cx.background_executor().timer(Duration::from_millis(100))).await;
            let _ = entity.update(cx, |coord, cx| match selected {
                Some(selected) => coord.start_recording_from(
                    |_| selected.target,
                    Some(selected.source),
                    #[cfg(target_os = "linux")]
                    selected.storage,
                    cx,
                ),
                None => coord.cancel_recording(cx),
            });
        }).detach();
        true
    }

    fn discard_recording(&mut self) -> Option<(TargetInfo, Option<LaserOverlay>)> {
        #[cfg(target_os = "linux")]
        use crate::capture::engine::runtime::recording::recorder::{fd_path, verify_directory};
        #[cfg(target_os = "linux")]
        let storage = self.active_recording.as_ref().and_then(|recording| match &recording.source {
            CaptureSource::Screen { session, .. } => session.storage_dir.as_ref(),
            _ => None,
        });
        if let Some(rec) = &self.active_recording
            && !matches!(rec.source, CaptureSource::Lab)
        {
            #[cfg(target_os = "linux")]
            let pinned_path = storage.map(fd_path);
            #[cfg(not(target_os = "linux"))]
            let pinned_path: Option<std::path::PathBuf> = None;
            let directory = pinned_path.as_deref().unwrap_or(&rec.bundle_dir);
            if let Err(error) = crate::capture::engine::bundle::recover::cancel(directory) {
                apparent_log(format!("Could not persist cancellation; capture is still active: {error:#}"));
                return None;
            }
        }
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        if let Some(id) = self.agent_capture_id.take() {
            self.agent_captures.set(&id, "cancelled", None, None);
        }
        self.report_capture = false;
        let rec = self.active_recording.take()?;
        self.note_ui = None;
        let _ = self.telemetry.finish_session();
        #[cfg(target_os = "linux")]
        let mut storage = None;
        match rec.source {
            CaptureSource::Screen { session, audio, .. } => {
                #[cfg(target_os = "linux")]
                let session = {
                    let mut session = session;
                    storage = session.storage_dir.take();
                    session
                };
                let _ = session.stop();
                if let Some(audio) = audio {
                    let _ = audio.stop();
                }
            }
            CaptureSource::Phone(session) => session.cancel(),
            CaptureSource::Lab => return Some((rec.target, rec._metal_overlay)),
        }
        #[cfg(target_os = "linux")]
        if let Some(storage) = storage
            && let Err(error) = verify_directory(&storage, &rec.bundle_dir)
        {
            apparent_log(format!("Cancelled capture storage changed; skipped path cleanup: {error:#}"));
            return Some((rec.target, rec._metal_overlay));
        }
        if let Err(error) = crate::capture::engine::bundle::recover::delete_cancelled(&rec.bundle_dir) {
            apparent_log(format!("Cancelled assets could not be deleted at {}: {error:#}; recovery remains forbidden", rec.bundle_dir.display()));
        }
        Some((rec.target, rec._metal_overlay))
    }

}
