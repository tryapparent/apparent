//! Synthetic coordinator/codec checks. These do not claim native capture or portal proof.
use super::*;
use crate::model::{CaptureMode, TargetInfo};

fn display(id: u32) -> CapturedDisplay {
    CapturedDisplay {
        id, name: format!("synthetic-{id}"),
        frame: TargetFrame { x: f64::from(id - 1) * 32.0 - 32.0, y: 0.0, width: 32.0, height: 32.0, scale: 1.0 },
        started_ms: None, failed_ms: None, failure: None,
    }
}

fn sampler() -> Sampler {
    Sampler {
        target: TargetInfo { mode: CaptureMode::Display, app: None, bundle_id: None,
            window_title: None, window_id: None, display_id: 1,
            frame: bounds(&[display(1).frame, display(2).frame]).unwrap(),
            displays: vec![display(1), display(2)] },
        video_output_path: None, excluded_window_ids: Arc::new(Mutex::new(Vec::new())),
        started_at: Instant::now(), stopping: Arc::new(AtomicBool::new(false)),
        urgent: Arc::new(AtomicBool::new(true)), frames: Arc::new(Mutex::new(CandidateBuffer::new(1_000_000))),
        real_frame_seen: Arc::new(AtomicBool::new(false)), video_offset_ms: Arc::new(AtomicU64::new(0)),
        startup_failed: Arc::new(AtomicBool::new(false)),
    }
}

fn source(color: [u8; 4], end: Option<Duration>) -> Result<Runner, String> {
    Ok(Box::new(move |s| {
        while !s.stopping.load(Ordering::Acquire) {
            if end.is_some_and(|end| s.started_at.elapsed() >= end) { break; }
            let frame = RgbaFrame::new(s.started_at.elapsed().as_millis() as u64, 32, 32, color.repeat(32 * 32));
            super::super::push_candidate(&s.frames, &s.real_frame_seen, frame, true, true);
            thread::sleep(Duration::from_millis(10));
        }
        None
    }))
}

#[test]
fn delayed_consent_gets_its_own_stream_startup_budget_not_a_stale_launch_clock() {
    let mut buffer = CandidateBuffer::latest();
    buffer.awaiting_consent = true;
    assert!(!source_timed_out(&buffer, None, 0, 90_000));
    buffer.startup_ready_ms = 90_000;
    buffer.awaiting_consent = false;
    assert!(!source_timed_out(&buffer, None, 0, 90_020), "consent time is not a stream startup failure");
    assert!(source_timed_out(&buffer, None, 0, 98_001));
    let stale = RgbaFrame::new(89_000, 1, 1, vec![0; 4]);
    assert!(source_timed_out(&buffer, Some(&stale), 0, 92_000), "consent never refreshes stale pixels");
}

#[test]
fn privacy_revocation_after_parent_copied_a_tile_invalidates_the_whole_capture() {
    privacy_revocation_after_copy();
}

#[test]
fn portal_cancel_after_first_source_frames_discards_the_entire_capture() {
    let s = sampler();
    let parent = Arc::clone(&s.frames);
    let observed = Arc::clone(&parent);
    let cancel: Runner = Box::new(move |_| {
        let deadline = Instant::now() + Duration::from_secs(2);
        while observed.lock().unwrap().frames.is_empty() && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(5));
        }
        assert!(!observed.lock().unwrap().frames.is_empty());
        observed.lock().unwrap().cancelled = true;
        None
    });
    let stop = Arc::clone(&s.stopping);
    let stopper = thread::spawn(move || { thread::sleep(Duration::from_millis(350)); stop.store(true, Ordering::Release); });
    assert!(coordinate(s, Arc::new(Mutex::new(Vec::new())), vec![source([0, 50, 200, 255], None), Ok(cancel)], || vec![display(1), display(2)]).is_none());
    stopper.join().unwrap();
    let parent = parent.lock().unwrap();
    assert!(parent.cancelled);
    assert!(parent.frames.is_empty(), "Cancel in B's chooser is not permission to publish A");
}

