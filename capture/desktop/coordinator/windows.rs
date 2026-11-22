#[cfg(any(test, target_os = "macos"))]
fn restore_picker_exclusion(ids: &mut Vec<u32>, picker: Option<u32>) {
    if let Some(id) = picker.filter(|id| *id > 0)
        && !ids.contains(&id)
    {
        ids.push(id);
    }
}

fn open_picker_windows(coord_entity: &Entity<ApparentCoordinator>, cx: &mut App) {
    close_picker_window(cx);
    let screen = coord_entity.read(cx).display_rect;
    let display = platform::display_at(screen, cx);
    // Windows wants the display's own origin, or GPUI puts the picker at its default bounds.
    let picker_bounds = Bounds {
        origin: platform::window_origin(display.as_deref()),
        size: platform::layout_size(screen, display.as_deref()),
    };
    let display_id = display.as_ref().map(|d| d.id());
    let lab = coord_entity.read(cx).lab;

    let picker_coord = coord_entity.clone();
    let _ = cx.open_window(
        WindowOptions {
            window_bounds: Some(WindowBounds::Windowed(picker_bounds)),
            display_id,
            titlebar: None,
            focus: !lab,
            show: true,
            kind: WindowKind::PopUp,
            is_movable: false,
            is_resizable: false,
            is_minimizable: false,
            window_background: WindowBackgroundAppearance::Transparent,
            ..Default::default()
        },
        move |window, cx| {
            // The display the picker was opened for, or has since followed the pointer to.
            let frame = picker_coord.read(cx).display_rect.map(f64::from);
            if let Some(num) = platform::configure_picker_window(window, lab, frame, cx) {
                picker_coord
                    .read(cx)
                    .telemetry
                    .excluded_window_ids
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner)
                    .push(num);
            }
            let focus = cx.focus_handle();
            if !lab {
                window.focus(&focus);
            }
            cx.new(|cx| {
                cx.observe(&picker_coord, |_, _, cx| cx.notify()).detach();
                TargetPickerWindow {
                    coordinator: picker_coord,
                    focus,
                }
            })
        },
    );
    // A menu bar (accessory) app isn't active when its menu or capsule is used, and keys only
    // reach the picker while it is.
    if !lab {
        platform::take_keys(cx);
    }

    ensure_hud_pill_open(coord_entity, cx);
}

/// Puts Apparent's floating windows back in order once they've all opened: the pill above the
/// picker above the ink overlay (which places itself a turn later).
fn restack_soon(cx: &mut App) {
    cx.spawn(async move |cx| {
        cx.background_executor()
            .timer(Duration::from_millis(60))
            .await;
        let _ = cx.update(|cx| {
            for handle in cx.windows() {
                if handle.downcast::<TargetPickerWindow>().is_some() {
                    let _ = handle.update(cx, |_, window, _| platform::raise_window(window));
                }
            }
            for handle in cx.windows() {
                if handle.downcast::<HudPillWindow>().is_some() {
                    let _ = handle.update(cx, |_, window, _| platform::raise_window(window));
                }
            }
        });
    })
    .detach();
}

