use super::*;
use std::os::unix::fs::{PermissionsExt, symlink};

struct Sandbox(PathBuf);
impl Sandbox {
    fn new() -> Self {
        // Honor an explicit TMPDIR, but also work in native test environments
        // that leave it unset. Resolve Darwin's /var and /tmp aliases before
        // the storage layer deliberately refuses symlinked path components.
        let base = std::fs::canonicalize(std::env::temp_dir()).unwrap();
        let path = base.join(format!("apparent-tracing-test-{}", ident().unwrap()));
        std::fs::create_dir(&path).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).unwrap();
        Self(path)
    }
    fn store(&self) -> store::Store {
        store::Store::open(&self.0.join("traces")).unwrap()
    }
}
impl Drop for Sandbox {
    fn drop(&mut self) {
        std::fs::remove_dir_all(&self.0).unwrap();
    }
}
fn begin(store: &store::Store) -> String {
    start(store, "private-trial", "live").unwrap().id
}
fn note(id: &str, kind: &str) -> Command {
    Command::Note {
        id: id.into(),
        phase: "prepare".into(),
        step: "ready".into(),
        owner: "environment".into(),
        kind: kind.into(),
        text: "explicit note sentinel".into(),
    }
}

#[test]
fn lifecycle_attempt_outcomes_repetition_and_explicit_friction() {
    let sb = Sandbox::new();
    let store = sb.store();
    let id = begin(&store);
    Attempt::begin_at(&store.root, &id, "capture.start")
        .unwrap()
        .finish(true)
        .unwrap();
    Attempt::begin_at(&store.root, &id, "capture.start")
        .unwrap()
        .finish(false)
        .unwrap();
    execute(&store, note(&id, "friction")).unwrap();
    execute(&store, note(&id, "recovery")).unwrap();
    let trace = load(&store, &id).unwrap();
    let report = report(&trace);
    assert_eq!(report["operations"][0]["attempts"], 2);
    assert_eq!(report["operations"][0]["succeeded"], 1);
    assert_eq!(report["operations"][0]["failed"], 1);
    assert_eq!(report["repeated_operation_attempts"], 1);
    assert_eq!(report["friction"][0]["friction_notes"], 1);
    assert_eq!(trace.executable.sha256.len(), 64);
    let mut executable = File::open(std::env::current_exe().unwrap()).unwrap();
    assert_eq!(
        trace.executable.sha256,
        digest(&mut executable, None).unwrap().0
    );
    for event in &trace.events[..2] {
        let value = serde_json::to_value(event).unwrap();
        for forbidden in [
            "argv", "output", "stdout", "stderr", "env", "text", "path", "error", "cwd",
        ] {
            assert!(
                value.get(forbidden).is_none(),
                "automatic event leaked {forbidden}"
            );
        }
        assert!(value["elapsed_ms"].is_u64());
        assert!(value["pid"].is_u64());
    }
    execute(
        &store,
        Command::End {
            id: id.clone(),
            status: "delivered".into(),
        },
    )
    .unwrap();
    assert_eq!(load(&store, &id).unwrap().status, "delivered");
    assert!(Attempt::begin_at(&store.root, &id, "inspect").is_err());
    assert!(execute(&store, note(&id, "observation")).is_err());
}

#[test]
fn dropped_attempt_stays_running_and_resolve_does_not_invent_elapsed() {
    let sb = Sandbox::new();
    let store = sb.store();
    let id = begin(&store);
    let attempt = Attempt::begin_at(&store.root, &id, "export").unwrap();
    let event = attempt.event.clone();
    drop(attempt);
    assert!(
        execute(
            &store,
            Command::End {
                id: id.clone(),
                status: "blocked".into()
            }
        )
        .is_err()
    );
    let report = report(&load(&store, &id).unwrap());
    assert_eq!(report["operations"][0]["running"], 1);
    assert!(report["trace"]["events"][0]["elapsed_ms"].is_null());
    execute(
        &store,
        Command::Resolve {
            id: id.clone(),
            event: event.clone(),
            text: "checked owned process; it exited".into(),
        },
    )
    .unwrap();
    let trace = serde_json::to_value(load(&store, &id).unwrap()).unwrap();
    assert_eq!(trace["events"][0]["status"], "interrupted");
    assert!(trace["events"][0]["elapsed_ms"].is_null());
    assert!(trace["events"][0]["success"].is_null());
    assert!(
        execute(
            &store,
            Command::Resolve {
                id: id.clone(),
                event,
                text: "again".into()
            }
        )
        .is_err()
    );
    execute(
        &store,
        Command::End {
            id,
            status: "blocked".into(),
        },
    )
    .unwrap();
}

