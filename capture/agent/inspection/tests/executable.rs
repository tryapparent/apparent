use std::{fs, path::PathBuf, process::Command};
struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("apparent-inspection-{}", std::process::id()));
        fs::create_dir_all(path.join("legacy.apparent")).unwrap();
        fs::write(path.join("legacy.apparent/apparent.json"), include_bytes!("fixtures/legacy.json")).unwrap();
        Self(path)
    }
    fn run(&self, args: &[&str]) -> std::process::Output {
        Command::new(env!("CARGO_BIN_EXE_apparent-inspect"))
            .current_dir(&self.0).env("HOME", &self.0).env("APPARENT_CAPTURES_DIR", &self.0)
            .args(args).output().unwrap()
    }
}
impl Drop for Fixture { fn drop(&mut self) { fs::remove_dir_all(&self.0).unwrap(); } }
#[test]
fn legacy_outputs_errors_and_read_only_lookup() {
    let f = Fixture::new();
    let manifest = f.0.join("legacy.apparent/apparent.json");
    let before = fs::read(&manifest).unwrap();
    let modified = fs::metadata(&manifest).unwrap().modified().unwrap();
    let output = f.run(&["latest", "--json"]);
    assert!(output.status.success(), "{:?}", output);
    let value: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(value["id"], "legacy");
    assert_eq!(value["durationMs"], 20000);
    assert!(value.get("context").is_none());
    for path in ["legacy", "legacy.apparent", "legacy.apparent/apparent.json"] {
        let output = f.run(&[path]);
        assert!(output.status.success());
        let text = String::from_utf8(output.stdout).unwrap();
        assert!(text.contains("Read this."));
        assert!(text.contains(f.0.join("legacy.apparent").to_str().unwrap()));
    }
    assert_eq!(f.run(&["latest", "--marks"]).stdout, b"No marks\n");
    assert_eq!(f.run(&["latest", "--marks", "--json"]).stdout, b"[]\n");
    // Canonical remote-looking IDs are local here: no fetch/login/network path.
    let missing = f.run(&["0123456789abcdef0123456789abcdef"]);
    assert_eq!(missing.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&missing.stderr).contains("Bundle directory not found:"));
    fs::create_dir(f.0.join("bad.apparent")).unwrap();
    fs::write(f.0.join("bad.apparent/apparent.json"), b"{").unwrap();
    let invalid = f.run(&["bad.apparent"]);
    assert_eq!(invalid.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&invalid.stderr).contains("Invalid bundle manifest:"));
    fs::create_dir(f.0.join("current.apparent")).unwrap();
    fs::write(f.0.join("current.apparent/apparent.json"), include_bytes!("fixtures/current.json")).unwrap();
    for (name, flags, expected) in [
        ("legacy", vec![], include_str!("fixtures/legacy.md")),
        ("legacy", vec!["--json"], include_str!("fixtures/legacy.normalized.json")),
        ("current", vec![], include_str!("fixtures/current.md")),
        ("current", vec!["--json"], include_str!("fixtures/current.normalized.json")),
        ("current", vec!["--experiment", "agentContext"], include_str!("fixtures/current.agent.md")),
        ("current", vec!["--marks", "--json"], include_str!("fixtures/current.marks.json")),
    ] {
        let directory = format!("{name}.apparent");
        let mut args = vec![directory.as_str()];
        args.extend(flags);
        let output = f.run(&args);
        assert!(output.status.success());
        let actual = String::from_utf8(output.stdout).unwrap()
            .replace(f.0.join(directory).to_str().unwrap(), "@BUNDLE@");
        assert_eq!(actual, expected);
    }
    assert_eq!(fs::metadata(&manifest).unwrap().modified().unwrap(), modified);
    assert_eq!(fs::read(manifest).unwrap(), before);
    assert_eq!(f.run(&["--unknown-option"]).status.code(), Some(2));
    assert_eq!(fs::read_dir(f.0.join("legacy.apparent")).unwrap().count(), 1);
    assert!(!f.0.join(".config").exists());
}