fn ensure_hud_pill_open(coord_entity: &Entity<ApparentCoordinator>, cx: &mut App) {
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        coord_entity.update(cx, |coord, _| coord.ensure_electron_pill());
        if coord_entity.read(cx).electron_pill_routed { return; }
        // Linux reserves presentation for the launching renderer. The tick
        // restores GPUI only on a real launch/readiness failure, avoiding a
        // native pill flashing before the healthy Electron surface arrives.
        #[cfg(target_os = "linux")]
        if coord_entity.read(cx).electron_pill.as_ref().is_some_and(|session| session.healthy()) {
            return;
        }
    }
    if crate::shared::handoff::native_pill() {
        let _ = coord_entity.update(cx, |coord, _| {
            coord.ensure_native_pill();
            coord.sync_native_pill();
        });
        return;
    }
    restack_soon(cx);
    for handle in cx.windows() {
        if let Some(pill) = handle.downcast::<HudPillWindow>() {
            #[cfg(any(target_os = "linux", target_os = "macos"))]
            let telemetry = Arc::clone(&coord_entity.read(cx).telemetry);
            let _ = pill.update(cx, |view, _, cx| {
                view.chrome.raise();
                // Linux's exclusion is candidate-only; Mac includes the pill in this experiment.
                #[cfg(any(target_os = "linux", target_os = "macos"))]
                if let Some(num) = view.chrome.window_number() {
                    #[cfg(target_os = "macos")]
                    let exclude = !crate::shared::handoff::experiment("movableRecordingControls");
                    #[cfg(target_os = "linux")]
                    let exclude = true;
                    let mut ids = telemetry
                        .excluded_window_ids
                        .lock()
                        .unwrap_or_else(std::sync::PoisonError::into_inner);
                    if exclude && !ids.contains(&num) {
                        ids.push(num);
                    }
                }
                cx.notify();
            });
            return;
        }
    }
    // The display in use: the picker's or recording's, else the pointer's.
    let coord = coord_entity.read(cx);
    let in_use = match (&coord.active_recording, coord.island_phase) {
        (Some(rec), _) if rec.target.mode != CaptureMode::Device => {
            let f = rec.target.frame;
            Some([f.x, f.y, f.width, f.height].map(|v| v as f32))
        }
        (_, IslandPhase::Selecting { .. }) => Some(coord.display_rect),
        _ => None,
    };
    let near =
        in_use.or_else(|| crate::capture::engine::runtime::screens::pointer().map(|[x, y]| [x as f32, y as f32, 1.0, 1.0]));
    let display = near.map_or_else(|| cx.primary_display(), |r| platform::display_at(r, cx));
    let display_bounds = display.as_ref().map_or_else(
        || Bounds {
            origin: Point::default(),
            size: size(px(1440.0), px(900.0)),
        },
        |d| d.bounds(),
    );
    let display_id = display.as_ref().map(|d| d.id());

    // Transparent Dynamic Island host positioned cleanly below the 37pt macOS menu bar
    let pill_size: Size<Pixels> = size(px(PILL_WINDOW_W), px(PILL_WINDOW_H));
    let pill_bounds = Bounds {
        origin: platform::hud_pill_origin(display_bounds),
        size: pill_size,
    };
    let pill_coord = coord_entity.clone();
    let _ = cx.open_window(
        WindowOptions {
            window_bounds: Some(WindowBounds::Windowed(pill_bounds)),
            display_id,
            titlebar: None,
            focus: false,
            show: true,
            kind: WindowKind::PopUp,
            is_movable: true,
            is_resizable: false,
            is_minimizable: false,
            window_background: WindowBackgroundAppearance::Transparent,
            ..Default::default()
        },
        move |window, cx| {
            let chrome = PillChrome::open(window, cx);
            #[cfg(any(target_os = "linux", target_os = "macos"))]
            if let Some(num) = chrome.window_number() {
                #[cfg(target_os = "macos")]
                let exclude = !crate::shared::handoff::experiment("movableRecordingControls");
                #[cfg(target_os = "linux")]
                let exclude = true;
                if exclude {
                    pill_coord.read(cx).telemetry.excluded_window_ids.lock()
                        .unwrap_or_else(std::sync::PoisonError::into_inner)
                        .push(num);
                }
            }
            let focus = cx.focus_handle();
            window.focus(&focus);
            cx.new(|cx| {
                cx.observe(&pill_coord, |_, _, cx| cx.notify()).detach();
                HudPillWindow {
                    coordinator: pill_coord,
                    focus,
                    chrome,
                    frames: 0,
                    #[cfg(target_os = "linux")]
                    equalizer: InputEqualizer::default(),
                }
            })
        },
    );
}

fn close_picker_window(cx: &mut App) {
    for handle in cx.windows() {
        if handle.downcast::<TargetPickerWindow>().is_some() {
            let _ = handle.update(cx, |_, window, _| window.remove_window());
        }
    }
}

