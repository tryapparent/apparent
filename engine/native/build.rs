use std::path::PathBuf;
use std::process::Command;

fn main() {
    println!("cargo:rerun-if-changed=macos/Probe.swift");
    println!("cargo:rerun-if-changed=macos/Frames.swift");
    println!("cargo:rerun-if-env-changed=DEVELOPER_DIR");
    println!("cargo:rerun-if-env-changed=SDKROOT");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("macos") {
        return;
    }
    let out = PathBuf::from(std::env::var_os("OUT_DIR").unwrap());
    let arch = std::env::var("CARGO_CFG_TARGET_ARCH").unwrap();
    let arch = if arch == "aarch64" { "arm64" } else { &arch };
    let mut helpers = vec![("Probe.swift", "apparent-engine-probe")];
    if std::env::var_os("CARGO_FEATURE_FRAMES").is_some() {
        helpers.push(("Frames.swift", "apparent-engine-frames-native"));
    }
    // Cargo stages siblings for normal binaries; no application helper is imported.
    let profile = out
        .ancestors()
        .find(|p| p.file_name().is_some_and(|n| n == "build"))
        .and_then(|p| p.parent())
        .expect("Cargo profile directory");
    for (source, name) in helpers {
        let helper = out.join(name);
        assert!(
            Command::new("xcrun")
                .args([
                    "swiftc",
                    "-O",
                    "-swift-version",
                    "5",
                    "-parse-as-library",
                    "-target"
                ])
                .arg(format!("{arch}-apple-macos15.0"))
                .arg(format!("macos/{source}"))
                .arg("-o")
                .arg(&helper)
                .status()
                .expect("Xcode is required to build the Mac provider")
                .success(),
            "Engine native helper compilation failed"
        );
        std::fs::copy(&helper, profile.join(name)).unwrap();
    }
}
