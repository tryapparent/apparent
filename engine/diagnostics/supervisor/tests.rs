use super::*;
use std::os::unix::fs::{PermissionsExt, symlink};
use std::sync::atomic::AtomicUsize;

static TERMINATED: AtomicBool = AtomicBool::new(false);

extern "C" fn terminate(_: libc::c_int) {
    TERMINATED.store(true, Ordering::Release);
}

#[test]
fn supervised_fixture_process() {
    let Some(path) = std::env::var_os("APPARENT_SUPERVISOR_TEST_DIR") else {
        return;
    };
    let mode = std::env::var("APPARENT_SUPERVISOR_TEST_MODE").unwrap();
    if is_child() {
        eprintln!("[123] Recording synthetic fixture");
        eprintln!("[124] emit_capture_shortcut");
        match mode.as_str() {
            "kill" => unsafe {
                libc::raise(libc::SIGKILL);
            },
            "term" => loop {
                std::thread::sleep(Duration::from_millis(10));
            },
            _ => {}
        }
        return;
    }
    unsafe {
        libc::signal(libc::SIGTERM, terminate as *const () as libc::sighandler_t);
    }
    run(Hooks {
        directory: path.into(),
        consent: || Some("initial".into()),
        deliver: |_, _, _, _| false,
        requested: || TERMINATED.load(Ordering::Acquire),
    })
    .unwrap();
}

#[test]
fn production_supervision_records_signal_and_removes_clean_exit_markers() {
    for mode in ["kill", "clean", "term"] {
        let directory = tempfile::tempdir().unwrap();
        fs::set_permissions(directory.path(), fs::Permissions::from_mode(0o700)).unwrap();
        let mut child = Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "capture::desktop::workflow::error_reporting::native_supervisor::tests::supervised_fixture_process", "--nocapture"])
            .env("APPARENT_SUPERVISOR_TEST_DIR", directory.path())
            .env("APPARENT_SUPERVISOR_TEST_MODE", mode)
            .stdout(Stdio::null()).stderr(Stdio::null()).spawn().unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut signalled = false;
        let status = loop {
            if let Some(status) = child.try_wait().unwrap() {
                break status;
            }
            if mode == "term" && !signalled {
                let ready = fs::read_dir(directory.path())
                    .unwrap()
                    .flatten()
                    .any(|entry| {
                        read(&entry.path()).is_some_and(|record| record.stage == Stage::Shortcut)
                    });
                if ready {
                    unsafe {
                        libc::kill(child.id() as libc::pid_t, libc::SIGTERM);
                    }
                    signalled = true;
                }
            }
            if Instant::now() >= deadline {
                for entry in fs::read_dir(directory.path()).unwrap().flatten() {
                    if let Some(record) = read(&entry.path()) {
                        if identity(record.child).as_deref() == Some(record.child_identity.as_str())
                        {
                            unsafe {
                                libc::kill(record.child as libc::pid_t, libc::SIGKILL);
                            }
                        }
                    }
                }
                let _ = child.kill();
                let _ = child.wait();
                panic!("supervision did not finish: {mode}");
            }
            std::thread::sleep(Duration::from_millis(10));
        };
        let records: Vec<_> = fs::read_dir(directory.path())
            .unwrap()
            .flatten()
            .filter_map(|entry| read(&entry.path()))
            .collect();
        if mode == "clean" {
            assert!(status.success());
            assert!(records.is_empty());
        } else {
            assert!(!status.success());
            assert_eq!(records.len(), 1);
            assert_eq!(
                records[0].signal,
                Some(if mode == "kill" {
                    libc::SIGKILL
                } else {
                    libc::SIGTERM
                })
            );
            assert_eq!(records[0].stage, Stage::Shortcut);
            assert_eq!(records[0].supervisor, 0);
            assert!(records[0].exited_ms.is_some());
        }
    }
}

fn fixture() -> Record {
    Record {
        id: "cb02e8ec-35ed-4fb5-8afc-000000000001".into(),
        consent: Some("initial".into()),
        supervisor: 0,
        identity: String::new(),
        child: 0,
        child_identity: String::new(),
        created_ms: crate::shared::clock::now_epoch_ms(),
        exited_ms: Some(crate::shared::clock::now_epoch_ms()),
        build: "0.22.8 · 4373c3f".into(),
        revision: "4373c3f".into(),
        version: "0.22.8".into(),
        release: String::new(),
        release_id: String::new(),
        channel: "main".into(),
        environment: "production".into(),
        modified: false,
        stage: Stage::Shortcut,
        code: None,
        signal: Some(libc::SIGKILL),
        core_dumped: false,
        runtime_ms: 2000,
    }
}

#[test]
fn failed_delivery_survives_restart_with_same_event_identity() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("pending.json");
    let record = fixture();
    save(&path, &record).unwrap();
    replay_with(directory.path(), || Some("initial".into()), |_| false);
    assert!(path.exists());
    let calls = AtomicUsize::new(0);
    replay_with(
        directory.path(),
        || Some("initial".into()),
        |pending| {
            assert_eq!(pending.id, record.id);
            assert_eq!(pending.signal, Some(libc::SIGKILL));
            assert_eq!(pending.build, "0.22.8 · 4373c3f");
            calls.fetch_add(1, Ordering::Relaxed);
            true
        },
    );
    assert_eq!(calls.load(Ordering::Relaxed), 1);
    assert!(!path.exists());
}

