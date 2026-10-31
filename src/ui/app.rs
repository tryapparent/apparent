use super::*;

/// Real startup paths, without registering hotkeys or publishing personal captures.
pub fn run_start_benchmark() {
    let app = Application::new().with_assets(crate::icons::Assets);
    app.run(|cx: &mut App| {
        let quick_stop = std::env::var("APPARENT_BENCH_QUICK_STOP").as_deref() == Ok("1");
        let (sender, _receiver) = flume::unbounded();
        let telemetry = SharedCaptureTelemetry::new(sender);
        let coordinator = cx.new(|_| ApparentCoordinator::new(telemetry, None));
        cx.spawn(async move |cx| {
            for run in 0..8 {
                coordinator.update(cx, |coord, cx| coord.begin_target_selection(cx)).unwrap();
                // Allow deferred picker creation and async discovery to settle.
                cx.background_executor().timer(Duration::from_millis(600)).await;
                coordinator.update(cx, |coord, cx| {
                    let stage = Instant::now();
                    assert!(!coord.windows_loading, "Picker discovery did not finish");
                    let target = region_target(100.0, 100.0, 480.0, 320.0, &coord.selectable_windows);
                    start_metric("target_discovery_ms", stage);
                    coord.start_recording_with_target(target, cx);
                }).unwrap();
                if !quick_stop {
                    cx.background_executor().timer(Duration::from_millis(1_500)).await;
                }
                coordinator.update(cx, |coord, cx| {
                    let rec = coord.active_recording.take().expect("Recording did not start");
                    assert!(rec._metal_overlay.is_some(), "Metal overlay failed");
                    coord.telemetry.finish_session();
                    let CaptureSource::Screen { session, audio, .. } = rec.source else {
                        unreachable!("The benchmark records the screen")
                    };
                    let (recording, audio) = std::thread::scope(|scope| {
                        let screen = scope.spawn(|| session.stop());
                        let audio = audio.expect("Microphone failed to start").stop().expect("Microphone failed to stop");
                        (screen.join().unwrap(), audio)
                    });
                    if !quick_stop {
                        assert!(recording.video.is_some(), "MP4 missing");
                        assert!(audio.sample_count > 0, "Microphone returned no samples");
                        // Candidates are small (480 px long edge); the MP4 keeps full size.
                        assert!(recording.frames.iter().any(|f| f.width == 480 && f.height == 320), "No real SCK frames (synthetic fallback only)");
                    }
                    let wav = hound::WavReader::new(std::io::Cursor::new(&audio.wav_bytes)).unwrap();
                    assert_eq!(wav.duration() as usize, audio.sample_count);
                    std::fs::write(rec.bundle_dir.join("audio.wav"), &audio.wav_bytes).unwrap();
                    println!("START_RUN {}", serde_json::json!({"run": run, "frames": recording.frames.len(), "first_frame_ms": recording.frames[0].t_ms, "audio_samples": audio.sample_count, "duration_ms": recording.duration_ms, "video_offset_ms": recording.video_offset_ms}));
                    coord.set_island_phase(IslandPhase::Hidden);
                    close_capture_windows(cx);
                }).unwrap();
            }
            cx.update(|cx| cx.quit()).unwrap();
        }).detach();
    });
}