#[test]
fn explicit_desktop_inventory_refuses_empty_instead_of_returning_pointer_target() {
    let selected = sampler().target;
    assert!(super::super::resolve_desktop_inventory(selected.clone(), Vec::new()).is_err());
    let desktop = super::super::resolve_desktop_inventory(selected, vec![display(1), display(2)]).unwrap();
    assert_eq!(desktop.frame, bounds(&[display(1).frame, display(2).frame]).unwrap());
}

#[cfg(target_os = "linux")]
#[test]
#[ignore = "requires host GStreamer synthetic source, H264 encoder and FFmpeg"]
fn production_pipeline_error_cannot_replace_valid_history_with_an_incomplete_movie() {
    let dir = std::env::temp_dir().join(crate::make_bundle_id());
    std::fs::create_dir_all(&dir).unwrap();
    let mut s = sampler();
    s.video_output_path = Some(dir.join("recording.mp4"));
    let frames = Arc::clone(&s.frames);
    let stop = Arc::clone(&s.stopping);
    let stopper = thread::spawn(move || { thread::sleep(Duration::from_secs(3)); stop.store(true, Ordering::Release); });
    let state = Arc::new(Mutex::new(Vec::new()));
    let result = coordinate(s, Arc::clone(&state), vec![
        Ok(Box::new(|s| crate::linux::media::run_sampler_source(s, Some(crate::linux::media::Source::TestFailure)))),
        Ok(Box::new(|s| crate::linux::media::run_sampler_source(s, Some(crate::linux::media::Source::Test))))],
        || vec![display(1), display(2)]);
    stopper.join().unwrap();
    let status = state.lock().unwrap();
    assert!(status[0].started_ms.is_some() && status[0].failure.is_some(), "error must follow real samples: {status:?}");
    assert!(status[1].started_ms.is_some());
    assert!(!frames.lock().unwrap().frames.is_empty());
    assert!(result.is_none(), "a source with valid history but no finalized movie cannot disappear from final authority");
    assert!(dir.join(".display-1/recording.mp4").exists(), "retain damaged source privately for recovery");
    std::fs::remove_dir_all(dir).unwrap();
}