#[test]
fn resolve_wins_against_late_finish_without_overwriting_reconciliation() {
    let sb = Sandbox::new();
    let store = sb.store();
    let id = begin(&store);
    let attempt = Attempt::begin_at(&store.root, &id, "inspect").unwrap();
    execute(
        &store,
        Command::Resolve {
            id: id.clone(),
            event: attempt.event.clone(),
            text: "operator decision".into(),
        },
    )
    .unwrap();
    assert!(attempt.finish(true).is_err());
    assert_eq!(
        report(&load(&store, &id).unwrap())["operations"][0]["interrupted"],
        1
    );
}

#[test]
fn retained_copy_survives_missing_original_and_detects_tamper() {
    let sb = Sandbox::new();
    let store = sb.store();
    let id = begin(&store);
    let source = sb.0.join("source.mov");
    std::fs::write(&source, b"synthetic movie bytes").unwrap();
    artifact(&store, &id, "qa", "final", &source, true).unwrap();
    artifact(&store, &id, "qa", "reference", &source, false).unwrap();
    let trace = load(&store, &id).unwrap();
    assert_eq!(verify(&store, &trace)["ok"], true);
    std::fs::remove_file(&source).unwrap();
    let checked = verify(&store, &trace);
    assert_eq!(checked["artifacts"][0]["status"], "ok");
    assert_eq!(checked["artifacts"][1]["status"], "missing_or_unreadable");
    assert_eq!(checked["ok"], false);
    let EventData::Artifact {
        retained: Some(name),
        ..
    } = &trace.events[0].data
    else {
        panic!("retained copy missing")
    };
    std::fs::write(store.root.join(name), b"tampered").unwrap();
    assert_eq!(verify(&store, &trace)["artifacts"][0]["status"], "changed");
    // No registration overwrites an earlier retained copy.
    assert_eq!(std::fs::read(store.root.join(name)).unwrap(), b"tampered");
}

#[test]
fn modes_are_separate_and_private_store_is_not_the_prototype_store() {
    let sb = Sandbox::new();
    let store = sb.store();
    let live = begin(&store);
    let historical = start(&store, "old", "historical").unwrap().id;
    let synthetic = start(&store, "fixture", "synthetic-test").unwrap().id;
    for id in [&live, &historical, &synthetic] {
        Attempt::begin_at(&store.root, id, "inspect")
            .unwrap()
            .finish(true)
            .unwrap();
    }
    let report = execute(&store, Command::Report { id: None }).unwrap();
    let traces = report["traces"].as_array().unwrap();
    assert_eq!(traces.len(), 3);
    assert!(traces.iter().all(|t| t["operations"][0]["attempts"] == 1));
    let modes: std::collections::BTreeSet<_> = traces
        .iter()
        .map(|t| t["trace"]["mode"].as_str().unwrap())
        .collect();
    assert_eq!(
        modes,
        ["historical", "live", "synthetic-test"]
            .into_iter()
            .collect()
    );
    assert!(!store.root.join("traces.sqlite3").exists());
}

#[test]
fn private_permissions_and_unsafe_preexisting_paths_are_refused_not_repaired() {
    let sb = Sandbox::new();
    let store = sb.store();
    let id = begin(&store);
    assert_eq!(
        std::fs::metadata(&store.root).unwrap().mode() & 0o7777,
        0o700
    );
    for name in [".lock".to_owned(), format!("{id}.json")] {
        assert_eq!(
            std::fs::metadata(store.root.join(&name)).unwrap().mode() & 0o7777,
            0o600
        );
    }
    let trace_path = store.root.join(format!("{id}.json"));
    std::fs::set_permissions(&trace_path, std::fs::Permissions::from_mode(0o644)).unwrap();
    assert!(load(&store, &id).is_err());
    assert_eq!(
        std::fs::metadata(&trace_path).unwrap().mode() & 0o777,
        0o644
    );
    std::fs::set_permissions(&store.root, std::fs::Permissions::from_mode(0o755)).unwrap();
    assert!(store::Store::open(&store.root).is_err());
    assert_eq!(
        std::fs::metadata(&store.root).unwrap().mode() & 0o777,
        0o755
    );
}

