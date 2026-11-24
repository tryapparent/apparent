impl Recorder {
    fn new(
        source: &Source,
        out: (u32, u32),
        candidate: (u32, u32),
        movie: Option<&Path>,
        pinned_movie_dir: Option<&std::fs::File>,
        started_at: Instant,
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
            let base = Mutex::new(None);
            sink.add_probe(gst::PadProbeType::BUFFER, move |_, info| {
                if let Some(gst::PadProbeData::Buffer(buffer)) = info.data.as_mut() {
                    let mut base = base.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
                    let pts = buffer.pts();
                    if base.is_none() && pts.is_some() && buffer.size() != 0 {
                        *base = pts;
                        first.store(started_at.elapsed().as_millis() as u64, Ordering::Release);
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
