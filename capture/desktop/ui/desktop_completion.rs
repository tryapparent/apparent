//! Desktop capability adapter for Record's headless completion policy.
//! Receipts and Connect completion precede the stale-UI gate; presentation never does.

mod worker;

use gpui::Context;
use std::sync::{Arc, atomic::{AtomicBool, Ordering}};
use crate::capture::engine::draft_paste::{self, DraftClipboard, DraftTarget};
use crate::shared::handoff;

use super::super::{ApparentCoordinator, CAPTURE_STATUS, PillEvent};
use super::recording_completion::CaptureResult;
use crate::capture::engine::runtime::apparent_log;
pub(in crate::capture::desktop) use worker::{Capture, Facts};
use worker::{Completion, CopyMode, Effect, Outcome, State, Worker};

#[derive(Default)]
pub(in crate::capture::desktop) struct AutoPaste {
    target: Option<(u64, DraftTarget)>,
    active: Option<Arc<AtomicBool>>,
}

impl AutoPaste {
    pub(in crate::capture::desktop) fn cancel(&mut self) {
        self.target = None;
        if let Some(active) = self.active.take() {
            active.store(false, Ordering::Release);
        }
    }
}

pub(in crate::capture::desktop) fn connect_completed(dir: &std::path::Path) {
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    crate::connect::hosted::completed(dir);
}

impl ApparentCoordinator {
    pub(in crate::capture::desktop) fn capture_completion_facts(
        &mut self,
        finishing_id: Option<String>,
        completion_source: &str,
        agent_requested: bool,
        released: bool,
    ) -> Facts {
        let generation = self.capture_generation;
        let auto_paste_enabled = !self.capture_local_practice && handoff::experiment_preference("labs.autoPasteDraft");
        #[cfg(target_os = "linux")]
        let hold = self.shortcut.hold.take().filter(|hold| hold.generation == Some(generation));
        #[cfg(target_os = "macos")]
        let _ = released;

        let target = (auto_paste_enabled && !agent_requested && completion_source == "screen" && !self.lab)
            .then(DraftTarget::focused).flatten();
        #[cfg(target_os = "linux")]
        let target = match hold {
            Some(hold) => target.filter(|target| {
                matches!(target, DraftTarget::Hyprland(window, _) if released && hold.target.as_ref() == Some(window))
            }),
            None => target,
        };
        let paste_target_available = target.is_some();
        self.auto_paste.target = target.map(|target| (generation, target));
        Facts {
            capture: Capture {
                generation: generation.to_string(),
                capture_id: finishing_id.clone().unwrap_or_default(),
                request_id: finishing_id,
            },
            platform: if cfg!(target_os = "linux") { "linux" } else { "macos" }.into(),
            source: completion_source.into(),
            agent_requested,
            auto_paste_enabled,
            paste_target_available,
            image_quality_warning: None,
            lab: self.lab,
        }
    }

    /// Dispatches a finalizer receipt separately from effects on the current capture UI.
    pub(in crate::capture::desktop) fn receive_capture_result(
        &mut self,
        generation: u64,
        allow_t3: bool,
        #[cfg(any(target_os = "macos", target_os = "linux"))] finishing_id: Option<&str>,
        finalized: CaptureResult,
        on_completed: impl FnOnce(&std::path::Path),
        on_current: impl FnOnce(&mut Self, CaptureResult),
    ) {
        // The worker still owns its exact ID's receipt after dismissal. Only its
        // UI/clipboard/onboarding effects lose ownership when a new capture starts.
        if let Err(error) = &finalized {
            crate::capture::desktop::workflow::error_reporting::report_finalization(error);
        }
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        if let Some(id) = finishing_id {
            self.agent_captures.finish(
                id,
                finalized
                    .as_ref()
                    .map(|(dir, _, _)| dir.as_path())
                    .map_err(|error| format!("{error:#}")),
            );
        }
        // A saved capture completes independently of its pill. Hosted
        // admission rechecks current consent; failed takes stay local.
        if let Ok((dir, _, _)) = &finalized {
            on_completed(dir);
        }
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        if allow_t3 && let Some(session) = &mut self.electron_pill {
            let text = finalized.as_ref().ok().map(|(dir, bundle, _)|
                crate::shared::handoff::clipboard_summary(bundle, dir));
            session.complete(generation, text);
        }
        if !self.accepts_capture_result(generation) {
            return;
        }
        on_current(self, finalized);
    }