#[test]
fn malicious_ids_symlinks_hardlinks_fifos_and_oversized_inputs_are_refused() {
    let sb = Sandbox::new();
    let store = sb.store();
    let id = begin(&store);
    for bad in [
        "",
        "../escape",
        "/absolute",
        ".",
        "..",
        "a/b",
        "a\nb",
        "--flag",
    ] {
        assert!(load(&store, bad).is_err());
        assert!(start(&store, bad, "live").is_err());
    }
    assert!(Attempt::begin_at(&store.root, &id, "inspect /private/file").is_err());
    assert!(Attempt::begin_at(&store.root, &id, "secret-token").is_err());
    let outside = sb.0.join("outside");
    std::fs::write(&outside, b"do not alter").unwrap();
    symlink(&outside, store.root.join("evil.json")).unwrap();
    assert!(load(&store, "evil").is_err());
    symlink(&store.root, sb.0.join("alias")).unwrap();
    assert!(store::Store::open(&sb.0.join("alias")).is_err());
    symlink(&outside, sb.0.join("source-link")).unwrap();
    assert!(artifact(&store, &id, "qa", "link", &sb.0.join("source-link"), true).is_err());
    let fifo = sb.0.join("fifo");
    let fifo_c = std::ffi::CString::new(fifo.as_os_str().as_encoded_bytes()).unwrap();
    assert_eq!(unsafe { libc::mkfifo(fifo_c.as_ptr(), 0o600) }, 0);
    assert!(artifact(&store, &id, "qa", "fifo", &fifo, true).is_err());
    let huge = sb.0.join("sparse");
    File::create(&huge)
        .unwrap()
        .set_len(MAX_ARTIFACT + 1)
        .unwrap();
    assert!(artifact(&store, &id, "qa", "huge", &huge, true).is_err());
    let lock = store.root.join(".lock");
    std::fs::remove_file(&lock).unwrap();
    symlink(&outside, &lock).unwrap();
    assert!(store.lock().is_err());
    std::fs::remove_file(&lock).unwrap();
    std::fs::hard_link(&outside, &lock).unwrap();
    assert!(store.lock().is_err());
    assert_eq!(std::fs::read(&outside).unwrap(), b"do not alter");
}

#[test]
fn relative_store_root_and_artifacts_survive_a_changed_cwd_in_an_isolated_process() {
    let sb = Sandbox::new();
    let store = sb.store();
    let id = begin(&store);
    let current = std::thread::current();
    let test_name = current.name().unwrap().replace(
        "relative_store_root_and_artifacts_survive_a_changed_cwd_in_an_isolated_process",
        "concurrent_writer_child",
    );
    let output = std::process::Command::new(std::env::current_exe().unwrap())
        .args(["--exact", &test_name, "--nocapture"])
        .current_dir(&sb.0)
        .env("APPARENT_TRACE_TEST_CHILD_ROOT", "traces")
        .env("APPARENT_TRACE_TEST_CHILD_ID", &id)
        .env("APPARENT_TRACE_TEST_RELATIVE", "1")
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(String::from_utf8_lossy(&output.stdout).contains("1 passed"));
    assert_eq!(verify(&store, &load(&store, &id).unwrap())["ok"], true);
}

