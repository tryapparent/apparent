use super::*;
use std::{fs, io::BufRead, os::unix::fs::{PermissionsExt, symlink}, sync::atomic::{AtomicUsize, Ordering}};

fn shell(app: &Path) -> Command {
    let mut command = Command::new("bash");
    command.arg(concat!(env!("CARGO_MANIFEST_DIR"), "/capture/desktop/scripts/packaging/with-install-lock.sh")).arg(app);
    command
}
fn temporary() -> std::path::PathBuf {
    let path = std::env::temp_dir().join(format!("recipient-lock-{}", crate::shared::ids::make_bundle_id()));
    fs::create_dir(&path).unwrap();
    path
}
#[test]
fn shell_and_rust_reject_unsafe_lock_files() {
    let dir = temporary();
    let app = dir.join("Apparent.app");
    let lock = dir.join(".Apparent.app.recipient.lock");
    fs::write(&lock, "").unwrap();
    for mode in [0o644, 0o666] {
        fs::set_permissions(&lock, fs::Permissions::from_mode(mode)).unwrap();
        assert!(installation_lock::acquire(&app).is_err());
        assert!(!shell(&app).arg("true").output().unwrap().status.success());
    }
    fs::set_permissions(&lock, fs::Permissions::from_mode(0o600)).unwrap();
    fs::hard_link(&lock, dir.join("alias")).unwrap();
    assert!(installation_lock::acquire(&app).is_err());
    assert!(!shell(&app).arg("true").output().unwrap().status.success());
    fs::remove_file(&lock).unwrap();
    symlink(dir.join("alias"), &lock).unwrap();
    assert!(installation_lock::acquire(&app).is_err());
    assert!(!shell(&app).arg("true").output().unwrap().status.success());
    fs::remove_dir_all(dir).unwrap();
}

#[test]
#[cfg(not(target_os = "macos"))]
#[ignore = "requires genuine recipient fixture via APPARENT_TEST_RECIPIENT_EXECUTABLE"]
fn shell_installer_and_real_invocation_exclude_each_other() {
    let dir = temporary();
    let app = dir.join("Apparent.app");
    let root = app.join("Contents/MacOS/apparent");
    let package = root.parent().unwrap().join("recipient");
    fs::create_dir_all(&package).unwrap();
    let source = std::path::PathBuf::from(std::env::var_os("APPARENT_TEST_RECIPIENT_EXECUTABLE").expect("real fixture required"));
    let executable = package.join("apparent-connect-recipient");
    fs::copy(&source, &executable).unwrap();
    let digest = format!("{:x}", Sha256::digest(fs::read(&executable).unwrap()));
    let mut manifest: serde_json::Value = serde_json::from_slice(&fs::read(source.parent().unwrap().join("manifest.json")).unwrap()).unwrap();
    manifest["sha256"] = digest.clone().into();
    fs::write(package.join("manifest.json"), serde_json::to_vec(&manifest).unwrap()).unwrap();
    fs::set_permissions(&dir, fs::Permissions::from_mode(0o700)).unwrap();
    let request = Request { protocol: 1, operation: apparent_connect_client::recipient_protocol::Operation::Status { account: false } };
    let config = dir.join("config.json");
    let mutation = dir.join("mutated");
    let attempts = AtomicUsize::new(0);
    // invoke's second admission callback is deterministically after package hash verification.
    let allowed = || {
        if attempts.fetch_add(1, Ordering::SeqCst) == 1 {
            let result = shell(&app).args(["touch"]).arg(&mutation).output().unwrap();
            assert!(!result.status.success(), "installer entered after verification");
            assert!(!mutation.exists());
        }
        true
    };
    // Linux runs the real invocation path with Mac-shaped installation identity;
    // actual codesign/native Mac acceptance is deliberately separate.
    assert!(invoke(&root, &config, &digest, &request, &|_,_|{}, &allowed).is_ok());
    assert!(shell(&app).arg("touch").arg(&mutation).status().unwrap().success());
    fs::remove_file(&mutation).unwrap();
    // Reverse direction: actual shell lock survives exec into the installer workload.
    let mut installer = shell(&app).args(["bash", "-c", "echo ready; exec sleep 30"]).stdout(Stdio::piped()).spawn().unwrap();
    let mut ready = String::new();
    BufReader::new(installer.stdout.take().unwrap()).read_line(&mut ready).unwrap();
    assert_eq!(ready.trim(), "ready");
    assert!(invoke(&root, &config, &digest, &request, &|_,_|{}, &||true).unwrap_err().to_string().contains("busy"));
    installer.kill().unwrap(); installer.wait().unwrap();
    assert!(invoke(&root, &config, &digest, &request, &|_,_|{}, &||true).is_ok());
    // Cancellation after verification and failed verification both release Rust's guard.
    let calls = AtomicUsize::new(0);
    assert!(invoke(&root, &config, &digest, &request, &|_,_|{}, &|| calls.fetch_add(1, Ordering::SeqCst) == 0).is_err());
    assert!(shell(&app).arg("true").status().unwrap().success());
    assert!(invoke(&root, &config, &"0".repeat(64), &request, &|_,_|{}, &||true).is_err());
    assert!(shell(&app).arg("true").status().unwrap().success());
    fs::remove_dir_all(dir).unwrap();
}