fn close_capture_windows(cx: &mut App) {
    for handle in cx.windows() {
        if handle.downcast::<HudPillWindow>().is_some()
            || handle.downcast::<TargetPickerWindow>().is_some()
        {
            let _ = handle.update(cx, |_, window, _| window.remove_window());
        }
    }
}

fn close_review_window(cx: &mut App) {
    for handle in cx.windows() {
        if handle.downcast::<BundleReviewWindow>().is_some() {
            let _ = handle.update(cx, |_, window, _| window.remove_window());
        }
    }
}

fn open_review_capture(coord: &Entity<ApparentCoordinator>, path: &std::path::Path, cx: &mut App) {
    match crate::shared::handoff::load_bundle(path) {
        Ok(bundle) => {
            coord.update(cx, |coord, cx| {
                coord.mark_handled(path);
                coord.set_review_bundle(bundle, None);
                cx.notify();
            });
        }
        Err(error) => {
            coord.update(cx, |coord, cx| {
                coord.review_status = Some(format!("Could not open capture: {error}"));
                cx.notify();
            });
        }
    }
}

/// Opens the review window in front with the keys. A menu bar (accessory) app isn't active when
/// its menu is used, and the cooperative `NSApp.activate()` may leave the window behind the app
/// in front, so it activates ignoring other apps once the window exists.
fn open_review_window(coord_entity: &Entity<ApparentCoordinator>, cx: &mut App) {
    for handle in cx.windows() {
        if let Some(review) = handle.downcast::<BundleReviewWindow>() {
            platform::take_keys(cx);
            let _ = review.update(cx, |_, window, cx| {
                window.activate_window();
                cx.notify();
            });
            return;
        }
    }
    let bounds = Bounds::centered(None, size(px(1120.0), px(740.0)), cx);
    let coord_clone = coord_entity.clone();
    let _ = cx.open_window(
        WindowOptions {
            window_bounds: Some(WindowBounds::Windowed(bounds)),
            titlebar: Some(gpui::TitlebarOptions {
                // The taskbar and Alt+Tab show it on Windows and Linux; macOS draws no title here.
                title: cfg!(not(target_os = "macos")).then(|| "Apparent".into()),
                appears_transparent: true,
                traffic_light_position: Some(point(px(16.0), px(16.0))),
            }),
            app_id: Some("dev.kitlangton.apparent".into()),
            focus: true,
            show: true,
            kind: WindowKind::Normal,
            is_resizable: true,
            window_background: WindowBackgroundAppearance::Opaque,
            ..Default::default()
        },
        move |window, cx| {
            platform::decorate_app_window(window);
            let focus = cx.focus_handle();
            window.focus(&focus);
            cx.new(|cx: &mut Context<BundleReviewWindow>| {
                cx.observe(&coord_clone, |_, _, cx| cx.notify()).detach();
                cx.spawn(async move |view, cx| {
                    loop {
                        let history = cx
                            .background_executor()
                            .spawn(async {
                                crate::shared::handoff::capture_history(
                                    &crate::shared::handoff::default_captures_dir(),
                                )
                            })
                            .await;
                        if view
                            .update(cx, |review, cx| review.update_history(history, cx))
                            .is_err()
                        {
                            break;
                        }
                        cx.background_executor().timer(Duration::from_secs(2)).await;
                    }
                })
                .detach();
                BundleReviewWindow::new(coord_clone, focus)
            })
        },
    );
    platform::take_keys(cx);
}

pub(crate) fn start_metric(name: &str, started: Instant) {
    if std::env::var_os("APPARENT_BENCH_START").is_some()
        || std::env::var_os("APPARENT_START_TIMINGS").is_some()
    {
        eprintln!(
            "START_METRIC {name}={:.6}",
            started.elapsed().as_secs_f64() * 1_000.0
        );
    }
}