#[test]
fn concurrent_writer_child() {
    let Some(root) = std::env::var_os("APPARENT_TRACE_TEST_CHILD_ROOT") else {
        return;
    };
    let id = std::env::var("APPARENT_TRACE_TEST_CHILD_ID").unwrap();
    let store = store::Store::open(Path::new(&root)).unwrap();
    if std::env::var_os("APPARENT_TRACE_TEST_RELATIVE").is_some() {
        let attempt = Attempt::begin_at(Path::new(&root), &id, "inspect").unwrap();
        assert!(attempt.root.is_absolute());
        std::fs::write("source", b"retained").unwrap();
        artifact(&store, &id, "qa", "copy", Path::new("source"), true).unwrap();
        artifact(&store, &id, "qa", "reference", Path::new("source"), false).unwrap();
        let elsewhere = store.root.parent().unwrap().join("elsewhere");
        std::fs::create_dir(&elsewhere).unwrap();
        std::env::set_current_dir(elsewhere).unwrap();
        attempt.finish(true).unwrap();
        assert_eq!(verify(&store, &load(&store, &id).unwrap())["ok"], true);
        return;
    }
    for _ in 0..12 {
        execute(&store, note(&id, "observation")).unwrap();
        Attempt::begin_at(&store.root, &id, "inspect")
            .unwrap()
            .finish(true)
            .unwrap();
    }
}

#[test]
fn concurrent_process_writers_preserve_every_event() {
    let sb = Sandbox::new();
    let store = sb.store();
    let id = begin(&store);
    let current = std::thread::current();
    let test_name = current.name().unwrap().replace(
        "concurrent_process_writers_preserve_every_event",
        "concurrent_writer_child",
    );
    let mut children = Vec::new();
    for _ in 0..4 {
        children.push(
            std::process::Command::new(std::env::current_exe().unwrap())
                .args(["--exact", &test_name, "--nocapture"])
                .env("APPARENT_TRACE_TEST_CHILD_ROOT", &store.root)
                .env("APPARENT_TRACE_TEST_CHILD_ID", &id)
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped())
                .spawn()
                .unwrap(),
        );
    }
    for child in children {
        let output = child.wait_with_output().unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(
            String::from_utf8_lossy(&output.stdout).contains("1 passed"),
            "child selected zero tests"
        );
    }
    let trace = load(&store, &id).unwrap();
    assert_eq!(trace.events.len(), 96);
    let events: std::collections::BTreeSet<_> =
        trace.events.iter().map(|event| &event.id).collect();
    assert_eq!(events.len(), 96);
    assert_eq!(report(&trace)["operations"][0]["attempts"], 48);
    assert_eq!(report(&trace)["operations"][0]["running"], 0);
}

#[cfg(target_os = "linux")]
#[test]
fn inherited_default_acl_cannot_expose_new_trace_content() {
    use std::os::unix::ffi::OsStrExt;
    let sb = Sandbox::new();
    let mut acl = 2u32.to_le_bytes().to_vec();
    // POSIX default ACL: grant another uid access, then ensure fchmod masks it out.
    for (tag, permissions, uid) in [
        (1u16, 7u16, u32::MAX),
        (2, 7, unsafe { libc::geteuid() }.wrapping_add(1)),
        (4, 7, u32::MAX),
        (16, 7, u32::MAX),
        (32, 7, u32::MAX),
    ] {
        acl.extend(tag.to_le_bytes());
        acl.extend(permissions.to_le_bytes());
        acl.extend(uid.to_le_bytes());
    }
    let path = std::ffi::CString::new(sb.0.as_os_str().as_bytes()).unwrap();
    let result = unsafe {
        libc::setxattr(
            path.as_ptr(),
            b"system.posix_acl_default\0".as_ptr().cast(),
            acl.as_ptr().cast(),
            acl.len(),
            0,
        )
    };
    if result != 0 {
        let error = std::io::Error::last_os_error();
        if matches!(
            error.raw_os_error(),
            Some(libc::EOPNOTSUPP) | Some(libc::EPERM)
        ) {
            eprintln!("default ACL fixture unavailable: {error}");
            return;
        }
        panic!("default ACL setup failed: {error}");
    }
    let store = sb.store();
    let id = begin(&store);
    let source = sb.0.join("source");
    std::fs::write(&source, b"private").unwrap();
    artifact(&store, &id, "qa", "copy", &source, true).unwrap();
    assert_eq!(
        std::fs::metadata(&store.root).unwrap().mode() & 0o7777,
        0o700
    );
    for entry in std::fs::read_dir(&store.root).unwrap() {
        assert_eq!(entry.unwrap().metadata().unwrap().mode() & 0o7777, 0o600);
    }
}
