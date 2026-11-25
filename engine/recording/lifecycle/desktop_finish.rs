impl ApparentCoordinator {
    pub fn finish_recording(&mut self, cx: &mut Context<Self>) {
        self.finish_recording_with_release(false, cx);
    }

    fn finish_recording_with_release(&mut self, released: bool, cx: &mut Context<Self>) {
        self.observe_recording_activity();
        #[cfg(target_os = "linux")]
        if self.cancel_pending_screen_finish() {
            self.present_capture_cancellation(cx);
            return;
        }
        let finish_started = Instant::now();
        self.playback.take();
        apparent_log("finish_recording invoked");
        let Some(rec) = self.active_recording.take() else {
            return;
        };
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        let finishing_id = self.agent_capture_id.take();
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        if let Some(id) = &finishing_id {
            self.agent_captures.set(id, "processing", None, None);
        }
        #[cfg(target_os = "linux")]
        let agent_requested = std::mem::take(&mut self.agent_finishing);
        #[cfg(not(target_os = "linux"))]
        let agent_requested = false;
        let completion_source = if matches!(&rec.source, CaptureSource::Phone(_)) {
            "phone"
        } else {
            "screen"
        };
        let note_receipt = self
            .note_ui
            .as_ref()
            .map(workflow::notes::Session::saved_note_receipt);
        let notes_finished = self.note_ui.take().map(workflow::notes::Session::finish);
        let (events, strokes, action_context) = self.telemetry.finish_session_with_context();
        let paper_time = rec.elapsed_ms();
        let bundle_dir = rec.bundle_dir;
        let target = rec.target;
        let source = rec.source;
        let performance = rec.performance;
        let report = self.seal_report_capture();
        let completion_facts = self.capture_completion_facts(
            finishing_id.clone(),
            completion_source,
            agent_requested,
            released,
        );
        drop(rec._metal_overlay);
        self.apply_pill_event(PillEvent::CaptureSealed);
        let generation = self.capture_generation;
        let local_practice = self.capture_local_practice;
        let wardrobe_eligible = rec.user_started && !local_practice && !report;
        cx.notify();
        if matches!(source, CaptureSource::Lab) {
            self.whiteboard.borrow_mut().close();
            let wait = Duration::from_secs_f32(lab::PROCESSING_S / motion::time_scale());
            cx.spawn(async move |entity, cx| {
                cx.background_executor().timer(wait).await;
                let _ = entity.update(cx, |coord, cx| {
                    if !coord.accepts_capture_result(generation) {
                        return;
                    }
                    coord.apply_pill_event(PillEvent::CaptureSaved {
                        recovery: false,
                        text: None,
                        frame_count: 6,
                        duration_ms: paper_time,
                    });
                    cx.notify();
                });
            })
            .detach();
            return;
        }

        let final_whiteboard = self.whiteboard.borrow_mut().finish(cx, paper_time);

        self.stopping_source = SourceTransition::Releasing(generation);
        let (source_released, released) = flume::bounded(1);
        cx.spawn(async move |entity, cx| {
            let _ = released.recv_async().await;
            let _ = entity.update(cx, |coord, cx| {
                if matches!(coord.stopping_source, SourceTransition::Releasing(current) if current == generation) {
                    coord.stopping_source = SourceTransition::Idle;
                    coord.apply_pill_event(PillEvent::SourceReleased);
                    cx.notify();
                }
            });
        })
        .detach();
        self.capture_finalizer_started();
        self.publish_capture_busy();
        cx.spawn(async move |entity, cx| {
            let result = cx
                .background_executor()
                .spawn(async move {
                    workflow::performance::RecordingPerformance::finalize(
                        performance,
                        finish_started,
                        || {
                            recording_completion::finalize(
                                source,
                                target,
                                bundle_dir,
                                events,
                                strokes,
                                action_context,
                                final_whiteboard,
                                notes_finished,
                                source_released,
                            )
                        },
                    )
                })
                .await;

            let _ = entity.update(cx, |coord, cx| {
                let (finalized, duration_ms) = result;
                if finalized.is_err() && coord.accepts_capture_result(generation) {
                    crate::capture::desktop::workflow::shutdown::clear_request();
                }
                coord.capture_finalizer_finished();
                coord.publish_capture_busy();
                #[cfg(target_os = "macos")]
                if let Ok((_, bundle, _)) = &finalized
                    && wardrobe_eligible
                {
                    let id = bundle.id.clone();
                    cx.background_executor()
                        .spawn(async move {
                            frog_wardrobe::credit_saved(&id);
                        })
                        .detach();
                }
                coord.receive_capture_result(
                    generation,
                    !local_practice && !report,
                    #[cfg(any(target_os = "macos", target_os = "linux"))]
                    finishing_id.as_deref(),
                    finalized,
                    |dir| {
                        if !local_practice && !report {
                            desktop_completion::connect_completed(dir);
                        }
                    },
                    |coord, finalized| {
                        if report {
                            coord.dismiss_island(cx);
                            return;
                        }
                        if finalized.is_ok() {
                            if let Some(session) = coord.onboarding.as_mut() {
                                session.practice_note_saved(note_receipt.as_ref().is_some_and(
                                    |receipt| receipt.load(std::sync::atomic::Ordering::Acquire),
                                ));
                            }
                        }
                        coord.present_capture_result(finalized, duration_ms, completion_facts, cx);
                    },
                );
            });
        })
        .detach();
    }
}

#[cfg(test)]
mod finish_tests {
    use super::*;

    #[cfg(target_os = "linux")]
    #[test]
    fn recording_activity_observes_real_start_once_and_preserves_practice_fact() {
        use std::sync::atomic::Ordering;
        let (sender, _receiver) = flume::unbounded();
        let mut coordinator = ApparentCoordinator::new(SharedCaptureTelemetry::new(sender), None);
        let (session, _failed, seen) = ScreenCaptureSession::test_pending_start();
        coordinator.active_recording = Some(ActiveRecording {
            user_started: false,
            performance: None,
            started: Instant::now(),
            target: region_target(0.0, 0.0, 64.0, 64.0, &[]),
            bundle_dir: PathBuf::from("synthetic-unused.apparent"),
            source: CaptureSource::Screen {
                session,
                audio: None,
                windows: None,
            },
            _metal_overlay: None,
            microphone_enabled: false,
        });
        coordinator.apply_pill_event(PillEvent::CaptureStarted);
        assert_eq!(
            coordinator.take_recording_start(),
            None,
            "pending permission/frame is not activity"
        );
        seen.store(true, Ordering::Release);
        assert_eq!(coordinator.take_recording_start(), Some(false));
        assert_eq!(
            coordinator.take_recording_start(),
            None,
            "ticks and Finish cannot report twice"
        );
        coordinator.recording_activity_attempted = false;
        coordinator.capture_local_practice = true;
        assert_eq!(
            coordinator.take_recording_start(),
            Some(true),
            "TypeScript receives the practice exclusion fact"
        );
        coordinator.active_recording = None;
        assert_eq!(coordinator.take_recording_start(), None);
    }
}
