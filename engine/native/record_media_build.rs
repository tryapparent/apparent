use std::{path::PathBuf, process::Command};

pub(crate) fn compile_record_media() {
    let generator = "record/enablement/ci/bend/embed-media.ts";
    for input in [
        generator,
        "record/enablement/ci/bend/modules.json",
        "record/media/src/assembly-policy.ts",
        "record/media/src/assembly",
        "record/media/src/frames-policy.ts",
        "record/media/src/selection",
        "record/media/src/transcript",
        "shared/enablement/bend",
    ] {
        println!("cargo:rerun-if-changed={input}");
    }
    let output = PathBuf::from(std::env::var_os("OUT_DIR").expect("Cargo output directory"));
    let result = Command::new("node")
        .arg(generator)
        .arg(output.join("record-media-policies.mjs"))
        .output()
        .expect("Node 22 is required to compile Record media policy");
    assert!(
        result.status.success(),
        "Unable to compile Record media policy: {}",
        String::from_utf8_lossy(&result.stderr),
    );
}
