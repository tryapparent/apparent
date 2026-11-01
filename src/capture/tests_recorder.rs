use super::*;
use crate::model::{CaptureMode, TargetFrame};

#[test]
fn root_capture_leaves_have_engine_type_identity() {
    use apparent_capture_engine::{model, recording};
    use std::any::TypeId;

    assert_eq!(TypeId::of::<TargetInfo>(), TypeId::of::<model::TargetInfo>());
    assert_eq!(TypeId::of::<CaptureMode>(), TypeId::of::<model::CaptureMode>());
    assert_eq!(TypeId::of::<TargetFrame>(), TypeId::of::<model::TargetFrame>());
    assert_eq!(TypeId::of::<RgbaFrame>(), TypeId::of::<model::RgbaFrame>());
    assert_eq!(TypeId::of::<CandidateBuffer>(), TypeId::of::<recording::CandidateBuffer>());
    assert_eq!(TypeId::of::<ScreenRecording>(), TypeId::of::<recording::ScreenRecording>());
}

#[cfg(target_os = "linux")]
#[test]
fn producer_terminal_source_error_is_not_pending_consent() {
    // Runs the actual Linux sampler and source resolver. An invalid selected window is
    // refused before X11, D-Bus, microphone or any screen capture is opened.
    let target = TargetInfo {
        mode: CaptureMode::Window,
        app: None,
        bundle_id: None,
        window_title: None,
        window_id: None,
        display_id: 0,
        frame: TargetFrame {
            x: 0.0,
            y: 0.0,
            width: 100.0,
            height: 100.0,
            scale: 1.0,
        },
    };
    let session = ScreenCaptureSession::start(target, None, Arc::new(Mutex::new(vec![])));
    let deadline = Instant::now() + Duration::from_secs(2);
    while !session.failed_to_start() && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(5));
    }
    let failed = session.failed_to_start();
    assert!(!session.has_frames());
    assert!(!session.sampler_thread.as_ref().unwrap().is_finished());
    // Explicit caller cleanup, not an Inspect side effect.
    let recording = session.stop();
    assert!(recording.frames.is_empty());
    assert!(recording.video.is_none());
    assert!(
        failed,
        "the source resolver returned a terminal error, not pending consent"
    );
}

#[test]
fn synthetic_candidate_does_not_make_agent_capture_ready() {
    let frames = Arc::new(Mutex::new(CandidateBuffer::new(1 << 20)));
    let seen = Arc::new(AtomicBool::new(false));
    push_candidate(
        &frames,
        &seen,
        crate::render::render_synthetic_demo_frame(1280, 800, 0, 0),
        false,
        false,
    );
    let session = ScreenCaptureSession {
        started_at: Instant::now(),
        stopping: Arc::new(AtomicBool::new(false)),
        urgent_snapshot: Arc::new(AtomicBool::new(false)),
        frames,
        real_frame_seen: seen,
        startup_failed: Arc::new(AtomicBool::new(false)),
        video_offset_ms: Arc::new(AtomicU64::new(0)),
        sampler_thread: None,
        _recording: crate::retention::Recording::start(),
    };
    assert!(
        !session.has_frames(),
        "synthetic pixels are not a real capture"
    );
    assert!(session.failed_to_start(), "no sampler and no real frames must fail start");
    push_candidate(
        &session.frames,
        &session.real_frame_seen,
        RgbaFrame::new(1, 1, 1, vec![1, 2, 3, 255]),
        false,
        true,
    );
    assert!(session.has_frames(), "real pixels unlock agent Stop");
    assert!(!session.failed_to_start(), "real frames distinguish started from startup failure");
}

#[test]
fn transient_screenshot_failure_retries_to_readiness_and_finalization() {
    for error in ["screenshot acquisition failed", "screenshot has invalid pixel length"] {
        let stopping = Arc::new(AtomicBool::new(false));
        let worker_stopping = Arc::clone(&stopping);
        let worker = thread::spawn(move || {
            while !worker_stopping.load(Ordering::Acquire) {
                thread::park_timeout(Duration::from_millis(5));
            }
            None
        });
        let session = ScreenCaptureSession {
            started_at: Instant::now(),
            stopping,
            urgent_snapshot: Arc::new(AtomicBool::new(false)),
            frames: Arc::new(Mutex::new(CandidateBuffer::new(1 << 20))),
            real_frame_seen: Arc::new(AtomicBool::new(false)),
            startup_failed: Arc::new(AtomicBool::new(false)),
            video_offset_ms: Arc::new(AtomicU64::new(0)),
            sampler_thread: Some(worker),
            _recording: crate::retention::Recording::start(),
        };
        sample_real_candidate(
            &session.frames, &session.real_frame_seen, &session.startup_failed,
            true, || Err(error.into()),
        );
        assert!(!session.has_frames(), "a failed sample cannot supply readiness");
        let candidates = std::mem::replace(
            &mut *session.frames.lock().unwrap(),
            CandidateBuffer::new(1 << 20),
        );
        assert!(candidates.into_frames().is_empty(), "no demo pixels");
        let mut retried = false;
        sample_real_candidate(
            &session.frames, &session.real_frame_seen, &session.startup_failed,
            false, || {
                retried = true;
                Ok(RgbaFrame::new(220, 64, 64, vec![255; 64 * 64 * 4]))
            },
        );
        assert!(retried, "{error}: an individual sample failure must not disable later attempts");
        assert!(session.has_frames(), "the next successful sample unlocks Stop");
        assert!(!session.failed_to_start());
        let recording = session.stop();
        assert_eq!(recording.frames.len(), 1);
        let dir = std::env::temp_dir().join(crate::make_bundle_id());
        let target = TargetInfo {
            mode: CaptureMode::Region,
            app: None, bundle_id: None, window_title: None, window_id: None,
            display_id: 0,
            frame: TargetFrame { x: 0.0, y: 0.0, width: 64.0, height: 64.0, scale: 1.0 },
        };
        let (saved, bundle, _) = crate::finalize_capture_bundle(
            &dir, target, recording, vec![], vec![], None, None,
            crate::windows::ActivityLog::default(), None,
        ).expect("a recovered real sample must allow ordinary finalization");
        assert_eq!(saved, dir);
        assert!(!bundle.keyframes.is_empty());
        assert!(dir.join("apparent.json").is_file());
        std::fs::remove_dir_all(dir).unwrap();
    }
}

