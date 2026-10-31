//! Storage-owned contracts using only private synthetic paths and real child processes.
use super::*;
use serde_json::json;
use std::os::unix::fs::{DirBuilderExt, MetadataExt, symlink};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        static COUNT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let root = std::env::temp_dir().join(format!(
            "config-store-{}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            COUNT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        fs::DirBuilder::new().mode(0o700).create(&root).unwrap();
        Self(root)
    }
    fn path(&self) -> PathBuf {
        self.0.join("config.json")
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

struct Worker(Child);
impl Worker {
    fn start(root: &Path, mode: &str, id: usize) -> Self {
        Self(
            Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "handoff::config_store::tests::subprocess_writer",
                    "--test-threads=1",
                ])
                .env("APPARENT_STORE_TEST_ROOT", root)
                .env("APPARENT_STORE_TEST_MODE", mode)
                .env("APPARENT_STORE_TEST_ID", id.to_string())
                .stdout(Stdio::null())
                .stderr(Stdio::inherit())
                .spawn()
                .unwrap(),
        )
    }
    fn finish(&mut self) {
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            if let Some(status) = self.0.try_wait().unwrap() {
                assert!(status.success(), "storage subprocess failed: {status}");
                return;
            }
            assert!(Instant::now() < deadline, "storage subprocess timed out");
            std::thread::sleep(Duration::from_millis(5));
        }
    }
}
impl Drop for Worker {
    fn drop(&mut self) {
        if self.0.try_wait().ok().flatten().is_none() {
            let _ = self.0.kill();
        }
        let _ = self.0.wait();
    }
}

#[test]
fn donor_has_no_desktop_dependencies() {
    let source = include_str!("config_store.rs");
    assert!(
        !source.contains("crate::"),
        "storage still imports an application capability"
    );
    assert!(
        !source.contains("super::"),
        "storage still imports its Desktop parent"
    );
}

#[test]
fn subprocess_writer() {
    // Re-entered by Worker with only a synthetic fixture path.
    let Some(root) = std::env::var_os("APPARENT_STORE_TEST_ROOT") else {
        return;
    };
    let root = PathBuf::from(root);
    let path = root.join("config.json");
    let mode = std::env::var("APPARENT_STORE_TEST_MODE").unwrap();
    let id = std::env::var("APPARENT_STORE_TEST_ID").unwrap();
    if mode == "path" {
        assert_eq!(default_config_path(), path);
        return;
    }
    if mode == "write-failure" {
        // A real partial write failure, isolated to this process. Never change the
        // parent's resource limits or permissions to simulate an I/O failure.
        unsafe {
            libc::signal(libc::SIGXFSZ, libc::SIG_IGN);
            let limit = libc::rlimit {
                rlim_cur: 16,
                rlim_max: 16,
            };
            assert_eq!(libc::setrlimit(libc::RLIMIT_FSIZE, &limit), 0);
        }
        assert!(set_config_value_in(&path, "transcribeCommand", "x".repeat(4096).into()).is_err());
        return;
    }
    if mode == "refusal" {
        assert!(set_config_value_in(&path, "autoSend", true.into()).is_err());
        return;
    }
    let ready = root.join(format!("ready-{id}"));
    set_config_write_hook(Some(Box::new(move |point, _| {
        if point == "before_lock" {
            fs::write(&ready, b"ready").unwrap();
        }
    })));
    for n in 0..20 {
        update_config_in(&path, |value| {
            value[format!("worker-{id}-{n}")] = n.into();
            value["nested"][format!("worker-{id}-{n}")] = true.into();
            Ok(())
        })
        .unwrap();
    }
    set_config_write_hook(None);
}

#[test]
fn subprocess_transactions_preserve_unknown_nested_keys_and_lock_identity() {
    let f = Fixture::new();
    let original =
        json!({"nested":{"unknown":{"keep":[1,2,3]}},"syntheticSecret":"not-a-real-token"});
    fs::write(f.path(), serde_json::to_vec(&original).unwrap()).unwrap();
    let alias = f.0.join("alias");
    symlink(&f.0, &alias).unwrap();
    let mut workers = Vec::new();
    update_config_in(&f.path(), |value| {
        let lock_before = fs::metadata(f.0.join("config.json.lock")).unwrap();
        for id in 0..3 {
            workers.push(Worker::start(
                if id == 1 { &alias } else { &f.0 },
                "edit",
                id,
            ));
        }
        let deadline = Instant::now() + Duration::from_secs(5);
        while !(0..3).all(|id| f.0.join(format!("ready-{id}")).exists()) {
            assert!(
                Instant::now() < deadline,
                "children never reached writer boundary"
            );
            std::thread::sleep(Duration::from_millis(5));
        }
        std::thread::sleep(Duration::from_millis(100));
        assert!(
            workers
                .iter_mut()
                .all(|child| child.0.try_wait().unwrap().is_none()),
            "child bypassed the parent's read/edit lock"
        );
        value["nested"]["parent"] = true.into();
        assert_eq!(
            fs::metadata(f.0.join("config.json.lock")).unwrap().ino(),
            lock_before.ino()
        );
        Ok(())
    })
    .unwrap();
    let lock_before = fs::metadata(f.0.join("config.json.lock")).unwrap();
    for worker in &mut workers {
        worker.finish();
    }
    let value = read_value_from(&f.path()).unwrap();
    assert_eq!(value["syntheticSecret"], original["syntheticSecret"]);
    assert_eq!(value["nested"]["unknown"], original["nested"]["unknown"]);
    assert_eq!(value["nested"]["parent"], true);
    for id in 0..3 {
        for n in 0..20 {
            assert_eq!(value[format!("worker-{id}-{n}")], n);
            assert_eq!(value["nested"][format!("worker-{id}-{n}")], true);
        }
    }
    let lock_after = fs::metadata(f.0.join("config.json.lock")).unwrap();
    assert_eq!(
        (lock_before.dev(), lock_before.ino()),
        (lock_after.dev(), lock_after.ino())
    );
    assert_eq!(fs::metadata(f.path()).unwrap().mode() & 0o777, 0o600);
}

