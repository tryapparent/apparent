use apparent_config_native::{
    CasResult, ConfigPublicationUncertain, compare_and_swap_stream_state_in,
    legacy_capture_writer_retired_allowed_in, legacy_capture_writer_retired_in,
    retire_legacy_capture_writer_allowed_in, retire_legacy_capture_writer_in,
    set_config_directory_sync_failure, set_config_value_in, set_config_write_hook,
    update_config_in,
};
use serde_json::{Value, json};
use std::{
    fs,
    os::unix::fs::DirBuilderExt,
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
};

fn temp() -> PathBuf {
    let path = std::env::temp_dir().join(format!(
        "apparent-config-capture-writer-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos(),
    ));
    fs::DirBuilder::new().mode(0o700).create(&path).unwrap();
    path.canonicalize().unwrap()
}

fn config(path: &PathBuf) -> Value {
    serde_json::from_slice(&fs::read(path).unwrap()).unwrap()
}

#[test]
fn marker_is_absent_then_retired_and_survives_restart_reads() {
    let dir = temp();
    let path = dir.join("config.json");
    fs::write(
        &path,
        br#"{"unrelated":{"keep":true},"onboarding":{"step":2},"token":"synthetic"}"#,
    )
    .unwrap();
    assert!(!legacy_capture_writer_retired_in(&path).unwrap());
    retire_legacy_capture_writer_in(&path).unwrap();
    assert!(legacy_capture_writer_retired_in(&path).unwrap());
    assert!(
        legacy_capture_writer_retired_in(&path).unwrap(),
        "a fresh read sees persisted retirement"
    );
    assert_eq!(
        config(&path),
        json!({
            "unrelated":{"keep":true}, "onboarding":{"step":2}, "token":"synthetic",
            "legacyCaptureWriter":{"schema":1,"state":"retired"}
        })
    );
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn malformed_marker_fails_closed_for_read_and_retirement() {
    let dir = temp();
    let path = dir.join("config.json");
    fs::write(
        &path,
        br#"{"legacyCaptureWriter":{"schema":1,"state":"active"}}"#,
    )
    .unwrap();
    assert!(legacy_capture_writer_retired_in(&path).is_err());
    assert!(retire_legacy_capture_writer_in(&path).is_err());
    assert_eq!(config(&path)["legacyCaptureWriter"]["state"], "active");
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn ordinary_helpers_cannot_add_remove_or_replace_marker_or_erase_a_stale_snapshot() {
    let dir = temp();
    let path = dir.join("config.json");
    fs::write(&path, br#"{"unrelated":1}"#).unwrap();
    let stale: Value = fs::read(&path)
        .map(|bytes| serde_json::from_slice(&bytes).unwrap())
        .unwrap();
    assert!(set_config_value_in(&path, "legacyCaptureWriter", Value::Null).is_err());
    assert!(
        update_config_in(&path, |value| {
            value["legacyCaptureWriter"] = json!({"schema":1,"state":"retired"});
            Ok(())
        })
        .is_err()
    );
    assert!(!legacy_capture_writer_retired_in(&path).unwrap());

    retire_legacy_capture_writer_in(&path).unwrap();
    assert!(
        update_config_in(&path, |value| {
            *value = stale.clone();
            Ok(())
        })
        .is_err(),
        "stale whole-config replacement cannot erase retirement"
    );
    assert!(
        set_config_value_in(
            &path,
            "legacyCaptureWriter",
            json!({"schema":1,"state":"active"})
        )
        .is_err()
    );
    assert!(
        update_config_in(&path, |value| {
            value["legacyCaptureWriter"] = json!({"schema":1,"state":"active"});
            Ok(())
        })
        .is_err()
    );
    assert!(
        update_config_in(&path, |value| {
            value.as_object_mut().unwrap().remove("legacyCaptureWriter");
            Ok(())
        })
        .is_err()
    );
    assert_eq!(
        compare_and_swap_stream_state_in(&path, "desktop", 0, json!({"revision":1})).unwrap(),
        CasResult::Saved { revision: 1 }
    );
    assert!(legacy_capture_writer_retired_in(&path).unwrap());
    assert_eq!(config(&path)["unrelated"], 1);
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn retirement_repeat_republishes_after_uncertain_directory_sync() {
    let dir = temp();
    let path = dir.join("config.json");
    let syncs = Arc::new(AtomicUsize::new(0));
    let observed = syncs.clone();
    set_config_write_hook(Some(Box::new(move |point, _| {
        if point == "before_directory_sync" {
            observed.fetch_add(1, Ordering::SeqCst);
        }
    })));

    set_config_directory_sync_failure(true);
    let first = retire_legacy_capture_writer_in(&path).unwrap_err();
    assert!(
        first.downcast_ref::<ConfigPublicationUncertain>().is_some(),
        "published marker has uncertain durability: {first:#}"
    );
    assert!(legacy_capture_writer_retired_in(&path).unwrap());

    set_config_directory_sync_failure(true);
    let repeated = retire_legacy_capture_writer_in(&path).unwrap_err();
    assert!(
        repeated
            .downcast_ref::<ConfigPublicationUncertain>()
            .is_some()
    );
    assert_eq!(
        syncs.load(Ordering::SeqCst),
        2,
        "explicit repeat rewrites and reaches directory sync again"
    );
    set_config_write_hook(None);
    assert!(legacy_capture_writer_retired_in(&path).unwrap());
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn expired_operations_do_not_wait_for_writer_lock_or_publish_marker() {
    use std::{os::fd::AsRawFd, os::unix::fs::OpenOptionsExt};
    let dir = temp();
    let path = dir.join("config.json");
    let lock = fs::OpenOptions::new()
        .write(true)
        .create(true)
        .mode(0o600)
        .open(dir.join("config.json.lock"))
        .unwrap();
    assert_eq!(unsafe { libc::flock(lock.as_raw_fd(), libc::LOCK_EX) }, 0);

    let started = std::time::Instant::now();
    assert!(legacy_capture_writer_retired_allowed_in(&path, &|| false).is_err());
    assert!(retire_legacy_capture_writer_allowed_in(&path, &|| false).is_err());
    assert!(
        started.elapsed() < std::time::Duration::from_millis(250),
        "expired operations must not sit on the writer lock"
    );
    assert!(
        !path.exists(),
        "an expired retirement request publishes no config or marker"
    );
    drop(lock);
    fs::remove_dir_all(dir).unwrap();
}
