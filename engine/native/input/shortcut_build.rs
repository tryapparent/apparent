use std::{path::PathBuf, process::Command};

pub(super) fn compile() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("linux") {
        println!("cargo:rerun-if-changed=record/enablement/ci/bend/modules.json");
        println!("cargo:rerun-if-changed=shared/enablement/bend");
        super::emit_native_policy("record", "push-to-talk", "shortcuts/push-to-talk.bend");
    }
    let generator = "record/enablement/shortcuts/native.ts";
    println!("cargo:rerun-if-changed={generator}");
    println!("cargo:rerun-if-changed=record/shortcuts/policy.ts");
    let target = std::env::var("CARGO_CFG_TARGET_OS").expect("Cargo target OS");
    let generated = Command::new("node")
        .args(["--experimental-strip-types", generator, &target])
        .output()
        .expect("Node 22 is required to compile Record shortcut policy");
    assert!(
        generated.status.success(),
        "Unable to compile Record shortcut policy: {}",
        String::from_utf8_lossy(&generated.stderr),
    );
    let output = PathBuf::from(std::env::var_os("OUT_DIR").expect("Cargo output directory"));
    std::fs::write(output.join("record_shortcut_policy.rs"), generated.stdout)
        .expect("write generated Record shortcut policy");
}