#[test]
fn subprocess_partial_write_failure_keeps_original_and_cleans_temporary_file() {
    let f = Fixture::new();
    let bytes = br#"{"syntheticSecret":"not-a-real-token","unknown":{"nested":[1,2,3]}}"#;
    fs::write(f.path(), bytes).unwrap();
    Worker::start(&f.0, "write-failure", 0).finish();
    assert_eq!(fs::read(f.path()).unwrap(), bytes);
    let names: std::collections::BTreeSet<_> = fs::read_dir(&f.0)
        .unwrap()
        .map(|entry| entry.unwrap().file_name())
        .collect();
    assert_eq!(
        names,
        ["config.json", "config.json.lock"].map(Into::into).into()
    );
    // A subsequent process can use the same sidecar after error cleanup.
    Worker::start(&f.0, "edit", 0).finish();
    assert_eq!(
        read_value_from(&f.path()).unwrap()["unknown"]["nested"],
        json!([1, 2, 3])
    );
}

#[test]
fn subprocess_refuses_invalid_config_and_unsafe_files_without_changes() {
    let f = Fixture::new();
    for bytes in [b"".as_slice(), b" \n", b"{", b"[]", b"null", b"false"] {
        fs::write(f.path(), bytes).unwrap();
        Worker::start(&f.0, "refusal", 0).finish();
        assert_eq!(fs::read(f.path()).unwrap(), bytes);
    }
    let outside = f.0.join("outside.json");
    let bytes = br#"{"syntheticSecret":"not-a-real-token"}"#;
    fs::write(&outside, bytes).unwrap();
    fs::remove_file(f.path()).unwrap();
    symlink(&outside, f.path()).unwrap();
    Worker::start(&f.0, "refusal", 0).finish();
    assert!(
        fs::symlink_metadata(f.path())
            .unwrap()
            .file_type()
            .is_symlink()
    );
    assert_eq!(fs::read(&outside).unwrap(), bytes);
    fs::remove_file(f.path()).unwrap();
    fs::remove_file(f.0.join("config.json.lock")).unwrap();
    symlink(&outside, f.0.join("config.json.lock")).unwrap();
    Worker::start(&f.0, "refusal", 0).finish();
    assert!(!f.path().exists());
    assert_eq!(fs::read(&outside).unwrap(), bytes);
}

#[test]
fn edit_error_and_unwind_publish_nothing_and_release_lock() {
    let f = Fixture::new();
    let bytes = br#"{"nested":{"unknown":true},"syntheticSecret":"not-a-real-token"}"#;
    fs::write(f.path(), bytes).unwrap();
    assert!(
        update_config_in(&f.path(), |value| {
            value["nested"]["unknown"] = false.into();
            anyhow::bail!("caller refuses edit")
        })
        .is_err()
    );
    assert_eq!(fs::read(f.path()).unwrap(), bytes);
    let panic =
        std::panic::catch_unwind(|| update_config_in(&f.path(), |_| panic!("caller unwinds")));
    assert!(panic.is_err());
    assert_eq!(fs::read(f.path()).unwrap(), bytes);
    Worker::start(&f.0, "edit", 0).finish();
    assert_eq!(
        read_value_from(&f.path()).unwrap()["nested"]["unknown"],
        true
    );
}

#[test]
fn setting_a_key_never_replaces_an_invalid_existing_config() {
    let fixture = Fixture::new();
    let path = fixture.path();
    for bytes in [
        b"{\"ingestToken\":\"private\",".as_slice(),
        b"[]".as_slice(),
    ] {
        fs::write(&path, bytes).unwrap();
        assert!(set_config_value_in(&path, "autoSend", false.into()).is_err());
        assert_eq!(fs::read(&path).unwrap(), bytes);
    }
}

#[test]
fn config_path_override_is_process_local() {
    let f = Fixture::new();
    // Environment changes belong only to the child, never the parallel test process.
    let status = Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "handoff::config_store::tests::subprocess_writer"])
        .env("APPARENT_STORE_TEST_ROOT", &f.0)
        .env("APPARENT_STORE_TEST_MODE", "path")
        .env("APPARENT_STORE_TEST_ID", "0")
        .env("APPARENT_CONFIG", f.path())
        .status()
        .unwrap();
    assert!(status.success());
}
