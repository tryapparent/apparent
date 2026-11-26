impl ScreenCaptureSession {
    pub(crate) fn start_with_exclusion_receipt(
        target: TargetInfo,
        video_output_path: Option<PathBuf>,
        excluded_window_ids: Arc<Mutex<Vec<u32>>>,
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        circle: Option<Arc<crate::circle_recognition::Session>>,
        #[cfg(target_os = "macos")]
        applied_excluded_window_ids: Arc<Mutex<Vec<u32>>>,
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        prepared_source: Option<PreparedSource>,
        #[cfg(target_os = "linux")]
        pinned_movie_dir: Option<std::fs::File>,
        #[cfg(target_os = "linux")]
        startup: Option<Startup>,
        #[cfg(target_os = "linux")]
        media_clock: Option<Instant>,
    ) -> anyhow::Result<Self> {
        super::super::ensure_recording_mode(target.mode)?;
        #[cfg(target_os = "linux")]
        let adopt_intent = pinned_movie_dir.is_none();
        #[cfg(not(target_os = "linux"))]
        let adopt_intent = true;
        if adopt_intent && let Some(directory) = video_output_path.as_deref().and_then(std::path::Path::parent) {
            crate::capture::engine::bundle::recover::adopt_microphone_intent(directory, &target)?;
        }
        #[cfg(target_os = "linux")]
        let started_at = media_clock.unwrap_or_else(Instant::now);
        #[cfg(not(target_os = "linux"))]
        let started_at = Instant::now();
        let stopping = Arc::new(AtomicBool::new(false));
        let urgent_snapshot = Arc::new(AtomicBool::new(true));
        let candidate_buffer = CandidateBuffer::new(CANDIDATE_BUDGET_BYTES);
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        let candidate_buffer = CandidateBuffer { circle, ..candidate_buffer };
        #[cfg(target_os = "macos")]
        let candidate_buffer = {
            let mut buffer = candidate_buffer;
            let route = if prepared_source.is_some() { Route::SystemPicker } else { Route::Screenshot };
            buffer.set_sampling_route(route);
            buffer
        };
        let frames = Arc::new(Mutex::new(candidate_buffer));
        let real_frame_seen = Arc::new(AtomicBool::new(false));
        let startup_failed = Arc::new(AtomicBool::new(false));
        let video_offset_ms = Arc::new(AtomicU64::new(0));
        #[cfg(target_os = "macos")]
        let native_stop = prepared_source.as_ref().map(|_| Arc::new(AtomicBool::new(false)));
        #[cfg(target_os = "macos")]
        let worker_native_stop = native_stop.clone();

        let thread_stopping = Arc::clone(&stopping);
        let thread_urgent = Arc::clone(&urgent_snapshot);
        let thread_frames = Arc::clone(&frames);
        let thread_real_frame_seen = Arc::clone(&real_frame_seen);
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        let thread_startup_failed = Arc::clone(&startup_failed);
        let thread_offset = Arc::clone(&video_offset_ms);
        #[cfg(target_os = "linux")]
        let storage_dir = pinned_movie_dir.as_ref().map(std::fs::File::try_clone).transpose()?;
        let sampler_thread = thread::Builder::new()
            .name("apparent-frame-sampler".into())
            .spawn(move || {
                let sampler = Sampler {
                    target,
                    video_output_path,
                    #[cfg(target_os = "linux")]
                    pinned_movie_dir,
                    #[cfg(target_os = "linux")]
                    prepared_source,
                    #[cfg(target_os = "linux")]
                    startup,
                    excluded_window_ids,
                    #[cfg(target_os = "macos")]
                    applied_excluded_window_ids,
                    started_at,
                    stopping: thread_stopping,
                    urgent: thread_urgent,
                    frames: thread_frames,
                    real_frame_seen: thread_real_frame_seen,
                    #[cfg(any(target_os = "macos", target_os = "linux"))]
                    startup_failed: thread_startup_failed,
                    video_offset_ms: thread_offset,
                };
                #[cfg(target_os = "macos")]
                if let Some((source, stop)) = prepared_source.zip(worker_native_stop) {
                    return macos_picker::run(sampler, source, stop);
                }
                platform::run_sampler(sampler)
            });
        #[cfg(target_os = "linux")]
        let sampler_thread = if storage_dir.is_some() || media_clock.is_some() { Some(sampler_thread?) } else { sampler_thread.ok() };
        #[cfg(not(target_os = "linux"))]
        let sampler_thread = sampler_thread.ok();

        Ok(Self {
            started_at,
            stopping,
            urgent_snapshot,
            frames,
            real_frame_seen,
            startup_failed,
            #[cfg(target_os = "macos")]
            native_stop,
            video_offset_ms,
            sampler_thread,
            #[cfg(target_os = "linux")]
            storage_dir,
            _recording: crate::capture::engine::bundle::retention::Recording::start(),
        })
    }

}