/// Runs the GPUI desktop app, optionally opening an initial `.apparent` bundle in the Review window
/// or starting recording immediately.
pub fn run_app(
    initial_bundle: Option<(PathBuf, ApparentBundle)>,
    start_recording_immediately: bool,
    start_iphone_immediately: bool,
    screenshot_out: Option<PathBuf>,
) {
    let app = Application::new().with_assets(crate::icons::Assets);
    #[cfg(target_os = "macos")]
    app.on_open_urls(|urls| {
        for url in urls {
            if crate::launch_instance::request_url(&url).is_err() {
                apparent_log("Rejected unsupported or disabled Apparent launch URL");
            }
        }
    });
    app.run(move |cx: &mut App| {
        if let Err(error) =
            cx.text_system()
                .add_fonts(vec![std::borrow::Cow::Borrowed(include_bytes!(
                    "../../assets/fonts/HostGrotesk-Variable.ttf"
                ))])
        {
            apparent_log(format!("Host Grotesk unavailable: {error}"));
        }
        apparent_log(format!("run_app started pid={}", std::process::id()));
        platform::keep_alive(cx);
        crate::settings::reconcile_login_item();
        // ⌘W, Esc, the close button or Apparent itself: every way a window closes ends up here.
        cx.on_window_closed(|cx| cx.defer(platform::hand_back_keys))
            .detach();
        let (ui_sender, ui_receiver) = flume::unbounded();
        crate::web::start_server();
        let telemetry = SharedCaptureTelemetry::new(ui_sender);
        install_global_hotkeys(&telemetry);
        start_global_input_tap(Arc::clone(&telemetry));
        platform::start_updates();
        crate::retention::start();
        crate::recover::start();
        crate::hex::watch();
        crate::speech_model::ensure();
        let menu_rx = install_status_bar();
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        let agent_rx = crate::agent_capture::listen().map_err(|error| apparent_log(format!("Agent capture control unavailable: {error:#}"))).ok();

        let mut onboarding_initialized = screenshot_out.is_some()
            || std::env::var_os("APPARENT_NO_ONBOARDING").is_some();
        // Keep the Mac gate fresh even with Settings/onboarding closed. Helper processes
        // run off the UI thread; only the first successful read may open onboarding.
        #[cfg(target_os = "macos")]
        if screenshot_out.is_none() {
            let sender = telemetry.ui_sender.clone();
            let initialized_sender = sender.clone();
            let mut first_poll = true;
            let mut launch = std::env::var_os("APPARENT_NO_ONBOARDING").is_none();
            std::thread::spawn(move || {
                crate::onboarding::poll_grants(
                    crate::onboarding::read_grants,
                    move |grants| {
                        let event = if std::mem::take(&mut launch) {
                            crate::onboarding::Event::Launch(grants)
                        } else {
                            crate::onboarding::Event::Grants(grants)
                        };
                        sender.send(LiveOverlayEvent::Onboarding(event)).is_ok()
                    },
                    move || {
                        // Preserve native URL launch's startup barrier, even if the
                        // first helper read fails. Successful Launch goes first.
                        if std::mem::take(&mut first_poll) {
                            let _ =
                                initialized_sender.send(LiveOverlayEvent::OnboardingInitialized);
                        }
                        std::thread::sleep(Duration::from_millis(500));
                    },
                );
            });
        }
        // Onboarding opens on first launch, or for a permission that went away.
        #[cfg(not(target_os = "macos"))]
        if !onboarding_initialized {
            let sender = telemetry.ui_sender.clone();
            std::thread::spawn(move || {
                if let Some(grants) = crate::onboarding::read_grants() {
                    let event = crate::onboarding::Event::Launch(grants);
                    let _ = sender.send(LiveOverlayEvent::Onboarding(event));
                }
                let _ = sender.send(LiveOverlayEvent::OnboardingInitialized);
            });
        }
        let has_initial = initial_bundle.is_some();
        let coordinator = cx.new(|_| ApparentCoordinator::new(telemetry, initial_bundle));
        set_status_inbox_count(coordinator.read(cx).inbox.len());
        #[cfg(target_os = "linux")]
        if let Err(error) = crate::linux::update::mark_relaunch_ready() {
            apparent_log(format!("Linux update relaunch readiness: {error:#}"));
        }

        if has_initial {
            open_review_window(&coordinator, cx);
        }
        if start_recording_immediately {
            let coord_clone = coordinator.clone();
            coord_clone.update(cx, |coord, cx| coord.record_or_finish(cx));
        }
        if start_iphone_immediately {
            coordinator.update(cx, |coord, cx| coord.start_recording_iphone(cx));
        }

        if let Some(out_path) = screenshot_out {
            cx.spawn(async move |cx| {
                cx.background_executor()
                    .timer(Duration::from_millis(650))
                    .await;
                let window_num = cx.update(|_| platform::front_own_window()).ok().flatten();
                let saved =
                    cx.background_executor()
                        .spawn(async move {
                            platform::capture_own_window_screenshot(window_num, &out_path)
                        })
                        .await;
                if let Err(error) = saved {
                    apparent_log(format!("Window screenshot failed: {error:#}"));
                }
                let _ = cx.update(|cx| cx.quit());
            })
            .detach();
        }

        let loop_coord = coordinator.clone();
        cx.spawn(async move |cx| {
            let mut shown_status: Option<String> = None;
            let mut shown_export_busy = false;
            let mut last_login_check = std::time::Instant::now();
            loop {
                cx.background_executor()
                    .timer(Duration::from_millis(8))
                    .await;
                let mut should_quit = false;
                let _ = cx.update(|cx| {
                    if last_login_check.elapsed() >= Duration::from_secs(2) {
                        crate::settings::reconcile_login_item();
                        last_login_check = std::time::Instant::now();
                    }
                    let status = current_status_bar_text();
                    let export_busy = EXPORTING.load(std::sync::atomic::Ordering::Acquire);
                    if status != shown_status
                        || (cfg!(target_os = "linux") && export_busy != shown_export_busy)
                    {
                        refresh_status_bar(loop_coord.read(cx).inbox.len());
                        shown_status = status;
                        shown_export_busy = export_busy;
                    }
                    platform::poll_status_bar();
                    crate::onboarding_window::poll(cx);
                    crate::settings_window::poll(cx);
                    #[cfg(any(target_os = "macos", target_os = "linux"))]
                    if crate::launch_instance::take_open(onboarding_initialized) {
                        loop_coord.update(cx, |coord, _| {
                            if !crate::launch_url::can_present(
                                coord.is_recording(),
                                coord.is_processing(),
                                coord.is_selecting(),
                            ) {
                                apparent_log("Launch requested; active capture left unchanged");
                            } else if let Some(session) = coord.onboarding.as_mut() {
                                session.show();
                            } else {
                                coord.open_settings(None);
                            }
                        });
                    }
                    #[cfg(any(target_os = "macos", target_os = "linux"))]
                    if let Some(ref rx) = agent_rx {
                        while let Ok(request) = rx.try_recv() {
                            loop_coord.update(cx, |coord, cx| coord.agent_request(request, cx));
                        }
                    }
                    if let Some(ref rx) = menu_rx {
                        while let Ok(action) = rx.try_recv() {
                            match action {
                                MenuAction::ToggleCapture => {
                                    loop_coord.update(cx, |coord, cx| coord.record_or_finish(cx));
                                }
                                MenuAction::GiveFeedback => {
                                    if crate::handoff::experiment("feedbackIssue") {
                                        loop_coord
                                            .update(cx, |coord, cx| coord.record_feedback(cx));
                                    }
                                }
                                MenuAction::ChooseTarget => {
                                    loop_coord.update(cx, |coord, cx| {
                                        if !coord.is_recording()
                                            && !coord.is_processing()
                                            && !coord.is_selecting()
                                        {
                                            coord.begin_target_selection(cx);
                                        }
                                    });
                                }
                                MenuAction::OpenLatest => {
                                    if let Ok((dir, bundle)) =
                                        crate::handoff::load_bundle(std::path::Path::new("latest"))
                                    {
                                        loop_coord.update(cx, |coord, cx| {
                                            coord.mark_handled(&dir);
                                            coord.set_review_bundle((dir, bundle), None);
                                            cx.notify();
                                        });
                                        open_review_window(&loop_coord, cx);
                                    }
                                }
                                MenuAction::OpenInbox(path) => {
                                    let loaded = crate::handoff::load_bundle(&path).ok();
                                    let opened = loaded.is_some();
                                    loop_coord.update(cx, |coord, cx| {
                                        coord.mark_handled(&path);
                                        if let Some(bundle) = loaded {
                                            coord.set_review_bundle(bundle, None);
                                        }
                                        cx.notify();
                                    });
                                    if opened {
                                        open_review_window(&loop_coord, cx);
                                    }
                                }
                                MenuAction::ExportVideo => start_video_export(),
                                MenuAction::Settings => {
                                    loop_coord.update(cx, |coord, _| coord.open_settings(None));
                                }
                                MenuAction::CheckForUpdates => {
                                    platform::check_for_updates();
                                }
                                MenuAction::Quit => {
                                    should_quit = true;
                                }
                            }
                        }
                    }

                    while let Ok(ev) = ui_receiver.try_recv() {
                        loop_coord.update(cx, |coord, cx| match ev {
                            LiveOverlayEvent::CaptureShortcut => coord.press_shortcut(cx),
                            LiveOverlayEvent::PasteLatestShortcut => {
                                if !coord.is_recording() && !coord.is_selecting() {
                                    coord.paste_latest(cx);
                                }
                            }
                            LiveOverlayEvent::UndoStroke => {
                                coord.undo_stroke(cx);
                            }
                            LiveOverlayEvent::RequestSnapshot => {
                                coord.request_immediate_frame();
                                cx.notify();
                            }
                            LiveOverlayEvent::PhoneEnded => coord.phone_ended(cx),
                            LiveOverlayEvent::Onboarding(event) => {
                                coord.onboarding_event(event, cx)
                            }
                            LiveOverlayEvent::OnboardingInitialized => {
                                onboarding_initialized = true;
                            }
                            LiveOverlayEvent::Settings(event) => coord.settings_event(event, cx),
                        });
                    }

                    motion::poll_tune();
                    if loop_coord.read(cx).shortcut.is_pending() {
                        loop_coord.update(cx, |coord, cx| coord.tick_shortcut(cx));
                    } else if loop_coord.read(cx).telemetry.take_escape()
                        && loop_coord.read(cx).is_selecting()
                    {
                        // The picker may not have the keys (another app is active), but the
                        // key tap sees Esc anyway.
                        loop_coord.update(cx, |coord, cx| coord.cancel_recording(cx));
                    }
                    if loop_coord.read(cx).gate.is_pending() {
                        loop_coord.update(cx, |coord, _| coord.tick_gate());
                    }
                    if loop_coord.read(cx).is_island_visible() {
                        record_external_frontmost_app();
                        loop_coord.update(cx, |coord, cx| coord.island_tick(cx));
                    }
                });
                if should_quit {
                    let _ = cx.update(|cx| cx.quit());
                    break;
                }
            }
        })
        .detach();
    });
}