#[test]
fn pending_worker_is_not_failed_and_terminal_signal_does_not_discard_it() {
    let stopping = Arc::new(AtomicBool::new(false));
    let worker_stopping = Arc::clone(&stopping);
    let worker = thread::spawn(move || {
        while !worker_stopping.load(Ordering::Acquire) {
            thread::park_timeout(Duration::from_millis(5));
        }
        None
    });
    let session = ScreenCaptureSession {
        started_at: Instant::now(),
        stopping,
        urgent_snapshot: Arc::new(AtomicBool::new(false)),
        frames: Arc::new(Mutex::new(CandidateBuffer::new(1 << 20))),
        real_frame_seen: Arc::new(AtomicBool::new(false)),
        startup_failed: Arc::new(AtomicBool::new(false)),
        video_offset_ms: Arc::new(AtomicU64::new(0)),
        sampler_thread: Some(worker),
        _recording: crate::retention::Recording::start(),
    };
    assert!(!session.failed_to_start(), "a pending producer is not an error");
    session.startup_failed.store(true, Ordering::Release);
    sample_real_candidate(
        &session.frames, &session.real_frame_seen, &session.startup_failed,
        true, || panic!("a classified terminal setup failure must not retry"),
    );
    assert!(!session.has_frames());
    assert!(session.failed_to_start());
    assert!(session.failed_to_start(), "inspection must be read-only");
    assert!(!session.stopping.load(Ordering::Acquire));
    assert!(!session.sampler_thread.as_ref().unwrap().is_finished());
    assert!(session.stop().frames.is_empty());
}

#[test]
fn screen_stop_joins_worker_before_collecting_its_final_media() {
    let stopping = Arc::new(AtomicBool::new(false));
    let frames = Arc::new(Mutex::new(CandidateBuffer::new(1 << 20)));
    let worker_stopping = Arc::clone(&stopping);
    let worker_frames = Arc::clone(&frames);
    let path = std::env::temp_dir().join(crate::make_bundle_id());
    let worker_path = path.clone();
    let worker = thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(2);
        while !worker_stopping.load(Ordering::Acquire) && Instant::now() < deadline {
            thread::yield_now();
        }
        assert!(worker_stopping.load(Ordering::Acquire));
        worker_frames
            .lock()
            .unwrap()
            .push(RgbaFrame::new(42, 1, 1, vec![1, 2, 3, 255]), false);
        std::fs::write(&worker_path, b"finalized media").unwrap();
        Some(worker_path)
    });
    let session = ScreenCaptureSession {
        started_at: Instant::now(),
        stopping,
        urgent_snapshot: Arc::new(AtomicBool::new(false)),
        frames,
        real_frame_seen: Arc::new(AtomicBool::new(false)),
        video_offset_ms: Arc::new(AtomicU64::new(120)),
        startup_failed: Arc::new(AtomicBool::new(false)),
        sampler_thread: Some(worker),
        _recording: crate::retention::Recording::start(),
    };
    let recording = session.stop();
    let frames = recording.frames;
    assert_eq!(frames.len(), 1);
    assert_eq!(frames[0].t_ms, 42);
    assert_eq!(frames[0].rgba, vec![1, 2, 3, 255]);
    assert_eq!(recording.video.as_ref(), Some(&path));
    assert_eq!(recording.video_offset_ms, 120);
    std::fs::remove_file(path).unwrap();
}

#[test]
fn stopped_capture_without_real_frames_stays_empty() {
    let session = ScreenCaptureSession {
        started_at: Instant::now(),
        stopping: Arc::new(AtomicBool::new(false)),
        urgent_snapshot: Arc::new(AtomicBool::new(false)),
        frames: Arc::new(Mutex::new(CandidateBuffer::new(1 << 20))),
        real_frame_seen: Arc::new(AtomicBool::new(false)),
        video_offset_ms: Arc::new(AtomicU64::new(0)),
        startup_failed: Arc::new(AtomicBool::new(false)),
        sampler_thread: None,
        _recording: crate::retention::Recording::start(),
    };
    assert!(session.stop().frames.is_empty());
}