    pub(in crate::capture::desktop) fn present_capture_result(
        &mut self,
        finalized: CaptureResult,
        duration_ms: u64,
        mut facts: Facts,
        cx: &mut Context<Self>,
    ) {
        let generation = self.capture_generation;
        if self.completion_pending == Some(generation) { return; }
        self.completion_pending = Some(generation);
        facts.image_quality_warning = finalized.as_ref().ok()
            .and_then(|(_, bundle, _)| bundle.image_quality_warning.clone());
        let capture = facts.capture.clone();
        let paste_target = self.auto_paste.target.take().filter(|(owner, _)| *owner == generation).map(|(_, target)| target);
        let outcome = match &finalized {
            Ok((dir, _, _)) => Outcome::Saved { bundle_path: dir.clone() },
            Err(error) => Outcome::Failed { message: error.to_string() },
        };
        // A renderer reload or exit cannot interrupt this worker or the finalizer.
        // The original result stays here until both bounded policy exchanges end.
        cx.spawn(async move |entity, cx| {
            let started = cx.background_executor().spawn(async move {
                let mut worker = Worker::open(facts, outcome)?;
                let decision = worker.read()?;
                anyhow::Ok((worker, decision))
            }).await;
            let completion = match started {
                Ok((worker, decision)) => {
                    let copy = decision.effects.first().map(|effect| match effect {
                        Effect::Copy { mode, .. } => *mode,
                    });
                    let mut draft = None;
                    let mut receipt = copy.map(|mode| entity.update(cx, |coord, _| {
                        if !coord.accepts_capture_result(generation) { return "revoked"; }
                        let Ok((dir, bundle, _)) = &finalized else { return "revoked"; };
                        let result = match (mode, paste_target) {
                            (CopyMode::AutoPasteDraft, Some(target)) => {
                                let (text, image) = handoff::clipboard_payload(bundle, dir);
                                let image = image.then(|| dir.join(&bundle.contact_sheet));
                                handoff::copy_string_to_clipboard(&text)
                                    .and_then(|()| DraftClipboard::owner())
                                    .map(|clipboard| {
                                        let active = Arc::new(AtomicBool::new(true));
                                        coord.auto_paste.active = Some(active.clone());
                                        draft = Some((image, text, target, clipboard, active));
                                    })
                            }
                            _ => handoff::copy_bundle_to_clipboard(dir),
                        };
                        match result {
                            Ok(()) => "copied",
                            Err(error) => { apparent_log(format!("Copy handoff failed: {error:#}")); "failed" }
                        }
                    }).unwrap_or("revoked"));
                    if let Some((image, text, target, clipboard, active)) = draft {
                        let deadline = cx.background_executor().timer(std::time::Duration::from_secs(4));
                        let draft_active = active.clone();
                        let paste = cx.background_executor().spawn(async move {
                            let result = draft_paste::paste(
                                image.as_deref(), &text, &target, &clipboard,
                                || draft_active.load(Ordering::Acquire),
                                handoff::copy_png_to_clipboard, handoff::copy_string_to_clipboard,
                            );
                            if let Err(error) = &result {
                                apparent_log(format!("Auto paste stopped: {error:#}"));
                            }
                            result.is_ok()
                        });
                        let success = futures_lite::future::race(paste, async {
                            deadline.await;
                            false
                        }).await;
                        receipt = Some(if !active.swap(false, Ordering::AcqRel) {
                            "revoked"
                        } else if success {
                            "copied"
                        } else {
                            "failed"
                        });
                    }
                    cx.background_executor().spawn(async move {
                        worker.complete(decision, receipt)
                    }).await
                }
                Err(error) => Completion::unavailable(error),
            };
            let _ = entity.update(cx, |coord, cx| {
                if !coord.accepts_capture_result(generation) { return; }
                coord.auto_paste.active = None;
                let state = match completion.state {
                    Ok(state) if state.current => Some(state),
                    Ok(_) => return,
                    Err(error) => {
                        apparent_log(format!("Record handoff unavailable; retaining finalizer result: {error:#}"));
                        None
                    }
                };
                coord.apply_completion_presentation(finalized, duration_ms, state, completion.clipboard_receipt, &capture, cx);
            });
        }).detach();
    }

    fn apply_completion_presentation(
        &mut self, finalized: CaptureResult, duration_ms: u64, state: Option<State>,
        clipboard_receipt: Option<bool>, capture: &Capture, cx: &mut Context<Self>,
    ) {
        if let Some(session) = self.onboarding.as_mut() {
            session.practice_completion(
                self.capture_generation, &capture.capture_id, capture.request_id.as_deref(),
                finalized.as_ref().ok().map(|(dir, _, _)| dir.as_path()), clipboard_receipt,
            );
        }
        self.completed_dir = None;
        let (dir, bundle, _) = match finalized {
            Ok(capture) => capture,
            Err(error) => {
                apparent_log(format!("Capture failed: {error:#}"));
                #[cfg(target_os = "linux")]
                crate::capture::desktop::linux::shell::notify("Capture failed", &error.to_string());
                if let Ok(mut status) = CAPTURE_STATUS.lock() {
                    *status = Some(state.and_then(|s| s.status).unwrap_or_else(|| "Capture failed".into()));
                }
                self.apply_pill_event(PillEvent::CaptureFailed);
                cx.notify();
                return;
            }
        };
        if let Ok(mut status) = CAPTURE_STATUS.lock() {
            *status = None;
        }
        #[cfg(target_os = "linux")]
        if let Some(state) = state.as_ref() {
            for notification in &state.notifications {
                crate::capture::desktop::linux::shell::notify(&notification.title, &notification.body);
            }
        }
        self.completed_dir = Some(dir.clone());
        self.last_local_capture_ms = crate::shared::clock::now_epoch_ms();
        // Exceptional recovery is factual only: preserve access to the exact saved
        // artifact, never emulate copy policy or infer that a write succeeded.
        let recovery = state.as_ref().is_some_and(|result| result.manual_recovery);
        let text = state.and_then(|s| s.status)
            .unwrap_or_else(|| "Saved · handoff unavailable".into());
        let frame_count = bundle.keyframes.len();
        self.set_review_bundle((dir, bundle), Some(text.clone()));
        self.apply_pill_event(PillEvent::CaptureSaved { recovery, text: Some(text), frame_count, duration_ms });
        cx.notify();
    }
}
