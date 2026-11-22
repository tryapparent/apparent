//! In-process media teardown and bundle finalization, run only on the background executor.

use std::path::PathBuf;

use super::super::CaptureSource;
use super::whiteboard;
#[cfg(target_os = "linux")]
use crate::capture::desktop::workflow::FinishPhase;
use crate::capture::engine::runtime::apparent_log;
use crate::capture::engine::runtime::recording::diagnostics::{
    Diagnose, Stage, sampling::Sampling, with_sampling,
};
use crate::shared::model::{ApparentBundle, InteractionEvent, Stroke, TargetInfo};

pub(in crate::capture::desktop) type CaptureResult =
    anyhow::Result<(PathBuf, ApparentBundle, String)>;

/// The GUI has already stopped telemetry, closed the overlay and snapshotted the paper.
pub(in crate::capture::desktop) fn finalize(
    source: CaptureSource,
    target: TargetInfo,
    bundle_dir: PathBuf,
    events: Vec<InteractionEvent>,
    strokes: Vec<Stroke>,
    final_whiteboard: whiteboard::Paper,
    notes_finished: Option<flume::Receiver<crate::capture::desktop::workflow::notes::FinishResult>>,
    source_released: flume::Sender<()>,
    lip_input: Option<crate::lip_input::Input>,
) -> (CaptureResult, u64) {
    #[cfg(target_os = "linux")]
    FinishPhase::StoppingSource.emit();
    let (screen_session, audio_recorder, window_log) = match source {
        CaptureSource::Screen {
            session,
            audio,
            windows,
        } => (session, audio, windows),
        CaptureSource::Phone(session) => {
            // Stop the producer before waiting for a possibly contended writer lease.
            let stopped = session.stop().stage(Stage::PhoneStop);
            let _ = source_released.send(());
            let finalized = stopped.and_then(|recording| {
                complete_bundle(&bundle_dir, &final_whiteboard, None, || {
                    crate::capture::engine::runtime::phone::finalize_live_capture(
                        &bundle_dir,
                        recording,
                        events,
                        strokes,
                        None,
                    ).stage(Stage::PhoneBundle)
                })
            });
            // Only the outer publication result may enqueue native movie shrinking.
            let finalized = after_publication(
                finalized,
                crate::capture::engine::bundle::retention::after_phone_capture,
            );
            if let Err(error) = &finalized {
                apparent_log(format!("iPhone capture failed: {error:#}"));
            }
            let duration_ms = finalized.as_ref().map_or(0, |(_, b, _)| b.duration_ms);
            return (finalized, duration_ms);
        }
        CaptureSource::Lab => {
            return (Err(anyhow::anyhow!("a lab recording has no bundle")), 0);
        }
    };
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    let circle = screen_session.circle_labels();
    let stopped = screen_session.stop_tracks(audio_recorder, window_log);
    let _ = source_released.send(());
    let recording = stopped.recording;
    let sampling = stopped.sampling;
    let activity = stopped.activity;
    let duration_ms = recording.duration_ms;
    let recorded_audio = match stopped.audio {
        Ok(audio) => audio,
        Err(error) => return (Err(error).stage(Stage::AudioStop), duration_ms),
    };
    let finalized = complete_bundle(&bundle_dir, &final_whiteboard, sampling, || {
        if let Some(receipt) = notes_finished {
            if let Err(error) = receipt
                .recv_timeout(std::time::Duration::from_secs(12))
                .map_err(|_| "Notes finish receipt unavailable".to_owned())
                .and_then(|r| r.map(|outcome| match outcome {
                    crate::capture::desktop::workflow::notes::FinishOutcome::Drained => {},
                    crate::capture::desktop::workflow::notes::FinishOutcome::UnavailableBeforeAdmission => {
                        apparent_log("Typed notes unavailable before admission; finalizing screen capture without notes");
                    }
                }))
            {
                crate::capture::engine::bundle::recover::write(
                    &bundle_dir,
                    &crate::capture::engine::bundle::recover::Unfinished {
                        context: crate::capture::engine::bundle::recover::capture_context(&bundle_dir).stage(Stage::RecoveryJournal)?,
                        target: target.clone(),
                        duration_ms,
                        video: recording
                            .video
                            .as_ref()
                            .and_then(|p| p.file_name())
                            .map(|p| p.to_string_lossy().into_owned()),
                        video_offset_ms: recording.video_offset_ms,
                        video_ink: recording.video_ink,
                        strokes,
                        events,
                        interaction_telemetry: None,
                        note: None,
                        windows: activity.windows,
                        cursor: activity.cursor,
                    },
                ).stage(Stage::RecoveryJournal)?;
                return Err(anyhow::anyhow!(error)).stage(Stage::NotesReceipt);
            }
        }
        #[cfg(any(target_os = "linux", target_os = "macos"))]
        let strokes = {
            let mut strokes = strokes;
            if let Some(session) = circle { session.apply(&mut strokes); }
            strokes
        };
        crate::capture::engine::bundle::bundle_processing::finalize_capture_bundle_with_transcript(
            &bundle_dir,
            target,
            recording,
            strokes,
            events,
            recorded_audio,
            None,
            activity,
            None,
            lip_input.map(|input| input.transcript(duration_ms)),
        )
    });
    (finalized, duration_ms)
}

fn after_publication(
    result: CaptureResult,
    on_success: impl FnOnce(&std::path::Path),
) -> CaptureResult {
    if let Ok((dir, _, _)) = &result {
        on_success(dir);
    }
    result
}

/// Both recording sources must finish optional drawing mutations and validate
/// the surviving capture before Desktop can see any successful result.
fn complete_bundle(
    path: &std::path::Path,
    board: &whiteboard::Paper,
    sampling: Option<Sampling>,
    build: impl FnOnce() -> CaptureResult,
) -> CaptureResult {
    #[cfg(target_os = "linux")]
    FinishPhase::PreparingBundle.emit();
    let result = complete_bundle_with(
        path,
        || {
            #[cfg(target_os = "linux")]
            FinishPhase::BuildingBundle.emit();
            build()
        },
        |dir, bundle, summary| {
            #[cfg(target_os = "linux")]
            FinishPhase::PublishingBundle.emit();
            whiteboard::finish_handoff(dir, bundle, summary, board)
        },
    );
    let result = with_sampling(result, Stage::Publication, sampling);
    #[cfg(target_os = "linux")]
    FinishPhase::FinalizerReturned.emit();
    result
}

fn complete_bundle_with(
    path: &std::path::Path,
    build: impl FnOnce() -> CaptureResult,
    finish: impl FnOnce(&std::path::Path, ApparentBundle, String) -> (ApparentBundle, String),
) -> CaptureResult {
    crate::capture::engine::bundle::bundle_processing::publication::publish_after(path, || {
        let (dir, bundle, summary) = build()?;
        let (bundle, summary) = finish(&dir, bundle, summary);
        Ok((dir, bundle, summary))
    })
}

#[cfg(test)]
#[path = "../../engine/bundle/bundle_processing/publication/completion_tests.rs"]
mod publication_tests;
