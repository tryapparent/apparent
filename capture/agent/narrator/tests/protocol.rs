use std::{
    fs,
    process::Command,
    sync::atomic::{AtomicUsize, Ordering},
};

static NEXT: AtomicUsize = AtomicUsize::new(0);
struct Fixture(std::path::PathBuf);
impl Fixture {
    fn new() -> Self {
        let dir = std::env::temp_dir().join(format!(
            "narrator-test-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&dir).unwrap();
        Self(dir)
    }
    fn run(&self, text: &[u8]) -> std::process::Output {
        fs::write(self.0.join("cue.txt"), text).unwrap();
        Command::new(env!("CARGO_BIN_EXE_apparent-narrator"))
            .arg(self.0.join("missing-model"))
            .arg(self.0.join("cue.txt"))
            .arg(self.0.join("out.wav"))
            .output()
            .unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
#[test]
fn rejects_empty_and_invalid_utf8_before_loading_model() {
    let f = Fixture::new();
    let result = f.run(b" \n\t");
    assert!(!result.status.success());
    assert!(String::from_utf8_lossy(&result.stderr).contains("cue text is empty"));
    assert!(!f.0.join("out.wav").exists());
    assert!(!f.run(&[0xff]).status.success());
    assert!(!f.0.join("out.wav").exists());
}
#[test]
fn preserves_existing_output_and_symlink_target() {
    let f = Fixture::new();
    fs::write(f.0.join("out.wav"), b"original").unwrap();
    let result = f.run(b"A short cue.");
    assert!(!result.status.success());
    assert!(String::from_utf8_lossy(&result.stderr).contains("output already exists"));
    assert_eq!(fs::read(f.0.join("out.wav")).unwrap(), b"original");
    fs::remove_file(f.0.join("out.wav")).unwrap();
    std::os::unix::fs::symlink(f.0.join("cue.txt"), f.0.join("out.wav")).unwrap();
    assert!(!f.run(b"A short cue.").status.success());
    assert_eq!(fs::read(f.0.join("cue.txt")).unwrap(), b"A short cue.");
}
#[test]
fn missing_assets_leave_no_output() {
    let f = Fixture::new();
    assert!(!f.run(b"A short cue.").status.success());
    assert!(!f.0.join("out.wav").exists());
}
#[test]
fn requires_exactly_three_arguments() {
    let result = Command::new(env!("CARGO_BIN_EXE_apparent-narrator"))
        .output()
        .unwrap();
    assert!(!result.status.success());
    assert!(
        String::from_utf8_lossy(&result.stderr).contains("MODEL_DIRECTORY TEXT_FILE OUTPUT_WAV")
    );
}