#[test]
fn consent_generation_and_expiry_discard_without_delivery() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("pending.json");
    for consent in [None, Some("different".into())] {
        save(&path, &fixture()).unwrap();
        replay_with(
            directory.path(),
            || consent.clone(),
            |_| panic!("expired consent sent"),
        );
        assert!(!path.exists());
    }
    let mut expired = fixture();
    expired.created_ms = 1;
    expired.exited_ms = Some(1);
    save(&path, &expired).unwrap();
    replay_with(
        directory.path(),
        || Some("initial".into()),
        |_| panic!("expired record sent"),
    );
    assert!(!path.exists());
}

#[test]
fn active_supervisor_is_not_a_crash_but_stale_identity_is() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("pending.json");
    let mut record = fixture();
    record.supervisor = std::process::id();
    record.identity = identity(record.supervisor).unwrap();
    save(&path, &record).unwrap();
    replay_with(
        directory.path(),
        || Some("initial".into()),
        |_| panic!("live process reported"),
    );
    assert!(path.exists());
    record.identity = "stale".into();
    save(&path, &record).unwrap();
    replay_with(directory.path(), || Some("initial".into()), |_| true);
    assert!(!path.exists());
}

#[test]
fn private_records_reject_symlinks_modes_and_unknown_fields() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("pending.json");
    save(&path, &fixture()).unwrap();
    let link = directory.path().join("link.json");
    symlink(&path, &link).unwrap();
    assert!(read(&link).is_none());
    fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
    assert!(read(&path).is_none());
    let mut value = serde_json::to_value(fixture()).unwrap();
    value["transcript"] = serde_json::json!("private content");
    fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
    fs::write(&path, serde_json::to_vec(&value).unwrap()).unwrap();
    assert!(read(&path).is_none());
}

#[test]
fn real_killed_process_leaves_only_allowlisted_stage() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("pending.json");
    let record = Arc::new(Mutex::new(Some((path.clone(), fixture()))));
    let mut child = Command::new("/bin/sh").args(["-c", "printf '[123] Recording private window name\\n[124] emit_capture_shortcut\\nprivate transcript\\n' >&2; kill -KILL $$"])
            .stderr(Stdio::piped()).spawn().unwrap();
    let stop = Arc::new(AtomicBool::new(false));
    let pipe = child.stderr.take().unwrap();
    let observed = record.clone();
    let reader_stop = stop.clone();
    let reader = std::thread::spawn(move || observe(pipe, reader_stop, observed));
    let status = child.wait().unwrap();
    stop.store(true, Ordering::Release);
    reader.join().unwrap();
    assert_eq!(status.signal(), Some(libc::SIGKILL));
    assert_eq!(read(&path).unwrap().stage, Stage::Shortcut);
    let bytes = fs::read_to_string(path).unwrap();
    assert!(!bytes.contains("private window"));
    assert!(!bytes.contains("private transcript"));
}

#[test]
fn ordinary_stderr_cannot_create_a_stage() {
    assert_eq!(stage(b"private text finish_recording invoked"), None);
    assert_eq!(stage(b"[private] emit_capture_shortcut"), None);
    assert_eq!(stage(b"[123] emit_capture_shortcut"), Some(Stage::Shortcut));
}

#[test]
fn enabling_and_rotating_consent_discards_previous_context_without_restart() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("pending.json");
    let mut record = fixture();
    refresh_consent(&path, &mut record, None);
    assert!(!path.exists());
    refresh_consent(&path, &mut record, Some("new".into()));
    assert_eq!(read(&path).unwrap().consent.as_deref(), Some("new"));
    assert_eq!(read(&path).unwrap().stage, Stage::Starting);
    record.stage = Stage::Finishing;
    refresh_consent(&path, &mut record, Some("another".into()));
    assert_eq!(read(&path).unwrap().stage, Stage::Starting);
}

#[test]
fn orphaned_live_recorder_is_not_reported() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("pending.json");
    let mut record = fixture();
    record.child = std::process::id();
    record.child_identity = identity(record.child).unwrap();
    save(&path, &record).unwrap();
    replay_with(
        directory.path(),
        || Some("initial".into()),
        |_| panic!("live recorder reported"),
    );
    assert!(path.exists());
    record.child_identity = "old process".into();
    save(&path, &record).unwrap();
    replay_with(directory.path(), || Some("initial".into()), |_| true);
    assert!(!path.exists());
}

#[test]
fn retries_and_retention_are_bounded() {
    let directory = tempfile::tempdir().unwrap();
    for index in 0..20 {
        save(&directory.path().join(format!("{index}.json")), &fixture()).unwrap();
    }
    let attempts = AtomicUsize::new(0);
    replay_with(
        directory.path(),
        || Some("initial".into()),
        |_| {
            attempts.fetch_add(1, Ordering::Relaxed);
            false
        },
    );
    assert_eq!(attempts.load(Ordering::Relaxed), 4);
    assert_eq!(
        fs::read_dir(directory.path())
            .unwrap()
            .flatten()
            .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "json"))
            .count(),
        16
    );
}