#[cfg(target_os = "linux")]
#[test]
#[ignore = "requires FFmpeg; synthetic coordinator through real composition and whole-file decode"]
fn empty_failed_source_movie_does_not_poison_healthy_composition() {
    use std::process::Command;
    let dir = std::env::temp_dir().join(crate::make_bundle_id());
    std::fs::create_dir(&dir).unwrap();
    let healthy = dir.join("healthy.mp4");
    assert!(Command::new("ffmpeg").args(["-nostdin", "-v", "error", "-n", "-f", "lavfi", "-i",
        "color=c=blue:s=32x32:r=30:d=2", "-c:v", "libx264", "-threads", "1", "-pix_fmt", "yuv420p"])
        .arg(&healthy).status().unwrap().success());
    let mut s = sampler();
    s.video_output_path = Some(dir.join("recording.mp4"));
    let stop = Arc::clone(&s.stopping);
    let stopper = thread::spawn(move || { thread::sleep(Duration::from_millis(650)); stop.store(true, Ordering::Release); });
    let state = Arc::new(Mutex::new(Vec::new()));
    let result = coordinate(s, Arc::clone(&state), vec![
        Ok(Box::new(|child| {
            let path = child.video_output_path.unwrap();
            // Faithful no-video-stream artifact: the native zero-frame MP4 was 615 bytes.
            std::fs::write(&path, [0u8; 615]).unwrap();
            Some(path)
        })),
        Ok(Box::new(move |child| {
            let path = child.video_output_path.as_ref().unwrap().clone();
            std::fs::copy(healthy, &path).unwrap();
            while !child.stopping.load(Ordering::Acquire) {
                let frame = RgbaFrame::new(child.started_at.elapsed().as_millis() as u64, 32, 32, [0, 0, 255, 255].repeat(32 * 32));
                super::super::push_candidate(&child.frames, &child.real_frame_seen, frame, true, true);
                thread::sleep(Duration::from_millis(10));
            }
            Some(path)
        }))], || vec![display(1), display(2)]);
    stopper.join().unwrap();
    let state = state.lock().unwrap();
    assert!(state[0].started_ms.is_none() && state[0].failure.is_some());
    assert!(state[1].started_ms.is_some());
    let movie = result.expect("a never-started invalid source must not suppress the healthy movie");
    let decoded = Command::new("ffmpeg").args(["-v", "error", "-i"]).arg(movie)
        .args(["-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"]).output().unwrap();
    assert!(decoded.status.success());
    let stride = 64 * 32 * 3;
    assert!(decoded.stdout.len() >= 10 * stride);
    for frame in decoded.stdout.chunks_exact(stride) {
        assert!(frame[..3].iter().all(|v| *v < 40), "failed tile stays neutral");
        assert!(frame[32 * 3 + 2] > 180, "healthy tile remains blue");
    }
    assert_eq!(std::fs::metadata(dir.join(".display-1/recording.mp4")).unwrap().len(), 615, "failed original retained");
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn live_ink_adapter_follows_only_healthy_captured_displays_without_retargeting_capture() {
    let initial = display(1).frame;
    let mut second = display(2);
    let original = bounds(&[initial, second.frame]).unwrap();
    let current = [initial.x, initial.y, initial.width, initial.height];
    let destination = [second.frame.x, second.frame.y, second.frame.width, second.frame.height];
    assert_eq!(crate::ui::recording_ink_destination(current, [10.0, 10.0], &[display(1), second.clone()]), Some(destination));
    assert_eq!(crate::ui::recording_ink_destination(destination, [10.0, 10.0], &[display(1), second.clone()]), None);
    assert_eq!(crate::ui::recording_ink_destination(current, [10.0, 10.0], &[display(1)]), None);
    second.failure = Some("lost".into());
    assert_eq!(crate::ui::recording_ink_destination(current, [10.0, 10.0], &[display(1), second]), None);
    assert_eq!(bounds(&[display(1).frame, display(2).frame]), Some(original));
}

#[test]
fn all_sources_ending_after_frames_finishes_and_preserves_partial_capture() {
    let s = sampler();
    let state = Arc::new(Mutex::new(Vec::new()));
    let child_state = Arc::clone(&state);
    let mut session = super::super::ScreenCaptureSession {
        started_at: s.started_at, stopping: Arc::clone(&s.stopping), urgent_snapshot: Arc::clone(&s.urgent),
        frames: Arc::clone(&s.frames), real_frame_seen: Arc::clone(&s.real_frame_seen),
        startup_failed: Arc::clone(&s.startup_failed),
        video_offset_ms: Arc::clone(&s.video_offset_ms), sampler_thread: None, displays: state,
        _recording: crate::retention::Recording::start(),
    };
    session.sampler_thread = Some(thread::spawn(move || coordinate(s, child_state,
        vec![source([220, 30, 40, 255], Some(Duration::from_millis(600))), source([30, 40, 220, 255], Some(Duration::from_millis(650)))],
        || vec![display(1), display(2)])));
    let deadline = Instant::now() + Duration::from_secs(3);
    while !session.sampler_thread.as_ref().unwrap().is_finished() && Instant::now() < deadline { thread::sleep(Duration::from_millis(10)); }
    assert!(session.has_frames());
    assert!(session.ended(), "the UI must finish after losing all live sources, even with history");
    let partial = session.stop();
    assert!(!partial.frames.is_empty());
    assert!(partial.displays.iter().all(|d| d.failure.is_some()));
}

fn privacy_revocation_after_copy() {
    let s = sampler();
    let parent = Arc::clone(&s.frames);
    let observed = Arc::clone(&parent);
    let revoked = Arc::new(AtomicBool::new(false));
    let signalled = Arc::clone(&revoked);
    let runner: Runner = Box::new(move |child| {
        let frame = RgbaFrame::new(0, 32, 32, [250, 0, 100, 255].repeat(32 * 32));
        super::super::push_candidate(&child.frames, &child.real_frame_seen, frame, true, true);
        let deadline = Instant::now() + Duration::from_secs(2);
        while observed.lock().unwrap().frames.is_empty() && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(5));
        }
        assert!(!observed.lock().unwrap().frames.is_empty(), "revoke only AFTER parent copied the source");
        child.frames.lock().unwrap().invalidate_privacy();
        signalled.store(true, Ordering::Release);
        None
    });
    let stop = Arc::clone(&s.stopping);
    let stopper = thread::spawn(move || { thread::sleep(Duration::from_millis(350)); stop.store(true, Ordering::Release); });
    assert!(coordinate(s, Arc::new(Mutex::new(Vec::new())), vec![Ok(runner), source([0, 50, 200, 255], None)], || vec![display(1), display(2)]).is_none());
    stopper.join().unwrap();
    assert!(revoked.load(Ordering::Acquire));
    assert!(parent.lock().unwrap().frames.is_empty(), "copied private pixels must never reach bundle publication");
}

