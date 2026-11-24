impl Recorder {
    fn new(
        source: &Source,
        out: (u32, u32),
        candidate: (u32, u32),
        movie: Option<&Path>,
        pinned_movie_dir: Option<&std::fs::File>,
        started_at: Instant,
        startup: Option<Startup>,
    ) -> Result<Self> {
        init()?;
        let encoder = movie.and(encoder());
        let branch = CandidateBranch::new(out, candidate);
        let mut launch = branch.launch(&source_launch(source));
        if let Some(encoder) = encoder {
            let output = movie_output();
            launch.push_str(&format!(
                " t. ! queue max-size-time=3000000000 max-size-buffers=0 max-size-bytes=0 ! videorate ! video/x-raw,framerate={FPS}/1 ! videoconvert ! video/x-raw,format=I420 ! {encoder} name=encoder ! h264parse ! {output} name=movie_sink",
            ));
        }
        StartupPoint::VideoBuild.record_in(startup.as_ref());
        let pipeline = gst::parse::launch(&launch)
            .with_context(|| format!("Could not build the recording pipeline: {launch}"))?
            .downcast::<gst::Pipeline>()
            .map_err(|_| anyhow!("Not a pipeline"))?;
        branch.isolate_reconfigure(&pipeline)?;
        let mut movie_file = None;
        if let Some(movie) = movie.filter(|_| encoder.is_some()) {
            let pinned_path = pinned_movie_dir.map(|directory| fd_path(directory).join("recording.mp4"));
            let file = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .open(pinned_path.as_deref().unwrap_or(movie))
                .context("Could not create private recording file")?;
            let pinned_location = pinned_path.as_ref().map(|_| fd_path(&file));
            let location = pinned_location.as_deref().unwrap_or(movie).to_str()
                .context("Invalid recording file path")?;
            pipeline
                .by_name("movie_sink")
                .context("Recording pipeline has no movie sink")?
                .set_property("location", location);
            movie_file = pinned_location.is_some().then_some(file);
        }
        pipeline.set_property("message-forward", true);
        if let (Source::PipeWire { crop: Some(crop), .. }, Some(element)) =
            (source, pipeline.by_name("crop"))
        {
            crop_edges(&element, crop.rect);
        }
        let candidates = pipeline
            .by_name("candidates")
            .context("No candidate sink")?
            .downcast::<gst_app::AppSink>()
            .map_err(|_| anyhow!("Not an appsink"))?;
        let first_frame_ms = Arc::new(AtomicU64::new(u64::MAX));
        if let Some(sink) = pipeline
            .by_name("encoder")
            .and_then(|e| e.static_pad("sink"))
        {
            let first = Arc::clone(&first_frame_ms);
            let startup = startup.clone();
            let base = Mutex::new(None);
            sink.add_probe(gst::PadProbeType::BUFFER, move |_, info| {
                if let Some(gst::PadProbeData::Buffer(buffer)) = info.data.as_mut() {
                    let mut base = base.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
                    let pts = buffer.pts();
                    if base.is_none() && pts.is_some() && buffer.size() != 0 {
                        *base = pts;
                        first.store(started_at.elapsed().as_millis() as u64, Ordering::Release);
                        StartupPoint::VideoFirstFrame.record_in(startup.as_ref());
                        crate::capture::desktop::start_metric("screen_first_frame_ms", started_at);
                    }
                    if let (Some(pts), Some(zero)) = (pts, *base) {
                        let buffer = buffer.make_mut();
                        buffer.set_pts(pts.saturating_sub(zero));
                        buffer.set_dts(gst::ClockTime::NONE);
                    }
                }
                gst::PadProbeReturn::Ok
            });
        }
        pipeline
            .set_state(gst::State::Playing)
            .context("The recording pipeline wouldn't start")?;
        StartupPoint::VideoInitialized.record_in(startup.as_ref());
        Ok(Self {
            pipeline,
            candidates,
            out,
            candidate,
            video: encoder.is_some(),
            movie_file,
            first_frame_ms,
            last: None,
        })
    }
}

#[cfg(test)]
#[test]
fn chooser_storage_movie_stays_with_the_protected_directory() -> Result<()> {
    let root = tempfile::tempdir()?;
    let capture = root.path().join("capture");
    std::fs::DirBuilder::new().mode(0o700).create(&capture)?;
    std::fs::write(capture.join(".unsafe-video"), b"protected")?;
    let pinned = std::fs::File::open(&capture)?;
    let moved = root.path().join("moved");
    std::fs::rename(&capture, &moved)?;
    std::fs::DirBuilder::new().mode(0o700).create(&capture)?;
    let movie = capture.join("recording.mp4");
    let mut recorder = Recorder::new(
        &Source::Test,
        (640, 360),
        (320, 180),
        Some(&movie),
        Some(&pinned),
        Instant::now(),
        None,
    )?;
    let deadline = Instant::now() + Duration::from_secs(5);
    while recorder.candidate(0, &[]).is_none() && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(10));
    }
    assert!(recorder.last.is_some());
    assert!(recorder.finish());
    assert!(std::fs::metadata(moved.join("recording.mp4"))?.len() > 0);
    assert!(moved.join(".unsafe-video").is_file());
    assert!(!movie.exists());
    Ok(())
}

