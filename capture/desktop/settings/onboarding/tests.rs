#[cfg(test)]
mod tests {
    #[test]
    fn pen_save_receipts_follow_the_real_config_transaction() {
        const CHILD: &str = "APPARENT_PEN_RECEIPT_CHILD";
        if let Some(path) = std::env::var_os(CHILD) {
            let path = std::path::PathBuf::from(path);
            assert_eq!(crate::shared::handoff::default_config_path(), path);
            let original: serde_json::Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
            assert_eq!(original, serde_json::json!({"secret":"synthetic-pen-receipt","microphoneEnabled":false}));
            let mut session = Session::for_test(Flow::tour(Step::Welcome, Some(grants(&[]))));
            session.practice = Some(super::super::practice::Practice::default());
            session.pen_picker = true;
            let (tx, rx) = flume::unbounded();
            session.transport = Transport::InProcess(Some(tx));
            let receive = || rx.recv_timeout(std::time::Duration::from_secs(2)).unwrap();
            for id in ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"] {
                assert_eq!(session.action(&format!("pen:purple:{id}")), Effect::None);
                let view = receive();
                assert_eq!(view["penSaveId"], id);
                assert_eq!(view["penError"], false);
                assert_eq!(view["penSelected"], true);
                assert_eq!(view["step"], "welcome", "the renderer owns advancing after its hop");
                let saved: serde_json::Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
                assert_eq!(saved["penColor"], "purple");
                assert_eq!(saved["secret"], original["secret"]);
                assert_eq!(saved["microphoneEnabled"], false);
            }
            session.action("continue");
            assert_eq!(receive()["step"], "permissions");
            session.action("back");
            assert_eq!(receive()["step"], "welcome");
            assert!(session.pen_picker, "Back must return to the pen choices");
            session.action("back");
            assert_eq!(receive()["penPicker"], false, "Back from pen returns to agent setup");
            session.action("continue");
            assert_eq!(receive()["penPicker"], true);
            std::fs::write(&path, b"broken config").unwrap();
            let failed_id = "33333333-3333-4333-8333-333333333333";
            session.action(&format!("pen:blue:{failed_id}"));
            let failed = receive();
            assert_eq!(failed["penSaveId"], failed_id);
            assert_eq!(failed["penError"], true);
            assert_eq!(failed["penSelected"], false);
            assert_eq!(std::fs::read(&path).unwrap(), b"broken config");
            session.action("pen:green:invalid-receipt");
            assert!(rx.try_recv().is_err(), "invalid receipt must not emit a new acknowledgement");
            assert_eq!(session.pen_save_id.as_deref(), Some(failed_id));
            return;
        }
        struct Fixture(std::path::PathBuf);
        impl Drop for Fixture { fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); } }
        use std::os::unix::fs::DirBuilderExt;
        let fixture = Fixture(std::env::temp_dir().join(format!("pen-provider-{}", crate::shared::ids::make_bundle_id())));
        std::fs::DirBuilder::new().mode(0o700).create(&fixture.0).unwrap();
        let config = fixture.0.join("config.json");
        std::fs::write(&config, br#"{"secret":"synthetic-pen-receipt","microphoneEnabled":false}"#).unwrap();
        let name = "capture::desktop::settings::onboarding::tests::pen_save_receipts_follow_the_real_config_transaction";
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", name, "--nocapture"]).env(CHILD, &config).env("APPARENT_CONFIG", &config).output().unwrap();
        assert!(output.status.success(), "{}\n{}", String::from_utf8_lossy(&output.stdout), String::from_utf8_lossy(&output.stderr));
        assert!(String::from_utf8_lossy(&output.stdout).contains("1 passed"), "child must execute the exact provider test");
    }

    #[test]
    fn practice_finish_requires_native_receipt_and_successful_single_config_writer() {
        const CHILD:&str="APPARENT_PRACTICE_FINISH_CHILD";
        if let Some(path)=std::env::var_os(CHILD) {
            let path=std::path::PathBuf::from(path);
            assert_eq!(crate::shared::handoff::default_config_path(),path);
            for failure in [false,true] {
                std::fs::write(&path,br#"{"secret":"synthetic","unrelated":{"nested":7},"microphoneEnabled":false}"#).unwrap();
                let mut s=coached_session();let (tx,_rx)=flume::unbounded();s.transport=Transport::InProcess(Some(tx));
                s.input(Input::ShortcutTriggered);s.input(Input::CaptureStarted);s.practice_whiteboard();
                s.observe_practice(true,0,false,None);s.practice_board(None);s.observe_practice(false,1,false,None);
                s.observe_practice(false,0,true,Some(true));s.input(Input::CaptureEnded{completed:true});
                s.action("practice-review");
                assert_eq!(s.action("practice-finish"),Effect::None);
                assert!(!s.flow.first_capture_completed);
                s.input(Input::ShortcutTriggered);s.input(Input::CaptureStarted);s.practice_whiteboard();
                s.observe_practice(true,0,false,None);s.practice_board(None);s.observe_practice(false,1,false,None);
                let bundle=Path::new("/synthetic/finished.apparent");
                s.practice_completion(7,"capture",Some("request"),Some(bundle),Some(true));
                s.input(Input::CaptureEnded{completed:true});s.action("practice-review");
                assert!(!s.flow.first_capture_completed);
                if failure {std::fs::write(&path,b"invalid config").unwrap();}
                assert_eq!(s.action("practice-settings"),Effect::None);
                assert_eq!(s.practice_settings_opened(),if failure{Effect::None}else{Effect::Close});
                assert_eq!(s.flow.first_capture_completed,!failure);
                if failure {assert_eq!(std::fs::read(&path).unwrap(),b"invalid config");
                    std::fs::write(&path,br#"{"secret":"synthetic","unrelated":{"nested":7},"microphoneEnabled":false}"#).unwrap();
                    assert_eq!(s.action("practice-finish"),Effect::Close,"retry after native storage recovery");
                }
                else {let saved:serde_json::Value=serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
                    assert_eq!(saved["secret"],"synthetic");assert_eq!(saved["unrelated"]["nested"],7);
                    assert_eq!(saved["microphoneEnabled"],false);assert_eq!(saved["onboarding"]["firstCaptureCompleted"],true);}
            }
            return;
        }
        let dir=std::env::temp_dir().join(format!("practice-finish-{}",crate::shared::ids::make_bundle_id()));
        std::fs::create_dir(&dir).unwrap();let config=dir.join("config.json");
        let output=std::process::Command::new(std::env::current_exe().unwrap()).args(["--exact",
            "capture::desktop::settings::onboarding::tests::practice_finish_requires_native_receipt_and_successful_single_config_writer","--nocapture"])
            .env(CHILD,&config).env("APPARENT_CONFIG",&config).output().unwrap();
        let _=std::fs::remove_dir_all(dir);
        assert!(output.status.success(),"{}\n{}",String::from_utf8_lossy(&output.stdout),String::from_utf8_lossy(&output.stderr));
    }


    fn coached_session()->Session {
        let mut session=Session::for_test(Flow::tour(Step::TryIt,Some(grants(&Permission::REQUIRED))).with_first_capture(true, true, true, false));
        session.practice=Some(super::super::practice::Practice::default());session
    }
    #[test]
    fn completion_adapter_preserves_identity_and_actual_clipboard_result() {
        use super::super::practice::Stage;
        for (clipboard, stage) in [(Some(true), Stage::Copied), (Some(false), Stage::CopyFailed), (None, Stage::CopyFailed)] {
            let mut session = coached_session();
            session.input(Input::ShortcutTriggered);
            session.input(Input::CaptureStarted);
            session.practice_completion(7, "capture-a", Some("request-a"), Some(Path::new("/synthetic/a.apparent")), clipboard);
            assert_eq!(session.practice_receipt, Some((7, "capture-a".into(), Some("request-a".into()))));
            assert_eq!(session.practice.as_ref().unwrap().stage, stage);
            assert_eq!(session.practice_bundle.as_deref(), Some(Path::new("/synthetic/a.apparent")));
            session.practice_completion(7, "capture-a", Some("request-a"), None, Some(false));
            assert_eq!(session.practice.as_ref().unwrap().stage, stage);
        }
    }

    #[test]
    fn completion_adapter_failure_does_not_invent_a_bundle_and_retry_releases_receipt() {
        use super::super::practice::Stage;
        let mut session = coached_session();
        session.input(Input::ShortcutTriggered);
        session.input(Input::CaptureStarted);
        session.practice_completion(7, "capture-a", None, None, Some(true));
        assert!(session.practice_bundle.is_none());
        assert_eq!(session.practice.as_ref().unwrap().stage, Stage::Retry);
        session.input(Input::ShortcutTriggered);
        session.input(Input::CaptureStarted);
        assert!(session.practice_receipt.is_none());
        session.practice_completion(8, "capture-b", None, Some(Path::new("/synthetic/b.apparent")), Some(true));
        assert_eq!(session.practice_receipt, Some((8, "capture-b".into(), None)));
        assert_eq!(session.practice.as_ref().unwrap().stage, Stage::Copied);
    }

    #[test]
    fn completion_adapter_ignores_nonpractice_capture_and_empty_identity() {
        let mut session = coached_session();
        session.input(Input::CaptureStarted);
        session.practice_completion(1, "ordinary", None, Some(Path::new("/synthetic/a.apparent")), Some(true));
        assert!(session.practice_receipt.is_none());
        assert!(session.practice_bundle.is_none());
        session.input(Input::CaptureEnded { completed: false });
        session.input(Input::ShortcutTriggered);
        session.input(Input::CaptureStarted);
        session.practice_completion(2, "", None, Some(Path::new("/synthetic/a.apparent")), Some(true));
        assert!(session.practice_receipt.is_none());
    }
    #[test]
    fn shared_tour_skips_removed_demo_forward_back_and_on_legacy_resume() {
        for ready in [false, true] {
            let current = if ready { grants(&Permission::REQUIRED) } else { grants(&[]) };
            let mut flow = Flow::tour(Step::Welcome, Some(current.clone()));
            flow.on(Input::Continue);
            assert_eq!(flow.step(), if ready { Step::Shortcut } else { Step::Permissions });
            flow.on(Input::Back);
            assert_eq!(flow.step(), Step::Welcome);
            let resumed = Flow::tour(Step::HowItWorks, Some(current));
            assert_eq!(resumed.step(), if ready { Step::Shortcut } else { Step::Permissions });
        }
        assert_eq!(Flow::fix(Permission::REQUIRED.to_vec(), None).step(), Step::Permissions);
    }

    #[test]
    fn replay_rejects_queued_events_from_the_retired_transport() {
        let old=coached_session();
        let (sender,receiver)=flume::unbounded();
        let emit=Session::scope_events(old.source(),move |event| {sender.send(event).unwrap();});
        emit(Event::Action("continue".into()));
        drop(old);
        let replacement=coached_session();
        emit(Event::Exited);
        for event in receiver.try_iter() {
            assert!(event.for_current_session(Some(replacement.source())).is_none());
        }
        let (sender,receiver)=flume::unbounded();
        let emit=Session::scope_events(replacement.source(),move |event| {sender.send(event).unwrap();});
        emit(Event::Action("continue".into()));
        emit(Event::Exited);
        assert!(matches!(receiver.recv().unwrap().for_current_session(Some(replacement.source())),Some(Event::Action(_))));
        assert!(matches!(receiver.recv().unwrap().for_current_session(Some(replacement.source())),Some(Event::Exited)));
        assert!(matches!(Event::Launch(grants(&Permission::REQUIRED)).for_current_session(None),Some(Event::Launch(_))));
    }

    #[cfg(unix)]
    #[test]
    fn renderer_pipe_tags_actions_and_eof_before_fallback() {
        let mut session = coached_session();
        let generation = session.transport_generation();
        let (tx, rx) = flume::unbounded();
        let events = Session::scope_events(session.source(), move |event| { tx.send(event).unwrap(); });
        let transport = Session::spawn_renderer_transport(
            std::process::Command::new("/bin/sh").args(["-c", "printf '%s\\n' '{\"action\":\"continue\"}'"]),
            generation, events,
        ).unwrap();
        let action = rx.recv_timeout(std::time::Duration::from_secs(5)).unwrap();
        let eof = rx.recv_timeout(std::time::Duration::from_secs(5)).unwrap();
        assert!(matches!(&action, Event::Session { event, .. } if matches!(event.as_ref(), Event::Transport { generation: g, .. } if *g == generation)));
        let (sender, _receiver) = flume::unbounded();
        session.fallback = Some(Box::new(move |_| Ok(Transport::InProcess(Some(sender.clone())))));
        assert!(session.restore_native());
        for event in [action, eof] {
            assert!(event.for_current_session(Some(session.source())).unwrap()
                .for_current_transport(Some(session.transport_generation())).is_none());
        }
        retire_transport(transport);
    }

    #[test]
    fn whiteboard_ink_leads_to_screen_drawing_without_a_note_lesson() {
        use super::super::practice::Stage;
        let mut s=coached_session();s.input(Input::ShortcutTriggered);s.input(Input::CaptureStarted);
        s.practice_whiteboard();assert!(!s.practice_desktop_stage());
        s.observe_practice_surface(true,0,false,Some([0.0,0.0,720.0,540.0]));
        assert_eq!(s.practice.as_ref().unwrap().stage,Stage::BoardInk);
        s.observe_practice_surface(true,0,false,None);
        assert_eq!(s.practice.as_ref().unwrap().stage,Stage::ScreenInk);
        assert!(s.practice_desktop_stage(),"coordinator must close its board before screen drawing");
        s.practice_note_saved(false);s.observe_practice(false,0,false,None);
        assert_eq!(s.practice.as_ref().unwrap().stage,Stage::ScreenInk);assert!(s.practice_desktop_stage());
        s.observe_practice(false,1,false,None);assert_eq!(s.practice.as_ref().unwrap().stage,Stage::Stop);
        assert!(!s.practice_desktop_stage());
    }

    #[test]
    fn locate_requires_the_current_practice_bundle() {
        let mut s = coached_session();
        let first = Path::new("/synthetic/first.apparent");
        let other = Path::new("/synthetic/other.apparent");
        s.input(Input::ShortcutTriggered);
        s.input(Input::CaptureStarted);
        s.practice_whiteboard();
        s.observe_practice_surface(true,0,false,None);
        s.practice_note_saved(false);s.observe_practice(false, 0, false, None);
        s.observe_practice(false, 1, true, Some(true));
        s.practice_completion(7,"first",None,Some(first),Some(true));
        s.input(Input::CaptureEnded { completed: true });
        s.action("practice-paste");
        s.action("practice-pasted");
        s.practice_opened_bundle(other);
        assert!(s.practice_locating());
        assert_eq!(s.action("practice-finish"), Effect::None);
        s.practice_opened_bundle(first);
        assert_eq!(s.practice.as_ref().unwrap().stage, super::super::practice::Stage::Complete);

        s.input(Input::ShortcutTriggered);
        s.input(Input::CaptureStarted);
        assert!(s.practice_bundle.is_none());
        s.practice_whiteboard();
        s.observe_practice(true, 0, false, None);s.practice_board(None);
        s.practice_note_saved(true);s.observe_practice(false, 0, false, None);
        s.observe_practice(false, 1, true, Some(true));
        s.practice_completion(8,"other",None,Some(other),Some(true));
        s.input(Input::CaptureEnded { completed: true });
        s.action("practice-paste");
        s.action("practice-pasted");
        s.practice_opened_bundle(first);
        assert!(s.practice_locating());
        s.practice_opened_bundle(other);
        assert_eq!(s.action("practice-finish"), Effect::Close);
    }

    #[test]
    fn target_selection_precedes_recording_and_partial_capture_still_reaches_the_menu_lesson() {
        let mut s=coached_session();s.input(Input::ShortcutTriggered);s.input(Input::CaptureSelecting);
        assert_eq!(s.practice.as_ref().unwrap().stage,super::super::practice::Stage::Screen);
        s.input(Input::CaptureStarted);s.practice_whiteboard();s.observe_practice(true,0,true,Some(true));
        s.input(Input::CaptureEnded{completed:true});s.action("practice-paste");s.action("practice-pasted");
        assert!(s.practice_locating());s.practice_latest();assert_eq!(s.action("practice-finish"),Effect::None);
        assert!(!s.flow.first_capture_completed);
    }

    #[test]
    fn menu_bar_lesson_remains_after_paste_and_requires_opening_own_capture() {
        let mut s=coached_session();
        s.input(Input::ShortcutTriggered);s.input(Input::CaptureStarted);
        s.practice_whiteboard();s.observe_practice(true,0,false,None);s.practice_board(None);s.practice_note_saved(false);s.observe_practice(false,0,false,None);s.observe_practice(false,1,true,Some(true));
        s.practice_completion(7,"lesson",None,Some(Path::new("/synthetic/lesson.apparent")),Some(true));s.input(Input::CaptureEnded{completed:true});
        assert!(!s.practice_locating());
        s.action("practice-paste");assert!(!s.practice_locating());
        s.action("practice-pasted");assert!(s.practice_locating());
        assert_eq!(s.action("practice-finish"),Effect::None);
        s.practice_latest();assert_eq!(s.action("practice-finish"),Effect::Close);
    }

    #[test]
    fn coaching_finishes_after_completion_pill_dismissal() {
        let mut s=coached_session();s.input(Input::ShortcutTriggered);s.input(Input::CaptureStarted);
        s.practice_whiteboard();s.observe_practice(true,0,false,None);s.practice_board(None);s.practice_note_saved(false);
        s.observe_practice(false,0,false,None);s.observe_practice(false,1,false,None);s.observe_practice(false,0,true,Some(true));s.practice_completion(7,"lesson",None,Some(Path::new("/synthetic/lesson.apparent")),Some(true));s.input(Input::CaptureEnded{completed:true});
        assert!(!s.flow.practice_recording);assert!(!s.flow.hidden);
        s.input(Input::CaptureEnded{completed:false});
        s.action("practice-paste");s.action("practice-pasted");s.practice_latest();
        assert_eq!(s.action("practice-finish"),Effect::Close);assert!(s.flow.first_capture_completed);
    }
    #[test]
    fn menu_retry_cannot_inherit_completed_shortcut_attempt() {
        let mut s=coached_session();s.input(Input::ShortcutTriggered);s.input(Input::CaptureStarted);
        s.observe_practice(false,0,true,Some(true));s.input(Input::CaptureEnded{completed:true});
        s.input(Input::CaptureStarted);
        s.practice_whiteboard();s.observe_practice(true,0,false,None);s.practice_board(None);s.practice_note_saved(false);s.observe_practice(false,0,false,None);s.observe_practice(false,1,true,Some(true));
        s.input(Input::CaptureEnded{completed:true});s.action("practice-paste");s.action("practice-pasted");s.practice_latest();
        assert_eq!(s.action("practice-finish"),Effect::None);assert!(!s.flow.first_capture_completed);
    }
    #[test]
    fn deferring_shortcut_setup_keeps_the_step_and_stops_startup() {
        let mut progress = Progress::default();
        let mut flow = Flow::tour(Step::Shortcut, Some(grants(&Permission::REQUIRED)))
            .with_first_capture(true, false, false, false);
        assert_eq!(flow.on(Input::Closed), Effect::Defer);
        progress.dismiss(&flow);
        assert!(!progress.seen);
        assert!(progress.deferred);
        assert_eq!(progress.resume, Some(Step::Shortcut));
        assert!(launch_plan(&progress, &grants(&Permission::REQUIRED), true, &[]).is_none());
        assert_eq!(flow.on(Input::SkipShortcutTrial), Effect::None);
        assert_eq!(flow.step(), Step::TryIt);
        assert!(!flow.view().shortcut_tested);
        flow.on(Input::ShortcutTriggered);
        flow.on(Input::CaptureStarted);
        flow.on(Input::CaptureEnded { completed: true });
        progress.leave(&flow);
        assert!(progress.seen);
        assert_eq!(progress.resume, None);
    }

    #[test]
    fn first_capture_resume_rechecks_milestones_and_preserves_legacy_and_repairs() {
        let ready = Some(grants(&Permission::REQUIRED));
        let missing = Flow::tour(Step::TryIt, ready.clone()).with_first_capture(true, false, false, false);
        assert_eq!(missing.step(), Step::TryIt);
        let unfinished = Flow::tour(Step::Done, ready.clone()).with_first_capture(true, true, true, false);
        assert_eq!(unfinished.step(), Step::TryIt);
        let completed = Flow::tour(Step::TryIt, ready.clone()).with_first_capture(true, true, true, true);
        assert_eq!(completed.step(), Step::Done);
        let legacy = Flow::tour(Step::Shortcut, ready.clone()).with_first_capture(false, false, false, false);
        let mut progress = Progress::default();
        progress.dismiss(&legacy);
        assert!(progress.deferred);
        assert!(!progress.seen);
        let repair = Flow::fix(Permission::REQUIRED.to_vec(), ready).with_first_capture(true, false, false, false);
        assert!(!repair.view().first_capture_required);
        let before = progress.clone();
        progress.leave(&repair);
        assert_eq!(progress, before, "permission repair does not complete or reset a tour");
    }

    #[test]
    fn first_capture_requires_explicit_shortcut_choice() {
        let mut flow = Flow::tour(Step::Shortcut, Some(grants(&Permission::REQUIRED)))
            .with_first_capture(true, false, false, false);
        assert_eq!(flow.on(Input::Continue), Effect::None);
        assert_eq!(flow.step(), Step::Shortcut, "an existing shortcut is not a choice");
        flow.on(Input::ChangeShortcut);
        flow.on(Input::Continue);
        assert_eq!(flow.step(), Step::Shortcut, "opening the recorder is not a saved choice");
        flow.on(Input::ShortcutChosen);
        flow.on(Input::ShortcutTrialStarted);
        assert!(!flow.view().shortcut_tested);
        flow.on(Input::ShortcutTriggered);
        flow.on(Input::Continue);
        assert_eq!(flow.step(), Step::TryIt);
    }

    #[test]
    fn shortcut_trial_is_not_a_capture_and_changing_keys_requires_a_new_trial() {
        let mut flow=Flow::tour(Step::Shortcut,Some(grants(&Permission::REQUIRED)))
            .with_first_capture(true,false,false,false);
        assert_eq!(flow.shortcut_policy(),ShortcutPolicy::Record);
        flow.on(Input::ShortcutTriggered);
        assert!(!flow.view().shortcut_tested);
        flow.on(Input::ShortcutChosen);
        assert_eq!(flow.shortcut_policy(),ShortcutPolicy::Trial);
        flow.on(Input::Continue);
        assert_eq!(flow.step(),Step::Shortcut);
        flow.on(Input::ShortcutTrialStarted);
        assert!(!flow.view().shortcut_tested);
        flow.on(Input::ShortcutTriggered);
        assert!(flow.view().shortcut_tested);
        assert_eq!(flow.step(),Step::Shortcut);
        assert!(!flow.local_practice(),"trial must not acquire recording/handoff state");
        flow.on(Input::ChangeShortcut);
        assert_eq!(flow.shortcut_policy(),ShortcutPolicy::Block);
        flow.on(Input::ShortcutChosen);
        assert!(!flow.view().shortcut_tested,"saving different keys invalidates the trial");
        flow.on(Input::ShortcutTriggered);
        flow.on(Input::Continue);
        assert_eq!(flow.step(),Step::TryIt);
        assert_eq!(flow.shortcut_policy(),ShortcutPolicy::Record);
        assert!(!flow.local_practice(),"entering practice is not starting a capture");
        flow.on(Input::ShortcutTriggered);
        assert!(flow.local_practice(),"the next press owns the real guided capture");
    }

    #[test]
    fn resumed_optional_practice_keeps_its_step_and_early_pages_allow_capture() {
        for step in [Step::Welcome,Step::HowItWorks,Step::Permissions] {
            let flow=Flow::tour(step,None).with_first_capture(true,false,false,false);
            assert_eq!(flow.shortcut_policy(),ShortcutPolicy::Record);
        }
        let untried=Flow::tour(Step::TryIt,None).with_first_capture(true,true,false,false);
        assert_eq!(untried.step(),Step::TryIt);
        let tested=Flow::tour(Step::TryIt,None).with_first_capture(true,true,true,false);
        assert_eq!(tested.step(),Step::TryIt);
        let completed=Flow::tour(Step::TryIt,None).with_first_capture(true,true,false,true);
        assert_eq!(completed.step(),Step::Done,"completed legacy users remain complete");
    }

    #[test]
    fn first_capture_requires_shortcut_start_and_successful_finish() {
        let mut flow = Flow::tour(Step::TryIt, Some(grants(&Permission::REQUIRED)))
            .with_first_capture(true, true, true, false);
        assert_eq!(flow.on(Input::Continue), Effect::None, "Try it cannot finish the tour");
        flow.on(Input::CaptureEnded { completed: true });
        assert_eq!(flow.step(), Step::TryIt, "a stale completion cannot count");
        flow.on(Input::CaptureStarted);
        flow.on(Input::CaptureEnded { completed: true });
        assert_eq!(flow.step(), Step::TryIt, "menu recordings do not prove the shortcut works");
        flow.on(Input::ShortcutTriggered);
        flow.on(Input::CaptureStarted);
        flow.on(Input::CaptureEnded { completed: false });
        assert_eq!(flow.step(), Step::TryIt, "cancelled captures do not count");
        flow.on(Input::CaptureStarted);
        flow.on(Input::CaptureEnded { completed: true });
        assert_eq!(flow.step(), Step::TryIt, "cancel clears the shortcut attempt");
        flow.on(Input::ShortcutTriggered);
        flow.on(Input::CaptureStarted);
        flow.on(Input::CaptureEnded { completed: true });
        assert_eq!(flow.step(), Step::Done);
    }

    use super::*;

    use Permission::{Accessibility, Camera, InputMonitoring, Microphone, ScreenRecording};

    const ALL: [Permission; 3] = [ScreenRecording, Microphone, Accessibility];

    #[cfg(target_os = "linux")]
    #[test]
    #[ignore = "requires an isolated desktop clipboard (Xvfb or disposable Linux VM), never a real desktop"]
    fn electron_linux_input_action_copies_without_granting_or_advancing() {
        crate::capture::desktop::linux::clipboard::set_text("synthetic permission fixture").unwrap();
        let mut session = Session::for_test(Flow::fix(vec![Accessibility], Some(grants(&[]))));
        session.fallback = Some(Box::new(|_| panic!("permission copy must not replace the renderer")));
        session.action("grant:accessibility");
        let text = if crate::capture::desktop::linux::wayland_session()
            && (crate::capture::desktop::linux::hyprland() || crate::capture::desktop::linux::kde())
        {
            let output = std::process::Command::new("wl-paste")
                .args(["--no-newline", "--type", "text/plain;charset=utf-8"]).output().unwrap();
            assert!(output.status.success());
            String::from_utf8(output.stdout).unwrap()
        } else {
            arboard::Clipboard::new().unwrap().get_text().unwrap()
        };
        assert_eq!(text, crate::capture::desktop::linux::privacy::INPUT_COMMAND);
        assert_eq!(session.flow.step(), Step::Permissions);
        assert!(!session.flow.view().ready);
        assert!(!session.flow.granted(Accessibility));
    }

    fn grants(granted: &[Permission]) -> Grants {
        Grants {
            statuses: granted.iter().map(|p| (*p, Status::Granted)).collect(),
            screen_needs_relaunch: false,
            observed_at: None,
        }
    }

    fn stale(granted: &[Permission]) -> Grants {
        Grants {
            screen_needs_relaunch: true,
            ..grants(granted)
        }
    }

    fn tick(flow: &mut Flow, g: &Grants, now_ms: u64) -> Effect {
        flow.on(Input::Grants {
            grants: g.clone(),
            now_ms,
        })
    }

    fn rows(flow: &Flow) -> Vec<Permission> {
        flow.view().rows.iter().map(|r| r.permission).collect()
    }

    #[test]
    fn shortcut_step_edits_inline_and_continue_leaves_the_editor() {
        let mut flow = Flow::tour(Step::Welcome, Some(grants(&[])));
        assert_eq!(flow.view().count, 4);
        flow.on(Input::Continue);
        flow.on(Input::Continue);
        flow.on(Input::Grants {
            grants: grants(&ALL),
            now_ms: 0,
        });
        flow.on(Input::Continue);
        assert_eq!(flow.step(), Step::Shortcut);
        assert_eq!(flow.resume_point(), Some(Step::Shortcut));
        assert_eq!(flow.on(Input::ChangeShortcut), Effect::EditShortcut);
        assert_eq!(flow.step(), Step::Shortcut);
        assert!(flow.view().shortcut_editing);
        flow.on(Input::Continue);
        assert_eq!(flow.step(), Step::TryIt);
        assert!(!flow.view().shortcut_editing);
        flow.on(Input::Back);
        assert_eq!(flow.step(), Step::Shortcut);

        let mut fix = Flow::fix(vec![Permission::Microphone], Some(grants(&[])));
        assert_eq!(fix.on(Input::ChangeShortcut), Effect::None);
    }

    #[test]
    fn the_tour_has_a_shortcut_screen_with_every_permission_on_one() {
        let mut flow = Flow::tour(Step::Welcome, Some(grants(&[])));
        assert_eq!(flow.view().count, 4);
        assert_eq!(flow.on(Input::Continue), Effect::None);
        assert_eq!(flow.step(), Step::Permissions);
        assert_eq!(rows(&flow), Permission::REQUIRED);
        assert!(flow.view().rows.iter().all(|r| r.required));
        assert!(!rows(&flow).contains(&Camera));
        assert!(!flow.view().ready);
        assert_eq!(flow.on(Input::Continue), Effect::None);
        assert_eq!(flow.step(), Step::Permissions);
        assert_eq!(flow.on(Input::Back), Effect::None);
        assert_eq!(flow.step(), Step::Welcome);
    }

    #[test]
    fn speech_recognition_is_an_optional_row_only_where_the_helper_reports_it() {
        use Permission::SpeechRecognition;
        assert!(!SpeechRecognition.asked(Some(&grants(&[]))));
        assert!(!SpeechRecognition.asked(None));
        let flow = Flow::tour(Step::Permissions, Some(grants(&[])));
        assert!(!rows(&flow).contains(&SpeechRecognition));

        let mut asking = grants(&[]);
        asking
            .statuses
            .insert(SpeechRecognition, Status::NotDetermined);
        let mut flow = Flow::tour(Step::Permissions, Some(asking));
        assert_eq!(
            rows(&flow),
            [
                ScreenRecording,
                Microphone,
                Accessibility,
                SpeechRecognition
            ]
        );
        let row = flow.view().rows[3].clone();
        assert!(!row.required);
        assert_eq!(
            flow.on(Input::Grant(SpeechRecognition)),
            Effect::Request(SpeechRecognition)
        );
        assert_eq!(
            flow.on(Input::Grant(SpeechRecognition)),
            Effect::OpenSettings(SpeechRecognition)
        );

        let mut required = grants(&ALL);
        required.statuses.insert(SpeechRecognition, Status::Denied);
        tick(&mut flow, &required, 0);
        assert!(flow.view().ready);
        assert_eq!(flow.on(Input::Continue), Effect::None);
        assert_eq!(flow.step(), Step::Shortcut);
        flow.on(Input::Continue);
        assert_eq!(flow.step(), Step::TryIt);
    }

    #[test]
    fn removed_demo_resume_keeps_legacy_config_readable() {
        let progress = Progress {
            resume: Some(Step::HowItWorks),
            tutorial: Some(Tutorial::Watched),
            ..Progress::default()
        };
        let flow = launch_plan(&progress, &grants(&[]), true, &[])
            .expect("the tour")
            .with_tutorial(progress.tutorial);
        assert_eq!(flow.step(), Step::Shortcut);
        assert_eq!(flow.view().tutorial, Some(Tutorial::Watched));
        let json = serde_json::to_value(flow.view()).unwrap();
        assert_eq!(json["tutorial"], "watched");
        let fresh = serde_json::to_value(Flow::tour(Step::Welcome, None).view()).unwrap();
        assert!(fresh["tutorial"].is_null());
        let old: Progress = serde_json::from_str(r#"{"seen":false,"resume":"how-it-works"}"#).unwrap();
        assert_eq!(old.tutorial, None);
    }

    #[test]
    fn screen_recording_is_the_first_row_and_accessibility_the_third() {
        assert_eq!(Permission::REQUIRED, ALL);
        let flow = Flow::tour(Step::Permissions, Some(grants(&[])));
        assert_eq!(rows(&flow), ALL);
        let fix = Flow::fix(Permission::REQUIRED.to_vec(), Some(grants(&[])));
        assert_eq!(rows(&fix)[0], ScreenRecording);
        assert_eq!(rows(&fix)[2], Accessibility);
        assert!(Accessibility.required() && Accessibility.draggable());
    }

    #[test]
    fn input_monitoring_is_never_requested() {
        assert!(!InputMonitoring.required());
        assert!(!InputMonitoring.draggable());
        let mut flow = Flow::tour(Step::Permissions, Some(grants(&[])));
        assert!(!rows(&flow).contains(&InputMonitoring));
        assert_eq!(flow.on(Input::Grant(InputMonitoring)), Effect::None);
        let sources = [
            include_str!("session.rs"),
            include_str!("../../coordinator/setup.rs"),
            include_str!("../../coordinator/recording.rs"),
            include_str!("../../coordinator/windows.rs"),
            include_str!("../../coordinator/pill.rs"),
            include_str!("../../coordinator/review.rs"),
            include_str!("../../mod.rs"),
            include_str!("../../../engine/runtime/platform/macos.rs"),
            include_str!("../../ui/macos.rs"),
            include_str!("../onboarding.rs"),
            include_str!("../settings.rs"),
            include_str!("../shortcut/config.rs"),
            include_str!("../mod.rs"),
            include_str!("../../native/Onboarding.swift"),
            include_str!("../../native/Settings.swift"),
            include_str!("../../native/ShortcutKeys.swift"),
            include_str!("../../native/PermissionPanel.swift"),
        ];
        let calls = [
            concat!("CGRequest", "ListenEventAccess"),
            concat!("CGPreflight", "ListenEventAccess"),
            concat!("IOHIDRequest", "Access"),
            concat!("IOHIDCheck", "Access"),
            concat!("kCGEventTapOption", "ListenOnly"),
        ];
        for source in sources {
            for call in calls {
                assert!(!source.contains(call), "{call} is still called");
            }
        }
        let old: Progress = serde_json::from_str(
            r#"{"seen":true,"granted":["screen-recording","microphone","input-monitoring"]}"#,
        )
        .unwrap();
        assert!(old.seen);
    }

    #[test]
    fn permissions_are_granted_in_any_order_then_continue_moves_on() {
        let mut flow = Flow::tour(Step::Permissions, Some(grants(&[])));
        assert_eq!(
            flow.on(Input::Grant(Accessibility)),
            Effect::OpenSettings(Accessibility)
        );
        assert_eq!(
            flow.on(Input::Grant(Microphone)),
            Effect::Request(Microphone)
        );
        assert_eq!(
            flow.on(Input::Grant(Microphone)),
            Effect::OpenSettings(Microphone)
        );
        let some = grants(&[Microphone, Accessibility]);
        tick(&mut flow, &some, 0);
        let view = flow.view();
        assert_eq!(view.rows[1].status, Status::Granted);
        assert!(!view.rows[0].requested && !view.ready);
        let all = grants(&ALL);
        tick(&mut flow, &all, 1);
        tick(&mut flow, &all, 10_000);
        assert_eq!(flow.step(), Step::Permissions);
        assert!(flow.view().ready);
        assert_eq!(flow.on(Input::Grant(Microphone)), Effect::None);
        assert_eq!(flow.on(Input::Continue), Effect::None);
        assert_eq!(flow.step(), Step::Shortcut);
        flow.on(Input::Continue);
        assert_eq!(flow.step(), Step::TryIt);
        flow.on(Input::Back);
        assert_eq!(flow.step(), Step::Shortcut);
        flow.on(Input::Back);
        assert_eq!(flow.step(), Step::Welcome);
    }

    #[test]
    fn a_denied_permission_goes_straight_to_settings() {
        let mut denied = grants(&[]);
        denied.statuses.insert(Microphone, Status::Denied);
        let mut flow = Flow::tour(Step::Permissions, Some(denied));
        assert_eq!(
            flow.on(Input::Grant(Microphone)),
            Effect::OpenSettings(Microphone)
        );
    }

    #[test]
    fn granted_permissions_pass_the_screen_and_leave_the_dots() {
        let all = grants(&ALL);
        let mut flow = Flow::tour(Step::Welcome, Some(all.clone()));
        assert_eq!(flow.view().count, 3);
        flow.on(Input::Continue);
        assert_eq!(flow.step(), Step::Shortcut);
        flow.on(Input::Continue);
        assert_eq!(flow.step(), Step::TryIt);
        assert_eq!(flow.view().index, 2);
        let some = grants(&[Microphone]);
        assert_eq!(
            Flow::tour(Step::TryIt, Some(some)).step(),
            Step::Permissions
        );
        let resumed = Flow::tour(Step::Permissions, Some(all));
        assert_eq!(resumed.step(), Step::Permissions);
        assert!(resumed.view().ready);
    }

    #[test]
    fn a_screen_recording_grant_this_copy_cant_use_relaunches_by_itself_once() {
        let mut flow = Flow::tour(Step::Permissions, Some(grants(&[])));
        let granted = stale(&[ScreenRecording]);
        assert_eq!(tick(&mut flow, &granted, 1_000), Effect::None);
        let row = flow.view().rows[0].clone();
        assert_eq!(row.status, Status::Granted);
        assert!(row.reopening && !row.relaunch);
        assert_eq!(flow.on(Input::Continue), Effect::None);
        assert_eq!(tick(&mut flow, &granted, 1_500), Effect::None);
        let relaunch = Effect::Relaunch {
            resume: Some(Step::Permissions),
        };
        assert_eq!(tick(&mut flow, &granted, 1_000 + RELAUNCH_AFTER_MS), relaunch);
        assert_eq!(tick(&mut flow, &granted, 9_000), Effect::None);
        assert_eq!(flow.on(Input::Grant(ScreenRecording)), Effect::None);
        let mut flow = Flow::tour(Step::Permissions, Some(grants(&[])));
        assert_eq!(
            tick(&mut flow, &grants(&[ScreenRecording]), 0),
            Effect::ConfirmScreen
        );
        for t in [5_000, 60_000] {
            assert_eq!(tick(&mut flow, &grants(&[ScreenRecording]), t), Effect::None);
        }
        assert!(!flow.view().rows[0].reopening);
    }

    #[test]
    fn once_screen_recording_works_the_window_picker_question_comes_up_explained() {
        let mut flow = Flow::tour(Step::Permissions, Some(grants(&[])));
        assert_eq!(tick(&mut flow, &grants(&[Microphone]), 0), Effect::None);
        assert!(!flow.view().picker_note);
        assert_eq!(
            tick(&mut flow, &stale(&[ScreenRecording]), 100),
            Effect::None
        );
        assert_eq!(
            tick(&mut flow, &grants(&[ScreenRecording]), 200),
            Effect::ConfirmScreen
        );
        assert!(flow.view().picker_note);
        assert_eq!(
            tick(&mut flow, &grants(&[ScreenRecording]), 300),
            Effect::None
        );
        flow.on(Input::Grants {
            grants: grants(&Permission::REQUIRED),
            now_ms: 400,
        });
        flow.on(Input::Continue);
        assert_eq!(flow.step(), Step::Shortcut);
        flow.on(Input::Continue);
        assert_eq!(flow.step(), Step::TryIt);
        assert!(!flow.view().picker_note);
        let mut flow = Flow::tour(Step::TryIt, Some(grants(&Permission::REQUIRED)));
        assert_eq!(flow.step(), Step::TryIt);
        assert_eq!(
            tick(&mut flow, &grants(&Permission::REQUIRED), 0),
            Effect::ConfirmScreen
        );
        assert!(flow.view().picker_note);
        flow.on(Input::CaptureEnded { completed: true });
        assert_eq!(flow.step(), Step::Done);
        assert!(!flow.view().picker_note);
    }

    #[test]
    fn a_fix_relaunches_too_and_reopens_after() {
        let mut flow = Flow::fix(Permission::REQUIRED.to_vec(), Some(grants(&[Microphone])));
        let granted = stale(&[ScreenRecording, Microphone]);
        tick(&mut flow, &granted, 0);
        assert_eq!(
            tick(&mut flow, &granted, RELAUNCH_AFTER_MS),
            Effect::Relaunch { resume: None }
        );
        let mut progress = Progress {
            seen: true,
            ..Progress::default()
        };
        progress.relaunching(None, 42);
        assert!(progress.reopen_fix && progress.seen);
        let flow = launch_plan(&progress, &grants(&[ScreenRecording, Microphone]), true, &[]).expect("fix");
        assert_eq!((flow.mode(), flow.step()), (Mode::Fix, Step::Permissions));
        assert_eq!(rows(&flow), [ScreenRecording]);
    }

    #[test]
    fn right_after_a_relaunch_it_never_relaunches_by_itself_again() {
        let now = 1_000_000;
        let mut progress = Progress::default();
        assert!(relaunch_allowed(&progress, now));
        progress.relaunching(Some(Step::Permissions), now);
        assert!(!relaunch_allowed(&progress, now + 5_000));
        assert!(!relaunch_allowed(&progress, now + RELAUNCH_GUARD_MS - 1));
        assert!(relaunch_allowed(&progress, now + RELAUNCH_GUARD_MS));
        let mut flow = Flow::tour(Step::Permissions, Some(grants(&[]))).with_auto_relaunch(false);
        let granted = stale(&[ScreenRecording]);
        for t in [0, RELAUNCH_AFTER_MS, 60_000] {
            assert_eq!(tick(&mut flow, &granted, t), Effect::None);
        }
        let row = flow.view().rows[0].clone();
        assert!(row.relaunch && !row.reopening);
        assert_eq!(
            flow.on(Input::Grant(ScreenRecording)),
            Effect::Relaunch {
                resume: Some(Step::Permissions)
            }
        );
        assert_eq!(flow.on(Input::Grant(ScreenRecording)), Effect::None);
    }

    #[test]
    fn legacy_permission_resume_enters_coaching_without_requesting_permissions() {
        let mut progress = Progress::default();
        progress.relaunching(Some(Step::Permissions), 7);
        let flow = launch_plan(&progress, &grants(&[]), true, &[]).expect("the tour");
        assert_eq!((flow.mode(), flow.step()), (Mode::Tour, Step::Shortcut));
        assert!(flow.view().rows.is_empty());
        progress.dismiss(&flow);
        progress.relaunching(None, 8);
        let repair =
            launch_plan(&progress, &stale(&[ScreenRecording]), true, &[Microphone]).expect("repair");
        assert_eq!(repair.mode(), Mode::Fix);
        assert_eq!(rows(&repair), [ScreenRecording, Microphone]);
    }

    #[test]
    fn legacy_unfinished_tour_restarts_once_without_losing_grants() {
        let mut progress = Progress { resume: Some(Step::Permissions),
            granted: Permission::REQUIRED.into_iter().collect(), ..Progress::default() };
        let granted = progress.granted.clone();
        assert!(progress.prepare_current_tour());
        assert_eq!(progress.resume, Some(Step::Welcome));
        assert_eq!(progress.granted, granted);
        assert_eq!(launch_plan(&progress, &grants(&Permission::REQUIRED), true, &[]).unwrap().step(), Step::Welcome);
        progress.relaunching(Some(Step::Permissions), 123);
        assert!(!progress.prepare_current_tour());
        assert_eq!(progress.resume, Some(Step::Permissions));
    }

    #[test]
    fn completed_and_newer_tours_are_not_restarted_by_migration() {
        let mut finished = Progress { seen: true, ..Progress::default() };
        assert!(finished.prepare_current_tour());
        assert!(finished.seen);
        assert!(launch_plan(&finished, &grants(&Permission::REQUIRED), true, &[]).is_none());
        let mut future = Progress { tour_revision: 2, resume: Some(Step::Shortcut), ..Progress::default() };
        assert!(!future.prepare_current_tour());
        assert_eq!(future.resume, Some(Step::Shortcut));
    }

    #[test]
    fn previous_preview_trial_is_migrated_once_without_claiming_capture_completion() {
        let dir = std::env::temp_dir().join(format!("aot-restart-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        #[cfg(unix)] {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700)).unwrap();
        }
        let path = dir.join("config.json");
        std::fs::write(&path, r#"{"penColor":"green","unrelated":42}"#).unwrap();
        let mut progress = Progress { tour_revision: 1, seen: false, resume: Some(Step::TryIt),
            shortcut_chosen: true, shortcut_tested_for: Some("⌥S".into()),
            granted: Permission::REQUIRED.into_iter().collect(), ..Progress::default() };
        assert!(progress.prepare_current_tour());
        progress.save_to(&path).unwrap();
        let mut restored = Progress::load_from(&path);
        assert!(restored.seen);
        assert!(!restored.first_capture_completed);
        assert_eq!(restored.resume, None);
        assert!(!restored.prepare_current_tour());
        assert!(launch_plan(&restored, &grants(&Permission::REQUIRED), true, &[]).is_none());
        assert!(launch_plan(&restored, &grants(&[]), true, &[]).is_none());
        let config: serde_json::Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(config["penColor"], "green");
        assert_eq!(config["unrelated"], 42);
        restored.reset_for_replay();
        assert!(!restored.prepare_current_tour());
        assert!(launch_plan(&restored, &grants(&Permission::REQUIRED), true, &[]).is_none());
        let mut native_trial = Progress { tour_revision: 1, resume: Some(Step::Shortcut),
            shortcut_chosen: true, shortcut_tested_for: Some("⌥S".into()), ..Progress::default() };
        assert!(native_trial.prepare_current_tour());
        assert!(native_trial.seen);
        let mut untested = Progress { tour_revision: 1, resume: Some(Step::TryIt), shortcut_chosen: true, ..Progress::default() };
        assert!(!untested.prepare_current_tour());
        assert!(!untested.seen);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn replay_resets_only_tour_progress_and_config_writer_preserves_other_values() {
        let mut progress = Progress {
            tour_revision: 1,
            seen: true,
            deferred: true,
            resume: None,
            granted: BTreeSet::from([Permission::ScreenRecording, Permission::Accessibility]),
            relaunched_at: Some(123),
            reopen_fix: true,
            tutorial: Some(Tutorial::Practiced),
            shortcut_chosen: true,
            shortcut_tested_for: Some("⌥⇧R".into()),
            first_capture_completed: true,
        };
        progress.reset_for_replay();
        assert!(progress.seen);
        assert!(progress.deferred);
        assert_eq!(progress.resume, Some(Step::Welcome));
        assert_eq!(progress.tutorial, None);
        assert!(!progress.shortcut_chosen);
        assert_eq!(progress.shortcut_tested_for, None);
        assert!(!progress.first_capture_completed);
        assert_eq!(progress.granted, BTreeSet::from([Permission::ScreenRecording, Permission::Accessibility]));
        assert_eq!(progress.relaunched_at, Some(123));
        assert!(progress.reopen_fix);

        let ready = Some(grants(&Permission::REQUIRED));
        let mut replay = Flow::tour(progress.resume.unwrap(), ready).with_first_capture(
            true,
            progress.shortcut_chosen,
            progress.tested_shortcut("⌥⇧R"),
            progress.first_capture_completed,
        );
        assert_eq!(replay.step(), Step::Welcome);
        replay.on(Input::Continue);
        assert_eq!(replay.step(), Step::Shortcut);
        assert!(!replay.view().shortcut_chosen);
        replay.on(Input::ShortcutChosen);
        replay.on(Input::ShortcutTrialStarted);
        assert!(!replay.view().shortcut_tested);
        assert!(!replay.local_practice(), "the trial cannot start a capture");
        replay.on(Input::ShortcutTriggered);
        assert!(replay.view().shortcut_tested);
        assert_eq!(replay.step(), Step::Shortcut, "trial success still needs Continue");
        replay.on(Input::Continue);
        assert_eq!(replay.step(), Step::TryIt);

        let dir = std::env::temp_dir().join(format!("apparent-onboarding-replay-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir(&dir).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700)).unwrap();
        }
        let path = dir.join("config.json");
        std::fs::write(&path, r#"{"unrelated":{"keep":true},"penColor":"green","onboarding":{"seen":true}}"#).unwrap();
        progress.save_to(&path).unwrap();
        let config: serde_json::Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(config["unrelated"]["keep"], true);
        assert_eq!(config["penColor"], "green");
        assert_eq!(config["onboarding"]["resume"], "welcome");
        assert_eq!(config["onboarding"]["granted"], serde_json::json!(["screen-recording", "accessibility"]));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_tour_quit_midway_resumes_where_it_was() {
        let mut flow = Flow::coaching(Step::Welcome, Some(grants(&[])));
        assert_eq!(flow.resume_point(), Some(Step::Welcome));
        flow.on(Input::Continue);
        assert_eq!(flow.resume_point(), Some(Step::Shortcut));
        let progress = Progress {
            resume: flow.resume_point(),
            ..Progress::default()
        };
        let flow = launch_plan(&progress, &grants(&[ScreenRecording]), true, &[]).expect("the tour");
        assert_eq!(flow.step(), Step::Shortcut);
        assert_eq!(
            Flow::fix(vec![Camera], None).resume_point(),
            None,
            "a fix has nothing to resume"
        );
    }

    #[test]
    fn set_up_later_and_closing_end_the_tour() {
        let mut flow = Flow::tour(Step::Permissions, Some(grants(&[])));
        assert_eq!(flow.on(Input::Later), Effect::Defer);
        assert_eq!(flow.on(Input::Closed), Effect::Defer);
    }

    #[test]
    fn the_shortcut_with_a_permission_off_starts_nothing_and_opens_the_window_on_release() {
        let some = grants(&[Microphone, Accessibility]);
        let missing = vec![ScreenRecording];
        let mut gate = Gate::default();
        assert!(!gate.press(missing.clone()), "nothing starts");
        assert!(!gate.press(Vec::new()));
        assert_eq!(gate.tick(true), None);
        let asks = gate.tick(false).expect("the window, once the keys are up");
        assert_eq!(gate.tick(false), None);
        assert!(!gate.is_pending());
        let mut flow = Flow::fix(Permission::REQUIRED.to_vec(), Some(some.clone()));
        assert_eq!(asks, missing);
        assert_eq!(flow.step(), Step::Permissions);
        assert_eq!(
            flow.on(Input::Grant(ScreenRecording)),
            Effect::OpenSettings(ScreenRecording)
        );
        assert!(gate.press(Vec::new()));
    }

    #[test]
    fn camera_is_asked_for_on_its_own_when_first_used() {
        let mut flow = Flow::fix(vec![Camera], Some(grants(&[ScreenRecording])));
        assert_eq!(rows(&flow), [Camera]);
        let view = flow.view();
        assert!(view.fix && !view.ready && !view.rows[0].required);
        assert_eq!(flow.on(Input::Grant(Camera)), Effect::Request(Camera));
        assert_eq!(flow.on(Input::Grant(Microphone)), Effect::None);
        let camera = grants(&[Camera]);
        assert_eq!(tick(&mut flow, &camera, 100), Effect::None);
        assert!(flow.view().ready);
        assert_eq!(
            tick(&mut flow, &camera, 100 + AUTO_ADVANCE_MS),
            Effect::Close
        );
        let mut flow = Flow::fix(vec![Accessibility], Some(grants(&[])));
        assert_eq!(flow.on(Input::Later), Effect::Close);
        assert_eq!(flow.on(Input::Back), Effect::None);
        assert_eq!(flow.step(), Step::Permissions);
    }

    #[test]
    fn a_capture_hides_the_window_and_finishing_from_try_it_shows_done() {
        let mut flow = Flow::tour(Step::TryIt, None);
        assert_eq!(flow.on(Input::CaptureStarted), Effect::Hide);
        assert_eq!(flow.on(Input::CaptureStarted), Effect::None);
        assert_eq!(
            flow.on(Input::CaptureEnded { completed: true }),
            Effect::Show
        );
        assert_eq!(flow.step(), Step::Done);
        assert_eq!(flow.on(Input::Settings), Effect::Settings);
        assert_eq!(flow.on(Input::Continue), Effect::Close);
        let mut flow = Flow::tour(Step::TryIt, None);
        flow.on(Input::CaptureStarted);
        assert_eq!(
            flow.on(Input::CaptureEnded { completed: false }),
            Effect::Show
        );
        assert_eq!(flow.step(), Step::TryIt);
    }

    #[test]
    fn completed_setup_stays_quiet_even_after_a_permission_is_lost() {
        let all = grants(&ALL);
        let mut progress = Progress::default();
        assert_eq!(
            launch_plan(&progress, &all, true, &[]).map(|f| (f.mode(), f.step())),
            Some((Mode::Tour, Step::Welcome))
        );
        progress.seen = true;
        assert!(progress.note(&all));
        assert!(!progress.note(&all));
        assert!(launch_plan(&progress, &all, true, &[]).is_none());
        let lost = grants(&[ScreenRecording, Microphone]);
        assert!(launch_plan(&progress, &lost, true, &[]).is_none());
    }

    #[test]
    fn progress_is_kept_beside_the_rest_of_the_config() {
        let dir = std::env::temp_dir().join(format!("apparent-onboarding-{}", std::process::id()));
        let path = dir.join("config.json");
        std::fs::create_dir_all(&dir).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700)).unwrap();
        }
        std::fs::write(&path, r#"{"agentHost":"studio","autocrop":false,"onboarding":{"future":{"number":18446744073709551615,"token":"synthetic-secret"}}}"#).unwrap();
        assert_eq!(Progress::load_from(&path), Progress::default());
        let progress = Progress {
            tour_revision: 0,
            seen: true,
            deferred: true,
            resume: Some(Step::Permissions),
            granted: [Microphone].into_iter().collect(),
            relaunched_at: Some(1_792_000_000_000),
            reopen_fix: true,
            tutorial: Some(Tutorial::Practiced),
            shortcut_chosen: true,
            shortcut_tested_for: Some("⌥⇧S".into()),
            first_capture_completed: true,
        };
        progress.save_to(&path).unwrap();
        let restored = Progress::load_from(&path);
        assert_eq!(restored, progress);
        assert!(restored.tested_shortcut("⌥⇧S"));
        assert!(!restored.tested_shortcut("⌃⌥K"), "a saved trial is tied to its actual combination");
        let config: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(config["agentHost"], "studio");
        assert_eq!(config["autocrop"], false);
        assert_eq!(config["onboarding"]["resume"], "permissions");
        assert_eq!(config["onboarding"]["relaunchedAt"], 1_792_000_000_000_u64);
        assert_eq!(config["onboarding"]["reopenFix"], true);
        assert_eq!(config["onboarding"]["tutorial"], "practiced");
        assert_eq!(config["onboarding"]["shortcutTestedFor"], "⌥⇧S");
        assert_eq!(config["onboarding"]["future"], serde_json::json!({"number":18446744073709551615_u64,"token":"synthetic-secret"}));
        Progress::default().save_to(&path).unwrap();
        let cleared: serde_json::Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(cleared["onboarding"]["future"], config["onboarding"]["future"]);
        for key in ["resume", "relaunchedAt", "reopenFix", "tutorial", "shortcutTestedFor"] {
            assert!(cleared["onboarding"].get(key).is_none(), "stale schema leaf: {key}");
        }
        for invalid in [r#"{"onboarding":null,"keep":"synthetic"}"#, r#"{"onboarding":[],"keep":"synthetic"}"#] {
            std::fs::write(&path, invalid).unwrap();
            assert!(progress.save_to(&path).is_err());
            assert_eq!(std::fs::read_to_string(&path).unwrap(), invalid);
        }
        std::fs::write(
            &path,
            r#"{"onboarding":{"seen":false,"resume":"microphone","granted":[]}}"#,
        )
        .unwrap();
        assert_eq!(Progress::load_from(&path).resume, Some(Step::Permissions));
        std::fs::write(&path, r#"{"onboarding":{"resume":"draw"}}"#).unwrap();
        assert_eq!(Progress::load_from(&path).resume, Some(Step::HowItWorks));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn helper_statuses_parse_into_grants() {
        let statuses: BTreeMap<Permission, Status> = serde_json::from_str(
            r#"{"screen-recording":"granted","microphone":"denied","camera":"not-determined"}"#,
        )
        .unwrap();
        let g = Grants {
            statuses,
            screen_needs_relaunch: false,
            observed_at: None,
        };
        assert!(g.granted(ScreenRecording));
        assert_eq!(g.status(Microphone), Status::Denied);
        assert_eq!(g.status(Accessibility), Status::NotDetermined);
    }

    #[test]
    fn native_grants_match_recording_identity_and_observe_screen_revocation() {
        let helper = BTreeMap::from([
            (Accessibility, Status::NotDetermined),
            (ScreenRecording, Status::NotDetermined),
            (Microphone, Status::Granted),
        ]);
        let statuses = crate::permission_facts::reconcile_native_grants(helper, true, true);
        assert_eq!(statuses[&Accessibility], Status::Granted);
        assert_eq!(statuses[&ScreenRecording], Status::Granted);
        assert_eq!(statuses[&Microphone], Status::Granted);

        let helper = BTreeMap::from([
            (Accessibility, Status::Granted),
            (ScreenRecording, Status::Granted),
            (Microphone, Status::Granted),
        ]);
        let statuses = crate::permission_facts::reconcile_native_grants(helper, false, false);
        assert_eq!(statuses[&Accessibility], Status::NotDetermined);
        assert_eq!(statuses[&ScreenRecording], Status::NotDetermined);
        assert_eq!(statuses[&Microphone], Status::Granted);
    }

}

#[cfg(test)]
mod local_practice_tests {
    use super::*;

    #[test]
    fn optional_practice_stays_local_with_or_without_explicit_shortcut_choice() {
        for chosen in [false, true] {
            let mut flow = Flow::tour(Step::TryIt, None).with_first_capture(false, chosen, chosen, false);
            assert!(!flow.local_practice());
            flow.on(Input::ShortcutTriggered);
            assert!(flow.local_practice(), "opting out must not enable practice uploads");
            flow.on(Input::CaptureStarted);
            flow.on(Input::Closed);
            assert!(flow.local_practice(), "closing the tour must not change practice policy");
            flow.on(Input::CaptureEnded { completed: true });
            assert!(!flow.local_practice());
        }
    }

    #[test]
    fn practice_policy_follows_shortcut_attempt_and_survives_processing() {
        let mut flow = Flow::tour(Step::TryIt, None).with_first_capture(true, true, true, false);
        assert!(!flow.local_practice());
        flow.on(Input::ShortcutTriggered);
        assert!(flow.local_practice());
        flow.on(Input::CaptureStarted);
        assert!(flow.local_practice());
        flow.on(Input::CaptureEnded { completed: false });
        assert!(!flow.local_practice());
        flow.on(Input::CaptureStarted);
        assert!(!flow.local_practice(), "menu captures cannot inherit practice status");
    }
}

#[cfg(test)]
mod adapter_regressions {
    use super::*;
    #[test]
    fn live_renderer_nonreader_exits_through_scoped_hidden_fallback() {
        let mut session = Session::for_test(Flow::tour(Step::TryIt, None));
        session.flow.hidden = true;
        let source = session.source();
        let generation = session.transport_generation();
        let (tx, rx) = flume::unbounded();
        let events = Session::scope_events(source, move |event| { let _ = tx.send(event); });
        let mut command = std::process::Command::new("sleep");
        command.arg("30");
        session.transport = Session::spawn_renderer_transport(&mut command, generation, events).unwrap();
        let start = std::time::Instant::now();
        session.send(&serde_json::json!({"type":"state", "payload":"x".repeat(1024*1024)}));
        assert!(start.elapsed() < std::time::Duration::from_millis(500), "capture thread waited on child input");
        let event = rx.recv_timeout(std::time::Duration::from_secs(5)).expect("nonreader must trigger fallback without EOF");
        assert!(matches!(event.for_current_session(Some(source)).unwrap()
            .for_current_transport(Some(generation)), Some(Event::Exited)));
        if let Transport::Renderer { child, .. } = &mut session.transport {
            assert!(child.try_wait().unwrap().is_none(), "timeout must precede child EOF");
            child.kill().unwrap();
            child.wait().unwrap();
        }
        let (tx, _rx) = flume::unbounded();
        session.fallback = Some(Box::new(move |_| Ok(Transport::InProcess(Some(tx.clone())))));
        assert!(session.restore_native());
        assert_ne!(generation, session.transport_generation());
        assert!(session.flow.hidden && session.fallback_pending);
        assert!(!session.flow.first_capture_completed);
        assert!(Event::Transport { generation, event: Box::new(Event::Action("practice-finish".into())) }
            .for_current_transport(Some(session.transport_generation())).is_none());
    }

    #[test]
    #[ignore = "requires built Electron host and an isolated display; set APPARENT_TEST_ONBOARDING_APP"]
    fn renderer_parent_pipe_delivers_to_the_production_electron_host() {
        let app = std::env::var_os("APPARENT_TEST_ONBOARDING_APP").expect("built host directory");
        let runtime = std::env::var_os("APPARENT_TEST_ELECTRON").expect("Electron executable");
        struct Profile(std::path::PathBuf);
        impl Drop for Profile { fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); } }
        let profile = Profile(std::env::temp_dir().join(format!("onboarding-pipe-{}", crate::shared::ids::make_bundle_id())));
        std::fs::create_dir(&profile.0).unwrap();
        let mut command = super::super::presentation::onboarding_command(runtime.into(), app.into());
        command.arg("--no-sandbox")
            .env("APPARENT_UI_PROFILE", &profile.0);
        let (tx, rx) = flume::unbounded();
        let mut session = Session::for_test(Flow::tour(Step::TryIt, None));
        let generation = session.transport_generation();
        session.transport = Session::spawn_renderer_transport(&mut command, generation,
            move |event| { let _ = tx.send(event); }).unwrap();
        session.send(&serde_json::json!({"type":"state", "step":"shortcut", "ready":true, "rows":[],
            "shortcut":"Test", "shortcutChosen":true, "shortcutSelectionReleased":true, "firstCaptureRequired":true}));
        let event = rx.recv_timeout(std::time::Duration::from_secs(15)).expect("host receipt");
        assert!(matches!(event.for_current_transport(Some(generation)),
            Some(Event::Action(action)) if action=="accept-shortcut-choice:Test"));
        session.practice=Some(super::super::practice::Practice::default());
        let apply=|session:&mut Session,stage:&str| {
            let event=rx.recv_timeout(std::time::Duration::from_secs(5)).unwrap();
            let Some(Event::Practice(value))=event.for_current_transport(Some(generation)) else {panic!();};
            assert_eq!(value["stage"],stage);
            assert_eq!(session.practice_disposition(value),Effect::None);
        };
        session.practice_events(vec![serde_json::json!({"type":"reset"}),serde_json::json!({"type":"started"})],false);apply(&mut session,"whiteboard");
        super::super::practice::exercise_native_surfaces(&mut session,apply);
        session.send(&serde_json::json!({"type":"close"}));
        assert!(matches!(rx.recv_timeout(std::time::Duration::from_secs(5)).unwrap()
            .for_current_transport(Some(generation)), Some(Event::Exited)));
    }
    #[test]
    fn bounded_reader_limits_each_line_without_limiting_the_stream() {
        let mut reader = std::io::Cursor::new(b"{}\n{}\n");
        for _ in 0..2 {
            let mut line = Vec::new();
            assert_eq!(read_protocol_line(&mut reader, &mut line).unwrap(), 3);
        }
        let mut reader = std::io::Cursor::new(vec![b'x'; 100_000]);
        let mut line = Vec::new();
        assert_eq!(read_protocol_line(&mut reader, &mut line).unwrap(), 65_537);
        assert_eq!(line.len(), 65_537);
    }
    #[test]
    fn back_from_permissions_cancels_guides_without_claiming_a_grant() {
        let mut flow=Flow::tour(Step::Permissions,None);
        assert!(permission_guide_messages(&flow.view()).is_empty());
        flow.on(Input::Back);
        assert_eq!(flow.step(),Step::Welcome);
        assert_eq!(permission_guide_messages(&flow.view()),vec![serde_json::json!({"type":"cancel-guides"})]);
        let granted=Flow::tour(Step::Permissions,Some(Grants{statuses:BTreeMap::from([(Permission::Accessibility,Status::Granted)]),screen_needs_relaunch:false,observed_at:None}));
        assert!(permission_guide_messages(&granted.view()).iter().any(|m|m["type"]=="close-guide"&&m["permission"]=="accessibility"));
    }

    #[test]
    fn fallback_retires_queued_events_from_its_old_transport_but_keeps_grants() {
        let mut session=Session::for_test(Flow::tour(Step::Permissions,None));
        let old=session.transport_generation();
        let (tx,_rx)=flume::unbounded();
        session.fallback=Some(Box::new(move |_|Ok(Transport::InProcess(Some(tx.clone())))));
        assert!(session.restore_native());
        assert_ne!(old,session.transport_generation());
        for event in [Event::Exited,Event::Action("close".into())] {
            let queued=Event::Session{source:session.source(),event:Box::new(Event::Transport{generation:old,event:Box::new(event)})};
            assert!(queued.for_current_session(Some(session.source())).unwrap().for_current_transport(Some(session.transport_generation())).is_none());
        }
        let current=Event::Transport{generation:session.transport_generation(),event:Box::new(Event::Action("continue".into()))};
        assert!(matches!(current.for_current_transport(Some(session.transport_generation())),Some(Event::Action(_))));
        assert!(matches!(Event::Grants(Grants{statuses:BTreeMap::new(),screen_needs_relaunch:false,observed_at:None}).for_current_transport(Some(session.transport_generation())),Some(Event::Grants(_))));
    }

    #[test]
    fn coached_capture_completion_reveals_a_pending_native_fallback() {
        let mut flow=Flow::tour(Step::TryIt,None).with_first_capture(true, true, true, false);
        flow.on(Input::ShortcutTriggered);flow.on(Input::CaptureStarted);
        let mut session=Session::for_test(flow);
        session.practice=Some(super::super::practice::Practice::default());
        let (tx,rx)=flume::unbounded();
        session.fallback=Some(Box::new(move |_|Ok(Transport::InProcess(Some(tx.clone())))));
        assert!(session.restore_native());assert!(session.fallback_pending);
        session.input(Input::CaptureEnded{completed:true});
        assert!(!session.fallback_pending);assert!(session.practice.is_none());
        assert_eq!(session.flow.step(),Step::Done);
        assert!(rx.try_iter().any(|m|m["type"]=="show"));
    }

    #[test]
    fn hidden_fallback_waits_until_capture_ends_before_creating_native_window() {
        let mut flow = Flow::tour(Step::TryIt, None);
        flow.hidden = true;
        let mut session = Session::for_test(flow);
        session.shortcut_label = "Test shortcut".into();
        let (tx, rx) = flume::unbounded();
        session.fallback = Some(Box::new(move |_| Ok(Transport::InProcess(Some(tx.clone())))));
        assert!(session.restore_native());
        assert!(rx.try_recv().is_err(), "no replacement transport is created while hidden");
        assert!(session.fallback_pending);
        assert!(session.fallback.is_some());
        session.input(Input::CaptureEnded { completed: false });
        let messages: Vec<_> = rx.try_iter().collect();
        assert_eq!(messages.last().unwrap()["type"], "show");
        assert!(messages.iter().any(|v| v["type"] == "show"));
        assert!(messages.iter().any(|v| v["type"] == "state"));
        assert!(messages.iter().any(|v| v["label"] == "Test shortcut"));
        assert!(!session.restore_native());
    }
}
