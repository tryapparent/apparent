//! File-only compatibility for saved device movies. No discovery, permissions or live recorder.
use crate::capture::apparent_log;
use crate::helper::{self, FrameTimes};
use crate::model::{
    ApparentBundle, ContextChange, DeviceInfo, InteractionEvent, RgbaFrame, ScreenSpan, Stroke,
    TargetInfo,
};
use anyhow::{Result, ensure};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::Instant;
const MOVIE_FRAME_EDGE: u32 = 1600;
const CANDIDATE_EDGE: u32 = 320;
const MAX_CANDIDATES: u64 = 480;

/// Everything a phone movie needs to become a bundle, on the movie's clock.
pub struct MovieCapture {
    pub movie: PathBuf,
    pub source: Option<String>,
    pub duration_ms: u64,
    pub video_offset_ms: u64,
    pub interaction_telemetry: Option<crate::model::InteractionTelemetry>,
    pub target: TargetInfo,
    pub device: DeviceInfo,
    pub events: Vec<InteractionEvent>,
    pub strokes: Vec<Stroke>,
    pub flags: Vec<u64>,
    pub note: Option<String>,
    /// Additional context carried by the capture.
    pub context: BTreeMap<String, String>,
    pub context_changes: Vec<ContextChange>,
    pub screens: Vec<ScreenSpan>,
}