/// Real startup paths, without registering hotkeys or publishing personal captures.
pub fn run_start_benchmark() {
    let app = Application::new().with_assets(crate::capture::desktop::icons::Assets);
    app.run(|cx: &mut App| {
        let quick_stop = std::env::var("APPARENT_BENCH_QUICK_STOP").as_deref() == Ok("1");
        let (sender, _receiver) = flume::unbounded();
        let telemetry = SharedCaptureTelemetry::new(sender);
        let coordinator = cx.new(|_| ApparentCoordinator::new(telemetry, None));
        cx.spawn(async move |cx| {
            for run in 0..8 {
                // This explicit diagnostic still measures the legacy picker;
                // the ordinary Linux GUI entry is intentionally unavailable.
                coordinator.update(cx, |coord, cx| {
                    coord.open_picker(None, cx);
                }).unwrap();
                // Allow deferred picker creation and async discovery to settle.
                cx.background_executor().timer(Duration::from_millis(600)).await;
                coordinator.update(cx, |coord, cx| {
                    let stage = Instant::now();
                    assert!(!coord.windows_loading, "Picker discovery did not finish");
                    let target = region_target(100.0, 100.0, 480.0, 320.0, &coord.selectable_windows);
                    start_metric("target_discovery_ms", stage);
                    coord.start_recording_with_target(|_| target, cx);
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
                    coord.apply_pill_event(PillEvent::Hide);
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
    let _signals = workflow::shutdown::Signals::install()
        .inspect_err(|error| apparent_log(format!("Graceful signal handling unavailable: {error:#}"))).ok();
    workflow::error_reporting::install();
    let app = Application::new().with_assets(crate::capture::desktop::icons::Assets);
    #[cfg(target_os = "macos")]
    app.on_reopen(|_| workflow::launch_instance::request_open());
    #[cfg(target_os = "macos")]
    app.on_open_urls(|urls| {
        for url in urls {
            if workflow::launch_instance::request_url(&url).is_err() {
                apparent_log("Rejected unsupported or disabled Apparent launch URL");
            }
        }
    });
    app.run(move |cx: &mut App| {
        if let Err(error) =
            cx.text_system()
                .add_fonts(vec![std::borrow::Cow::Borrowed(include_bytes!(
                    "../../../shared/assets/fonts/HostGrotesk-Variable.ttf"
                ))])
        {
            apparent_log(format!("Host Grotesk unavailable: {error}"));
        }
        apparent_log(format!("run_app started pid={}", std::process::id()));
        platform::keep_alive(cx);
        crate::capture::desktop::settings::reconcile_login_item();
        // ⌘W, Esc, the close button or Apparent itself: every way a window closes ends up here.
        cx.on_window_closed(|cx| cx.defer(platform::hand_back_keys))
            .detach();
        #[cfg(target_os = "linux")]
        cx.on_app_quit(|_| crate::capture::desktop::linux::hyprland::release_runtime_bindings())
            .detach();
        let (ui_sender, ui_receiver) = flume::unbounded();
        crate::capture::desktop::web::start_server();
        let telemetry = SharedCaptureTelemetry::new(ui_sender);
        install_global_hotkeys(&telemetry);
        start_global_input_tap(Arc::clone(&telemetry));
        platform::start_updates();
        crate::capture::engine::bundle::retention::start();
        crate::capture::engine::bundle::recover::start();
        crate::shared::hex::watch();
        crate::capture::engine::runtime::audio::transcription::speech_model::ensure();
        let menu_rx = install_status_bar();
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        let agent_rx = crate::capture::desktop::workflow::agent_capture::listen().map_err(|error| apparent_log(format!("Agent capture control unavailable: {error:#}"))).ok();

        let mut onboarding_initialized = screenshot_out.is_some()
            || std::env::var_os("APPARENT_NO_ONBOARDING").is_some();
        if screenshot_out.is_none() {
            let sender = telemetry.ui_sender.clone();
            let mut launch = !onboarding_initialized;
            std::thread::spawn(move || {
                loop {
                    let grants = crate::composition::observe_permissions();
                    let launch = grants.is_some() && std::mem::take(&mut launch);
                    if sender.send(LiveOverlayEvent::PermissionFacts(grants, launch)).is_err() {
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(500));
                }
            });
        }
        let has_initial = initial_bundle.is_some();
        let coordinator = cx.new(|_| ApparentCoordinator::new(telemetry, initial_bundle));
        #[cfg(any(target_os = "linux", target_os = "macos"))]
        coordinator.update(cx, |coord, _| coord.ensure_electron_pill());
        set_status_inbox_count(coordinator.read(cx).inbox.len());
        #[cfg(target_os = "macos")]
        let reopen_settings = crate::capture::desktop::sparkle::take_reopen_settings();
        #[cfg(target_os = "linux")]
        let reopen_settings = std::env::var_os("APPARENT_UPDATE_REOPEN_SETTINGS").as_deref() == Some(std::ffi::OsStr::new("1"));
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        if reopen_settings {
            coordinator.update(cx, |coord, _| coord.open_settings(Some(crate::capture::desktop::settings::Pane::About)));
        }
        #[cfg(target_os = "linux")]
        if let Err(error) = crate::capture::desktop::linux::update::mark_relaunch_ready() {
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
                let _ = cx.update(|cx| {
                    if last_login_check.elapsed() >= Duration::from_secs(2) {
                        crate::capture::desktop::settings::reconcile_login_item();
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
                    loop_coord.read(cx).publish_capture_busy();
                    platform::poll_status_bar();
                    settings::onboarding_window::poll(cx);
                    #[cfg(any(target_os = "macos", target_os = "linux"))]
                    workflow::electron::poll_windows(cx);
                    #[cfg(any(target_os = "macos", target_os = "linux"))]
                    if workflow::launch_instance::take_open(onboarding_initialized) {
                        loop_coord.update(cx, |coord, cx| {
                            if !crate::capture::desktop::workflow::launch_url::can_present(
                                coord.is_recording(),
                                coord.is_processing(),
                                coord.is_selecting(),
                            ) {
                                apparent_log("Launch requested; active capture left unchanged");
                            } else if let Some(session) = coord.onboarding.as_mut() {
                                session.show();
                            } else {
                                // About is the shared installed Electron Settings entry.
                                // Its sidebar retains access to the native panes until migrated.
                                coord.open_settings(Some(crate::capture::desktop::settings::Pane::About));
                            }
                        });
                    }
                    #[cfg(target_os = "linux")]
                    platform::poll_controls(loop_coord.read(cx).is_recording() || loop_coord.read(cx).source_is_stopping() || loop_coord.read(cx).is_selecting(), !onboarding_initialized || loop_coord.read(cx).onboarding.is_some(), loop_coord.read(cx).settings.is_some(), cx);
                    #[cfg(any(target_os = "macos", target_os = "linux"))]
                    if let Some(ref rx) = agent_rx {
                        while let Ok(request) = rx.try_recv() {
                            loop_coord.update(cx, |coord, cx| coord.agent_request(request, cx));
                        }
                    }
                    if let Some(ref rx) = menu_rx {
                        while let Ok(action) = rx.try_recv() {
                            #[cfg(target_os = "linux")]
                            let Some(action) = admit_controls_action(action,
                                loop_coord.read(cx).is_recording() || loop_coord.read(cx).is_processing() ||
                                loop_coord.read(cx).is_selecting() || loop_coord.read(cx).onboarding.is_some()) else { continue; };
                            match action {
                                #[cfg(target_os = "linux")]
                                MenuAction::Controls(_) => {},
                                MenuAction::ToggleMicrophone => {
                                    let enabled = !crate::capture::engine::runtime::audio::mic::enabled();
                                    if let Err(error) = crate::shared::handoff::set_config_value_in(&crate::shared::handoff::default_config_path(), "microphoneEnabled", serde_json::json!(enabled)) {
                                        apparent_log(format!("Microphone preference was not saved: {error:#}"));
                                    }
                                }
                                MenuAction::ToggleCapture => {
                                    loop_coord.update(cx, |coord, cx| coord.record_or_finish(cx));
                                }
                                #[cfg(not(target_os = "linux"))]
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
                                        crate::shared::handoff::load_bundle(std::path::Path::new("latest"))
                                    {
                                        loop_coord.update(cx, |coord, cx| {
                                            if let Some(session)=coord.onboarding.as_mut(){session.practice_opened_bundle(&dir);}
                                            coord.mark_handled(&dir);
                                            coord.set_review_bundle((dir, bundle), None);
                                            cx.notify();
                                        });
                                        open_review_window(&loop_coord, cx);
                                    }
                                }
                                MenuAction::OpenInbox(path) => {
                                    let loaded = crate::shared::handoff::load_bundle(&path).ok();
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
                                    loop_coord.update(cx, |coord, _| {
                                        coord.open_settings(None);
                                        if coord.settings.is_some() && let Some(session)=coord.onboarding.as_mut().filter(|session| session.practice_active()) {
                                            session.practice_settings_opened();
                                        }
                                    });
                                }
                                MenuAction::CheckForUpdates => {
                                    platform::check_for_updates();
                                }
                                MenuAction::Quit => {
                                    loop_coord.update(cx, |coord, cx| coord.request_quit(cx));
                                }
                            }
                        }
                    }

                    while let Ok(ev) = ui_receiver.try_recv() {
                        loop_coord.update(cx, |coord, cx| match ev {
                            LiveOverlayEvent::CaptureShortcut => coord.press_shortcut(cx),
                            #[cfg(target_os="linux")]
                            LiveOverlayEvent::DesktopShortcutWhilePaused => {
                                if let Some(session)=coord.onboarding.as_mut().filter(|session|session.editing_shortcut()) {
                                    session.desktop_shortcut_pressed();
                                }
                            }
                            LiveOverlayEvent::PasteLatestShortcut => {
                                if !coord.is_recording() && !coord.is_selecting() {
                                    coord.paste_latest(cx);
                                }
                            }
                            LiveOverlayEvent::UndoStroke => {
                                coord.undo_stroke(cx);
                            }
                            LiveOverlayEvent::NotesUnavailable => {
                                apparent_log("Typed notes UI exited; recording continues. See this capture's notes-ui.log.");
                                if let Ok(mut status) = CAPTURE_STATUS.lock() { *status = Some("Typed notes unavailable · recording continues".into()); }
                            }
                            LiveOverlayEvent::NoteClosed { focus, owner } => platform::restore_note_focus(focus, owner),
                            LiveOverlayEvent::NoteOutside => { if let Some(ui) = coord.note_ui.as_ref() { ui.outside(); } },
                            LiveOverlayEvent::Note { pin, t, x, y, screen_x, screen_y } => {
                                coord.request_immediate_frame();
                                let (focus, owner) = platform::note_focus();
                                if let Some(ui) = &coord.note_ui { ui.open(workflow::notes::Anchor { pin, t, x, y, screen_x, screen_y, focus, owner }); }
                            }
                            LiveOverlayEvent::RequestSnapshot => {
                                coord.request_immediate_frame();
                                cx.notify();
                            }
                            LiveOverlayEvent::PhoneEnded => coord.phone_ended(cx),
                            LiveOverlayEvent::Onboarding(event) => {
                                coord.onboarding_event(event, cx)
                            }
                            LiveOverlayEvent::PermissionFacts(grants, launch) => {
                                coord.permission_facts(grants, launch, cx);
                                onboarding_initialized = true;
                            }
                            LiveOverlayEvent::Settings(event) => coord.settings_event(event, cx),
                        });
                    }

                    if loop_coord.read(cx).permission_facts_expired() {
                        loop_coord.update(cx, |coord, cx| coord.permission_facts(None, false, cx));
                    }
                    motion::poll_tune();
                    if workflow::shutdown::requested() {
                        loop_coord.update(cx, |coord, cx| coord.request_quit(cx));
                    }
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
                    loop_coord.update(cx, |coord, cx| coord.tick_onboarding_practice(cx));
                    if loop_coord.read(cx).is_island_visible() {
                        record_external_frontmost_app();
                        loop_coord.update(cx, |coord, cx| coord.island_tick(cx));
                    }
                });

            }
        })
        .detach();
    });
}
