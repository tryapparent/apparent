use super::*;
use crate::model::TargetFrame;
use crate::{generate_demo_bundle, handoff, make_bundle_id, sketch};

#[test]
fn movie_without_safe_screenshots_is_not_a_bundle() {
    let dir = std::env::temp_dir().join(make_bundle_id());
    std::fs::create_dir(&dir).unwrap();
    let movie = dir.join("recording.mp4");
    std::fs::write(&movie, b"untrusted movie bytes").unwrap();
    std::fs::write(dir.join("audio.wav"), b"audio bytes").unwrap();
    let target = TargetInfo {
        mode: CaptureMode::Window,
        app: None,
        bundle_id: None,
        window_title: None,
        window_id: None,
        display_id: 1,
        frame: TargetFrame { x: 0.0, y: 0.0, width: 32.0, height: 32.0, scale: 1.0 },
    };
    let error = finalize_capture_bundle(
        &dir,
        target,
        capture::ScreenRecording {
            frames: Vec::new(),
            video: Some(movie.clone()),
            duration_ms: 1_000,
            video_offset_ms: 0,
        },
        Vec::new(),
        Vec::new(),
        None,
        None,
        windows::ActivityLog::default(),
        None,
    )
    .err()
    .expect("a movie alone is not a safe screenshot candidate");
    assert!(error.to_string().contains(&movie.display().to_string()));
    assert!(movie.exists());
    assert!(!dir.join("apparent.json").exists());
    assert!(dir.join(crate::recover::UNSAFE_VIDEO).exists());
    assert!(!crate::recover::owed(&dir), "a later recovery must not decode unsafe movie frames");
    assert!(crate::recover::rebuild(&dir, &crate::recover::Media::SYSTEM).is_err());
    std::fs::remove_dir_all(dir).unwrap();
}
#[test]
fn video_only_bundle_discloses_telemetry_gap_after_reload() {
    let root = std::env::temp_dir().join(make_bundle_id());
    let dir = root.join("video-only.apparent");
    let target = TargetInfo {
        mode: CaptureMode::Display,
        app: None,
        bundle_id: None,
        window_title: None,
        window_id: None,
        display_id: 1,
        frame: TargetFrame { x: 0.0, y: 0.0, width: 32.0, height: 32.0, scale: 1.0 },
    };
    let (_, bundle, summary) = build_bundle_from_parts(
        &dir, target, 1000,
        vec![RgbaFrame::new(0, 32, 32, vec![128; 32 * 32 * 4])],
        vec![], vec![], TranscriptData::default(), None, None,
        SourceExtras {
            interaction_telemetry: Some(model::InteractionTelemetry::VideoOnly),
            autocrop: Some(None),
            ..Default::default()
        },
    ).unwrap();
    assert!(bundle.events.is_empty());
    assert!(bundle.marks.is_empty());
    assert!(summary.contains("clicks and Shift ink were not collected"));
    assert_eq!(std::fs::read_to_string(dir.join("summary.md")).unwrap(), summary);
    let (_, loaded) = handoff::load_bundle(&dir).unwrap();
    assert_eq!(loaded.interaction_telemetry, Some(model::InteractionTelemetry::VideoOnly));
    assert!(sketch::summary_markdown_with(&loaded, &dir, true).contains("clicks and Shift ink were not collected"));
    let manifest: serde_json::Value = serde_json::from_slice(&std::fs::read(dir.join("apparent.json")).unwrap()).unwrap();
    assert_eq!(manifest["interactionTelemetry"], "videoOnly");
    let old: model::ApparentBundle = serde_json::from_value({
        let mut old = manifest;
        old.as_object_mut().unwrap().remove("interactionTelemetry");
        old
    }).unwrap();
    assert_eq!(old.interaction_telemetry, None);
    assert!(!sketch::summary_markdown_with(&old, &dir, false).contains("timed CLI video only"));
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn demo_bundle_saves_finish_trace_without_configuration() {
    let dir = std::env::temp_dir().join(format!("{}.apparent", make_bundle_id()));
    let (built, _, _) = generate_demo_bundle(Some(dir.clone())).unwrap();
    assert_eq!(built, dir);
    let trace: serde_json::Value =
        serde_json::from_slice(&std::fs::read(dir.join("finish-trace.json")).unwrap()).unwrap();
    assert_eq!(trace["version"], 1);
    assert!(trace["totalMs"].is_u64());
    assert!(dir.join("apparent.json").exists());
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn finish_trace_contains_only_timings() {
    let dir = std::env::temp_dir().join(make_bundle_id());
    std::fs::create_dir_all(&dir).unwrap();
    let trace = FinishTrace {
        version: 1,
        stop_ms: Some(8),
        audio_ms: None,
        candidates_ms: None,
        transcribe_ms: Some(40),
        select_ms: 2,
        decode_ms: 3,
        autocrop_ms: 4,
        sheet_ms: 5,
        write_ms: 6,
        total_ms: 50,
        prepared_visuals: false,
    };
    let path = dir.join("finish-trace.json");
    save_finish_trace(&dir, &trace).unwrap();
    let json: serde_json::Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    assert_eq!(json["transcribeMs"], 40);
    assert_eq!(json["totalMs"], 50);
    assert_eq!(json["preparedVisuals"], false);
    assert_eq!(json.as_object().unwrap().len(), 12);
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn artifact_failures_do_not_publish_a_manifest() {
    let root = std::env::temp_dir().join(make_bundle_id());
    let (_, mut bundle, _) = generate_demo_bundle(Some(root.join("demo.apparent"))).unwrap();
    let frame = RgbaFrame::new(0, 1, 1, vec![20, 30, 40, 255]);
    let mut key = bundle.keyframes[0].clone();
    key.file = "frames/missing/frame.png".into();
    let frame_failure = root.join("frame-failure.apparent");
    assert!(
        write_bundle_artifacts(
            &frame_failure,
            &bundle,
            &[(key, frame.clone())],
            &frame,
            "summary"
        )
        .is_err()
    );
    assert!(!frame_failure.join("apparent.json").exists());

    bundle.contact_sheet = "missing/contact-sheet.png".into();
    let sheet_failure = root.join("sheet-failure.apparent");
    assert!(write_bundle_artifacts(&sheet_failure, &bundle, &[], &frame, "summary").is_err());
    assert!(!sheet_failure.join("apparent.json").exists());

    bundle.contact_sheet = "contact-sheet.png".into();
    let empty_frames = root.join("empty-frames.apparent");
    write_bundle_artifacts(&empty_frames, &bundle, &[], &frame, "summary").unwrap();
    assert!(empty_frames.join("apparent.json").exists());
    assert!(empty_frames.join("contact-sheet.png").exists());
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn full_keyframes_match_by_time_and_preserve_partial_decodes() {
    let kf = |index: usize, t: u64| model::Keyframe {
        index,
        t,
        reason: model::KeyframeReason::Click,
        file: format!("frames/frame-{index:02}.png"),
        event: "tap".into(),
        said: None,
        mark_id: None,
        cursor: None,
    };
    let small = |t: u64| RgbaFrame::new(t, 32, 32, vec![10; 32 * 32 * 4]);
    let large = |t: u64| RgbaFrame::new(t, 160, 160, vec![200; 160 * 160 * 4]);

    let selected = vec![
        (kf(1, 1_000), small(1_000)),
        (kf(2, 2_000), small(2_000)),
        (kf(3, 3_000), small(3_000)),
    ];
    // Frame at 2_000 failed to decode and frames arrived out of order (3_000 clamped to 2_999).
    let full = vec![large(2_999), large(1_000)];
    let (merged, matched) = merge_full_keyframes(selected, full);
    assert_eq!(matched, 2);
    assert_eq!(merged[0].1.width, 160);
    assert_eq!(merged[0].1.t_ms, 1_000);
    assert_eq!(merged[1].1.width, 32);
    assert_eq!(merged[1].1.t_ms, 2_000);
    assert_eq!(merged[2].1.width, 160);
    assert_eq!(merged[2].1.t_ms, 3_000);
}

#[test]
fn failed_full_decode_explains_candidate_frames_in_written_summary() {
    let dir = std::env::temp_dir().join(make_bundle_id());
    let bundle_dir = dir.join("fallback.apparent");
    let target = TargetInfo {
        mode: CaptureMode::Window,
        app: None, bundle_id: None, window_title: None, window_id: None,
        display_id: 1,
        frame: TargetFrame { x: 0.0, y: 0.0, width: 32.0, height: 32.0, scale: 1.0 },
    };
    let frames = vec![RgbaFrame::new(0, 32, 32, vec![128; 32 * 32 * 4])];
    let (_, bundle, summary) = build_bundle_from_parts(
        &bundle_dir, target, 1000, frames, vec![], vec![],
        TranscriptData::default(), None, None,
        SourceExtras {
            full_frames: Some(Box::new(|_| anyhow::bail!("decoder missing"))),
            autocrop: Some(None),
            ..SourceExtras::default()
        },
    ).unwrap();
    assert_eq!(bundle.keyframes.len(), 1);
    assert!(summary.contains("Image quality: Full-quality keyframes could not be decoded"));
    assert!(summary.contains("smaller candidate frames"));
    assert_eq!(std::fs::read_to_string(bundle_dir.join("summary.md")).unwrap(), summary);
    let (directory, mut loaded) = handoff::load_bundle(&bundle_dir).unwrap();
    // macOS may canonicalize /var to /private/var when loading the bundle.
    // Regenerating for the original path must preserve the written summary.
    assert_eq!(sketch::summary_markdown(&loaded, &bundle_dir), summary);
    assert_eq!(directory, bundle_dir.canonicalize().unwrap());
    loaded.note = Some("a later edit".into());
    let regenerated = sketch::summary_markdown(&loaded, &directory);
    assert!(regenerated.contains("Image quality: Full-quality keyframes could not be decoded"));
    assert!(regenerated.contains("Note: a later edit"));
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn decoder_fallback_keeps_moving_target_in_agent_images() {
    let root = std::env::temp_dir().join(make_bundle_id());
    let bundle_dir = root.join("fallback.apparent");
    let target = TargetInfo {
        mode: CaptureMode::Display,
        app: None, bundle_id: None, window_title: None, window_id: None,
        display_id: 1,
        frame: TargetFrame { x: 0.0, y: 0.0, width: 480.0, height: 300.0, scale: 1.0 },
    };
    let frame = |t, x: usize| {
        let mut rgba = vec![255; 480 * 300 * 4];
        for y in 30..110 {
            for xx in x..x + 80 {
                let pixel = (y * 480 + xx) * 4;
                rgba[pixel..pixel + 3].copy_from_slice(&[220, 0, 0]);
            }
        }
        RgbaFrame::new(t, 480, 300, rgba)
    };
    let frames = vec![frame(0, 20), frame(1_000, 40)];
    let (_, bundle, summary) = build_bundle_from_parts(
        &bundle_dir, target, 1_100, frames, vec![], vec![],
        TranscriptData::default(), None, None,
        SourceExtras {
            full_frames: Some(Box::new(|_| anyhow::bail!("decoder missing"))),
            autocrop: Some(Some(autocrop::Settings::default())),
            activity: windows::ActivityLog {
                cursor: vec![windows::CursorSample(0, 0.9, 0.85), windows::CursorSample(1_100, 0.9, 0.85)],
                ..Default::default()
            },
            ..SourceExtras::default()
        },
    ).unwrap();
    assert!(summary.contains("Image quality:"));
    assert!(!bundle.keyframes.is_empty());
    assert!(bundle.autocrop.is_none(), "fallback frames must not be cursor-cropped");
    // The idle pointer is at bottom-right; the moving target is at top-left.
    for key in &bundle.keyframes {
        let bytes = std::fs::read(bundle_dir.join(&key.file)).unwrap();
        let decoder = png::Decoder::new(std::io::Cursor::new(bytes));
        let mut reader = decoder.read_info().unwrap();
        let mut pixels = vec![0; reader.output_buffer_size().unwrap()];
        let info = reader.next_frame(&mut pixels).unwrap();
        assert_eq!((info.width, info.height), (480, 300));
        assert!(pixels[..info.buffer_size()].chunks_exact(4).any(|p| p[0] > 150 && p[1] < 40 && p[2] < 40));
    }
    let sheet = std::fs::read(bundle_dir.join("contact-sheet.png")).unwrap();
    let mut reader = png::Decoder::new(std::io::Cursor::new(sheet)).read_info().unwrap();
    let mut pixels = vec![0; reader.output_buffer_size().unwrap()];
    let info = reader.next_frame(&mut pixels).unwrap();
    assert!(pixels[..info.buffer_size()].chunks_exact(4).any(|p| p[0] > 150 && p[1] < 40 && p[2] < 40));
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn successful_full_decode_keeps_normal_autocrop() {
    let root = std::env::temp_dir().join(make_bundle_id());
    let target = TargetInfo {
        mode: CaptureMode::Display,
        app: None, bundle_id: None, window_title: None, window_id: None,
        display_id: 1,
        frame: TargetFrame { x: 0.0, y: 0.0, width: 1280.0, height: 800.0, scale: 1.0 },
    };
    let candidate = RgbaFrame::new(0, 320, 200, vec![128; 320 * 200 * 4]);
    let (_, bundle, _) = build_bundle_from_parts(
        &root, target, 1_000, vec![candidate], vec![], vec![],
        TranscriptData::default(), None, None,
        SourceExtras {
            full_frames: Some(Box::new(|times| Ok(times.iter().map(|&t| {
                RgbaFrame::new(t, 1280, 800, vec![128; 1280 * 800 * 4])
            }).collect()))),
            autocrop: Some(Some(autocrop::Settings::default())),
            activity: windows::ActivityLog {
                cursor: vec![windows::CursorSample(0, 0.5, 0.5)],
                ..Default::default()
            },
            ..SourceExtras::default()
        },
    ).unwrap();
    assert!(bundle.image_quality_warning.is_none());
    assert!(bundle.autocrop.is_some(), "normal decode should still autocrop");
    assert!(root.join("frames-full/frame-01.png").exists());
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn partial_full_decode_keeps_both_resolutions_uncropped() {
    let root = std::env::temp_dir().join(make_bundle_id());
    let target = TargetInfo {
        mode: CaptureMode::Display,
        app: None, bundle_id: None, window_title: None, window_id: None,
        display_id: 1,
        frame: TargetFrame { x: 0.0, y: 0.0, width: 1280.0, height: 800.0, scale: 1.0 },
    };
    let candidate = |t| RgbaFrame::new(t, 480, 300, vec![180; 480 * 300 * 4]);
    let click = |t| model::InteractionEvent::Click {
        t, x: 0.1, y: 0.1, button: None, label: None, role: None,
    };
    let (_, bundle, summary) = build_bundle_from_parts(
        &root, target, 10_000, vec![candidate(0), candidate(5_000)],
        vec![], vec![click(0), click(5_000)], TranscriptData::default(), None, None,
        SourceExtras {
            full_frames: Some(Box::new(|times| Ok(vec![RgbaFrame::new(
                times[0], 1280, 800, vec![180; 1280 * 800 * 4],
            )]))),
            autocrop: Some(Some(autocrop::Settings::default())),
            ..SourceExtras::default()
        },
    ).unwrap();
    assert!(summary.contains("Image quality:"));
    assert_eq!(bundle.keyframes.len(), 2, "one decoded and one candidate keyframe");
    assert!(bundle.autocrop.is_none());
    let sizes: Vec<_> = bundle.keyframes.iter().map(|key| {
        let bytes = std::fs::read(root.join(&key.file)).unwrap();
        let reader = png::Decoder::new(std::io::Cursor::new(bytes)).read_info().unwrap();
        (reader.info().width, reader.info().height)
    }).collect();
    assert!(sizes.contains(&(1280, 800)), "decoded full frame must survive: {sizes:?}");
    assert!(sizes.contains(&(480, 300)), "fallback candidate must survive: {sizes:?}");
    assert!(root.join("contact-sheet.png").exists());
    std::fs::remove_dir_all(root).unwrap();
}