/// Builds a bundle from a phone movie already inside `bundle_dir`: narration transcribed with
/// word timings, keyframes chosen on small candidate frames and then decoded again from the
/// native video.
pub fn build_movie_bundle(
    bundle_dir: &Path,
    mut capture: MovieCapture,
) -> Result<(PathBuf, ApparentBundle, String)> {
    let started_at = Instant::now();
    let wav = bundle_dir.join("audio.wav");
    let offset = capture.video_offset_ms;
    let duration_ms = capture.duration_ms;
    let mut mark_times: Vec<u64> = crate::sketch::marks_of(&capture.strokes)
        .into_iter()
        .map(|m| m.t1)
        .chain(capture.flags.iter().copied())
        .collect();
    mark_times.sort_unstable();
    mark_times.dedup();
    let ((transcript, audio_ms, transcribe_ms, audio_err), joined) = std::thread::scope(|scope| {
        let base_target = capture.target.clone();
        let strokes_ref = &capture.strokes;
        let events_ref = &capture.events;
        let flags_ref = &capture.flags;
        let movie_ref = &capture.movie;
        let frames = scope.spawn(move || -> Result<_> {
            let probe = helper::probe(movie_ref)?;
            ensure!(probe.duration_ms > 0, "The recording is empty");
            let mut target = base_target;
            if probe.width > 0 && probe.height > 0 {
                target.frame.width = f64::from(probe.width);
                target.frame.height = f64::from(probe.height);
            }
            let every = (duration_ms / MAX_CANDIDATES).max(250);
            let t0 = Instant::now();
            let budget = crate::model::keyframe_budget(duration_ms);
            // With a mark for every slot, only the frames under the marks are needed, unless
            // marks on one screen share a keyframe and leave slots for other moments.
            if mark_times.len() >= budget {
                let direct =
                    crate::movie_frames_at(movie_ref, &mark_times, offset, MOVIE_FRAME_EDGE);
                let decode_ms = t0.elapsed().as_millis() as u64;
                if let Ok(raw_frames) = direct
                    && !raw_frames.is_empty()
                {
                    let mut preview_marks = crate::sketch::marks_of(strokes_ref);
                    for (i, &t) in flags_ref.iter().enumerate() {
                        preview_marks.push(crate::model::Mark {
                            id: format!("f{}", i + 1),
                            strokes: Vec::new(),
                            t0: t,
                            t1: t,
                            box_norm: [0.0, 0.0, 1.0, 1.0],
                            shape: crate::model::Shape::Flag,
                            from: None,
                            to: None,
                            pin: None,
                            on: None,
                            description: "flagged this moment".into(),
                            frame: None,
                        });
                    }
                    let preview = crate::keyframes::select_keyframes(
                        &raw_frames,
                        strokes_ref,
                        &mut preview_marks,
                        events_ref,
                        &crate::model::TranscriptData::default(),
                        budget,
                    );
                    if preview.len() == budget
                        && preview
                            .iter()
                            .all(|(k, _)| k.reason == crate::model::KeyframeReason::Mark)
                    {
                        let prep = crate::prepare_visuals(
                            preview,
                            raw_frames.first(),
                            None,
                            &target,
                            duration_ms,
                            strokes_ref,
                            &preview_marks,
                            events_ref,
                            &crate::windows::ActivityLog::default(),
                        );
                        return Ok((probe, raw_frames, decode_ms, true, prep));
                    }
                }
            }
            let mut res = helper::frames(movie_ref, FrameTimes::Every(every), CANDIDATE_EDGE)?;
            for frame in &mut res {
                frame.t_ms += offset;
            }
            Ok((probe, res, t0.elapsed().as_millis() as u64, false, None))
        });
        let audio_started = Instant::now();
        let exported = helper::export_audio(&capture.movie, &wav)
            .and_then(|()| align_audio(&wav, offset))
            .and_then(|()| crate::audio::recorded_audio_from_wav(std::fs::read(&wav)?));
        let audio_ms = audio_started.elapsed().as_millis() as u64;
        let (audio, audio_err) = match exported {
            Ok(a) => (Some(a), None),
            Err(e) => (None, Some(e)),
        };
        let t0 = Instant::now();
        let transcript =
            crate::transcribe::transcribe(audio.as_ref().map(|_| wav.as_path()), audio.as_ref());
        let transcribe_ms = t0.elapsed().as_millis() as u64;
        (
            (transcript, audio_ms, transcribe_ms, audio_err),
            frames.join(),
        )
    });
    let (probe, frames, candidates_ms, already_full, prepared) =
        joined.map_err(|_| anyhow::anyhow!("Frame decoding panicked"))??;
    if probe.audio_tracks > 0
        && let Some(error) = audio_err
    {
        apparent_log(format!("Phone audio export failed: {error:#}"));
    }
    if probe.width > 0 && probe.height > 0 {
        capture.device.width = probe.width;
        capture.device.height = probe.height;
        capture.target.frame.width = f64::from(probe.width);
        capture.target.frame.height = f64::from(probe.height);
    }
    ensure!(!frames.is_empty(), "No frames could be decoded");
    let movie = capture.movie.clone();
    let extras = crate::SourceExtras {
        source: capture.source,
        video_offset_ms: offset,
        interaction_telemetry: capture.interaction_telemetry,
        device: Some(capture.device),
        context: capture.context,
        context_changes: capture.context_changes,
        screens: capture.screens,
        flags: capture.flags,
        full_frames: (!already_full).then(|| -> crate::FullFrames {
            Box::new(move |times: &[u64]| -> Result<Vec<RgbaFrame>> {
                crate::movie_frames_at(&movie, times, offset, MOVIE_FRAME_EDGE)
            })
        }),
        prepared,
        timings: crate::StageTimings {
            started_at: Some(started_at),
            audio_ms: Some(audio_ms),
            candidates_ms: Some(candidates_ms),
            transcribe_ms: Some(transcribe_ms),
            ..Default::default()
        },
        ..Default::default()
    };
    crate::build_bundle_from_parts(
        bundle_dir,
        capture.target,
        duration_ms,
        frames,
        capture.strokes,
        capture.events,
        transcript,
        Some(capture.movie),
        capture.note,
        extras,
    )
}

/// Shared movie decoding/audio extraction stays on the asset clock; only this saved-archive
/// boundary adds the archived capture offset, as desktop reprocessing already does for frames.
fn align_audio(wav: &Path, offset_ms: u64) -> Result<()> {
    if offset_ms == 0 {
        return Ok(());
    }
    let mut reader = hound::WavReader::open(wav)?;
    let spec = reader.spec();
    let padded = wav.with_file_name("audio-aligned.wav");
    let mut writer = hound::WavWriter::create(&padded, spec)?;
    let prefix = offset_ms
        .checked_mul(u64::from(spec.sample_rate))
        .and_then(|n| n.checked_mul(u64::from(spec.channels)))
        .ok_or_else(|| anyhow::anyhow!("Archived audio offset is too large"))?
        / 1000;
    for _ in 0..prefix {
        writer.write_sample(0i16)?;
    }
    for sample in reader.samples::<i16>() {
        writer.write_sample(sample?)?;
    }
    writer.finalize()?;
    std::fs::rename(padded, wav)?;
    Ok(())
}
