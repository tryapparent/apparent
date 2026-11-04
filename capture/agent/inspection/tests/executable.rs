use std::{fs, path::PathBuf, process::Command, sync::atomic::{AtomicU64, Ordering}};
struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let path = std::env::temp_dir().join(format!("apparent-inspection-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed)));
        fs::create_dir(&path).unwrap();
        // macOS temp roots can be symlinks; output intentionally uses absolute canonical paths.
        let path = path.canonicalize().unwrap();
        fs::create_dir(path.join("legacy.apparent")).unwrap();
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

#[test]
fn default_configured_and_environment_capture_lookup() {
    let f = Fixture::new();
    let run = |captures: Option<&std::path::Path>, args: &[&str]| {
        let mut command = Command::new(env!("CARGO_BIN_EXE_apparent-inspect"));
        command.current_dir(&f.0).env("HOME", &f.0).env_remove("APPARENT_CAPTURES_DIR")
            .env_remove("XDG_DATA_HOME");
        if let Some(path) = captures { command.env("APPARENT_CAPTURES_DIR", path); }
        command.args(args).output().unwrap()
    };
    let default = f.0.join(if cfg!(target_os = "macos") {
        "Library/Application Support/apparent/captures"
    } else { ".local/share/apparent/captures" });
    fs::create_dir_all(default.join("legacy.apparent")).unwrap();
    fs::copy(f.0.join("legacy.apparent/apparent.json"), default.join("legacy.apparent/apparent.json")).unwrap();
    let id = |output: std::process::Output| {
        assert!(output.status.success(), "{:?}", output);
        serde_json::from_slice::<serde_json::Value>(&output.stdout).unwrap()["id"].clone()
    };
    assert_eq!(id(run(None, &["latest", "--json"])), "legacy");
    let config_path = f.0.join(".config/apparent/config.json");
    fs::create_dir_all(config_path.parent().unwrap()).unwrap();
    let configured = f.0.join("configured captures");
    fs::create_dir_all(configured.join("current.apparent")).unwrap();
    fs::write(configured.join("current.apparent/apparent.json"), include_bytes!("fixtures/current.json")).unwrap();
    for captures_dir in [configured.to_str().unwrap().to_owned(), "~/configured captures".to_owned()] {
        let config = serde_json::to_vec(&serde_json::json!({"capturesDir": captures_dir,
            "experiments": {"agentContext": true}, "unrelated": "retain"})).unwrap();
        fs::write(&config_path, &config).unwrap();
        assert_eq!(id(run(None, &["latest", "--json"])), "current");
        assert_eq!(id(run(None, &["current", "--json"])), "current");
        let output = run(None, &["current"]);
        assert!(output.status.success());
        assert_eq!(String::from_utf8(output.stdout).unwrap()
            .replace(configured.join("current.apparent").to_str().unwrap(), "@BUNDLE@"),
            include_str!("fixtures/current.agent.md"));
        assert_eq!(id(run(Some(&f.0), &["latest", "--json"])), "legacy");
        assert_eq!(fs::read(&config_path).unwrap(), config);
    }
    fs::write(&config_path, b"{\"capturesDir\":\"relative\"}").unwrap();
    assert_eq!(id(run(None, &["latest", "--json"])), "legacy");
    fs::write(&config_path, b"{").unwrap();
    assert_eq!(id(run(None, &["latest", "--json"])), "legacy");
    // Inspection must not create a configured capture location or mutate config.
    let missing = f.0.join("missing");
    let config = serde_json::to_vec(&serde_json::json!({"capturesDir":missing})).unwrap();
    fs::write(&config_path, &config).unwrap();
    assert_eq!(run(None, &["latest"]).status.code(), Some(1));
    assert!(!missing.exists());
    assert_eq!(fs::read(config_path).unwrap(), config);
}