#[test]
fn saved_warning_survives_disk_reload_and_the_real_copy_text_composer() {
    let dir = std::env::temp_dir().join(format!("{}.apparent", crate::make_bundle_id()));
    std::fs::create_dir(&dir).unwrap();
    let mut target = sampler().target;
    target.displays[0].started_ms = Some(20);
    target.displays[1].started_ms = Some(20);
    fail(&mut target.displays[1], 1500, "Display stream unavailable");
    let mut manifest = serde_json::json!({
        "version":1, "id":"synthetic-copy-reload", "createdAtMs":0, "durationMs":2500,
        "transcript":{"source":"synthetic-test", "text":"", "segments":[]},
        "strokes":[], "marks":[], "events":[], "keyframes":[], "contactSheet":"contact-sheet.png"
    });
    manifest["target"] = serde_json::to_value(&target).unwrap();
    std::fs::write(dir.join("apparent.json"), serde_json::to_vec(&manifest).unwrap()).unwrap();
    std::fs::write(dir.join("summary.md"), "stale summary without any warnings").unwrap();
    let (path, reloaded) = crate::handoff::load_bundle(&dir).unwrap();
    assert_eq!(reloaded.target.displays, target.displays);
    let regenerated = crate::sketch::summary_markdown(&reloaded, &path);
    let copied = crate::handoff::clipboard_summary(&reloaded, &path);
    for text in [&regenerated, &copied] {
        assert!(text.contains("Display warning: synthetic-2 (2) at 1500 ms"));
        assert!(text.contains("Display stream unavailable"));
        assert!(text.contains("Missing display area is blank"));
    }
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn partial_start_keeps_healthy_source_and_warning_on_the_same_canvas() {
    let s = sampler();
    let stop = Arc::clone(&s.stopping);
    let frames = Arc::clone(&s.frames);
    let state = Arc::new(Mutex::new(Vec::new()));
    let stopper = thread::spawn(move || { thread::sleep(Duration::from_millis(400)); stop.store(true, Ordering::Release); });
    coordinate(s, Arc::clone(&state), vec![source([220, 30, 40, 255], None), Ok(Box::new(|_| None))], || vec![display(1), display(2)]);
    stopper.join().unwrap();
    let state = state.lock().unwrap();
    assert!(state[0].started_ms.is_some() && state[0].failure.is_none());
    assert!(state[1].started_ms.is_none() && state[1].failure.is_some());
    let frames = frames.lock().unwrap();
    let last = &frames.frames.last().expect("healthy source produces real candidates").0;
    assert_eq!(&last.rgba[..4], &[220, 30, 40, 255]);
    assert_eq!(&last.rgba[(last.width as usize / 2) * 4..][..4], &[24, 24, 28, 255]);
    let decoded: Vec<CapturedDisplay> = serde_json::from_slice(&serde_json::to_vec(&*state).unwrap()).unwrap();
    assert_eq!(decoded, *state);
}

#[test]
fn all_start_failures_return_without_a_real_frame_or_movie() {
    let s = sampler();
    let seen = Arc::clone(&s.real_frame_seen);
    let frames = Arc::clone(&s.frames);
    let state = Arc::new(Mutex::new(Vec::new()));
    assert!(coordinate(s, Arc::clone(&state), vec![Ok(Box::new(|_| None)), Ok(Box::new(|_| None))], || vec![display(1), display(2)]).is_none());
    assert!(!seen.load(Ordering::Acquire));
    assert!(frames.lock().unwrap().frames.is_empty());
    assert!(state.lock().unwrap().iter().all(|d| d.started_ms.is_none() && d.failure.is_some()));
}

#[test]
fn lost_or_stale_tiles_are_neutral_not_frozen_healthy_pixels() {
    let mut a = display(1); let mut b = display(2);
    let target = bounds(&[a.frame, b.frame]).unwrap();
    let image = |time, color: [u8; 4]| Some(RgbaFrame::new(time, 32, 32, color.repeat(32 * 32)));
    let frames = [image(500, [220, 30, 40, 255]), image(500, [30, 40, 220, 255])];
    let both = composite(target, (64, 32), 500, &[a.clone(), b.clone()], &frames).unwrap();
    assert_eq!(&both.rgba[32 * 4..][..4], &[30, 40, 220, 255]);
    fail(&mut b, 600, "stream lost");
    let partial = composite(target, (64, 32), 700, &[a.clone(), b], &frames).unwrap();
    assert_eq!(&partial.rgba[32 * 4..][..4], &[24, 24, 28, 255]);
    assert_eq!(&partial.rgba[..4], &[220, 30, 40, 255]);
    a.started_ms = Some(500);
    assert!(composite(target, (64, 32), 3000, &[a, display(2)], &frames).is_none());
}

#[cfg(target_os = "linux")]
#[test]
#[ignore = "requires FFmpeg; run explicitly on the Linux proof host"]
fn linux_movie_preserves_source_offsets_motion_and_loss_cutoff() {
    use std::io::Write;
    use std::process::{Command, Stdio};
    let dir = std::env::temp_dir().join(crate::make_bundle_id());
    std::fs::create_dir(&dir).unwrap();
    let mut sources = Vec::new();
    for (id, color) in [(1, [220, 30, 40]), (2, [30, 40, 220])] {
        let path = dir.join(format!("source-{id}.mp4"));
        let mut encoder = Command::new("ffmpeg").args(["-v", "error", "-n", "-f", "rawvideo", "-pixel_format", "rgb24", "-video_size", "32x32", "-framerate", "10", "-i", "pipe:0", "-c:v", "libx264", "-threads", "1", "-pix_fmt", "yuv420p"]).arg(&path).stdin(Stdio::piped()).spawn().unwrap();
        let mut input = encoder.stdin.take().unwrap();
        for frame in 0..10 {
            let mut pixels = color.repeat(32 * 32);
            for y in 8..16 { for x in frame * 2..frame * 2 + 6 {
                pixels[(y * 32 + x) * 3..][..3].copy_from_slice(&[240, 240, 240]);
            }}
            input.write_all(&pixels).unwrap();
        }
        drop(input);
        assert!(encoder.wait().unwrap().success());
        let mut display = display(id);
        if id == 2 { fail(&mut display, 500, "synthetic loss"); }
        sources.push(MovieSource { path, display, offset_ms: if id == 1 { 100 } else { 0 } });
    }
    let plan = MoviePlan { width: 64, height: 32, frame: bounds(&[display(1).frame, display(2).frame]).unwrap(), duration_ms: 1000, sources, output: dir.join("combined.mp4") };
    compose_movie(&plan).unwrap();
    let decoded = Command::new("ffmpeg").args(["-v", "error", "-i"]).arg(&plan.output).args(["-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"]).output().unwrap();
    assert!(decoded.status.success(), "whole-file movie decode");
    let stride = 64 * 32 * 3;
    assert_eq!(decoded.stdout.len() / stride, 30, "one-second shared 30fps clock");
    let pixel = |frame: usize, x: usize| &decoded.stdout[frame * stride + x * 3..][..3];
    assert!(pixel(0, 0).iter().all(|v| *v < 40), "left source must not precede its offset");
    assert!(pixel(9, 0)[0] > 180 && pixel(9, 32)[2] > 180, "both sources before loss");
    assert!(pixel(24, 0)[0] > 180 && pixel(24, 32).iter().all(|v| *v < 40), "only failed tile is blank after loss");
    assert_ne!(&decoded.stdout[9 * stride + 8 * 64 * 3..][..32 * 3], &decoded.stdout[24 * stride + 8 * 64 * 3..][..32 * 3], "healthy source still moves");
    std::fs::remove_dir_all(dir).unwrap();
}