pub fn run_sampler(sampler: Sampler) -> Option<PathBuf> {
    let Sampler {
        target,
        video_output_path,
        pinned_movie_dir,
        prepared_source,
        startup,
        started_at,
        stopping,
        urgent,
        frames,
        real_frame_seen,
        startup_failed,
        video_offset_ms,
        excluded_window_ids,
    } = sampler;
    let long_edge = if target.mode == CaptureMode::Display {
        2560.0
    } else {
        1280.0
    };
    let out = crate::capture::engine::runtime::capture_size(&target, long_edge);
    let movie = video_output_path.as_deref().filter(|_| can_record_video());
    let candidate = frames.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
        .sampling_size(&target, movie.is_some());
    let source = prepared_source.map_or_else(|| super::portal::source_for(&target, &stopping, startup.as_ref()), Ok);
    let recorder = source.and_then(|source| {
        Recorder::new(&source, out, candidate, movie, pinned_movie_dir.as_ref(), started_at, startup.clone())
            .map_err(|error| anyhow!("{error:#}"))
            .map(|recorder| (recorder, source))
    });
    let mut recorder = match recorder {
        Ok(recorder) => {
            apparent_log(format!(
                "Recording {}x{} ({:?}){}",
                out.0,
                out.1,
                target.mode,
                if recorder.0.video { "" } else { ", no movie" }
            ));
            Some(recorder)
        }
        Err(error) => {
            apparent_log(format!("Screen capture failed to start: {error:#}"));
            startup_failed.store(true, Ordering::Release);
            None
        }
    };
    crate::capture::desktop::start_metric("sck_ready_ms", started_at);
    let mut last_sample = Instant::now()
        .checked_sub(crate::capture::engine::runtime::FRAME_SAMPLE_INTERVAL)
        .unwrap_or_else(Instant::now);
    let mut offset_set = false;
    let records_others = !matches!(
        recorder.as_ref().map(|(_, source)| source),
        Some(Source::X11Window { .. })
    );
    let f = target.frame;
    let mut masks = (Instant::now(), Vec::new());
    let mut masks_read = false;
    while !stopping.load(Ordering::Acquire) {
        if records_others && (!masks_read || masks.0.elapsed() >= Duration::from_millis(500)) {
            let ids = excluded_window_ids
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .clone();
            masks = (
                Instant::now(),
                own_window_masks(&ids, [f.x, f.y, f.width, f.height], candidate),
            );
            masks_read = true;
        }
        if let Some((r, _)) = recorder.as_ref() {
            if let Some(error) = r.error() {
                apparent_log(format!("Recording failed: {error}"));
                startup_failed.store(true, Ordering::Release);
                if let Some((r, _)) = recorder.take() {
                    let _ = r.pipeline.set_state(gst::State::Null);
                }
            } else if !offset_set {
                let first = r.first_frame_ms.load(Ordering::Acquire);
                if first != u64::MAX {
                    video_offset_ms.store(first, Ordering::Release);
                    offset_set = true;
                }
            }
        }
        let is_urgent = urgent.swap(false, Ordering::AcqRel);
        let interval = frames
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .interval();
        if is_urgent || last_sample.elapsed() >= interval {
            last_sample = Instant::now();
            let t_ms = started_at.elapsed().as_millis() as u64;
            let frame = match recorder.as_mut() {
                Some((r, _)) => r.candidate(t_ms, &masks.1),
                None => None,
            };
            match frame {
                Some(frame) => crate::capture::engine::runtime::push_candidate(
                    &frames, &real_frame_seen, frame, is_urgent, true,
                ),
                None if is_urgent => urgent.store(true, Ordering::Release),
                None => {}
            }
        }
        std::thread::park_timeout(Duration::from_millis(8));
    }
    let (mut recorder, _source) = recorder?;
    let _ = recorder.out;
    let movie_file = recorder.movie_file.take();
    let finished = recorder.finish();
    if let Some(directory) = pinned_movie_dir.as_ref() {
        let path = fd_path(directory).join("recording.mp4");
        let owned = movie_file.as_ref().is_some_and(|file| file_matches_path(file, &path));
        if finished && owned {
            return video_output_path;
        }
        if owned {
            let _ = std::fs::remove_file(path);
        }
    } else {
        if finished {
            return video_output_path;
        }
        if let Some(path) = &video_output_path {
            let _ = std::fs::remove_file(path);
        }
    }
    None
}
