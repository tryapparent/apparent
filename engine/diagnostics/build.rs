use std::path::PathBuf;
use std::process::Command;

pub fn compile() {
    for input in [
        "shared/analytics/sparkle-outcomes.bend",
        "shared/enablement/ci/bend",
        "shared/enablement/bend",
    ] {
        println!("cargo:rerun-if-changed={input}");
    }
    let output = PathBuf::from(std::env::var_os("OUT_DIR").expect("Cargo output directory"));
    let result = Command::new("node")
        .arg("shared/enablement/ci/bend/build.ts")
        .arg(output.join("sparkle-outcomes.mjs"))
        .output()
        .expect("Node 22 is required to compile Sparkle outcomes");
    assert!(
        result.status.success(),
        "Unable to compile Sparkle outcomes: {}",
        String::from_utf8_lossy(&result.stderr),
    );
}
